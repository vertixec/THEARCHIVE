import { fal } from '@fal-ai/client';
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabaseServer';
import { createAdminClient } from '@/lib/supabaseAdmin';
import {
  canAccessFeature,
  MODEL_CREDIT_COSTS,
  type BusinessProfile,
} from '@/lib/business';
import { getPlanForProfileFromDB } from '@/lib/businessServer';
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

type CreditSpendResult = {
  ok: boolean;
  credits: number;
  video_credits: number;
};

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

  const { prompt, model, generationType, referenceImageUrl, referenceImageUrls } = await req.json();
  const cleanPrompt = typeof prompt === 'string' ? prompt.trim() : '';
  const type: GenerationType = generationType === 'video' ? 'video' : 'image';

  const referenceList: string[] = Array.isArray(referenceImageUrls)
    ? referenceImageUrls.filter((url: unknown): url is string => typeof url === 'string' && url.length > 0)
    : typeof referenceImageUrl === 'string' && referenceImageUrl.length > 0
      ? [referenceImageUrl]
      : [];

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

  const plan = await getPlanForProfileFromDB(profile, supabase);
  const generationCost = type === 'image' ? MODEL_CREDIT_COSTS.image : MODEL_CREDIT_COSTS.video;

  const yearMonth = new Date().toISOString().slice(0, 7);
  const { data: usage, error: usageError } = await supabase
    .from('user_generation_usage')
    .select('image_count, video_count')
    .eq('user_id', user.id)
    .eq('year_month', yearMonth)
    .maybeSingle();

  if (usageError) {
    return NextResponse.json({ error: 'Usage lookup failed' }, { status: 500 });
  }

  const imageCount = usage?.image_count ?? 0;
  const videoCount = usage?.video_count ?? 0;

  // Monthly counters track the NUMBER of generations (not credits).
  if (type === 'image' && imageCount + 1 > plan.monthlyImageLimit) {
    return NextResponse.json({ error: 'Monthly image limit reached' }, { status: 429 });
  }
  if (type === 'video' && videoCount >= plan.monthlyVideoLimit) {
    return NextResponse.json({ error: 'Monthly video limit reached' }, { status: 429 });
  }

  // Fast-fail UX hint only; the authoritative atomic charge happens below.
  const { data: balance } = await supabase
    .from('user_credit_balances')
    .select('credits, video_credits')
    .eq('user_id', user.id)
    .maybeSingle<{ credits: number; video_credits: number }>();

  if (balance) {
    const currentBalance = type === 'image' ? balance.credits : balance.video_credits;
    if (currentBalance < generationCost) {
      return NextResponse.json({ error: 'Not enough credits' }, { status: 429 });
    }
  }

  fal.config({ credentials: apiKey });

  const hasReference = referenceList.length > 0;
  const endpoint = resolveEndpoint(type, modelId, hasReference);

  let preparedReferenceList: string[] = [];
  try {
    preparedReferenceList = hasReference ? await prepareReferenceUrls(referenceList) : [];
  } catch (error) {
    if (error instanceof ReferenceImageAccessError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }

  const input = buildFalInput(type, endpoint, cleanPrompt, preparedReferenceList);
  const resolvedModel = modelId || DEFAULT_MODEL[type];

  // 1) Charge credits FIRST (atomic, fail closed). Refunded on any failure.
  const { data: spendData, error: spendError } = await supabase.rpc('spend_generation_credits', {
    p_generation_type: type,
    p_amount: generationCost,
    p_model: resolvedModel,
    p_prompt: cleanPrompt,
  });

  if (spendError || !Array.isArray(spendData) || !spendData[0]) {
    console.error('Credit spend failed:', spendError);
    return NextResponse.json({ error: 'Credit spend failed' }, { status: 500 });
  }
  const spendResult = spendData[0] as CreditSpendResult;
  if (!spendResult.ok) {
    return NextResponse.json({ error: 'Not enough credits' }, { status: 429 });
  }

  const refund = async (reason: string) => {
    try {
      const admin = createAdminClient();
      await admin.rpc('refund_generation_credits', {
        p_generation_type: type,
        p_amount: generationCost,
        p_reason: reason,
        p_user_id: user.id,
      });
    } catch (refundErr) {
      console.error('Refund failed:', { reason, userId: user.id, refundErr });
    }
  };

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
  const { data: generation, error: insertError } = await supabase
    .from('generations')
    .insert({
      user_id: user.id,
      prompt: cleanPrompt,
      model: resolvedModel,
      generation_type: type,
      reference_image_url: hasReference ? referenceList[0] : null,
      status: 'queued',
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
    credits: spendResult,
  });
}
