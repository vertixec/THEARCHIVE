import type { ProviderId } from './modelCatalog';

export type ItemType = 'visual' | 'system' | 'community' | 'workflow' | 'generation';

export interface Visual {
  id: string;
  created_at: string;
  title: string;
  category: string;
  volume: string;
  image_url: string;
  model: string;
  prompt_text: string;
}

export interface SystemPrompt {
  id: string;
  created_at: string;
  title: string;
  prompt_type: string;
  instructions: string;
  prompt_text: string;
  model: string;
}

export interface CommunityVisual {
  id: string;
  created_at: string;
  author: string;
  is_featured: boolean;
  image_url: string;
  prompt_text?: string;
}

export interface Workflow {
  id: string;
  created_at: string;
  name: string;
  use_cases: string;
  link: string;
  tools: string;
}

export type DropKind = 'html' | 'pack' | 'template' | 'resource';

export interface CommunityDrop {
  id: string;
  created_at: string;
  title: string;
  description: string | null;
  kind: DropKind | string;
  /** File in Storage (HTML / .zip / etc.) — opened or downloaded on demand. */
  file_url: string;
  thumbnail_url: string | null;
  is_featured: boolean;
}

export interface Generation {
  id: string;
  user_id: string;
  created_at: string;
  prompt: string;
  model: string;
  generation_type: 'image' | 'video';
  result_url: string | null;
  reference_image_url: string | null;
  is_saved: boolean;
}

export interface GenerationUsage {
  image_count: number;
  video_count: number;
  image_limit: number;
  video_limit: number;
  access_tier?: string;
  plan_name?: string;
  // Spendable TOTAL = monthly community allowance + purchased credits.
  credit_balance?: number | null;
  /** Purchased credits (never expire). */
  purchased_credits?: number | null;
  /** Community allowance remaining (rolls over monthly up to the cap). */
  monthly_credits?: number;
  /** Monthly allowance added to this tier each cycle (0 if none). */
  monthly_credit_grant?: number;
  /** Ceiling the rolled-over monthly allowance accumulates to (0 if none). */
  monthly_credit_cap?: number;
  /** When the current monthly allowance was last granted. */
  monthly_credits_reset_at?: string | null;
  /** Per-model credit cost map, keyed by model id. */
  model_costs?: Record<string, number>;
  /** Default cost for an image / video when no specific model is selected. */
  image_cost?: number;
  video_cost?: number;
  /** Which generation providers have an API key configured server-side. */
  providers?: Record<ProviderId, boolean>;
}

export interface CreditPack {
  id: string;
  name: string;
  description: string | null;
  price_usd: string;
  image_credits: number;
  video_credits: number;
  lemonsqueezy_variant_id: string | null;
  is_active: boolean;
  sort_order: number;
}

export type PaymentIntentStatus = 'pending' | 'confirmed' | 'failed' | 'refunded';

export interface PaymentIntent {
  id: string;
  user_id: string;
  pack_id: string;
  amount_usd: string;
  image_credits: number;
  video_credits: number;
  provider: string;
  provider_reference: string | null;
  checkout_url: string | null;
  status: PaymentIntentStatus;
  metadata: Record<string, unknown>;
  created_at: string;
  confirmed_at: string | null;
}

export type CreditTransactionReason =
  | 'signup_bonus'
  | 'monthly_grant'
  | 'purchase'
  | 'generation_spend'
  | 'refund'
  | 'admin_adjustment'
  | 'migration';

export interface CreditTransaction {
  id: string;
  user_id: string;
  amount: number;
  balance_after: number | null;
  credit_type: string;
  reason: CreditTransactionReason | string;
  related_generation_id: string | null;
  payment_provider: string | null;
  payment_reference: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

// Union type used in Card and Grid where any item type can arrive
export type AnyItem = (Visual | SystemPrompt | CommunityVisual | Workflow | Generation) & {
  _itemType?: ItemType;
  _likeCount?: number;
  // Optional fields accessed generically across item types
  image_url?: string;
  title?: string;
  category?: string;
  volume?: string;
  model?: string;
  prompt_text?: string;
  instructions?: string;
  prompt_type?: string;
  author?: string;
  is_featured?: boolean;
  name?: string;
  use_cases?: string;
  link?: string;
  tools?: string;
  prompt?: string;
  result_url?: string | null;
  generation_type?: 'image' | 'video';
};
