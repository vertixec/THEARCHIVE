import { fal } from '@fal-ai/client';

export class ReferenceImageAccessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReferenceImageAccessError';
  }
}

const BROWSER_FETCH_HEADERS: Record<string, string> = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
  Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Sec-Fetch-Dest': 'image',
  'Sec-Fetch-Mode': 'no-cors',
  'Sec-Fetch-Site': 'cross-site',
};

const FAL_HOST_PATTERNS = [/(^|\.)fal\.media$/i, /(^|\.)fal\.ai$/i, /(^|\.)fal\.run$/i];

export function isFalHostedUrl(url: string) {
  try {
    const host = new URL(url).hostname;
    return FAL_HOST_PATTERNS.some((re) => re.test(host));
  } catch {
    return false;
  }
}

async function fetchReferenceImage(url: string) {
  const direct = await fetch(url, { headers: BROWSER_FETCH_HEADERS, redirect: 'follow' });
  if (direct.ok) return direct;

  try {
    const parsed = new URL(url);
    const referer = `${parsed.protocol}//${parsed.host}/`;
    const withReferer = await fetch(url, {
      headers: { ...BROWSER_FETCH_HEADERS, Referer: referer },
      redirect: 'follow',
    });
    return withReferer;
  } catch {
    return direct;
  }
}

function looksLikeImageContentType(contentType: string) {
  if (!contentType) return true;
  if (contentType.startsWith('image/')) return true;
  if (contentType.startsWith('video/')) return true;
  if (contentType.startsWith('application/octet-stream')) return true;
  if (contentType.startsWith('binary/')) return true;
  return false;
}

export async function rehostUrlToFal(url: string): Promise<string> {
  if (isFalHostedUrl(url)) {
    const head = await fetch(url, { method: 'HEAD', redirect: 'follow' }).catch(() => null);
    if (head && head.ok) return url;
  }

  const response = await fetchReferenceImage(url);

  if (!response.ok) {
    throw new ReferenceImageAccessError(
      `Reference image is not accessible from the server (${response.status}). Drop the file directly into the panel instead.`
    );
  }

  const rawContentType = (response.headers.get('content-type') || '').split(';')[0].trim();
  if (!looksLikeImageContentType(rawContentType)) {
    throw new ReferenceImageAccessError(
      `Reference URL returned ${rawContentType || 'an unknown type'}, not an image. Drop the file directly into the panel.`
    );
  }

  const safeType = rawContentType.startsWith('image/') || rawContentType.startsWith('video/')
    ? rawContentType
    : 'image/png';

  const blob = new Blob([await response.arrayBuffer()], { type: safeType });
  return fal.storage.upload(blob);
}

export async function rehostBlobToFal(blob: Blob): Promise<string> {
  return fal.storage.upload(blob);
}

export async function prepareReferenceUrls(urls: string[]): Promise<string[]> {
  return Promise.all(
    urls.map(async (url) => {
      if (isFalHostedUrl(url)) return url;
      try {
        return await rehostUrlToFal(url);
      } catch (error) {
        if (error instanceof ReferenceImageAccessError) throw error;
        console.warn('Reference re-host failed, using original URL:', {
          url,
          message: error instanceof Error ? error.message : String(error),
        });
        return url;
      }
    })
  );
}
