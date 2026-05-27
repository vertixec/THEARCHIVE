import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabaseServer';
import { MODEL_CREDIT_COSTS, type BusinessProfile } from '@/lib/business';
import { getPlanForProfileFromDB } from '@/lib/businessServer';

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const yearMonth = new Date().toISOString().slice(0, 7);
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

  const plan = await getPlanForProfileFromDB(profile, supabase);

  const { data, error } = await supabase
    .from('user_generation_usage')
    .select('image_count, video_count')
    .eq('user_id', user.id)
    .eq('year_month', yearMonth)
    .maybeSingle();

  const { data: balance } = await supabase
    .from('user_credit_balances')
    .select('credits, video_credits')
    .eq('user_id', user.id)
    .maybeSingle<{ credits: number; video_credits: number }>();

  if (error) {
    return NextResponse.json({ error: 'Usage lookup failed' }, { status: 500 });
  }

  return NextResponse.json({
    image_count: data?.image_count ?? 0,
    video_count: data?.video_count ?? 0,
    image_limit: plan.monthlyImageLimit,
    video_limit: plan.monthlyVideoLimit,
    access_tier: plan.id,
    plan_name: plan.name,
    credit_balance: balance?.credits ?? null,
    video_credit_balance: balance?.video_credits ?? null,
    image_cost: MODEL_CREDIT_COSTS.image,
    video_cost: MODEL_CREDIT_COSTS.video,
  });
}
