import type { SupabaseClient } from '@supabase/supabase-js';
import {
  PLAN_CONFIG,
  resolveAccessTier,
  type BusinessProfile,
  type PlanConfig,
} from './business';

type PlansRow = {
  monthly_image_limit: number | null;
  monthly_video_limit: number | null;
  signup_credits: number | null;
  monthly_credit_grant: number | null;
  monthly_credit_cap: number | null;
};

export async function getPlanForProfileFromDB(
  profile: BusinessProfile | null | undefined,
  supabase: SupabaseClient,
): Promise<PlanConfig> {
  const tier = resolveAccessTier(profile);
  const base = PLAN_CONFIG[tier];

  if (tier === 'visitor' || tier === 'admin') {
    return base;
  }

  const { data, error } = await supabase
    .from('plans')
    .select('monthly_image_limit, monthly_video_limit, signup_credits, monthly_credit_grant, monthly_credit_cap')
    .eq('access_tier', tier)
    .maybeSingle<PlansRow>();

  if (error || !data) {
    return base;
  }

  return {
    ...base,
    monthlyImageLimit: data.monthly_image_limit ?? base.monthlyImageLimit,
    monthlyVideoLimit: data.monthly_video_limit ?? base.monthlyVideoLimit,
    signupCredits: data.signup_credits ?? base.signupCredits,
    monthlyCreditGrant: data.monthly_credit_grant ?? base.monthlyCreditGrant,
    monthlyCreditCap: data.monthly_credit_cap ?? base.monthlyCreditCap,
  };
}
