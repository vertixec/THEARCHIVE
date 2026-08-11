import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabaseServer';
import {
  ReferenceImageAccessError,
  isSupportedRasterBytes,
  rehostBlob,
  rehostUrl,
} from '@/lib/referenceImages';
import { stagingProvider } from '@/lib/providers';
import { enforceRateLimit } from '@/lib/generationSecurity';

export const runtime = 'nodejs';
export const maxDuration = 60;

const MAX_FILE_BYTES = 15 * 1024 * 1024;

// The panel uploads references BEFORE a model is chosen, so the file is parked
// on whichever provider is configured (see stagingProvider). Generation later
// re-hosts it onto the model's own provider if they differ.
export async function POST(req: NextRequest) {
  const provider = stagingProvider();
  if (!provider) {
    return NextResponse.json(
      { error: 'No generation provider is configured' },
      { status: 500 },
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const rateLimitResponse = await enforceRateLimit(user.id, 'upload-reference', 20, 600);
  if (rateLimitResponse) return rateLimitResponse;

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
      const url = await rehostBlob(provider, blob, file.name);
      return NextResponse.json({ url });
    }

    const { url } = await req.json();
    if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) {
      return NextResponse.json({ error: 'A valid URL is required' }, { status: 400 });
    }

    const hostedUrl = await rehostUrl(provider, url);
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
