// Client-safe angle metadata for Ads Studio: only id + display label.
// The actual creative "directions" (the secret sauce) live server-only in
// lib/tools/prompts/ads.ts and are never shipped to the client.
export interface AdAngleOption {
  id: string;
  label: string;
}

export const AD_ANGLE_OPTIONS: AdAngleOption[] = [
  { id: 'hook', label: 'Hook' },
  { id: 'problem-solution', label: 'Problem/Solution' },
  { id: 'social-proof', label: 'Social proof' },
  { id: 'aspirational', label: 'Aspirational' },
  { id: 'offer', label: 'Offer' },
];
