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
import { ReferenceImageAccessError, prepareReferenceUrls } from '@/lib/falReference';
import { buildStyleTransferPrompt } from '@/lib/tools/prompts/styleTransfer';
import { getTool } from '@/lib/tools/registry';

export const runtime = 'nodejs';
export const maxDuration = 60;

const GPT_IMAGE_EDIT = 'openai/gpt-image-2/edit';

type FalResult = { data?: { images?: { url?: string }[] } };
type CreditSpendResult = { ok: boolean; credits: number; video_credits: number };

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return 'Generation failed';
}

export async function POST(req: NextRequest) {
  const apiKey = process.env.FAL_API_KEY || process.env.FAL_KEY;
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

  const tool = getTool('style-transfer');
  if (!tool || !tool.endpoint) {
    return NextResponse.json({ error: 'Tool unavailable' }, { status: 404 });
  }

  const body = await req.json().catch(() => ({}));
  const prompt = typeof body?.prompt === 'string' ? body.prompt.trim() : '';
  const referenceList: string[] = Array.isArray(body?.referenceImageUrls)
    ? body.referenceImageUrls.filter((url: unknown): url is string => typeof url === 'string' && url.length > 0)
    : [];

  // image #1 = style source, image #2 (optional) = content to restyle.
  const styleUrl = referenceList[0];
  const contentUrl = referenceList[1];
  const hasContentImage = Boolean(contentUrl);

  if (!styleUrl) {
    return NextResponse.json({ error: 'Add a style reference image' }, { status: 400 });
  }
  if (!prompt && !hasContentImage) {
    return NextResponse.json(
      { error: 'Write a prompt or add a second image to restyle' },
      { status: 400 }
    );
  }

  const finalPrompt = buildStyleTransferPrompt({ prompt, hasContentImage });
  // Style first, content second — the prompt refers to "FIRST"/"SECOND" image.
  const inputImages = hasContentImage ? [styleUrl, contentUrl] : [styleUrl];
  const outputs = 1;

  // Profile + access -----------------------------------------------------
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

  if (!canAccessFeature(profile, 'generate_image')) {
    return NextResponse.json({ error: 'Your current plan cannot generate images' }, { status: 403 });
  }

  const plan = await getPlanForProfileFromDB(profile, supabase);
  const maxCost = MODEL_CREDIT_COSTS.image * outputs;

  // Limits + balance -----------------------------------------------------
  const { data: balance } = await supabase
    .from('user_credit_balances')
    .select('credits, video_credits')
    .eq('user_id', user.id)
    .maybeSingle<{ credits: number; video_credits: number }>();

  const yearMonth = new Date().toISOString().slice(0, 7);
  const { data: usage, error: usageError } = await supabase
    .from('user_generation_usage')
    .select('image_count, video_count')
    .eq('user_id', user.id)
    .eq('year_month', yearMonth)
    .maybeSingle<{ image_count: number; video_count: number }>();

  if (usageError) {
    return NextResponse.json({ error: 'Usage lookup failed' }, { status: 500 });
  }

  const imageCount = usage?.image_count ?? 0;

  if (imageCount + outputs > plan.monthlyImageLimit) {
    return NextResponse.json(
      { error: `You have ${Math.max(plan.monthlyImageLimit - imageCount, 0)} images left this month` },
      { status: 429 }
    );
  }

  if (balance && balance.credits < maxCost) {
    return NextResponse.json(
      { error: `You need ${maxCost} image credit for this tool` },
      { status: 429 }
    );
  }

  // Prepare references + run ---------------------------------------------
  fal.config({ credentials: apiKey });

  let preparedImages: string[];
  try {
    preparedImages = await prepareReferenceUrls(inputImages);
  } catch (error) {
    if (error instanceof ReferenceImageAccessError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }

  let resultUrl: string;
  try {
    const result = (await fal.subscribe(GPT_IMAGE_EDIT, {
      input: { prompt: finalPrompt, image_urls: preparedImages },
    })) as FalResult;
    const url = result.data?.images?.[0]?.url;
    if (!url) throw new Error('No result URL from FAL');
    resultUrl = url;
  } catch (error) {
    console.error('Style Transfer failed:', getErrorMessage(error));
    return NextResponse.json(
      { error: 'Could not generate. Try another reference or try again.' },
      { status: 502 }
    );
  }

  // Spend credits --------------------------------------------------------
  const spendAmount = MODEL_CREDIT_COSTS.image * outputs;
  const { data: spendData, error: spendError } = await supabase.rpc('spend_generation_credits', {
    p_generation_type: 'image',
    p_amount: spendAmount,
    p_model: 'style-transfer',
    p_prompt: (prompt || 'Style transfer').slice(0, 160),
  });

  if (spendError || !Array.isArray(spendData) || !spendData[0]) {
    console.error('Credit spend failed:', spendError);
    return NextResponse.json({ error: 'Credit spend failed' }, { status: 500 });
  }
  const spendResult = spendData[0] as CreditSpendResult;
  if (!spendResult.ok) {
    return NextResponse.json({ error: 'Not enough credits' }, { status: 429 });
  }

  // refund ADDS credits, so it must run via the service role with an explicit
  // user id (never client-callable).
  const refund = async (reason: string) => {
    try {
      const admin = createAdminClient();
      await admin.rpc('refund_generation_credits', {
        p_generation_type: 'image',
        p_amount: spendAmount,
        p_reason: reason,
        p_user_id: user.id,
      });
    } catch (refundErr) {
      console.error('Refund failed:', { reason, userId: user.id, refundErr });
    }
  };

  // Usage + history ------------------------------------------------------
  const { error: usageRpcError } = await supabase.rpc('increment_generation_usage', {
    p_generation_type: 'image',
    p_amount: outputs,
  });

  if (usageRpcError) {
    await refund('usage_update_failed');
    return NextResponse.json({ error: 'Usage update failed', refunded: true }, { status: 500 });
  }

  const { error: insertError } = await supabase.from('generations').insert({
    user_id: user.id,
    prompt: finalPrompt,
    model: 'style-transfer',
    generation_type: 'image' as const,
    result_url: resultUrl,
    reference_image_url: styleUrl,
  });

  if (insertError) {
    await refund('generation_insert_failed');
    return NextResponse.json({ error: 'Generation history save failed', refunded: true }, { status: 500 });
  }

  return NextResponse.json({
    results: [{ url: resultUrl, angle: hasContentImage ? 'Restyled' : 'Style transfer' }],
    requested: outputs,
    succeeded: outputs,
    credits: spendResult,
  });
}
