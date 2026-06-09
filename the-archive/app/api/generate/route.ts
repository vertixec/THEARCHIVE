import { fal } from '@fal-ai/client';
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabaseServer';
import { createAdminClient } from '@/lib/supabaseAdmin';
import {
  enforceRateLimit,
  refundCreditOperation,
  reserveCredits,
} from '@/lib/generationSecurity';
import {
  canAccessFeature,
  type BusinessProfile,
} from '@/lib/business';
import {
  creditCostFor,
  defaultSelection,
  falParamsFor,
  normalizeSelection,
} from '@/lib/modelOptions';
import {
  ReferenceImageAccessError,
  prepareReferenceUrls,
} from '@/lib/falReference';
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
} from '@/lib/falGenerate';

// Submitting to the FAL queue is fast; this only needs a small budget.
export const runtime = 'nodejs';
export const maxDuration = 60;

// Generous ceiling: only guards against abusive payloads, not real creative
// prompts. Matches GPT Image 2's prompt limit; FAL enforces per-model limits
// and we surface those errors. (Previously 2000, which wrongly rejected long
// but valid prompts.)
const MAX_PROMPT_LENGTH = 32000;

export async function POST(req: NextRequest) {
  const apiKey = getApiKey();
  if (!apiKey) {
    return NextResponse.json({ error: 'FAL API key is not configured' }, { status: 500 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const rateLimitResponse = await enforceRateLimit(supabase, 'generate', 10, 60);
  if (rateLimitResponse) return rateLimitResponse;

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const { prompt, model, generationType, referenceImageUrl, referenceImageUrls, options } = body;
  const cleanPrompt = typeof prompt === 'string' ? prompt.trim() : '';
  const type: GenerationType = generationType === 'video' ? 'video' : 'image';

  const referenceList: string[] = Array.isArray(referenceImageUrls)
    ? referenceImageUrls.filter((url: unknown): url is string => typeof url === 'string' && url.length > 0)
    : typeof referenceImageUrl === 'string' && referenceImageUrl.length > 0
      ? [referenceImageUrl]
      : [];
  if (referenceList.length > 3) {
    return NextResponse.json({ error: 'A maximum of 3 reference images is allowed' }, { status: 400 });
  }

  if (!cleanPrompt) {
    return NextResponse.json({ error: 'Prompt is required' }, { status: 400 });
  }
  if (cleanPrompt.length > MAX_PROMPT_LENGTH) {
    return NextResponse.json(
      { error: `Prompt is too long (max ${MAX_PROMPT_LENGTH} characters)` },
      { status: 400 }
    );
  }

  const modelId = typeof model === 'string' ? model : '';
  const validModels = type === 'video' ? VIDEO_MODELS : IMAGE_MODELS;
  if (modelId.length > 0 && !(modelId in validModels)) {
    return NextResponse.json({ error: `Unknown ${type} model: ${modelId}` }, { status: 400 });
  }

  let profile: BusinessProfile | null = null;
  const expandedProfile = await supabase
    .from('profiles')
    .select('id, status, role, access_tier, plan_id')
    .eq('id', user.id)
    .maybeSingle<BusinessProfile>();

  if (expandedProfile.error) {
    const fallbackProfile = await supabase
      .from('profiles')
      .select('id, status, role')
      .eq('id', user.id)
      .maybeSingle<BusinessProfile>();
    profile = fallbackProfile.data ?? null;
  } else {
    profile = expandedProfile.data;
  }

  if (!canAccessFeature(profile, type === 'image' ? 'generate_image' : 'generate_video')) {
    return NextResponse.json(
      {
        error:
          type === 'image'
            ? 'Your current plan cannot generate images'
            : 'Your current plan cannot generate videos',
      },
      { status: 403 }
    );
  }

  // Credits are now the only spend gate (the old monthly count limit was
  // redundant and conflicted with the credit balance). Cost depends on the
  // chosen model AND the selected options (quality / format / resolution /
  // duration). The selection is normalized so the client can't under-pay.
  const resolvedModel = modelId || DEFAULT_MODEL[type];
  const hasReference = referenceList.length > 0;

  let selection = normalizeSelection(resolvedModel, options);
  if (type === 'image' && hasReference) {
    // Edit endpoints size the output from the source image, so format/
    // resolution don't apply — price at the model base, keeping only quality
    // (the one option that still affects an edit's cost, e.g. gpt-image-2).
    const base = defaultSelection(resolvedModel);
    if (selection.quality) base.quality = selection.quality;
    selection = base;
  }
  const generationCost = creditCostFor(resolvedModel, selection, type);

  // Fast-fail UX hint only; the authoritative atomic charge happens below.
  // Spendable balance = monthly community allowance + purchased credits.
  const { data: balance } = await supabase
    .from('user_credit_balances')
    .select('credits, monthly_credits')
    .eq('user_id', user.id)
    .maybeSingle<{ credits: number; monthly_credits: number }>();

  if (balance && (balance.credits + (balance.monthly_credits ?? 0)) < generationCost) {
    return NextResponse.json({ error: 'Not enough credits' }, { status: 429 });
  }

  fal.config({ credentials: apiKey });

  const endpoint = resolveEndpoint(type, modelId, hasReference);

  let reservation;
  try {
    reservation = await reserveCredits({
      supabase,
      generationType: type,
      amount: generationCost,
      model: resolvedModel,
      tool: 'generate',
      prompt: cleanPrompt,
    });
  } catch (error) {
    console.error('Credit reservation failed:', error);
    return NextResponse.json({ error: 'Credit reservation failed' }, { status: 500 });
  }
  if (!reservation.ok) {
    return NextResponse.json({ error: 'Not enough credits' }, { status: 429 });
  }

  const refund = async (reason: string) => {
    try {
      await refundCreditOperation(reservation.operation_id, reason);
    } catch (refundErr) {
      console.error('Refund failed:', { reason, userId: user.id, refundErr });
    }
  };

  let preparedReferenceList: string[] = [];
  try {
    preparedReferenceList = hasReference ? await prepareReferenceUrls(referenceList) : [];
  } catch (error) {
    await refund('reference_failed');
    const message = error instanceof ReferenceImageAccessError
      ? error.message
      : 'Reference preparation failed';
    return NextResponse.json({ error: message, refunded: true }, { status: 400 });
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

  // 2) Enqueue the job on the FAL queue (returns immediately with a request id).
  let requestId = '';
  try {
    const queued = await fal.queue.submit(endpoint, { input });
    requestId = queued.request_id;
    if (!requestId) throw new Error('No request_id from FAL');
  } catch (error) {
    await refund('submit_failed');
    console.error('FAL submit error:', {
      endpoint,
      message: getErrorMessage(error),
      body: getFalErrorBody(error),
    });
    return NextResponse.json(
      { error: 'Could not start the generation. Please try again.', refunded: true },
      { status: 502 }
    );
  }

  // 3) Record the queued job. The /status endpoint finalizes it on completion.
  const admin = createAdminClient();
  const { data: generation, error: insertError } = await admin
    .from('generations')
    .insert({
      user_id: user.id,
      prompt: cleanPrompt,
      model: resolvedModel,
      generation_type: type,
      reference_image_url: hasReference ? referenceList[0] : null,
      status: 'queued',
      // Persist exactly what we charged so the status poller refunds the right
      // amount on failure (cost now varies by model).
      credit_cost: generationCost,
      credit_operation_id: reservation.operation_id,
      fal_request_id: requestId,
      fal_endpoint: endpoint,
    })
    .select()
    .single();

  if (insertError) {
    await refund('generation_insert_failed');
    return NextResponse.json({ error: 'Could not save the job', refunded: true }, { status: 500 });
  }

  return NextResponse.json({
    jobId: generation.id,
    status: 'queued',
    generationType: type,
    credits: { credits: reservation.credits },
  });
}
