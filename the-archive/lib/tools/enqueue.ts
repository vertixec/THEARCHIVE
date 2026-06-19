// Server-only helper that enqueues a single Tools image job on the FAL queue
// and records it as a 'queued' generation — the SAME async pattern the freeform
// /api/generate route uses. The job is then finalized by /api/generate/status
// (it fetches the result, stores result_url, completes credits and counts usage).
//
// Why: tools used to call fal.subscribe() and WAIT for the image inside the
// request. On hosts with a 60s function timeout (Vercel) a multi-image run
// (e.g. Ads = up to 5 gpt-image-2 edits) would time out — FAL still produced
// the images, but the function died before saving them, so nothing showed up in
// Creations and the client only saw a generic "The tool failed". Enqueuing
// returns in well under the limit and polling does the slow part.
//
// NOTE: the caller MUST have configured the FAL client (fal.config({...}))
// before calling this — fal is a global singleton.

import { fal } from '@fal-ai/client';
import { createAdminClient } from '@/lib/supabaseAdmin';
import { refundCreditOperation, reserveCredits } from '@/lib/generationSecurity';
import { getErrorMessage, getFalErrorBody } from '@/lib/falGenerate';

// All current tools run gpt-image-2 edits.
export const GPT_IMAGE_EDIT = 'openai/gpt-image-2/edit';

export type ToolEnqueueParams = {
  userId: string;
  /** Prompt sent to FAL and stored on the generation row. */
  prompt: string;
  /** UI label for this result (e.g. an ad angle, or "Style transfer"). */
  angle: string;
  /** Stored as `model` on the generation (e.g. 'ads-studio'). */
  model: string;
  /** Reservation bucket label (e.g. 'ads'). */
  tool: string;
  /** Credits to reserve/charge for this single image. */
  perImageCost: number;
  /** Prepared (FAL-readable) reference image URLs. */
  preparedImages: string[];
  /** Original reference URL persisted for display in Creations. */
  referenceImageUrl: string | null;
};

export type ToolEnqueueResult =
  | { ok: true; jobId: string; angle: string }
  | { ok: false; reason: 'insufficient_credits' | 'submit_failed' | 'insert_failed' };

export async function enqueueToolJob(p: ToolEnqueueParams): Promise<ToolEnqueueResult> {
  // 1) Reserve credits for THIS image (one operation per job, so /status can
  //    complete/refund each independently — matching the freeform flow).
  let reservation;
  try {
    reservation = await reserveCredits({
      userId: p.userId,
      generationType: 'image',
      amount: p.perImageCost,
      model: p.model,
      tool: p.tool,
      prompt: p.prompt,
    });
  } catch (error) {
    console.error('Tool credit reservation failed:', error);
    return { ok: false, reason: 'insufficient_credits' };
  }
  if (!reservation.ok) return { ok: false, reason: 'insufficient_credits' };

  const refund = async (reason: string) => {
    try {
      await refundCreditOperation(reservation.operation_id, reason);
    } catch (error) {
      console.error('Tool refund failed:', { reason, userId: p.userId, error });
    }
  };

  // 2) Enqueue on the FAL queue (returns immediately with a request id).
  let requestId = '';
  try {
    const queued = await fal.queue.submit(GPT_IMAGE_EDIT, {
      input: { prompt: p.prompt, image_urls: p.preparedImages, quality: 'medium' },
    });
    requestId = queued.request_id;
    if (!requestId) throw new Error('No request_id from FAL');
  } catch (error) {
    await refund('submit_failed');
    console.error('Tool FAL submit error:', {
      message: getErrorMessage(error),
      body: getFalErrorBody(error),
    });
    return { ok: false, reason: 'submit_failed' };
  }

  // 3) Record the queued job. /api/generate/status finalizes it on completion.
  const admin = createAdminClient();
  const { data: generation, error: insertError } = await admin
    .from('generations')
    .insert({
      user_id: p.userId,
      prompt: p.prompt,
      model: p.model,
      generation_type: 'image' as const,
      reference_image_url: p.referenceImageUrl,
      status: 'queued',
      credit_cost: p.perImageCost,
      credit_operation_id: reservation.operation_id,
      fal_request_id: requestId,
      fal_endpoint: GPT_IMAGE_EDIT,
    })
    .select('id')
    .single();

  if (insertError || !generation) {
    await refund('generation_insert_failed');
    return { ok: false, reason: 'insert_failed' };
  }

  return { ok: true, jobId: generation.id, angle: p.angle };
}
