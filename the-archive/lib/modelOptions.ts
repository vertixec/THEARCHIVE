// ============================================================
// Per-model generation options (format / quality / resolution / duration)
// ============================================================
// Single source of truth shared by the client panel AND the server route, so
// what the user picks, what we charge, and what we send to FAL never drift.
//
// Each model exposes a set of CONTROLS. The selected values determine:
//   1. the FAL input params we send  (falParamsFor)
//   2. the credit cost we charge      (creditCostFor)
//
// Credit prices are calibrated to ~$0.02 retail per credit and ~4.5x the real
// FAL compute cost (prices: June 2026). Parameter names/enums are taken from
// each model's FAL API schema.
// ============================================================

import type { GenerationType } from './falGenerate';

export type ControlOption = { value: string; label: string };

export type ModelControl = {
  /** FAL input field name this control maps to. */
  key: 'quality' | 'image_size' | 'aspect_ratio' | 'resolution' | 'duration';
  /** Short UI label. */
  label: string;
  options: ControlOption[];
  default: string;
};

export type ModelOptionSpec = {
  type: GenerationType;
  controls: ModelControl[];
  /** Credits for a given (already-normalized) selection. */
  cost: (sel: Record<string, string>) => number;
};

// ------------------------------------------------------------
// Shared option lists
// ------------------------------------------------------------

const IMAGE_SIZES: ControlOption[] = [
  { value: 'square_hd', label: '1:1 Square' },
  { value: 'landscape_4_3', label: '4:3 Landscape' },
  { value: 'portrait_4_3', label: '3:4 Portrait' },
  { value: 'landscape_16_9', label: '16:9 Wide' },
  { value: 'portrait_16_9', label: '9:16 Vertical' },
];

const VIDEO_ASPECTS: ControlOption[] = [
  { value: '16:9', label: '16:9 Wide' },
  { value: '9:16', label: '9:16 Vertical' },
  { value: '1:1', label: '1:1 Square' },
];

// ------------------------------------------------------------
// Per-model specs
// ------------------------------------------------------------

export const MODEL_OPTIONS: Record<string, ModelOptionSpec> = {
  'gpt-image-2': {
    type: 'image',
    controls: [
      {
        key: 'quality',
        label: 'Quality',
        options: [
          { value: 'low', label: 'Low' },
          { value: 'medium', label: 'Medium' },
          { value: 'high', label: 'High' },
        ],
        default: 'medium',
      },
      { key: 'image_size', label: 'Format', options: IMAGE_SIZES, default: 'square_hd' },
    ],
    // FAL cost: low $0.006, medium $0.053, high $0.211.
    cost: (sel) => ({ low: 2, medium: 12, high: 48 }[sel.quality] ?? 12),
  },

  'flux-pro': {
    type: 'image',
    controls: [
      { key: 'image_size', label: 'Format', options: IMAGE_SIZES, default: 'square_hd' },
    ],
    // FAL cost ~$0.04-0.08/image regardless of aspect → flat.
    cost: () => 10,
  },

  'nano-banana-pro': {
    type: 'image',
    controls: [
      {
        key: 'aspect_ratio',
        label: 'Format',
        options: [
          { value: '1:1', label: '1:1 Square' },
          { value: '16:9', label: '16:9 Wide' },
          { value: '9:16', label: '9:16 Vertical' },
          { value: '4:3', label: '4:3 Landscape' },
          { value: '3:4', label: '3:4 Portrait' },
        ],
        default: '1:1',
      },
      {
        key: 'resolution',
        label: 'Resolution',
        options: [
          { value: '1K', label: '1K' },
          { value: '2K', label: '2K' },
          { value: '4K', label: '4K' },
        ],
        default: '2K',
      },
    ],
    // FAL cost: 1K/2K $0.15, 4K $0.30 (double).
    cost: (sel) => (sel.resolution === '4K' ? 70 : 35),
  },

  'kling-1.6': {
    type: 'video',
    controls: [
      { key: 'aspect_ratio', label: 'Format', options: VIDEO_ASPECTS, default: '16:9' },
      {
        key: 'duration',
        label: 'Duration',
        options: [
          { value: '5', label: '5s' },
          { value: '10', label: '10s' },
        ],
        default: '5',
      },
    ],
    // FAL cost $0.056/s → 5s $0.28, 10s $0.56.
    cost: (sel) => (sel.duration === '10' ? 130 : 65),
  },

  seedance: {
    type: 'video',
    controls: [
      {
        key: 'resolution',
        label: 'Resolution',
        options: [
          { value: '480p', label: '480p' },
          { value: '720p', label: '720p' },
        ],
        default: '720p',
      },
      {
        key: 'aspect_ratio',
        label: 'Format',
        options: VIDEO_ASPECTS,
        default: '16:9',
      },
      {
        key: 'duration',
        label: 'Duration',
        options: [
          { value: '5', label: '5s' },
          { value: '10', label: '10s' },
        ],
        default: '5',
      },
    ],
    // FAL cost ~$0.242/s @720p, ~$0.108/s @480p → per-second credits 55 / 25.
    cost: (sel) => {
      const perSecond = sel.resolution === '480p' ? 25 : 55;
      const seconds = sel.duration === '10' ? 10 : 5;
      return perSecond * seconds;
    },
  },
};

// ------------------------------------------------------------
// Helpers
// ------------------------------------------------------------

/** Default selection (all controls at their default value) for a model. */
export function defaultSelection(modelId: string): Record<string, string> {
  const spec = MODEL_OPTIONS[modelId];
  if (!spec) return {};
  const sel: Record<string, string> = {};
  for (const c of spec.controls) sel[c.key] = c.default;
  return sel;
}

/**
 * Coerce an untrusted selection from the client into a safe one: keep only
 * known controls, only allowed values, and fill any missing control with its
 * default. The server uses this before pricing and before calling FAL.
 */
export function normalizeSelection(modelId: string, raw: unknown): Record<string, string> {
  const spec = MODEL_OPTIONS[modelId];
  if (!spec) return {};
  const input = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const sel: Record<string, string> = {};
  for (const c of spec.controls) {
    const v = input[c.key];
    const allowed = c.options.some((o) => o.value === v);
    sel[c.key] = allowed ? (v as string) : c.default;
  }
  return sel;
}

/** Authoritative credit cost for a model + selection. */
export function creditCostFor(
  modelId: string,
  selection: Record<string, string>,
  fallbackType: GenerationType,
): number {
  const spec = MODEL_OPTIONS[modelId];
  if (!spec) return fallbackType === 'image' ? 12 : 65;
  return spec.cost(normalizeSelection(modelId, selection));
}

/** FAL input params for a model + selection (only valid keys). */
export function falParamsFor(
  modelId: string,
  selection: Record<string, string>,
): Record<string, unknown> {
  const spec = MODEL_OPTIONS[modelId];
  if (!spec) return {};
  const sel = normalizeSelection(modelId, selection);
  const params: Record<string, unknown> = {};
  for (const c of spec.controls) params[c.key] = sel[c.key];
  return params;
}
