import { fal } from '@fal-ai/client';
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabaseServer';
import {
  ReferenceImageAccessError,
  isSupportedRasterBytes,
  rehostBlobToFal,
  rehostUrlToFal,
} from '@/lib/falReference';
import { enforceRateLimit } from '@/lib/generationSecurity';

export const runtime = 'nodejs';
export const maxDuration = 60;

const MAX_FILE_BYTES = 15 * 1024 * 1024;

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
  const rateLimitResponse = await enforceRateLimit(supabase, 'upload-reference', 20, 600);
  if (rateLimitResponse) return rateLimitResponse;

  fal.config({ credentials: apiKey });

  const contentType = req.headers.get('content-type') || '';

  try {
    if (contentType.includes('multipart/form-data')) {
      const form = await req.formData();
      const file = form.get('file');

      if (!(file instanceof File)) {
        return NextResponse.json({ error: 'No file provided' }, { status: 400 });
      }
      if (file.size > MAX_FILE_BYTES) {
        return NextResponse.json({ error: 'File exceeds 15MB' }, { status: 413 });
      }

      if (!file.type.startsWith('image/') || file.type === 'image/svg+xml') {
        return NextResponse.json({ error: 'Only image files are supported' }, { status: 400 });
      }

      const bytes = new Uint8Array(await file.arrayBuffer());
      if (!isSupportedRasterBytes(bytes.subarray(0, 16))) {
        return NextResponse.json({ error: 'File is not a supported raster image' }, { status: 400 });
      }
      const blob = new Blob([bytes.buffer], { type: file.type });
      const url = await rehostBlobToFal(blob);
      return NextResponse.json({ url });
    }

    const { url } = await req.json();
    if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) {
      return NextResponse.json({ error: 'A valid URL is required' }, { status: 400 });
    }

    const hostedUrl = await rehostUrlToFal(url);
    return NextResponse.json({ url: hostedUrl });
  } catch (error) {
    if (error instanceof ReferenceImageAccessError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error('upload-reference failed:', error);
    return NextResponse.json(
      { error: 'Reference upload failed' },
      { status: 500 }
    );
  }
}
