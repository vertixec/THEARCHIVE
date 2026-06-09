import { fal } from '@fal-ai/client';
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabaseServer';
import { createAdminClient } from '@/lib/supabaseAdmin';
import {
  canAccessFeature,
  creditCostForModel,
  type BusinessProfile,
} from '@/lib/business';
import { ReferenceImageAccessError, prepareReferenceUrls } from '@/lib/falReference';
import { buildAdPrompts } from '@/lib/tools/prompts/ads';
import { getTool } from '@/lib/tools/registry';
import { AD_ANGLE_OPTIONS } from '@/lib/tools/adsAngles';

// NOTE: On Vercel Hobby the cap is 60s. Five parallel GPT Image 2 edits can
// exceed that — this tool should be migrated to the async queue flow (like
// /api/generate) before relying on it in production on Hobby.
export const runtime = 'nodejs';
export const maxDuration = 60;

const GPT_IMAGE_EDIT = 'openai/gpt-image-2/edit';
// This tool runs gpt-image-2 edits — charge the per-image gpt-image-2 rate.
const PER_IMAGE_COST = creditCostForModel('gpt-image-2', 'image');

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

  const tool = getTool('ads');
  if (!tool || !tool.endpoint) {
    return NextResponse.json({ error: 'Tool unavailable' }, { status: 404 });
  }

  const body = await req.json().catch(() => ({}));
  const offer = typeof body?.offer === 'string' ? body.offer.trim() : '';
  const audience = typeof body?.audience === 'string' ? body.audience.trim() : '';
  const referenceList: string[] = Array.isArray(body?.referenceImageUrls)
    ? body.referenceImageUrls.filter((url: unknown): url is string => typeof url === 'string' && url.length > 0)
    : [];

  // Which angles to generate. Prefer an explicit angleIds selection; fall back
  // to a numeric count (first N angles) for backwards compatibility.
  const angleIds: string[] = Array.isArray(body?.angleIds)
    ? body.angleIds.filter((id: unknown): id is string => typeof id === 'string')
    : [];
  const requestedCount = Number.parseInt(String(body?.count ?? tool.outputCount), 10);
  const fallbackCount = Number.isFinite(requestedCount)
    ? Math.min(Math.max(requestedCount, 1), tool.outputCount)
    : tool.outputCount;
  const idList = angleIds.length > 0
    ? angleIds
    : AD_ANGLE_OPTIONS.slice(0, fallbackCount).map((o) => o.id);

  if (!offer) {
    return NextResponse.json({ error: 'Describe your product and offer' }, { status: 400 });
  }
  if (referenceList.length === 0) {
    return NextResponse.json({ error: 'Upload at least 1 product reference' }, { status: 400 });
  }

  // Build the FAL prompts for the selected angles up front; outputs = how many
  // valid angles we'll actually generate.
  const adPrompts = buildAdPrompts(offer, audience, idList).slice(0, tool.outputCount);
  const outputs = adPrompts.length;
  if (outputs === 0) {
    return NextResponse.json({ error: 'Select at least one angle' }, { status: 400 });
  }

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

  // Credits are the only spend gate. Reserve the full run; only spend for
  // successes below.
  const maxCost = PER_IMAGE_COST * outputs;

  const { data: balance } = await supabase
    .from('user_credit_balances')
    .select('credits, monthly_credits')
    .eq('user_id', user.id)
    .maybeSingle<{ credits: number; monthly_credits: number }>();

  if (balance && (balance.credits + (balance.monthly_credits ?? 0)) < maxCost) {
    return NextResponse.json(
      { error: `You need ${maxCost} credits for this tool` },
      { status: 429 }
    );
  }

  // Prepare references + prompts ----------------------------------------
  fal.config({ credentials: apiKey });

  let preparedReferences: string[];
  try {
    preparedReferences = await prepareReferenceUrls(referenceList);
  } catch (error) {
    if (error instanceof ReferenceImageAccessError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }

  // Run all angles in parallel; tolerate partial failure -----------------
  const settled = await Promise.allSettled(
    adPrompts.map(async ({ prompt, angle }) => {
      const result = (await fal.subscribe(GPT_IMAGE_EDIT, {
        input: { prompt, image_urls: preparedReferences, quality: 'medium' },
      })) as FalResult;
      const url = result.data?.images?.[0]?.url;
      if (!url) throw new Error('No result URL from FAL');
      return { url, angle, prompt };
    })
  );

  const succeeded = settled
    .filter((r): r is PromiseFulfilledResult<{ url: string; angle: string; prompt: string }> => r.status === 'fulfilled')
    .map((r) => r.value);

  const failedCount = settled.length - succeeded.length;
  if (failedCount > 0) {
    settled
      .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
      .forEach((r) => console.error('Ads tool variant failed:', getErrorMessage(r.reason)));
  }

  if (succeeded.length === 0) {
    return NextResponse.json({ error: 'Could not generate any version. Try another reference or try again.' }, { status: 502 });
  }

  // Spend only for what we actually produced ----------------------------
  const spendAmount = PER_IMAGE_COST * succeeded.length;
  const { data: spendData, error: spendError } = await supabase.rpc('spend_generation_credits', {
    p_generation_type: 'image',
    p_amount: spendAmount,
    p_model: 'ads-studio',
    p_prompt: offer.slice(0, 160),
  });

  if (spendError || !Array.isArray(spendData) || !spendData[0]) {
    // Fail closed — never let images through uncharged (e.g. missing RPC).
    console.error('Credit spend failed:', spendError);
    return NextResponse.json({ error: 'Credit spend failed' }, { status: 500 });
  }
  const spendResult = spendData[0] as CreditSpendResult;
  if (!spendResult.ok) {
    return NextResponse.json({ error: 'Not enough credits' }, { status: 429 });
  }

  // refund_generation_credits ADDS credits, so it must run via the service role
  // (never client-callable) with an explicit user id.
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
  // Counter is written server-side via RPC (the table is read-only for clients).
  const { error: usageRpcError } = await supabase.rpc('increment_generation_usage', {
    p_generation_type: 'image',
    p_amount: succeeded.length,
  });

  if (usageRpcError) {
    await refund('usage_update_failed');
    return NextResponse.json({ error: 'Usage update failed', refunded: true }, { status: 500 });
  }

  const { error: insertError } = await supabase.from('generations').insert(
    succeeded.map((item) => ({
      user_id: user.id,
      // Store the exact prompt sent to FAL for this angle (the angle label is
      // embedded in the prompt's "Creative direction" line), so each ad in
      // Creations shows its real, distinct prompt.
      prompt: item.prompt,
      model: 'ads-studio',
      generation_type: 'image' as const,
      result_url: item.url,
      reference_image_url: referenceList[0],
      credit_cost: PER_IMAGE_COST,
    }))
  );

  if (insertError) {
    await refund('generation_insert_failed');
    return NextResponse.json({ error: 'Generation history save failed', refunded: true }, { status: 500 });
  }

  return NextResponse.json({
    results: succeeded.map((item) => ({ url: item.url, angle: item.angle })),
    requested: outputs,
    succeeded: succeeded.length,
    credits: spendResult,
  });
}
