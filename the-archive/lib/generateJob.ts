// Shared generation enqueue. ONE implementation of "validate -> price ->
// reserve credits -> submit to FAL -> record the job", used by every entry
// point that can start a generation:
//   * app/api/generate/route.ts  — the browser panel
//   * lib/mcp/tools.ts           — the MCP server (agents)
//
// Keeping this in one place is what stops the MCP surface from drifting into a
// cheaper or less-guarded path than the web app. Pricing, tier checks and the
// atomic credit reservation are identical no matter who calls.

import { fal } from '@fal-ai/client';
import { createAdminClient } from './supabaseAdmin';
import { refundCreditOperation, reserveCredits } from './generationSecurity';
import { canAccessFeature, type BusinessProfile } from './business';
import {
  creditCostFor,
  defaultSelection,
  falParamsFor,
  normalizeSelection,
} from './modelOptions';
import { ReferenceImageAccessError, prepareReferenceUrls } from './falReference';
import { buildFalWebhookUrl } from './falWebhook';
import {
  DEFAULT_MODEL,
  IMAGE_MODELS,
  VIDEO_MODELS,
  buildFalInput,
  getApiKey,
  getErrorMessage,
  getFalErrorBody,
  resolveEndpoint,
  type GenerationType,
} from './falGenerate';

// Generous ceiling: only guards against abusive payloads, not real creative
// prompts. Matches GPT Image 2's prompt limit; FAL enforces per-model limits
// and we surface those errors.
export const MAX_PROMPT_LENGTH = 32000;
export const MAX_REFERENCE_IMAGES = 3;

export type EnqueueErrorCode =
  | 'not_configured'
  | 'invalid_input'
  | 'forbidden'
  | 'insufficient_credits'
  | 'reference_failed'
  | 'submit_failed'
  | 'internal';

export type EnqueueGenerationParams = {
  userId: string;
  /** Already-loaded profile; the caller decides how to fetch it. */
  profile: BusinessProfile | null;
  prompt: unknown;
  model?: unknown;
  generationType: GenerationType;
  referenceImageUrls?: unknown;
  options?: unknown;
  /** Attribution recorded on the credit operation ('generate', 'mcp', ...). */
  tool: string;
};

export type EnqueueGenerationResult =
  | {
      ok: true;
      jobId: string;
      generationType: GenerationType;
      model: string;
      creditCost: number;
      /** Spendable balance left after the reservation (monthly + purchased). */
      creditsRemaining: number;
    }
  | {
      ok: false;
      code: EnqueueErrorCode;
      message: string;
      /** HTTP status the web route should surface for this code. */
      status: number;
      /** True when credits were reserved and then given back. */
      refunded?: boolean;
    };

function fail(
  code: EnqueueErrorCode,
  message: string,
  status: number,
  refunded?: boolean,
): EnqueueGenerationResult {
  return { ok: false, code, message, status, refunded };
}

export async function enqueueGeneration(
  params: EnqueueGenerationParams,
): Promise<EnqueueGenerationResult> {
  const apiKey = getApiKey();
  if (!apiKey) {
    return fail('not_configured', 'FAL API key is not configured', 500);
  }

  const type = params.generationType;

  // ---- input validation -------------------------------------------------
  const cleanPrompt = typeof params.prompt === 'string' ? params.prompt.trim() : '';
  if (!cleanPrompt) {
    return fail('invalid_input', 'Prompt is required', 400);
  }
  if (cleanPrompt.length > MAX_PROMPT_LENGTH) {
    return fail(
      'invalid_input',
      `Prompt is too long (max ${MAX_PROMPT_LENGTH} characters)`,
      400,
    );
  }

  const referenceList: string[] = Array.isArray(params.referenceImageUrls)
    ? params.referenceImageUrls.filter(
        (url: unknown): url is string => typeof url === 'string' && url.length > 0,
      )
    : [];
  if (referenceList.length > MAX_REFERENCE_IMAGES) {
    return fail(
      'invalid_input',
      `A maximum of ${MAX_REFERENCE_IMAGES} reference images is allowed`,
      400,
    );
  }

  const modelId = typeof params.model === 'string' ? params.model : '';
  const validModels = type === 'video' ? VIDEO_MODELS : IMAGE_MODELS;
  if (modelId.length > 0 && !(modelId in validModels)) {
    return fail('invalid_input', `Unknown ${type} model: ${modelId}`, 400);
  }

  // ---- tier / feature gate ----------------------------------------------
  if (!canAccessFeature(params.profile, type === 'image' ? 'generate_image' : 'generate_video')) {
    return fail(
      'forbidden',
      type === 'image'
        ? 'Your current plan cannot generate images'
        : 'Your current plan cannot generate videos',
      403,
    );
  }

  // ---- pricing -----------------------------------------------------------
  // Credits are the only spend gate. Cost depends on the chosen model AND the
  // selected options (quality / format / resolution / duration). The selection
  // is normalized server-side so a caller can't under-pay.
  const resolvedModel = modelId || DEFAULT_MODEL[type];
  const hasReference = referenceList.length > 0;

  let selection = normalizeSelection(resolvedModel, params.options);
  if (type === 'image' && hasReference) {
    // Edit endpoints size the output from the source image, so format/
    // resolution don't apply — price at the model base, keeping only quality
    // (the one option that still affects an edit's cost, e.g. gpt-image-2).
    const base = defaultSelection(resolvedModel);
    if (selection.quality) base.quality = selection.quality;
    selection = base;
  }
  const generationCost = creditCostFor(resolvedModel, selection, type);

  const admin = createAdminClient();

  // Fast-fail UX hint only; the authoritative atomic charge happens below.
  // Spendable balance = monthly community allowance + purchased credits.
  const { data: balance } = await admin
    .from('user_credit_balances')
    .select('credits, monthly_credits')
    .eq('user_id', params.userId)
    .maybeSingle<{ credits: number; monthly_credits: number }>();

  if (balance && balance.credits + (balance.monthly_credits ?? 0) < generationCost) {
    return fail('insufficient_credits', 'Not enough credits', 429);
  }

  fal.config({ credentials: apiKey });
  const endpoint = resolveEndpoint(type, modelId, hasReference);

  // ---- atomic credit reservation ----------------------------------------
  let reservation;
  try {
    reservation = await reserveCredits({
      userId: params.userId,
      generationType: type,
      amount: generationCost,
      model: resolvedModel,
      tool: params.tool,
      prompt: cleanPrompt,
    });
  } catch (error) {
    console.error('Credit reservation failed:', error);
    return fail('internal', 'Credit reservation failed', 500);
  }
  if (!reservation.ok) {
    return fail('insufficient_credits', 'Not enough credits', 429);
  }

  const refund = async (reason: string) => {
    try {
      await refundCreditOperation(reservation.operation_id, reason);
    } catch (refundErr) {
      console.error('Refund failed:', { reason, userId: params.userId, refundErr });
    }
  };

  // ---- reference images --------------------------------------------------
  // prepareReferenceUrls re-hosts to FAL after SSRF checks (DNS resolution,
  // private-range rejection, redirect cap, content-type + magic-byte checks).
  let preparedReferenceList: string[] = [];
  try {
    preparedReferenceList = hasReference ? await prepareReferenceUrls(referenceList) : [];
  } catch (error) {
    await refund('reference_failed');
    const message =
      error instanceof ReferenceImageAccessError
        ? error.message
        : 'Reference preparation failed';
    return fail('reference_failed', message, 400, true);
  }

  const input = buildFalInput(type, endpoint, cleanPrompt, preparedReferenceList);
  // Merge the per-model option params (quality / image_size / aspect_ratio /
  // resolution / duration). On image edits, drop dimension params (output dims
  // follow the source) and keep only quality.
  const modelParams = falParamsFor(resolvedModel, selection);
  if (type === 'image' && hasReference) {
    Object.assign(input, modelParams.quality != null ? { quality: modelParams.quality } : {});
  } else {
    Object.assign(input, modelParams);
  }

  // ---- submit to the FAL queue -------------------------------------------
  // Returns immediately with a request id. The webhook URL lets FAL finalize
  // the job server-side even if nobody ever polls again; polling and the cron
  // sweeper are the fallbacks.
  let requestId = '';
  try {
    const queued = await fal.queue.submit(endpoint, {
      input,
      webhookUrl: buildFalWebhookUrl(),
    });
    requestId = queued.request_id;
    if (!requestId) throw new Error('No request_id from FAL');
  } catch (error) {
    await refund('submit_failed');
    console.error('FAL submit error:', {
      endpoint,
      message: getErrorMessage(error),
      body: getFalErrorBody(error),
    });
    return fail(
      'submit_failed',
      'Could not start the generation. Please try again.',
      502,
      true,
    );
  }

  // ---- record the queued job ---------------------------------------------
  const { data: generation, error: insertError } = await admin
    .from('generations')
    .insert({
      user_id: params.userId,
      prompt: cleanPrompt,
      model: resolvedModel,
      generation_type: type,
      reference_image_url: hasReference ? referenceList[0] : null,
      status: 'queued',
      // Persist exactly what we charged so the status poller refunds the right
      // amount on failure (cost varies by model and options).
      credit_cost: generationCost,
      credit_operation_id: reservation.operation_id,
      fal_request_id: requestId,
      fal_endpoint: endpoint,
    })
    .select('id')
    .single();

  if (insertError || !generation) {
    await refund('generation_insert_failed');
    return fail('internal', 'Could not save the job', 500, true);
  }

  return {
    ok: true,
    jobId: generation.id,
    generationType: type,
    model: resolvedModel,
    creditCost: generationCost,
    creditsRemaining: reservation.credits,
  };
}
