'use client';

// Hook-agnostic core for turning a dropped file / pasted URL / image dragged
// from the site grid into a hosted reference URL. Shared by the global
// reference list (useReferenceUpload) and single-slot uploads (useImageSlot)
// so the drop behavior stays identical everywhere.

export async function ingestReference(payload: FormData | { url: string }): Promise<string> {
  const init: RequestInit = payload instanceof FormData
    ? { method: 'POST', body: payload }
    : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) };

  const response = await fetch('/api/generate/upload-reference', init);
  const data = await response.json().catch(() => ({}));

  if (!response.ok || typeof data?.url !== 'string') {
    throw new Error(typeof data?.error === 'string' ? data.error : 'Reference upload failed');
  }
  return data.url as string;
}

async function fetchUrlAsBlobInBrowser(url: string): Promise<Blob | null> {
  try {
    const response = await fetch(url, { mode: 'cors', credentials: 'omit' });
    if (!response.ok) return null;
    const blob = await response.blob();
    return blob.size > 0 ? blob : null;
  } catch {
    return null;
  }
}

// Prefer re-hosting the bytes (works for cross-origin grid images); fall back to
// handing the URL to the server.
export async function ingestReferenceFromUrl(url: string): Promise<string> {
  const blob = await fetchUrlAsBlobInBrowser(url);
  if (blob) {
    const ext = (blob.type.split('/')[1] || 'png').split(';')[0];
    const form = new FormData();
    form.append('file', new File([blob], `reference.${ext}`, { type: blob.type || 'image/png' }));
    return ingestReference(form);
  }
  return ingestReference({ url });
}

// Pull an image out of a drag event: a real file, or a URL (uri-list / plain /
// an <img> in dropped HTML, e.g. dragged from the website grid).
export function extractImageFromDrop(event: React.DragEvent): { file?: File; url?: string } {
  let file: File | null = event.dataTransfer.files?.[0] ?? null;
  if (!file && event.dataTransfer.items) {
    for (const item of Array.from(event.dataTransfer.items)) {
      if (item.kind === 'file') {
        const maybeFile = item.getAsFile();
        if (maybeFile && maybeFile.type.startsWith('image/')) {
          file = maybeFile;
          break;
        }
      }
    }
  }
  if (file) return { file };

  const uriList = event.dataTransfer.getData('text/uri-list');
  const plain = event.dataTransfer.getData('text/plain');
  const html = event.dataTransfer.getData('text/html');
  let url = (uriList || plain || '').split('\n').find((line) => line.trim() && !line.startsWith('#'))?.trim();
  if (!url && html) {
    const match = html.match(/<img[^>]+src=["']([^"']+)["']/i);
    if (match) url = match[1];
  }

  if (url && /^https?:\/\//i.test(url)) return { url };
  return {};
}
