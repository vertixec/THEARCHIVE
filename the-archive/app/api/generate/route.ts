import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabaseServer';
import { enforceRateLimit } from '@/lib/generationSecurity';
import { type BusinessProfile } from '@/lib/business';
import { enqueueGeneration } from '@/lib/generateJob';
import { type GenerationType } from '@/lib/generationModels';

// Submitting to the FAL queue is fast; this only needs a small budget.
export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const rateLimitResponse = await enforceRateLimit(user.id, 'generate', 10, 60);
  if (rateLimitResponse) return rateLimitResponse;

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const { prompt, model, generationType, referenceImageUrl, referenceImageUrls, options } = body;
  const type: GenerationType = generationType === 'video' ? 'video' : 'image';

  // The panel sends either a list or a single legacy `referenceImageUrl`.
  const referenceList: unknown = Array.isArray(referenceImageUrls)
    ? referenceImageUrls
    : typeof referenceImageUrl === 'string' && referenceImageUrl.length > 0
      ? [referenceImageUrl]
      : [];

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

  // Validation, pricing, credit reservation, FAL submit and the job row all
  // live in lib/generateJob so the MCP server can't drift onto a different
  // (cheaper or less-guarded) path.
  const result = await enqueueGeneration({
    userId: user.id,
    profile,
    prompt,
    model,
    generationType: type,
    referenceImageUrls: referenceList,
    options,
    tool: 'generate',
  });

  if (!result.ok) {
    return NextResponse.json(
      result.refunded ? { error: result.message, refunded: true } : { error: result.message },
      { status: result.status },
    );
  }

  return NextResponse.json({
    jobId: result.jobId,
    status: 'queued',
    generationType: result.generationType,
    credits: { credits: result.creditsRemaining },
  });
}
