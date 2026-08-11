// Server-only helper that enqueues a single Tools image job on the provider
// queue and records it as a 'queued' generation — the SAME async pattern the
// freeform /api/generate route uses. The job is then finalized by
// /api/generate/status (it fetches the result, stores result_url, completes
// credits and counts usage).
//
// Why: tools used to call fal.subscribe() and WAIT for the image inside the
// request. On hosts with a 60s function timeout (Vercel) a multi-image run
// (e.g. Ads = up to 5 gpt-image-2 edits) would time out — the vendor still
// produced the images, but the function died before saving them, so nothing
// showed up in Creations and the client only saw a generic "The tool failed".
// Enqueuing returns in well under the limit and polling does the slow part.
//
// Which model (and therefore which provider) Tools runs on is a single line in
// lib/modelCatalog.ts: TOOL_IMAGE_MODEL.

import { createAdminClient } from '@/lib/supabaseAdmin';
import { refundCreditOperation, reserveCredits } from '@/lib/generationSecurity';
import { getErrorMessage, buildModelInput, resolveEndpoint } from '@/lib/generationModels';
import {
  defaultSelection,
  editUsesSourceDimensions,
  modelParamsFor,
} from '@/lib/modelOptions';
import { TOOL_IMAGE_MODEL, providerForModel } from '@/lib/modelCatalog';
import { encodeJobEndpoint, providerFor, ProviderSubmitError } from '@/lib/providers';

/** Provider that serves the Tools image model — used for reference uploads. */
export function toolImageProvider() {
  return providerFor(TOOL_IMAGE_MODEL);
}

export type ToolEnqueueParams = {
  userId: string;
  /** Prompt sent to the provider and stored on the generation row. */
  prompt: string;
  /** UI label for this result (e.g. an ad angle, or "Style transfer"). */
  angle: string;
  /** Stored as `model` on the generation (e.g. 'ads-studio'). */
  model: string;
  /** Reservation bucket label (e.g. 'ads'). */
  tool: string;
  /** Credits to reserve/charge for this single image. */
  perImageCost: number;
  /** Prepared (provider-readable) reference image URLs. */
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

  // 2) Enqueue on the provider queue (returns immediately with a request id).
  const provider = toolImageProvider();
  const endpoint = resolveEndpoint('image', TOOL_IMAGE_MODEL, true);
  const input = buildModelInput('image', TOOL_IMAGE_MODEL, p.prompt, p.preparedImages);
  const params = modelParamsFor(TOOL_IMAGE_MODEL, defaultSelection(TOOL_IMAGE_MODEL));
  if (editUsesSourceDimensions(TOOL_IMAGE_MODEL)) {
    // Output dimensions follow the source image; only quality still applies
    // (gpt-image-2 defaults to HIGH upstream, so sending it is not optional).
    Object.assign(input, params.quality != null ? { quality: params.quality } : {});
  } else {
    Object.assign(input, params);
  }

  let requestId = '';
  try {
    requestId = await provider.submit({ endpoint, input });
  } catch (error) {
    await refund('submit_failed');
    console.error('Tool provider submit error:', {
      provider: provider.id,
      endpoint,
      message: getErrorMessage(error),
      body: error instanceof ProviderSubmitError ? error.body : null,
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
      fal_endpoint: encodeJobEndpoint(providerForModel(TOOL_IMAGE_MODEL), endpoint),
    })
    .select('id')
    .single();

  if (insertError || !generation) {
    await refund('generation_insert_failed');
    return { ok: false, reason: 'insert_failed' };
  }

  return { ok: true, jobId: generation.id, angle: p.angle };
}
