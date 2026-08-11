// Copies a finished generation from FAL's CDN into our own Supabase Storage
// bucket, so user galleries never depend on fal.media retention. Called during
// finalization (see lib/finalizeGeneration.ts) BEFORE result_url is written.
//
// Failure here is deliberately non-fatal: the caller falls back to the FAL URL
// so the user still gets their image, and the backfill script
// (scripts/migrate-fal-results-to-storage.mjs) can re-copy stragglers later.

import { createAdminClient } from './supabaseAdmin';
import type { GenerationType } from './modelCatalog';

export const GENERATION_MEDIA_BUCKET = 'generations';

// Must stay <= the bucket's file_size_limit (50MB, set in the migration).
const MAX_MEDIA_BYTES = 50 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 45_000;

const EXTENSION_BY_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
};

// Exported for tests. Falls back by generation type when the CDN sends a
// missing/unknown content-type.
export function resolveMediaType(
  contentType: string | null,
  generationType: GenerationType,
): { mime: string; extension: string } {
  const normalized = (contentType ?? '').split(';')[0].trim().toLowerCase();
  if (EXTENSION_BY_MIME[normalized]) {
    return { mime: normalized, extension: EXTENSION_BY_MIME[normalized] };
  }
  const fallback = generationType === 'video' ? 'video/mp4' : 'image/png';
  return { mime: fallback, extension: EXTENSION_BY_MIME[fallback] };
}

export type PersistedMedia = {
  publicUrl: string;
  storagePath: string;
};

export async function persistResultMedia(params: {
  userId: string;
  generationId: string;
  sourceUrl: string;
  generationType: GenerationType;
}): Promise<PersistedMedia | null> {
  const { userId, generationId, sourceUrl, generationType } = params;
  try {
    const response = await fetch(sourceUrl, {
      signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
    });
    if (!response.ok) {
      console.error('persistResultMedia: download failed', {
        generationId,
        status: response.status,
      });
      return null;
    }

    const { mime, extension } = resolveMediaType(
      response.headers.get('content-type'),
      generationType,
    );
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_MEDIA_BYTES) {
      console.error('persistResultMedia: size out of range', {
        generationId,
        bytes: bytes.byteLength,
      });
      return null;
    }

    // Stable path -> re-runs (concurrent finalizers, backfill) are idempotent.
    const storagePath = `${userId}/${generationId}.${extension}`;
    const admin = createAdminClient();
    const { error } = await admin.storage
      .from(GENERATION_MEDIA_BUCKET)
      .upload(storagePath, bytes, {
        contentType: mime,
        upsert: true,
        cacheControl: '31536000',
      });
    if (error) {
      console.error('persistResultMedia: upload failed', { generationId, error });
      return null;
    }

    const { data } = admin.storage.from(GENERATION_MEDIA_BUCKET).getPublicUrl(storagePath);
    if (!data?.publicUrl) return null;
    return { publicUrl: data.publicUrl, storagePath };
  } catch (error) {
    console.error('persistResultMedia: unexpected failure', { generationId, error });
    return null;
  }
}
