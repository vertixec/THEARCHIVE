// Shared helpers for the async generation pipeline (submit + status routes).
// FAL calls run through the queue API (submit -> poll status -> fetch result)
// so no single serverless invocation has to wait for a slow model — required
// on hosts with short function timeouts (e.g. Vercel Hobby's 60s).

export type GenerationType = 'image' | 'video';

export const IMAGE_MODELS: Record<string, string> = {
  'gpt-image-2': 'fal-ai/gpt-image-2',
  'flux-pro': 'fal-ai/flux-pro/v1.1',
  'nano-banana-pro': 'fal-ai/nano-banana-pro',
};

export const IMAGE_EDIT_MODELS: Record<string, string> = {
  'gpt-image-2': 'openai/gpt-image-2/edit',
  'flux-pro': 'fal-ai/flux-pro/v1.1/redux',
  'nano-banana-pro': 'fal-ai/nano-banana-pro/edit',
};

export const VIDEO_MODELS: Record<string, string> = {
  'kling-1.6': 'fal-ai/kling-video/v1.6/standard/text-to-video',
  seedance: 'bytedance/seedance-2.0/fast/text-to-video',
};

export const DEFAULT_MODEL: Record<GenerationType, string> = {
  image: 'gpt-image-2',
  video: 'kling-1.6',
};

export type FalResult = {
  data?: {
    images?: { url?: string }[];
    video?: { url?: string };
  };
};

export function getApiKey() {
  return process.env.FAL_API_KEY || process.env.FAL_KEY || null;
}

export function resolveEndpoint(
  type: GenerationType,
  modelId: string,
  hasReference: boolean,
): string {
  if (type === 'video') {
    return VIDEO_MODELS[modelId] || VIDEO_MODELS[DEFAULT_MODEL.video];
  }
  if (hasReference) {
    return (
      IMAGE_EDIT_MODELS[modelId] ||
      IMAGE_MODELS[modelId] ||
      IMAGE_MODELS[DEFAULT_MODEL.image]
    );
  }
  return IMAGE_MODELS[modelId] || IMAGE_MODELS[DEFAULT_MODEL.image];
}

export function buildFalInput(
  type: GenerationType,
  endpoint: string,
  prompt: string,
  preparedReferenceList: string[],
): Record<string, unknown> {
  const hasReference = preparedReferenceList.length > 0;
  const finalPrompt =
    hasReference && type === 'image' ? enhanceReferencePrompt(prompt) : prompt;
  const input: Record<string, unknown> = { prompt: finalPrompt };
  if (type === 'image' && hasReference) {
    if (endpoint.includes('/edit') || endpoint.includes('/image-to-image')) {
      input.image_urls = preparedReferenceList;
    } else {
      input.image_url = preparedReferenceList[0];
    }
  }
  return input;
}

export function extractResultUrl(result: FalResult): string {
  return result.data?.images?.[0]?.url || result.data?.video?.url || '';
}

function enhanceReferencePrompt(prompt: string) {
  if (prompt.length >= 80) return prompt;
  return `Edit the provided reference image. ${prompt}. Preserve the main subject, composition, and important details unless explicitly requested.`;
}

export function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return 'Generation failed';
}

export function getFalErrorBody(error: unknown) {
  if (typeof error !== 'object' || error === null || !('body' in error)) return null;
  return (error as { body?: unknown }).body ?? null;
}

function getFalErrorCode(body: unknown) {
  if (typeof body !== 'object' || body === null || !('detail' in body)) return null;
  const detail = (body as { detail?: unknown }).detail;
  if (!Array.isArray(detail)) return null;
  const first = detail[0];
  if (typeof first !== 'object' || first === null || !('type' in first)) return null;
  return typeof (first as { type?: unknown }).type === 'string' ? (first as { type: string }).type : null;
}

export function getFalUserMessage(body: unknown, type: GenerationType, hasReference: boolean) {
  const code = getFalErrorCode(body);
  if (code === 'file_download_error') {
    return 'FAL could not download the reference image. Upload the image file directly or use an image hosted in Supabase/FAL instead of a protected CDN URL.';
  }
  if (code === 'invalid_request' && hasReference) {
    return 'FAL rejected this reference edit. Try a clearer edit prompt, remove the reference, or upload the image directly instead of using an external URL.';
  }
  if (code === 'invalid_request') {
    return `FAL rejected this ${type} prompt. Try a more specific prompt or a different model.`;
  }
  return null;
}
