import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabaseServer';
import { canAccessFeature, creditCostForModel, type BusinessProfile } from '@/lib/business';
import { enforceRateLimit } from '@/lib/generationSecurity';
import { ReferenceImageAccessError, prepareReferenceUrls } from '@/lib/referenceImages';
import { TOOL_IMAGE_MODEL } from '@/lib/modelCatalog';
import { enqueueToolJob, toolImageProvider } from '@/lib/tools/enqueue';
import { buildStyleTransferPrompt } from '@/lib/tools/prompts/styleTransfer';
import { getTool } from '@/lib/tools/registry';

export const runtime = 'nodejs';
export const maxDuration = 60;

const PER_IMAGE_COST = creditCostForModel(TOOL_IMAGE_MODEL, 'image');

export async function POST(req: NextRequest) {
  const provider = toolImageProvider();
  if (!provider.isConfigured()) {
    return NextResponse.json({ error: `${provider.label} API key is not configured` }, { status: 500 });
  }

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
  const angle = hasContentImage ? 'Restyled' : 'Style transfer';

  let preparedImages: string[];
  try {
    preparedImages = await prepareReferenceUrls(provider, inputImages);
  } catch (error) {
    const message = error instanceof ReferenceImageAccessError ? error.message : 'Reference preparation failed';
    return NextResponse.json({ error: message }, { status: 400 });
  }

  // Enqueue the async job; /api/generate/status finalizes it (fetch result,
  // save result_url, complete credits, count usage). Keeps us under the
  // serverless timeout instead of waiting on FAL inline.
  const result = await enqueueToolJob({
    userId: user.id,
    prompt: finalPrompt,
    angle,
    model: 'style-transfer',
    tool: 'style-transfer',
    perImageCost: PER_IMAGE_COST,
    preparedImages,
    referenceImageUrl: styleUrl,
  });

  if (!result.ok) {
    if (result.reason === 'insufficient_credits') {
      return NextResponse.json({ error: `You need ${PER_IMAGE_COST} credits for this tool` }, { status: 429 });
    }
    return NextResponse.json(
      { error: 'Could not start the generation. Try another reference or try again.' },
      { status: 502 },
    );
  }

  return NextResponse.json({
    jobs: [{ jobId: result.jobId, angle: result.angle }],
    requested: 1,
    queued: 1,
  });
}
