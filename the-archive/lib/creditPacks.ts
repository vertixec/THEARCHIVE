import type { CreditPack } from './types';

// Shared display helpers for credit packs, used by the public pricing grid AND
// the logged-in top-up modal so both show the same tangible output / badges /
// savings without duplicating logic.

// Reference costs to translate a credit balance into tangible output.
export const IMAGE_REF_COST = 12; // gpt-image-2 medium
export const VIDEO_REF_COST = 65; // kling-1.6 5s

// Marketing badge per pack id (guides the choice — not a copy of competitors).
export const PACK_BADGE: Record<string, string> = {
  creator: 'Most Popular',
  studio: 'Best Value',
};

export const packCredits = (pack: CreditPack) => pack.image_credits + pack.video_credits;

/** Highest $/credit across packs — the baseline the savings % is measured from. */
export function baselinePerCredit(packs: CreditPack[]): number {
  if (packs.length === 0) return 0;
  return Math.max(...packs.map((p) => Number(p.price_usd) / Math.max(packCredits(p), 1)));
}

export type PackDisplay = {
  credits: number;
  images: number;
  videos: number;
  savings: number; // whole-percent savings vs the baseline ($/credit)
  badge: string | null;
};

export function packDisplay(pack: CreditPack, baseline: number): PackDisplay {
  const credits = packCredits(pack);
  const perCredit = Number(pack.price_usd) / Math.max(credits, 1);
  return {
    credits,
    images: Math.round(credits / IMAGE_REF_COST),
    videos: Math.round(credits / VIDEO_REF_COST),
    savings: baseline > 0 ? Math.round((1 - perCredit / baseline) * 100) : 0,
    badge: PACK_BADGE[pack.id] ?? null,
  };
}
