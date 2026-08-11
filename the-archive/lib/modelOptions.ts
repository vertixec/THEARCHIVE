// ============================================================
// Per-model generation options (format / quality / resolution / duration)
// ============================================================
// Single source of truth shared by the client panel AND the server route, so
// what the user picks, what we charge, and what we send to the provider never
// drift.
//
// Each model exposes a set of CONTROLS. The selected values determine:
//   1. the provider input params we send  (modelParamsFor)
//   2. the credit cost we charge          (creditCostFor)
//
// PRICING RULE: credits are calibrated to ~$0.02 retail per credit at ~4.5x the
// real compute cost, i.e. `credits ≈ usd * 225`. Each entry states the vendor
// price it was derived from, so retuning is arithmetic, not guesswork.
//
// FAL prices: June 2026. KIE prices: published rates as of August 2026 — verify
// the live table at https://kie.ai/pricing before a big pricing pass. KIE video
// models are deliberately priced at the FAL rate (a conservative placeholder):
// KIE is cheaper, so margin can only come out ahead, and they can be lowered
// once the real per-second rates are confirmed.
//
// Parameter names/enums are taken from each model's API schema
// (FAL docs, and docs.kie.ai/market/* for KIE).
// ============================================================

import type { GenerationType } from './modelCatalog';

export type ControlOption = { value: string; label: string };

export type ControlKey =
  | 'quality'
  | 'image_size'
  | 'aspect_ratio'
  | 'resolution'
  | 'duration'
  | 'mode';

export type ModelControl = {
  /** Provider input field this control maps to. */
  key: ControlKey;
  /** Short UI label. */
  label: string;
  options: ControlOption[];
  default: string;
  /** Send the value as a number (KIE's seedance takes `duration: 5`, not '5'). */
  numeric?: boolean;
};

export type ModelOptionSpec = {
  type: GenerationType;
  controls: ModelControl[];
  /** Credits for a given (already-normalized) selection. */
  cost: (sel: Record<string, string>) => number;
  /**
   * Image models only. true = the edit endpoint sizes its output from the
   * source image, so format/resolution controls don't apply to an edit and the
   * job is priced at the model base (keeping only `quality`). false = the edit
   * endpoint accepts the same controls as text-to-image.
   */
  editUsesSourceDimensions?: boolean;
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

/** Aspect ratios every KIE image model in the catalog accepts. */
const KIE_IMAGE_ASPECTS: ControlOption[] = [
  { value: '1:1', label: '1:1 Square' },
  { value: '4:3', label: '4:3 Landscape' },
  { value: '3:4', label: '3:4 Portrait' },
  { value: '16:9', label: '16:9 Wide' },
  { value: '9:16', label: '9:16 Vertical' },
  { value: '3:2', label: '3:2 Photo' },
  { value: '2:3', label: '2:3 Tall' },
];

const DURATION_5_10: ControlOption[] = [
  { value: '5', label: '5s' },
  { value: '10', label: '10s' },
];

// ------------------------------------------------------------
// Per-model specs
// ------------------------------------------------------------

export const MODEL_OPTIONS: Record<string, ModelOptionSpec> = {
  // ---------------- FAL ----------------
  'gpt-image-2': {
    type: 'image',
    editUsesSourceDimensions: true,
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
    editUsesSourceDimensions: true,
    controls: [
      { key: 'image_size', label: 'Format', options: IMAGE_SIZES, default: 'square_hd' },
    ],
    // FAL cost ~$0.04-0.08/image regardless of aspect → flat.
    cost: () => 10,
  },

  'nano-banana-pro': {
    type: 'image',
    editUsesSourceDimensions: true,
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
      { key: 'duration', label: 'Duration', options: DURATION_5_10, default: '5' },
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
      { key: 'aspect_ratio', label: 'Format', options: VIDEO_ASPECTS, default: '16:9' },
      { key: 'duration', label: 'Duration', options: DURATION_5_10, default: '5' },
    ],
    // FAL cost ~$0.242/s @720p, ~$0.108/s @480p → per-second credits 55 / 25.
    cost: (sel) => {
      const perSecond = sel.resolution === '480p' ? 25 : 55;
      const seconds = sel.duration === '10' ? 10 : 5;
      return perSecond * seconds;
    },
  },

  // ---------------- KIE AI ----------------
  // KIE edit endpoints accept the same aspect_ratio/resolution as their
  // text-to-image counterparts, so editUsesSourceDimensions stays false.
  'kie/gpt-image-2': {
    type: 'image',
    controls: [
      { key: 'aspect_ratio', label: 'Format', options: KIE_IMAGE_ASPECTS, default: '1:1' },
      {
        key: 'resolution',
        label: 'Resolution',
        options: [
          { value: '1K', label: '1K' },
          { value: '2K', label: '2K' },
          { value: '4K', label: '4K' },
        ],
        default: '1K',
      },
    ],
    // KIE cost: 1K ~$0.03, 2K ~$0.05, 4K ~$0.09 (vs $0.053 for a single
    // MEDIUM gpt-image-2 render on FAL).
    cost: (sel) => ({ '1K': 8, '2K': 12, '4K': 22 }[sel.resolution] ?? 8),
  },

  'kie/nano-banana': {
    type: 'image',
    controls: [
      { key: 'aspect_ratio', label: 'Format', options: KIE_IMAGE_ASPECTS, default: '1:1' },
    ],
    // KIE cost ~$0.02/image, single resolution → flat.
    cost: () => 5,
  },

  'kie/nano-banana-pro': {
    type: 'image',
    controls: [
      { key: 'aspect_ratio', label: 'Format', options: KIE_IMAGE_ASPECTS, default: '1:1' },
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
    // KIE cost: 1K ~$0.04, 2K ~$0.06, 4K ~$0.09 — roughly a third of the
    // same model on FAL ($0.15 / $0.30).
    cost: (sel) => ({ '1K': 10, '2K': 15, '4K': 22 }[sel.resolution] ?? 15),
  },

  'kie/flux-2-pro': {
    type: 'image',
    controls: [
      { key: 'aspect_ratio', label: 'Format', options: KIE_IMAGE_ASPECTS, default: '1:1' },
      {
        key: 'resolution',
        label: 'Resolution',
        options: [
          { value: '1K', label: '1K' },
          { value: '2K', label: '2K' },
        ],
        default: '1K',
      },
    ],
    // KIE cost: 1K ~$0.03, 2K ~$0.05.
    cost: (sel) => (sel.resolution === '2K' ? 12 : 8),
  },

  'kie/kling-3': {
    type: 'video',
    controls: [
      { key: 'aspect_ratio', label: 'Format', options: VIDEO_ASPECTS, default: '16:9' },
      {
        key: 'mode',
        label: 'Quality',
        options: [
          { value: 'std', label: 'Standard 720p' },
          { value: 'pro', label: 'Pro 1080p' },
        ],
        default: 'std',
      },
      { key: 'duration', label: 'Duration', options: DURATION_5_10, default: '5' },
    ],
    // Placeholder: priced at the FAL Kling rate ($0.056/s std) until KIE's live
    // per-second rate is confirmed. pro ≈ 1.5x std.
    cost: (sel) => {
      const perSecond = sel.mode === 'pro' ? 19 : 13;
      const seconds = sel.duration === '10' ? 10 : 5;
      return perSecond * seconds;
    },
  },

  'kie/seedance-2': {
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
      { key: 'aspect_ratio', label: 'Format', options: VIDEO_ASPECTS, default: '16:9' },
      // KIE takes seedance duration as a NUMBER, unlike every other control.
      { key: 'duration', label: 'Duration', options: DURATION_5_10, default: '5', numeric: true },
    ],
    // Placeholder: priced at the FAL Seedance rate until KIE's is confirmed.
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
 * default. The server uses this before pricing and before calling the provider.
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

/** Provider input params for a model + selection (only valid keys). */
export function modelParamsFor(
  modelId: string,
  selection: Record<string, string>,
): Record<string, unknown> {
  const spec = MODEL_OPTIONS[modelId];
  if (!spec) return {};
  const sel = normalizeSelection(modelId, selection);
  const params: Record<string, unknown> = {};
  for (const c of spec.controls) {
    params[c.key] = c.numeric ? Number(sel[c.key]) : sel[c.key];
  }
  return params;
}

/** True when an edit run should be priced/parameterised at the model base. */
export function editUsesSourceDimensions(modelId: string): boolean {
  return MODEL_OPTIONS[modelId]?.editUsesSourceDimensions === true;
}
