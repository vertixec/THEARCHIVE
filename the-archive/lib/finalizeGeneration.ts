// Single source of truth for finalizing a queued generation. Three entry
// points share it so a job finishes no matter which one fires first:
//   * /api/generate/status          — browser polling (original path)
//   * /api/fal/webhook              — FAL pokes us when the job completes,
//                                     so closing the tab no longer strands it
//   * /api/cron/finalize-generations — sweeper for anything both missed
//
// Finalizing means: check FAL, fetch the result, COPY IT TO OUR OWN STORAGE
// (fal.media retention is not guaranteed), claim the row atomically, then
// complete or refund the credit reservation. The atomic 'queued' -> terminal
// claim makes concurrent finalizers safe: only the winner touches credits.

import { fal } from '@fal-ai/client';
import { createAdminClient } from './supabaseAdmin';
import {
  completeCreditOperation,
  incrementGenerationUsage,
  refundCreditOperation,
} from './generationSecurity';
import {
  extractResultUrl,
  getApiKey,
  getErrorMessage,
  getFalErrorBody,
  getFalUserMessage,
  type FalResult,
  type GenerationType,
} from './falGenerate';
import { persistResultMedia } from './resultMedia';

export type GenerationJob = {
  id: string;
  user_id: string;
  generation_type: GenerationType;
  status: 'queued' | 'completed' | 'failed';
  result_url: string | null;
  fal_request_id: string | null;
  fal_endpoint: string | null;
  credit_cost: number | null;
  credit_operation_id: string | null;
  created_at: string | null;
};

export const GENERATION_JOB_COLUMNS =
  'id, user_id, generation_type, status, result_url, fal_request_id, fal_endpoint, credit_cost, credit_operation_id, created_at';

export type FinalizeOutcome =
  | { status: 'queued' }
  | { status: 'completed'; url: string | null }
  | { status: 'failed'; error: string }
  // Internal problem (DB/credits) — retryable, callers map it to a 500 so
  // the client keeps polling / FAL redelivers the webhook.
  | { status: 'error'; error: string };

export type FinalizeOptions = {
  // Sweeper only: if FAL still reports the job pending (or the lookup keeps
  // failing) past this age, give up — mark failed and refund. User polls and
  // webhooks never pass it, so a transient FAL hiccup can't kill a live job.
  failStaleAfterMs?: number;
};

function isStale(job: GenerationJob, failStaleAfterMs?: number): boolean {
  if (!failStaleAfterMs || !job.created_at) return false;
  const age = Date.now() - new Date(job.created_at).getTime();
  return age > failStaleAfterMs;
}

export async function finalizeGeneration(
  job: GenerationJob,
  options: FinalizeOptions = {},
): Promise<FinalizeOutcome> {
  // Already terminal — just make sure the credit op didn't get left behind
  // (complete_generation_operation is idempotent).
  if (job.status === 'completed') {
    if (job.credit_operation_id) {
      await completeCreditOperation(job.credit_operation_id, job.id).catch((error) => {
        console.error('Credit completion retry failed:', error);
      });
    }
    return { status: 'completed', url: job.result_url };
  }
  if (job.status === 'failed') {
    return { status: 'failed', error: 'Generation failed' };
  }

  const apiKey = getApiKey();
  if (!apiKey) {
    return { status: 'error', error: 'FAL API key is not configured' };
  }
  fal.config({ credentials: apiKey });

  const refund = async (reason: string) => {
    if (!job.credit_operation_id) return;
    try {
      await refundCreditOperation(job.credit_operation_id, reason);
    } catch (refundErr) {
      console.error('Refund failed:', { reason, userId: job.user_id, refundErr });
    }
  };

  // Claim the failure atomically so concurrent finalizers can't double-refund.
  const finalizeFailed = async (
    userMessage: string,
    refundReason: string,
  ): Promise<FinalizeOutcome> => {
    const admin = createAdminClient();
    const { data: claimed } = await admin
      .from('generations')
      .update({ status: 'failed' })
      .eq('id', job.id)
      .eq('status', 'queued')
      .select('id');
    if (claimed && claimed.length > 0) {
      await refund(refundReason);
    }
    return { status: 'failed', error: userMessage };
  };

  // A row with no FAL reference can never complete; the sweeper eventually
  // refunds it. (Normally impossible — the insert always sets both fields.)
  if (!job.fal_request_id || !job.fal_endpoint) {
    if (isStale(job, options.failStaleAfterMs)) {
      return finalizeFailed('Generation timed out.', 'generation_stale');
    }
    return { status: 'queued' };
  }

  let statusValue: string;
  try {
    const queueStatus = await fal.queue.status(job.fal_endpoint, {
      requestId: job.fal_request_id,
    });
    statusValue = queueStatus.status;
  } catch (error) {
    console.error('FAL status error:', {
      endpoint: job.fal_endpoint,
      message: getErrorMessage(error),
    });
    // Transient lookup error — keep polling. The sweeper's stale cutoff
    // covers the case where FAL genuinely lost the request.
    if (isStale(job, options.failStaleAfterMs)) {
      return finalizeFailed('Generation timed out.', 'generation_stale');
    }
    return { status: 'queued' };
  }

  if (statusValue !== 'COMPLETED') {
    if (isStale(job, options.failStaleAfterMs)) {
      return finalizeFailed('Generation timed out.', 'generation_stale');
    }
    return { status: 'queued' };
  }

  // Completed on FAL — fetch the result.
  const type = job.generation_type;
  let falResultUrl = '';
  try {
    const result = (await fal.queue.result(job.fal_endpoint, {
      requestId: job.fal_request_id,
    })) as FalResult;
    falResultUrl = extractResultUrl(result);
  } catch (error) {
    const userMessage =
      getFalUserMessage(getFalErrorBody(error), type, false) ||
      'Generation failed. Please try again or use a different model.';
    console.error('FAL result error:', {
      endpoint: job.fal_endpoint,
      message: getErrorMessage(error),
      body: getFalErrorBody(error),
    });
    return finalizeFailed(userMessage, 'generation_failed');
  }

  if (!falResultUrl) {
    return finalizeFailed('Generation produced no output. Please try again.', 'generation_failed');
  }

  // Copy the media into our own bucket BEFORE recording the row, so the
  // stored result_url is durable. On copy failure we keep the FAL URL —
  // the user still gets their result and the backfill script can retry.
  let resultUrl = falResultUrl;
  let storagePath: string | null = null;
  const persisted = await persistResultMedia({
    userId: job.user_id,
    generationId: job.id,
    sourceUrl: falResultUrl,
    generationType: type,
  });
  if (persisted) {
    resultUrl = persisted.publicUrl;
    storagePath = persisted.storagePath;
  } else {
    console.warn('Result media not persisted; keeping FAL URL', { generationId: job.id });
  }

  // Claim completion atomically; only the winning finalizer records usage.
  const admin = createAdminClient();
  const { data: claimed, error: claimError } = await admin
    .from('generations')
    .update({ status: 'completed', result_url: resultUrl, result_storage_path: storagePath })
    .eq('id', job.id)
    .eq('status', 'queued')
    .select('id');

  if (claimError) {
    console.error('Generation claim failed:', claimError);
    return { status: 'error', error: 'Could not finalize the job' };
  }

  if (claimed && claimed.length > 0) {
    if (job.credit_operation_id) {
      try {
        await completeCreditOperation(job.credit_operation_id, job.id);
      } catch (error) {
        console.error('Credit completion failed:', error);
        return { status: 'error', error: 'Could not finalize credits' };
      }
    }
    // One generation = 1 toward the monthly counter (written server-side).
    await incrementGenerationUsage(job.user_id, type, 1).catch((error) => {
      console.error('Usage increment failed (non-fatal):', error);
    });
  }

  return { status: 'completed', url: resultUrl };
}
