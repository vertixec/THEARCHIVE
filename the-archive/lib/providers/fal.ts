// FAL provider — wraps @fal-ai/client's queue API (submit -> status -> result).
//
// The client is a global singleton, so credentials are (re)applied before every
// call rather than once at module load: a serverless instance can be reused
// across requests and we never want a stale/absent key.

import { fal } from '@fal-ai/client';
import type { GenerationProvider, PollParams, ProviderPoll, SubmitParams } from './types';
import { ProviderSubmitError } from './types';
import type { GenerationType } from '../modelCatalog';

const FAL_HOST_PATTERNS = [/(^|\.)fal\.media$/i, /(^|\.)fal\.ai$/i, /(^|\.)fal\.run$/i];

type FalResult = {
  data?: {
    images?: { url?: string }[];
    video?: { url?: string };
  };
};

export function getFalApiKey(): string | null {
  return process.env.FAL_API_KEY || process.env.FAL_KEY || null;
}

/** Applies credentials to the shared client. Throws when the key is missing. */
function configure(): void {
  const key = getFalApiKey();
  if (!key) throw new ProviderSubmitError('FAL API key is not configured');
  fal.config({ credentials: key });
}

export function getFalErrorBody(error: unknown) {
  if (typeof error !== 'object' || error === null || !('body' in error)) return null;
  return (error as { body?: unknown }).body ?? null;
}

function getFalErrorCode(body: unknown) {
  if (typeof body !== 'object' || body === null || !('detail' in body)) return null;
  const detail = (body as { detail?: unknown }).detail;
  if (!Array.isArray(detail)) return null;
  const first = detail[0];
  if (typeof first !== 'object' || first === null || !('type' in first)) return null;
  return typeof (first as { type?: unknown }).type === 'string'
    ? (first as { type: string }).type
    : null;
}

/** Turns a FAL error body into copy the user can act on, when we recognise it. */
export function getFalUserMessage(body: unknown, type: GenerationType, hasReference: boolean) {
  const code = getFalErrorCode(body);
  if (code === 'file_download_error') {
    return 'FAL could not download the reference image. Upload the image file directly or use an image hosted in Supabase/FAL instead of a protected CDN URL.';
  }
  if (code === 'invalid_request' && hasReference) {
    return 'FAL rejected this reference edit. Try a clearer edit prompt, remove the reference, or upload the image directly instead of using an external URL.';
  }
  if (code === 'invalid_request') {
    return `FAL rejected this ${type} prompt. Try a more specific prompt or a different model.`;
  }
  return null;
}

function extractResultUrl(result: FalResult): string {
  return result.data?.images?.[0]?.url || result.data?.video?.url || '';
}

/**
 * Callback URL passed to fal.queue.submit so FAL notifies /api/fal/webhook when
 * a job finishes (finalization without the browser). Undefined when no public
 * https base URL is configured (e.g. local dev, where FAL can't reach us) —
 * everything still works via polling + the cron sweeper.
 */
export function buildFalWebhookUrl(): string | undefined {
  const base = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/+$/, '');
  if (!base || !base.startsWith('https://')) return undefined;
  const url = `${base}/api/fal/webhook`;
  const secret = process.env.FAL_WEBHOOK_SECRET;
  return secret ? `${url}?token=${encodeURIComponent(secret)}` : url;
}

export const falProvider: GenerationProvider = {
  id: 'fal',
  label: 'FAL',

  isConfigured() {
    return getFalApiKey() !== null;
  },

  async submit({ endpoint, input }: SubmitParams): Promise<string> {
    configure();
    try {
      const queued = await fal.queue.submit(endpoint, {
        input,
        webhookUrl: buildFalWebhookUrl(),
      });
      if (!queued.request_id) throw new Error('No request_id from FAL');
      return queued.request_id;
    } catch (error) {
      const body = getFalErrorBody(error);
      throw new ProviderSubmitError(
        error instanceof Error ? error.message : 'FAL submit failed',
        body,
        getFalUserMessage(body, 'image', false),
      );
    }
  },

  async poll({ endpoint, requestId, type }: PollParams): Promise<ProviderPoll> {
    configure();

    let statusValue: string;
    try {
      const queueStatus = await fal.queue.status(endpoint, { requestId });
      statusValue = queueStatus.status;
    } catch (error) {
      console.error('FAL status error:', {
        endpoint,
        message: error instanceof Error ? error.message : String(error),
      });
      // Transient lookup error — keep waiting. The sweeper's stale cutoff
      // covers the case where FAL genuinely lost the request.
      return { status: 'pending' };
    }

    if (statusValue !== 'COMPLETED') return { status: 'pending' };

    try {
      const result = (await fal.queue.result(endpoint, { requestId })) as FalResult;
      const url = extractResultUrl(result);
      if (!url) {
        return { status: 'failed', message: 'Generation produced no output. Please try again.' };
      }
      return { status: 'completed', url };
    } catch (error) {
      const body = getFalErrorBody(error);
      console.error('FAL result error:', {
        endpoint,
        message: error instanceof Error ? error.message : String(error),
        body,
      });
      return {
        status: 'failed',
        message:
          getFalUserMessage(body, type, false) ||
          'Generation failed. Please try again or use a different model.',
      };
    }
  },

  async uploadImage(blob: Blob): Promise<string> {
    configure();
    return fal.storage.upload(blob);
  },

  hostsUrl(url: string): boolean {
    try {
      const host = new URL(url).hostname;
      return FAL_HOST_PATTERNS.some((pattern) => pattern.test(host));
    } catch {
      return false;
    }
  },
};
