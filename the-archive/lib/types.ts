export type ItemType = 'visual' | 'system' | 'community' | 'workflow';

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

// Union type used in Card and Grid where any item type can arrive
export type AnyItem = (Visual | SystemPrompt | CommunityVisual | Workflow) & {
  _itemType?: ItemType;
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
};
