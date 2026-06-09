export type AccessTier = 'visitor' | 'free' | 'community' | 'pro' | 'admin';

export type Feature =
  | 'view_visuals'
  | 'view_systems'
  | 'view_workflows'
  | 'view_community'
  | 'generate_image'
  | 'generate_video'
  | 'create_moodboard'
  | 'save_favorite'
  | 'admin_panel';

export type BusinessProfile = {
  id: string;
  status?: string | null;
  role?: string | null;
  access_tier?: string | null;
  plan_id?: string | null;
  credit_balance?: number | null;
};

export type PlanConfig = {
  id: AccessTier;
  name: string;
  label: string;
  description: string;
  monthlyImageLimit: number;
  monthlyVideoLimit: number;
  signupCredits: number;
  // Credits granted to this tier at the start of every monthly cycle. These
  // live in a SEPARATE bucket (user_credit_balances.monthly_credits) that is
  // reset each month (use-it-or-lose-it) and spent BEFORE purchased credits.
  // Only the community tier gets an allowance today. See
  // supabase/community_monthly_credits.sql for the matching DB logic.
  monthlyCreditGrant: number;
  features: Feature[];
};

export const PLAN_CONFIG: Record<AccessTier, PlanConfig> = {
  visitor: {
    id: 'visitor',
    name: 'Visitor',
    label: 'Public preview',
    description: 'Explore the product story and public examples before creating an account.',
    monthlyImageLimit: 0,
    monthlyVideoLimit: 0,
    signupCredits: 0,
    monthlyCreditGrant: 0,
    features: [],
  },
  free: {
    id: 'free',
    name: 'Free',
    label: 'Try the engine',
    description: 'A light account for outside users to test THE ARCHIVE before upgrading.',
    monthlyImageLimit: 5,
    monthlyVideoLimit: 0,
    // 60 unified credits ≈ 5 medium gpt-image-2 images. The monthly image
    // count (5) is the hard guardrail that caps free-tier FAL spend.
    signupCredits: 60,
    monthlyCreditGrant: 0,
    features: ['view_visuals', 'view_systems', 'generate_image', 'create_moodboard', 'save_favorite'],
  },
  community: {
    id: 'community',
    name: 'Community',
    label: 'Private member access',
    description: 'The full Archive experience for active paid community members.',
    monthlyImageLimit: 50,
    monthlyVideoLimit: 5,
    signupCredits: 0,
    // Skool community perk: 800 credits refreshed every month.
    monthlyCreditGrant: 800,
    features: [
      'view_visuals',
      'view_systems',
      'view_workflows',
      'view_community',
      'generate_image',
      'generate_video',
      'create_moodboard',
      'save_favorite',
    ],
  },
  pro: {
    id: 'pro',
    name: 'Pro',
    label: 'Public paid plan',
    description: 'A future paid plan for public users who want more credits and full workflows.',
    monthlyImageLimit: 100,
    monthlyVideoLimit: 10,
    signupCredits: 0,
    monthlyCreditGrant: 0,
    features: [
      'view_visuals',
      'view_systems',
      'view_workflows',
      'generate_image',
      'generate_video',
      'create_moodboard',
      'save_favorite',
    ],
  },
  admin: {
    id: 'admin',
    name: 'Admin',
    label: 'Operator access',
    description: 'Internal access for managing members, credits, content, and operations.',
    monthlyImageLimit: 9999,
    monthlyVideoLimit: 9999,
    signupCredits: 0,
    monthlyCreditGrant: 0,
    features: [
      'view_visuals',
      'view_systems',
      'view_workflows',
      'view_community',
      'generate_image',
      'generate_video',
      'create_moodboard',
      'save_favorite',
      'admin_panel',
    ],
  },
};

// Credit cost PER MODEL (unified credit pool). Calibrated to ~4.5x the real
// FAL compute cost at a retail value of ~$0.02 per credit (prices: June 2026).
// This is the single source of truth for what a generation costs. Different
// models cost different amounts so users can't pick an expensive model for the
// price of a cheap one — that arbitrage is what made the old flat pricing lose
// money. See supabase/pricing_unified_credits.sql for the matching DB changes.
//
//   model              FAL cost      credits   markup
//   gpt-image-2 (med)   $0.053         12        4.5x
//   flux-pro            $0.04-0.08     10        2.5-5x
//   nano-banana-pro     $0.15          35        4.7x
//   kling-1.6 (5s)      $0.28          65        4.6x
//   seedance fast (5s)  $1.21          275       4.5x
export const MODEL_CREDIT_COSTS: Record<string, number> = {
  'gpt-image-2': 12,
  'flux-pro': 10,
  'nano-banana-pro': 35,
  'kling-1.6': 65,
  seedance: 275,
};

// Cost charged when a model id is missing/unknown — the default of each type
// (gpt-image-2 for images, kling-1.6 for videos).
export const DEFAULT_MODEL_COST = {
  image: MODEL_CREDIT_COSTS['gpt-image-2'],
  video: MODEL_CREDIT_COSTS['kling-1.6'],
} as const;

export function creditCostForModel(
  modelId: string | null | undefined,
  type: 'image' | 'video',
): number {
  if (modelId && MODEL_CREDIT_COSTS[modelId] != null) {
    return MODEL_CREDIT_COSTS[modelId];
  }
  return type === 'image' ? DEFAULT_MODEL_COST.image : DEFAULT_MODEL_COST.video;
}

export function resolveAccessTier(profile?: BusinessProfile | null): AccessTier {
  if (!profile) return 'visitor';
  if (profile.role === 'admin') return 'admin';
  if (isAccessTier(profile.access_tier)) return profile.access_tier;
  if (profile.status === 'active' && profile.role === 'member') return 'community';
  if (profile.status === 'active') return 'free';
  return 'free';
}

export function getPlanForProfile(profile?: BusinessProfile | null) {
  return PLAN_CONFIG[resolveAccessTier(profile)];
}

export function canAccessFeature(profile: BusinessProfile | null | undefined, feature: Feature) {
  return getPlanForProfile(profile).features.includes(feature);
}

export function isAccessTier(value: unknown): value is AccessTier {
  return typeof value === 'string' && value in PLAN_CONFIG;
}

export function isActivePlatformUser(profile?: BusinessProfile | null) {
  if (!profile) return false;
  if (profile.role === 'admin') return true;
  if (profile.status === 'banned') return false;
  return ['free', 'community', 'pro'].includes(resolveAccessTier(profile));
}

