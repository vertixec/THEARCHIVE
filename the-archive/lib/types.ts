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
  credit_balance?: number | null;
  video_credit_balance?: number | null;
  image_cost?: number;
  video_cost?: number;
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
