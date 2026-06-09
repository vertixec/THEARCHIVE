import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabaseServer';
import {
  MODEL_CREDIT_COSTS,
  DEFAULT_MODEL_COST,
  type BusinessProfile,
} from '@/lib/business';
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

  // Two-bucket balance: purchased `credits` + monthly community allowance.
  // The spendable total is what gates a generation.
  const { data: balance } = await supabase
    .from('user_credit_balances')
    .select('credits, monthly_credits, monthly_credits_reset_at')
    .eq('user_id', user.id)
    .maybeSingle<{ credits: number; monthly_credits: number; monthly_credits_reset_at: string | null }>();

  if (error) {
    return NextResponse.json({ error: 'Usage lookup failed' }, { status: 500 });
  }

  const purchasedCredits = balance?.credits ?? null;
  const monthlyCredits = balance?.monthly_credits ?? 0;
  const totalCredits = balance ? (balance.credits + (balance.monthly_credits ?? 0)) : null;

  return NextResponse.json({
    image_count: data?.image_count ?? 0,
    video_count: data?.video_count ?? 0,
    image_limit: plan.monthlyImageLimit,
    video_limit: plan.monthlyVideoLimit,
    access_tier: plan.id,
    plan_name: plan.name,
    // credit_balance is the spendable TOTAL (monthly + purchased) so the UI's
    // existing gating keeps working. The breakdown fields below let the UI show
    // "X de comunidad + Y comprados" and the monthly grant amount.
    credit_balance: totalCredits,
    purchased_credits: purchasedCredits,
    monthly_credits: monthlyCredits,
    monthly_credit_grant: plan.monthlyCreditGrant,
    monthly_credits_reset_at: balance?.monthly_credits_reset_at ?? null,
    // Per-model credit costs so the UI can show what the selected model costs.
    model_costs: MODEL_CREDIT_COSTS,
    image_cost: DEFAULT_MODEL_COST.image,
    video_cost: DEFAULT_MODEL_COST.video,
  });
}
