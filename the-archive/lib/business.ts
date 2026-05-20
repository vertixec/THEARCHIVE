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
    features: [],
  },
  free: {
    id: 'free',
    name: 'Free',
    label: 'Try the engine',
    description: 'A light account for outside users to test THE ARCHIVE before upgrading.',
    monthlyImageLimit: 5,
    monthlyVideoLimit: 0,
    signupCredits: 5,
    features: ['view_visuals', 'generate_image', 'create_moodboard', 'save_favorite'],
  },
  community: {
    id: 'community',
    name: 'Community',
    label: 'Private member access',
    description: 'The full Archive experience for active paid community members.',
    monthlyImageLimit: 50,
    monthlyVideoLimit: 5,
    signupCredits: 0,
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

export const MODEL_CREDIT_COSTS = {
  image: 1,
  video: 5,
} as const;

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

