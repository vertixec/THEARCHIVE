// SERVER-ONLY. The conversion "recipe" for Ads Studio lives here and never
// reaches the client. Each angle produces one distinct ad creative from the
// same product references + offer. Only the angle id + short label are public
// (see lib/tools/adsAngles.ts); the creative directions below stay secret.
import { AD_ANGLE_OPTIONS } from '../adsAngles';

interface AngleDirection {
  /** Descriptive label that leads the FAL prompt (saved to Creations). */
  promptLabel: string;
  direction: string;
}

const ANGLE_DIRECTIONS: Record<string, AngleDirection> = {
  hook: {
    promptLabel: 'Hook / Pattern interrupt',
    direction:
      'A bold scroll-stopping hero shot. Dramatic lighting, high contrast, the product as the unmistakable focal point. Strong negative space in the upper third for a short punchy headline. Designed to stop the thumb in the first 0.5 seconds.',
  },
  'problem-solution': {
    promptLabel: 'Problem → Solution',
    direction:
      'A clean before/after or problem-then-relief composition that frames the product as the obvious fix. Calm, trustworthy palette. Visual contrast between the pain state and the improved result. Leaves room for a headline that names the problem.',
  },
  'social-proof': {
    promptLabel: 'Social proof / UGC',
    direction:
      'An authentic, native-feeling UGC creative: real hands or a real person using the product, casual phone-photo realism, natural light, lived-in setting. Looks like a genuine customer post rather than a studio ad. Space for a testimonial-style caption.',
  },
  aspirational: {
    promptLabel: 'Aspirational / Lifestyle',
    direction:
      'An aspirational lifestyle scene that sells the transformation and status the product unlocks. Premium, editorial styling, desirable environment, confident mood. The product integrated naturally into a life the audience wants.',
  },
  offer: {
    promptLabel: 'Offer / Urgency',
    direction:
      'A direct-response promo creative built around the offer. Clear focal product, a prominent space reserved for the discount/offer badge and a strong call-to-action. Energetic, high-saturation, conversion-first layout with visual urgency.',
  },
};

interface BuildAdPromptArgs {
  promptLabel: string;
  direction: string;
  offer: string;
  audience?: string;
}

function buildAdPrompt({ promptLabel, direction, offer, audience }: BuildAdPromptArgs): string {
  const audienceLine = audience?.trim()
    ? `Target audience: ${audience.trim()}. Tailor styling, model casting and tone to resonate with them.`
    : 'Tailor styling and tone to the most likely buyer of this product.';

  // Lead with the unique creative direction so each ad's prompt is instantly
  // distinct (Creations clamps the preview to the first lines).
  return [
    `${promptLabel} — ${direction}`,
    `Product & offer: ${offer.trim()}`,
    audienceLine,
    'Format: a polished, ready-to-run advertising creative for paid social (Meta / Instagram), 1:1 or 4:5 composition. Use the provided reference image(s) as the real product and brand identity — keep the product accurate, recognizable and on-brand, do not distort it.',
    'Reserve clean space for marketing copy (headline / CTA). Any on-image text must be written in the same language as the product/offer description above, short and benefit-driven — no lorem ipsum, no gibberish, no fake logos.',
    'Output: a professional, high-converting ad image. Sharp, well-lit, commercially usable. Avoid watermarks and cluttered layouts.',
  ].join('\n');
}

export interface BuiltAdPrompt {
  angleId: string;
  /** Short Spanish label for the UI / result caption. */
  angle: string;
  prompt: string;
}

/**
 * Build the FAL prompts for the requested angles. If `angleIds` is omitted or
 * empty, builds the full set. Invalid ids are ignored; order follows the
 * provided ids (or the canonical order for the full set).
 */
export function buildAdPrompts(offer: string, audience?: string, angleIds?: string[]): BuiltAdPrompt[] {
  const requested = angleIds && angleIds.length > 0 ? angleIds : AD_ANGLE_OPTIONS.map((o) => o.id);
  const seen = new Set<string>();

  return requested
    .filter((id) => ANGLE_DIRECTIONS[id] && !seen.has(id) && (seen.add(id), true))
    .map((id) => {
      const option = AD_ANGLE_OPTIONS.find((o) => o.id === id);
      const dir = ANGLE_DIRECTIONS[id];
      return {
        angleId: id,
        angle: option?.label ?? dir.promptLabel,
        prompt: buildAdPrompt({ promptLabel: dir.promptLabel, direction: dir.direction, offer, audience }),
      };
    });
}
