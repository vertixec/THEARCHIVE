import { fal } from '@fal-ai/client';
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabaseServer';
import { canAccessFeature, creditCostForModel, type BusinessProfile } from '@/lib/business';
import { enforceRateLimit } from '@/lib/generationSecurity';
import { ReferenceImageAccessError, prepareReferenceUrls } from '@/lib/falReference';
import { enqueueToolJob, type ToolEnqueueResult } from '@/lib/tools/enqueue';
import { buildAdPrompts } from '@/lib/tools/prompts/ads';
import { getTool } from '@/lib/tools/registry';
import { AD_ANGLE_OPTIONS } from '@/lib/tools/adsAngles';

export const runtime = 'nodejs';
export const maxDuration = 60;

const PER_IMAGE_COST = creditCostForModel('gpt-image-2', 'image');

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

  // Prepare references once (shared across every angle) before reserving any
  // credits — if this fails there's nothing to refund yet.
  fal.config({ credentials: apiKey });
  let preparedReferences: string[];
  try {
    preparedReferences = await prepareReferenceUrls(referenceList);
  } catch (error) {
    const message = error instanceof ReferenceImageAccessError ? error.message : 'Reference preparation failed';
    return NextResponse.json({ error: message }, { status: 400 });
  }

  // Enqueue one async job per angle. Each reserves + charges its own credits and
  // is finalized by /api/generate/status, so a slow run can't blow the function
  // timeout. Stop early if the user runs out of credits mid-batch.
  const jobs: { jobId: string; angle: string }[] = [];
  let ranOutOfCredits = false;
  for (const { prompt, angle } of adPrompts) {
    const result: ToolEnqueueResult = await enqueueToolJob({
      userId: user.id,
      prompt,
      angle,
      model: 'ads-studio',
      tool: 'ads',
      perImageCost: PER_IMAGE_COST,
      preparedImages: preparedReferences,
      referenceImageUrl: referenceList[0],
    });
    if (result.ok) {
      jobs.push({ jobId: result.jobId, angle: result.angle });
    } else if (result.reason === 'insufficient_credits') {
      ranOutOfCredits = true;
      break;
    }
    // submit/insert failures: their reservation was already refunded; skip this
    // angle and try the rest.
  }

  if (jobs.length === 0) {
    if (ranOutOfCredits) {
      return NextResponse.json({ error: `You need ${PER_IMAGE_COST} credits for this tool` }, { status: 429 });
    }
    return NextResponse.json(
      { error: 'Could not start the generation. Try another reference or try again.' },
      { status: 502 },
    );
  }

  return NextResponse.json({ jobs, requested: outputs, queued: jobs.length });
}
