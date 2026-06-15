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
import { buildAdPrompts } from '@/lib/tools/prompts/ads';
import { getTool } from '@/lib/tools/registry';
import { AD_ANGLE_OPTIONS } from '@/lib/tools/adsAngles';

export const runtime = 'nodejs';
export const maxDuration = 60;

const GPT_IMAGE_EDIT = 'openai/gpt-image-2/edit';
const PER_IMAGE_COST = creditCostForModel('gpt-image-2', 'image');

type FalResult = { data?: { images?: { url?: string }[] } };

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Generation failed';
}

export async function POST(req: NextRequest) {
  const apiKey = process.env.FAL_API_KEY || process.env.FAL_KEY;
  if (!apiKey) return NextResponse.json({ error: 'FAL API key is not configured' }, { status: 500 });

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const rateLimitResponse = await enforceRateLimit(user.id, 'tool:ads', 2, 600);
  if (rateLimitResponse) return rateLimitResponse;

  const tool = getTool('ads');
  if (!tool || !tool.endpoint) return NextResponse.json({ error: 'Tool unavailable' }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const offer = typeof body?.offer === 'string' ? body.offer.trim() : '';
  const audience = typeof body?.audience === 'string' ? body.audience.trim() : '';
  const referenceList: string[] = Array.isArray(body?.referenceImageUrls)
    ? body.referenceImageUrls.filter((url: unknown): url is string => typeof url === 'string' && url.length > 0)
    : [];
  const angleIds: string[] = Array.isArray(body?.angleIds)
    ? body.angleIds.filter((id: unknown): id is string => typeof id === 'string')
    : [];
  const requestedCount = Number.parseInt(String(body?.count ?? tool.outputCount), 10);
  const fallbackCount = Number.isFinite(requestedCount)
    ? Math.min(Math.max(requestedCount, 1), tool.outputCount)
    : tool.outputCount;
  const idList = angleIds.length > 0
    ? angleIds
    : AD_ANGLE_OPTIONS.slice(0, fallbackCount).map((option) => option.id);

  if (!offer) return NextResponse.json({ error: 'Describe your product and offer' }, { status: 400 });
  if (referenceList.length === 0) {
    return NextResponse.json({ error: 'Upload at least 1 product reference' }, { status: 400 });
  }
  if (referenceList.length > 3 || offer.length > 600 || audience.length > 300) {
    return NextResponse.json({ error: 'Invalid tool input' }, { status: 400 });
  }

  const adPrompts = buildAdPrompts(offer, audience, idList).slice(0, tool.outputCount);
  const outputs = adPrompts.length;
  if (outputs === 0) return NextResponse.json({ error: 'Select at least one angle' }, { status: 400 });

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

  const maxCost = PER_IMAGE_COST * outputs;
  let reservation;
  try {
    reservation = await reserveCredits({
      userId: user.id,
      generationType: 'image',
      amount: maxCost,
      model: 'ads-studio',
      tool: 'ads',
      prompt: offer,
    });
  } catch (error) {
    console.error('Credit reservation failed:', error);
    return NextResponse.json({ error: 'Credit reservation failed' }, { status: 500 });
  }
  if (!reservation.ok) return NextResponse.json({ error: `You need ${maxCost} credits for this tool` }, { status: 429 });

  const refund = async (reason: string) => {
    try {
      await refundCreditOperation(reservation.operation_id, reason);
    } catch (error) {
      console.error('Refund failed:', { reason, userId: user.id, error });
    }
  };

  fal.config({ credentials: apiKey });
  let preparedReferences: string[];
  try {
    preparedReferences = await prepareReferenceUrls(referenceList);
  } catch (error) {
    await refund('reference_failed');
    const message = error instanceof ReferenceImageAccessError ? error.message : 'Reference preparation failed';
    return NextResponse.json({ error: message, refunded: true }, { status: 400 });
  }

  const settled = await Promise.allSettled(
    adPrompts.map(async ({ prompt, angle }) => {
      const result = (await fal.subscribe(GPT_IMAGE_EDIT, {
        input: { prompt, image_urls: preparedReferences, quality: 'medium' },
      })) as FalResult;
      const url = result.data?.images?.[0]?.url;
      if (!url) throw new Error('No result URL from FAL');
      return { url, angle, prompt };
    }),
  );
  const succeeded = settled
    .filter((result): result is PromiseFulfilledResult<{ url: string; angle: string; prompt: string }> => result.status === 'fulfilled')
    .map((result) => result.value);
  settled
    .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
    .forEach((result) => console.error('Ads tool variant failed:', getErrorMessage(result.reason)));

  if (succeeded.length === 0) {
    await refund('all_variants_failed');
    return NextResponse.json({ error: 'Could not generate any version. Try another reference or try again.', refunded: true }, { status: 502 });
  }

  const spendAmount = PER_IMAGE_COST * succeeded.length;
  const admin = createAdminClient();
  const { data: generations, error: insertError } = await admin.from('generations').insert(
    succeeded.map((item) => ({
      user_id: user.id,
      prompt: item.prompt,
      model: 'ads-studio',
      generation_type: 'image' as const,
      result_url: item.url,
      reference_image_url: referenceList[0],
      credit_cost: PER_IMAGE_COST,
      credit_operation_id: reservation.operation_id,
    })),
  ).select('id');
  if (insertError) {
    await refund('generation_insert_failed');
    return NextResponse.json({ error: 'Generation history save failed', refunded: true }, { status: 500 });
  }

  try {
    await completeCreditOperation(reservation.operation_id, generations?.[0]?.id ?? null, spendAmount);
  } catch (error) {
    console.error('Credit completion failed:', error);
    return NextResponse.json({ error: 'Credit completion failed' }, { status: 500 });
  }

  await incrementGenerationUsage(user.id, 'image', succeeded.length).catch((error) => {
    console.error('Usage increment failed (non-fatal):', error);
  });

  return NextResponse.json({
    results: succeeded.map((item) => ({ url: item.url, angle: item.angle })),
    requested: outputs,
    succeeded: succeeded.length,
    credits: { credits: reservation.credits + (maxCost - spendAmount) },
  });
}
