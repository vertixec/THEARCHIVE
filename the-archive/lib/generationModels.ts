// Shared helpers for the async generation pipeline (submit + status routes).
//
// Generation runs through a provider queue (submit -> poll -> fetch result) so
// no single serverless invocation has to wait for a slow model — required on
// hosts with short function timeouts (e.g. Vercel Hobby's 60s).
//
// WHICH model belongs to WHICH provider lives in lib/modelCatalog.ts; HOW to
// talk to a provider lives in lib/providers. This file only assembles the
// prompt-side input every provider shares.

import {
  MODELS_BY_ID,
  modelsOfType,
  referenceInputFor,
  type GenerationType,
} from './modelCatalog';

export type { GenerationType } from './modelCatalog';
export { DEFAULT_MODEL, resolveEndpoint } from './modelCatalog';

/** modelId -> endpoint, kept in the legacy shape the callers already use. */
function endpointMap(type: GenerationType): Record<string, string> {
  return Object.fromEntries(modelsOfType(type).map((entry) => [entry.id, entry.endpoint]));
}

export const IMAGE_MODELS: Record<string, string> = endpointMap('image');
export const VIDEO_MODELS: Record<string, string> = endpointMap('video');

export const IMAGE_EDIT_MODELS: Record<string, string> = Object.fromEntries(
  modelsOfType('image')
    .filter((entry) => entry.editEndpoint)
    .map((entry) => [entry.id, entry.editEndpoint as string]),
);

/**
 * Base input for a generation. Per-model params (quality, image_size,
 * aspect_ratio, resolution, duration, mode) are merged by the caller via
 * modelParamsFor() — see lib/generateJob.ts.
 *
 * Critically, gpt-image-2 on FAL defaults to HIGH quality (~$0.211/img), so the
 * caller always sends an explicit quality (default 'medium', ~$0.053).
 */
export function buildModelInput(
  type: GenerationType,
  modelId: string,
  prompt: string,
  preparedReferenceList: string[],
): Record<string, unknown> {
  const hasReference = preparedReferenceList.length > 0;
  const finalPrompt =
    hasReference && type === 'image' ? enhanceReferencePrompt(prompt) : prompt;
  const input: Record<string, unknown> = { prompt: finalPrompt };

  if (type === 'image' && hasReference) {
    // Each model names its reference field differently (image_urls, image_url,
    // input_urls, image_input) — the catalog knows which.
    const reference = referenceInputFor(modelId);
    input[reference.key] = reference.multiple
      ? preparedReferenceList
      : preparedReferenceList[0];
  }

  return input;
}

function enhanceReferencePrompt(prompt: string) {
  if (prompt.length >= 80) return prompt;
  return `Edit the provided reference image. ${prompt}. Preserve the main subject, composition, and important details unless explicitly requested.`;
}

export function isKnownModel(modelId: string, type: GenerationType): boolean {
  return MODELS_BY_ID[modelId]?.type === type;
}

export function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return 'Generation failed';
}
