import { fal } from '@fal-ai/client';
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabaseServer';

const IMAGE_LIMIT = 10;
const VIDEO_LIMIT = 2;

const IMAGE_MODELS: Record<string, string> = {
  'gpt-image-2': 'fal-ai/gpt-image-2',
  'flux-pro': 'fal-ai/flux-pro/v1.1',
  'nano-banana-pro': 'fal-ai/nano-banana-pro',
};

const IMAGE_EDIT_MODELS: Record<string, string> = {
  'gpt-image-2': 'openai/gpt-image-2/edit',
  'flux-pro': 'fal-ai/flux-pro/v1.1/redux',
  'nano-banana-pro': 'fal-ai/nano-banana-pro/edit',
};

const VIDEO_MODELS: Record<string, string> = {
  'kling-1.6': 'fal-ai/kling-video/v1.6/standard/text-to-video',
  seedance: 'bytedance/seedance-2.0/fast/text-to-video',
};

type FalResult = {
  data?: {
    images?: { url?: string }[];
    video?: { url?: string };
  };
};

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return 'Generation failed';
}

function getFalErrorBody(error: unknown) {
  if (typeof error !== 'object' || error === null || !('body' in error)) return null;
  return (error as { body?: unknown }).body ?? null;
}

export async function POST(req: NextRequest) {
  const apiKey = process.env.FAL_API_KEY || process.env.FAL_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'FAL API key is not configured' }, { status: 500 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { prompt, model, generationType, referenceImageUrl, referenceImageUrls } = await req.json();
  const cleanPrompt = typeof prompt === 'string' ? prompt.trim() : '';
  const type = generationType === 'video' ? 'video' : 'image';

  const referenceList: string[] = Array.isArray(referenceImageUrls)
    ? referenceImageUrls.filter((url: unknown): url is string => typeof url === 'string' && url.length > 0)
    : typeof referenceImageUrl === 'string' && referenceImageUrl.length > 0
      ? [referenceImageUrl]
      : [];

  if (!cleanPrompt) {
    return NextResponse.json({ error: 'Prompt is required' }, { status: 400 });
  }

  const yearMonth = new Date().toISOString().slice(0, 7);
  const { data: usage, error: usageError } = await supabase
    .from('user_generation_usage')
    .select('image_count, video_count')
    .eq('user_id', user.id)
    .eq('year_month', yearMonth)
    .maybeSingle();

  if (usageError) {
    return NextResponse.json({ error: 'Usage lookup failed' }, { status: 500 });
  }

  const imageCount = usage?.image_count ?? 0;
  const videoCount = usage?.video_count ?? 0;

  if (type === 'image' && imageCount >= IMAGE_LIMIT) {
    return NextResponse.json({ error: 'Monthly image limit reached' }, { status: 429 });
  }

  if (type === 'video' && videoCount >= VIDEO_LIMIT) {
    return NextResponse.json({ error: 'Monthly video limit reached' }, { status: 429 });
  }

  fal.config({ credentials: apiKey });

  const hasReference = referenceList.length > 0;
  const modelId = typeof model === 'string' ? model : '';
  const endpoint =
    type === 'video'
      ? VIDEO_MODELS[modelId] || VIDEO_MODELS['kling-1.6']
      : hasReference
        ? IMAGE_EDIT_MODELS[modelId] || IMAGE_MODELS[modelId] || IMAGE_MODELS['gpt-image-2']
        : IMAGE_MODELS[modelId] || IMAGE_MODELS['gpt-image-2'];

  const input: Record<string, unknown> = { prompt: cleanPrompt };
  if (type === 'image' && hasReference) {
    if (endpoint.includes('/edit') || endpoint.includes('/image-to-image')) {
      input.image_urls = referenceList;
    } else {
      input.image_url = referenceList[0];
    }
  }

  let resultUrl = '';
  try {
    const result = (await fal.subscribe(endpoint, { input })) as FalResult;
    resultUrl = result.data?.images?.[0]?.url || result.data?.video?.url || '';
    if (!resultUrl) throw new Error('No result URL from FAL');
  } catch (error) {
    const falBody = getFalErrorBody(error);
    const falDetail = falBody ? JSON.stringify(falBody) : getErrorMessage(error);
    console.error('FAL.ai error:', {
      endpoint,
      input,
      message: getErrorMessage(error),
      body: falBody,
    });
    return NextResponse.json({ error: `Generation failed: ${falDetail}` }, { status: 500 });
  }

  const nextUsage = {
    user_id: user.id,
    year_month: yearMonth,
    image_count: type === 'image' ? imageCount + 1 : imageCount,
    video_count: type === 'video' ? videoCount + 1 : videoCount,
  };

  const { error: upsertError } = await supabase
    .from('user_generation_usage')
    .upsert(nextUsage, { onConflict: 'user_id,year_month' });

  if (upsertError) {
    return NextResponse.json({ error: 'Usage update failed' }, { status: 500 });
  }

  const { data: generation, error: insertError } = await supabase
    .from('generations')
    .insert({
      user_id: user.id,
      prompt: cleanPrompt,
      model: modelId || (type === 'image' ? 'gpt-image-2' : 'kling-1.6'),
      generation_type: type,
      result_url: resultUrl,
      reference_image_url: hasReference ? referenceList[0] : null,
    })
    .select()
    .single();

  if (insertError) {
    return NextResponse.json({ error: 'Generation history save failed' }, { status: 500 });
  }

  return NextResponse.json({ url: resultUrl, generation });
}
