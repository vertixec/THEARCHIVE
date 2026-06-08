import type { ToolDefinition } from './types';
import { AD_ANGLE_OPTIONS } from './adsAngles';

// Client-safe registry. NO prompt templates live here — those are server-only
// (see lib/tools/prompts/*). The panel renders tools from this list.
export const TOOLS: ToolDefinition[] = [
  {
    id: 'ads',
    name: 'Ads Studio',
    tagline: 'Ads that convert',
    description:
      'Upload your product or references and generate up to 5 ad versions ready to run — each with a distinct conversion angle (hook, problem-solution, social proof, aspirational and offer). Choose how many you want.',
    icon: 'ads',
    status: 'live',
    kind: 'image-batch',
    endpoint: '/api/tools/ads',
    outputCount: 5,
    outputNoun: 'ad',
    angleOptions: AD_ANGLE_OPTIONS,
    creditType: 'image',
    // Credits per single output (gpt-image-2 edit). Total run = cost × outputs.
    creditCost: 12,
    inputs: [
      {
        key: 'references',
        type: 'reference-images',
        label: 'Product / references',
        required: true,
        min: 1,
        max: 3,
        helpText: 'Drag images from the site or upload your own (up to 3).',
      },
      {
        key: 'offer',
        type: 'textarea',
        label: 'Product & offer',
        required: true,
        maxLength: 600,
        placeholder:
          'E.g.: Retinol facial cream. Benefit: firmer skin in 14 days. Offer: 30% OFF this week.',
      },
      {
        key: 'audience',
        type: 'text',
        label: 'Target audience',
        required: false,
        placeholder: 'E.g.: women 25-40 interested in skincare',
      },
    ],
  },
  {
    id: 'style-transfer',
    name: 'Style Transfer',
    tagline: 'Borrow any look',
    description:
      'Drop a reference and steal its visual style — palette, lighting, texture and mood. Then either write a prompt to create something new in that style, or add a second image to re-skin it with the reference look.',
    icon: 'style',
    status: 'live',
    kind: 'image-batch',
    endpoint: '/api/tools/style-transfer',
    outputCount: 1,
    outputNoun: 'image',
    creditType: 'image',
    // Credits per single output (gpt-image-2 edit).
    creditCost: 12,
    // Custom UI: rendered by StyleTransferRunner (two labeled slots), not the
    // generic ToolRunner — so no declarative inputs here.
    inputs: [],
  },
  {
    id: 'reels',
    name: 'Reels Engine',
    tagline: 'Reference → storyboard → reel',
    description:
      'From a reference we generate a storyboard with GPT Image 2 and animate it with Seedance 2.0 for a high-quality reel. Coming soon.',
    icon: 'reels',
    status: 'soon',
    kind: 'pipeline',
    outputCount: 5,
    creditType: 'video',
    // Per-clip video cost (seedance) — placeholder; tool is not live yet.
    creditCost: 275,
    inputs: [],
  },
];

export function getTool(id: string): ToolDefinition | null {
  return TOOLS.find((tool) => tool.id === id) ?? null;
}
