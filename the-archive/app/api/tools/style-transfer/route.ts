import { fal } from '@fal-ai/client';
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabaseServer';
import { createAdminClient } from '@/lib/supabaseAdmin';
import { canAccessFeature, creditCostForModel, type BusinessProfile } from '@/lib/business';
import {
  completeCreditOperation,
  enforceRateLimit,
  incrementGenerationUsage,
  refundCreditOperation,
  reserveCredits,
} from '@/lib/generationSecurity';
import { ReferenceImageAccessError, prepareReferenceUrls } from '@/lib/falReference';
import { buildStyleTransferPrompt } from '@/lib/tools/prompts/styleTransfer';
import { getTool } from '@/lib/tools/registry';

export const runtime = 'nodejs';
export const maxDuration = 60;

const GPT_IMAGE_EDIT = 'openai/gpt-image-2/edit';
const PER_IMAGE_COST = creditCostForModel('gpt-image-2', 'image');
type FalResult = { data?: { images?: { url?: string }[] } };

export async function POST(req: NextRequest) {
  const apiKey = process.env.FAL_API_KEY || process.env.FAL_KEY;
  if (!apiKey) return NextResponse.json({ error: 'FAL API key is not configured' }, { status: 500 });

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const rateLimitResponse = await enforceRateLimit(user.id, 'tool:style-transfer', 5, 600);
  if (rateLimitResponse) return rateLimitResponse;

  const tool = getTool('style-transfer');
  if (!tool || !tool.endpoint) return NextResponse.json({ error: 'Tool unavailable' }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const prompt = typeof body?.prompt === 'string' ? body.prompt.trim() : '';
  const referenceList: string[] = Array.isArray(body?.referenceImageUrls)
    ? body.referenceImageUrls.filter((url: unknown): url is string => typeof url === 'string' && url.length > 0)
    : [];
  const styleUrl = referenceList[0];
  const contentUrl = referenceList[1];
  const hasContentImage = Boolean(contentUrl);

  if (!styleUrl) return NextResponse.json({ error: 'Add a style reference image' }, { status: 400 });
  if (!prompt && !hasContentImage) {
    return NextResponse.json({ error: 'Write a prompt or add a second image to restyle' }, { status: 400 });
  }
  if (referenceList.length > 2 || prompt.length > 2000) {
    return NextResponse.json({ error: 'Invalid tool input' }, { status: 400 });
  }

  let profile: BusinessProfile | null = null;
  const expandedProfile = await supabase
    .from('profiles').select('id, status, role, access_tier, plan_id').eq('id', user.id)
    .maybeSingle<BusinessProfile>();
  profile = expandedProfile.error
    ? (await supabase.from('profiles').select('id, status, role').eq('id', user.id).maybeSingle<BusinessProfile>()).data ?? null
    : expandedProfile.data;
  if (!canAccessFeature(profile, 'generate_image')) {
    return NextResponse.json({ error: 'Your current plan cannot generate images' }, { status: 403 });
  }

  const finalPrompt = buildStyleTransferPrompt({ prompt, hasContentImage });
  const inputImages = hasContentImage ? [styleUrl, contentUrl] : [styleUrl];
  let reservation;
  try {
    reservation = await reserveCredits({
      userId: user.id,
      generationType: 'image',
      amount: PER_IMAGE_COST,
      model: 'style-transfer',
      tool: 'style-transfer',
      prompt: prompt || 'Style transfer',
    });
  } catch (error) {
    console.error('Credit reservation failed:', error);
    return NextResponse.json({ error: 'Credit reservation failed' }, { status: 500 });
  }
  if (!reservation.ok) return NextResponse.json({ error: `You need ${PER_IMAGE_COST} credits for this tool` }, { status: 429 });

  const refund = async (reason: string) => {
    try {
      await refundCreditOperation(reservation.operation_id, reason);
    } catch (error) {
      console.error('Refund failed:', { reason, userId: user.id, error });
    }
  };

  fal.config({ credentials: apiKey });
  let preparedImages: string[];
  try {
    preparedImages = await prepareReferenceUrls(inputImages);
  } catch (error) {
    await refund('reference_failed');
    const message = error instanceof ReferenceImageAccessError ? error.message : 'Reference preparation failed';
    return NextResponse.json({ error: message, refunded: true }, { status: 400 });
  }

  let resultUrl: string;
  try {
    const result = (await fal.subscribe(GPT_IMAGE_EDIT, {
      input: { prompt: finalPrompt, image_urls: preparedImages, quality: 'medium' },
    })) as FalResult;
    resultUrl = result.data?.images?.[0]?.url ?? '';
    if (!resultUrl) throw new Error('No result URL from FAL');
  } catch (error) {
    await refund('generation_failed');
    console.error('Style Transfer failed:', error);
    return NextResponse.json({ error: 'Could not generate. Try another reference or try again.', refunded: true }, { status: 502 });
  }

  const admin = createAdminClient();
  const { data: generation, error: insertError } = await admin.from('generations').insert({
    user_id: user.id,
    prompt: finalPrompt,
    model: 'style-transfer',
    generation_type: 'image' as const,
    result_url: resultUrl,
    reference_image_url: styleUrl,
    credit_cost: PER_IMAGE_COST,
    credit_operation_id: reservation.operation_id,
  }).select('id').single();
  if (insertError) {
    await refund('generation_insert_failed');
    return NextResponse.json({ error: 'Generation history save failed', refunded: true }, { status: 500 });
  }

  try {
    await completeCreditOperation(reservation.operation_id, generation.id, PER_IMAGE_COST);
  } catch (error) {
    console.error('Credit completion failed:', error);
    return NextResponse.json({ error: 'Credit completion failed' }, { status: 500 });
  }
  await incrementGenerationUsage(user.id, 'image', 1).catch((error) => {
    console.error('Usage increment failed (non-fatal):', error);
  });

  return NextResponse.json({
    results: [{ url: resultUrl, angle: hasContentImage ? 'Restyled' : 'Style transfer' }],
    requested: 1,
    succeeded: 1,
    credits: { credits: reservation.credits },
  });
}
