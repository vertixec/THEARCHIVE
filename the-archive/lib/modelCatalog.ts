// ============================================================
// Model catalog — the single source of truth for WHICH models exist, WHO
// serves them, and WHAT endpoint each one needs.
// ============================================================
// THE ARCHIVE talks to more than one generation provider:
//
//   * fal — the original provider (@fal-ai/client, queue API)
//   * kie — KIE AI (api.kie.ai unified Jobs API), typically 2-4x cheaper for
//           the same underlying models
//
// Adding a model = one entry here + its controls/cost in modelOptions.ts + its
// default cost in business.ts. Nothing else in the pipeline hardcodes a
// provider: submit, polling, reference uploads and the completion webhook all
// resolve through lib/providers using the `provider` field below.
//
// Model ids are also stored on the `generations.model` column and exposed to
// MCP agents, so they must stay stable once shipped.
// ============================================================

export type GenerationType = 'image' | 'video';
export type ProviderId = 'fal' | 'kie';

export type ReferenceInput = {
  /** Provider input field that carries the reference image URL(s). */
  key: string;
  /** true = array of urls, false = a single url string. */
  multiple: boolean;
};

export type ModelEntry = {
  id: string;
  provider: ProviderId;
  type: GenerationType;
  /** UI label. */
  label: string;
  /** UI one-liner. */
  description: string;
  /** Provider endpoint / model string for the text-to-x path. */
  endpoint: string;
  /** Endpoint used when reference images are attached (image models). */
  editEndpoint?: string;
  /** How reference URLs are passed on the edit endpoint. */
  referenceInput?: ReferenceInput;
};

export const MODEL_CATALOG: ModelEntry[] = [
  // ---------------- FAL ----------------
  {
    id: 'gpt-image-2',
    provider: 'fal',
    type: 'image',
    label: 'GPT Image 2',
    description: 'High fidelity, text-aware',
    endpoint: 'fal-ai/gpt-image-2',
    editEndpoint: 'openai/gpt-image-2/edit',
    referenceInput: { key: 'image_urls', multiple: true },
  },
  {
    id: 'flux-pro',
    provider: 'fal',
    type: 'image',
    label: 'Flux Pro',
    description: 'Creative image generation',
    endpoint: 'fal-ai/flux-pro/v1.1',
    editEndpoint: 'fal-ai/flux-pro/v1.1/redux',
    referenceInput: { key: 'image_url', multiple: false },
  },
  {
    id: 'nano-banana-pro',
    provider: 'fal',
    type: 'image',
    label: 'Nano Banana Pro',
    description: 'Reasoning image model',
    endpoint: 'fal-ai/nano-banana-pro',
    editEndpoint: 'fal-ai/nano-banana-pro/edit',
    referenceInput: { key: 'image_urls', multiple: true },
  },
  {
    id: 'kling-1.6',
    provider: 'fal',
    type: 'video',
    label: 'Kling 1.6',
    description: 'Standard text to video',
    endpoint: 'fal-ai/kling-video/v1.6/standard/text-to-video',
  },
  {
    id: 'seedance',
    provider: 'fal',
    type: 'video',
    label: 'Seedance 2 Fast',
    description: 'Fast cinematic video',
    endpoint: 'bytedance/seedance-2.0/fast/text-to-video',
  },

  // ---------------- KIE AI ----------------
  // Model strings come from docs.kie.ai/market/* — they are NOT namespaced
  // consistently upstream (some carry a vendor prefix, some don't), so each one
  // is copied verbatim from its own doc page.
  {
    id: 'kie/gpt-image-2',
    provider: 'kie',
    type: 'image',
    label: 'GPT Image 2 · KIE',
    description: 'Same model, cheaper route',
    endpoint: 'gpt-image-2-text-to-image',
    editEndpoint: 'gpt-image-2-image-to-image',
    referenceInput: { key: 'input_urls', multiple: true },
  },
  {
    id: 'kie/nano-banana',
    provider: 'kie',
    type: 'image',
    label: 'Nano Banana · KIE',
    description: 'Cheapest fast image model',
    endpoint: 'google/nano-banana',
    editEndpoint: 'google/nano-banana-edit',
    referenceInput: { key: 'image_urls', multiple: true },
  },
  {
    id: 'kie/nano-banana-pro',
    provider: 'kie',
    type: 'image',
    label: 'Nano Banana Pro · KIE',
    description: 'Reasoning image model, up to 4K',
    // One model handles both text-to-image and editing; references go in
    // `image_input` (up to 8).
    endpoint: 'nano-banana-pro',
    editEndpoint: 'nano-banana-pro',
    referenceInput: { key: 'image_input', multiple: true },
  },
  {
    id: 'kie/flux-2-pro',
    provider: 'kie',
    type: 'image',
    label: 'Flux 2 Pro · KIE',
    description: 'Creative image generation',
    endpoint: 'flux-2/pro-text-to-image',
    editEndpoint: 'flux-2/pro-image-to-image',
    referenceInput: { key: 'input_urls', multiple: true },
  },
  {
    id: 'kie/kling-3',
    provider: 'kie',
    type: 'video',
    label: 'Kling 3.0 · KIE',
    description: 'Up to 1080p, native audio',
    endpoint: 'kling-3.0/video',
    referenceInput: { key: 'image_urls', multiple: true },
  },
  {
    id: 'kie/seedance-2',
    provider: 'kie',
    type: 'video',
    label: 'Seedance 2 · KIE',
    description: 'Cinematic video',
    endpoint: 'bytedance/seedance-2',
    referenceInput: { key: 'reference_image_urls', multiple: true },
  },
];

export const MODELS_BY_ID: Record<string, ModelEntry> = Object.fromEntries(
  MODEL_CATALOG.map((entry) => [entry.id, entry]),
);

export const DEFAULT_MODEL: Record<GenerationType, string> = {
  image: 'gpt-image-2',
  video: 'kling-1.6',
};

/**
 * Model the Tools surface (Ads, Style transfer) runs its image edits on.
 * Switching Tools to another provider is this one line — the tool routes read
 * the provider, endpoint and cost from the catalog.
 */
export const TOOL_IMAGE_MODEL = 'gpt-image-2';

export function modelsOfType(type: GenerationType): ModelEntry[] {
  return MODEL_CATALOG.filter((entry) => entry.type === type);
}

export function providerForModel(modelId: string | null | undefined): ProviderId {
  return (modelId && MODELS_BY_ID[modelId]?.provider) || 'fal';
}

/** Endpoint to call for a model, taking the edit path when references exist. */
export function resolveEndpoint(
  type: GenerationType,
  modelId: string,
  hasReference: boolean,
): string {
  const entry = MODELS_BY_ID[modelId] ?? MODELS_BY_ID[DEFAULT_MODEL[type]];
  if (type === 'image' && hasReference) {
    return entry.editEndpoint || entry.endpoint;
  }
  return entry.endpoint;
}

export function referenceInputFor(modelId: string): ReferenceInput {
  return MODELS_BY_ID[modelId]?.referenceInput ?? { key: 'image_urls', multiple: true };
}
