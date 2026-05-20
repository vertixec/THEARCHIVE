import { fal } from '@fal-ai/client';
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabaseServer';
import {
  canAccessFeature,
  getPlanForProfile,
  MODEL_CREDIT_COSTS,
  type BusinessProfile,
} from '@/lib/business';

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

type CreditSpendResult = {
  ok: boolean;
  credits: number;
  video_credits: number;
};

class ReferenceImageAccessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReferenceImageAccessError';
  }
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return 'Generation failed';
}

function getFalErrorBody(error: unknown) {
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

function getFalUserMessage(body: unknown, type: 'image' | 'video', hasReference: boolean) {
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

function enhanceReferencePrompt(prompt: string) {
  if (prompt.length >= 80) return prompt;
  return `Edit the provided reference image. ${prompt}. Preserve the main subject, composition, and important details unless explicitly requested.`;
}

async function uploadReferenceToFal(url: string) {
  try {
    const response = await fetch(url, {
      headers: {
        Accept: 'image/*,*/*;q=0.8',
        'User-Agent': 'THE-ARCHIVE-FAL-PROXY/1.0',
      },
    });

    if (!response.ok) {
      throw new ReferenceImageAccessError(
        `Reference image is not accessible from the server (${response.status}). Upload the image file directly or use a public Supabase/FAL URL.`
      );
    }

    const contentType = response.headers.get('content-type') || 'image/png';
    if (!contentType.startsWith('image/')) {
      throw new ReferenceImageAccessError('Reference URL did not return an image file.');
    }

    const blob = new Blob([await response.arrayBuffer()], { type: contentType });
    return await fal.storage.upload(blob);
  } catch (error) {
    if (error instanceof ReferenceImageAccessError) throw error;
    console.warn('Reference re-host failed, using original URL:', {
      url,
      message: getErrorMessage(error),
    });
    return url;
  }
}

async function prepareReferenceUrls(urls: string[]) {
  return Promise.all(urls.map((url) => uploadReferenceToFal(url)));
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

  let profile: BusinessProfile | null = null;
  const expandedProfile = await supabase
    .from('profiles')
    .select('id, status, role, access_tier, plan_id')
    .eq('id', user.id)
    .maybeSingle<BusinessProfile>();

  if (expandedProfile.error) {
    const fallbackProfile = await supabase
      .from('profiles')
      .select('id, status, role')
      .eq('id', user.id)
      .maybeSingle<BusinessProfile>();
    profile = fallbackProfile.data ?? null;
  } else {
    profile = expandedProfile.data;
  }

  if (!canAccessFeature(profile, type === 'image' ? 'generate_image' : 'generate_video')) {
    return NextResponse.json(
      {
        error:
          type === 'image'
            ? 'Your current plan cannot generate images'
            : 'Your current plan cannot generate videos',
      },
      { status: 403 }
    );
  }

  const plan = getPlanForProfile(profile);
  const generationCost = type === 'image' ? MODEL_CREDIT_COSTS.image : MODEL_CREDIT_COSTS.video;
  const { data: balance } = await supabase
    .from('user_credit_balances')
    .select('credits, video_credits')
    .eq('user_id', user.id)
    .maybeSingle<{ credits: number; video_credits: number }>();

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

  if (type === 'image' && imageCount + generationCost > plan.monthlyImageLimit) {
    return NextResponse.json({ error: 'Monthly image limit reached' }, { status: 429 });
  }

  if (type === 'video' && videoCount >= plan.monthlyVideoLimit) {
    return NextResponse.json({ error: 'Monthly video limit reached' }, { status: 429 });
  }

  if (balance) {
    const currentBalance = type === 'image' ? balance.credits : balance.video_credits;
    if (currentBalance < generationCost) {
      return NextResponse.json({ error: 'Not enough credits' }, { status: 429 });
    }
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

  let preparedReferenceList: string[] = [];
  try {
    preparedReferenceList = hasReference ? await prepareReferenceUrls(referenceList) : [];
  } catch (error) {
    if (error instanceof ReferenceImageAccessError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }
  const falPrompt = hasReference && type === 'image' ? enhanceReferencePrompt(cleanPrompt) : cleanPrompt;
  const input: Record<string, unknown> = { prompt: falPrompt };
  if (type === 'image' && hasReference) {
    if (endpoint.includes('/edit') || endpoint.includes('/image-to-image')) {
      input.image_urls = preparedReferenceList;
    } else {
      input.image_url = preparedReferenceList[0];
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
    const userMessage = getFalUserMessage(falBody, type, hasReference);
    console.error('FAL.ai error:', {
      endpoint,
      input,
      message: getErrorMessage(error),
      body: falBody,
    });
    return NextResponse.json(
      {
        error: userMessage || `Generation failed: ${falDetail}`,
        detail: falBody,
      },
      { status: 502 }
    );
  }

  let spendResult: CreditSpendResult | null = null;
  const { data: spendData, error: spendError } = await supabase.rpc('spend_generation_credits', {
    p_generation_type: type,
    p_amount: generationCost,
    p_model: modelId || (type === 'image' ? 'gpt-image-2' : 'kling-1.6'),
    p_prompt: cleanPrompt,
  });

  if (!spendError && Array.isArray(spendData) && spendData[0]) {
    spendResult = spendData[0] as CreditSpendResult;
    if (!spendResult.ok) {
      return NextResponse.json({ error: 'Not enough credits' }, { status: 429 });
    }
  } else if (spendError && spendError.code !== '42883' && spendError.code !== 'PGRST202') {
    console.error('Credit spend failed:', spendError);
    return NextResponse.json({ error: 'Credit spend failed' }, { status: 500 });
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

  return NextResponse.json({ url: resultUrl, generation, credits: spendResult });
}
