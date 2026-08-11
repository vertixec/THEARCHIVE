// KIE AI provider — https://docs.kie.ai
//
// KIE exposes one unified "Jobs" API for every model in its market:
//   POST /api/v1/jobs/createTask   { model, input, callBackUrl } -> { data: { taskId } }
//   GET  /api/v1/jobs/recordInfo?taskId=...                      -> { data: { state, resultJson, ... } }
//
// So the provider's `endpoint` is simply the KIE model string (see
// lib/modelCatalog.ts) and one recordInfo call answers both "is it done?" and
// "where's the media?".
//
// There is no vendor SDK — plain fetch keeps the bundle small and the failure
// modes obvious. Every response is treated as untrusted: KIE returns HTTP 200
// with a `code` field for application-level errors, so both layers are checked.

import type { GenerationProvider, PollParams, ProviderPoll, SubmitParams } from './types';
import { ProviderSubmitError } from './types';

const API_BASE = 'https://api.kie.ai';
const REQUEST_TIMEOUT_MS = 30_000;
const UPLOAD_TIMEOUT_MS = 60_000;

// Buckets KIE serves generated media and uploaded references from. Used to skip
// a pointless re-upload when a reference is already on KIE's own CDN.
const KIE_HOST_PATTERNS = [
  /(^|\.)kie\.ai$/i,
  /(^|\.)redpandaai\.co$/i,
  /(^|\.)aiquickdraw\.com$/i,
];

type KieEnvelope<T> = {
  code?: number;
  msg?: string;
  data?: T;
};

type KieTaskRecord = {
  taskId?: string;
  model?: string;
  state?: 'waiting' | 'queuing' | 'generating' | 'success' | 'fail';
  resultJson?: string | null;
  failCode?: string | null;
  failMsg?: string | null;
  creditsConsumed?: number | null;
};

export function getKieApiKey(): string | null {
  return process.env.KIE_API_KEY || process.env.KIE_KEY || null;
}

function requireKey(): string {
  const key = getKieApiKey();
  if (!key) throw new ProviderSubmitError('KIE API key is not configured');
  return key;
}

/**
 * Callback URL passed as `callBackUrl` so KIE pushes to /api/kie/webhook when a
 * task finishes. Undefined without a public https base URL (local dev) — the
 * browser poll and the cron sweeper still finalize the job.
 */
export function buildKieWebhookUrl(): string | undefined {
  const base = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/+$/, '');
  if (!base || !base.startsWith('https://')) return undefined;
  const url = `${base}/api/kie/webhook`;
  const secret = process.env.KIE_WEBHOOK_SECRET;
  return secret ? `${url}?token=${encodeURIComponent(secret)}` : url;
}

async function readEnvelope<T>(response: Response): Promise<KieEnvelope<T>> {
  const text = await response.text();
  try {
    return JSON.parse(text) as KieEnvelope<T>;
  } catch {
    return { code: response.status, msg: text.slice(0, 300) };
  }
}

/** True when KIE accepted the call at both the HTTP and application layer. */
function isOk(response: Response, envelope: KieEnvelope<unknown>): boolean {
  return response.ok && (envelope.code === undefined || envelope.code === 200);
}

/**
 * KIE returns results as a JSON *string*: `{"resultUrls":["https://..."]}`.
 * Text-ish models use `resultObject` instead, which we don't generate — so a
 * missing resultUrls array is treated as "no media".
 */
function extractResultUrl(resultJson: string | null | undefined): string {
  if (!resultJson) return '';
  try {
    const parsed = JSON.parse(resultJson) as { resultUrls?: unknown };
    const urls = parsed.resultUrls;
    if (Array.isArray(urls)) {
      const first = urls.find((url) => typeof url === 'string' && url.length > 0);
      if (typeof first === 'string') return first;
    }
  } catch {
    // Fall through — a malformed body is a failed generation, not a crash.
  }
  return '';
}

/** KIE failure text is vendor-facing; keep it short and prefixed for the UI. */
function failureMessage(record: KieTaskRecord): string {
  const raw = (record.failMsg || '').trim();
  if (!raw) return 'Generation failed. Please try again or use a different model.';
  return raw.length > 200 ? `${raw.slice(0, 200)}…` : raw;
}

export const kieProvider: GenerationProvider = {
  id: 'kie',
  label: 'KIE AI',

  isConfigured() {
    return getKieApiKey() !== null;
  },

  async submit({ endpoint, input }: SubmitParams): Promise<string> {
    const key = requireKey();
    const callBackUrl = buildKieWebhookUrl();

    let response: Response;
    try {
      response = await fetch(`${API_BASE}/api/v1/jobs/createTask`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: endpoint,
          input,
          ...(callBackUrl ? { callBackUrl } : {}),
        }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      throw new ProviderSubmitError(
        error instanceof Error ? error.message : 'KIE request failed',
      );
    }

    const envelope = await readEnvelope<{ taskId?: string }>(response);
    if (!isOk(response, envelope)) {
      // 402 = out of credits on the KIE account, 429 = rate limited. Both are
      // operator problems, so the user gets generic copy and we log the detail.
      const userMessage =
        response.status === 402 || envelope.code === 402
          ? 'The image service is temporarily unavailable. Please try again later.'
          : null;
      throw new ProviderSubmitError(
        `KIE createTask failed (${envelope.code ?? response.status}): ${envelope.msg ?? 'unknown error'}`,
        envelope,
        userMessage,
      );
    }

    const taskId = envelope.data?.taskId;
    if (!taskId) {
      throw new ProviderSubmitError('No taskId from KIE', envelope);
    }
    return taskId;
  },

  async poll({ requestId }: PollParams): Promise<ProviderPoll> {
    const key = requireKey();

    let response: Response;
    try {
      response = await fetch(
        `${API_BASE}/api/v1/jobs/recordInfo?taskId=${encodeURIComponent(requestId)}`,
        {
          headers: { Authorization: `Bearer ${key}` },
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        },
      );
    } catch (error) {
      // Transient lookup failure — keep waiting, exactly like FAL. The cron
      // sweeper's stale cutoff is what eventually refunds a lost task.
      console.error('KIE recordInfo error:', {
        taskId: requestId,
        message: error instanceof Error ? error.message : String(error),
      });
      return { status: 'pending' };
    }

    const envelope = await readEnvelope<KieTaskRecord>(response);
    if (!isOk(response, envelope)) {
      console.error('KIE recordInfo rejected:', {
        taskId: requestId,
        code: envelope.code ?? response.status,
        msg: envelope.msg,
      });
      return { status: 'pending' };
    }

    const record = envelope.data ?? {};
    if (record.state === 'fail') {
      console.error('KIE task failed:', {
        taskId: requestId,
        failCode: record.failCode,
        failMsg: record.failMsg,
      });
      return { status: 'failed', message: failureMessage(record) };
    }
    if (record.state !== 'success') return { status: 'pending' };

    const url = extractResultUrl(record.resultJson);
    if (!url) {
      return { status: 'failed', message: 'Generation produced no output. Please try again.' };
    }

    // Logged so real spend can be reconciled against the credit prices in
    // lib/modelOptions.ts (KIE reports what the task actually cost).
    if (record.creditsConsumed != null) {
      console.info('KIE task cost:', {
        taskId: requestId,
        model: record.model,
        creditsConsumed: record.creditsConsumed,
      });
    }

    return { status: 'completed', url };
  },

  async uploadImage(blob: Blob, fileName = 'reference.png'): Promise<string> {
    const key = requireKey();
    const form = new FormData();
    form.append('file', blob, fileName);
    // KIE requires a destination folder; files are auto-deleted after 3 days,
    // which is fine because references only need to survive the generation.
    form.append('uploadPath', 'images/the-archive');
    form.append('fileName', fileName);

    const response = await fetch(`${API_BASE}/api/file-stream-upload`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}` },
      body: form,
      signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
    });

    const envelope = await readEnvelope<{ downloadUrl?: string }>(response);
    if (!isOk(response, envelope) || !envelope.data?.downloadUrl) {
      throw new ProviderSubmitError(
        `KIE upload failed (${envelope.code ?? response.status}): ${envelope.msg ?? 'unknown error'}`,
        envelope,
      );
    }
    return envelope.data.downloadUrl;
  },

  hostsUrl(url: string): boolean {
    try {
      const host = new URL(url).hostname;
      return KIE_HOST_PATTERNS.some((pattern) => pattern.test(host));
    } catch {
      return false;
    }
  },
};
