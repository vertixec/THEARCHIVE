'use client';

import { useCallback, useState } from 'react';
import { useAuth } from '@/components/AuthContext';
import { useGenerate, MAX_REFERENCE_IMAGES } from '@/components/GenerateContext';
import { useToast } from '@/components/Toast';

// Shared reference-image ingestion (upload, paste-by-URL, and drag from the
// website grid). Extracted from GeneratePanel so both freeform generation and
// Tools reuse the exact same drop behavior.
export function useReferenceUpload() {
  const { user } = useAuth();
  const { showToast } = useToast();
  const { referenceImageUrls, addReferenceImageUrl } = useGenerate();
  const [isDragOver, setIsDragOver] = useState(false);
  const [isUploadingRef, setIsUploadingRef] = useState(false);

  const isAtReferenceLimit = referenceImageUrls.length >= MAX_REFERENCE_IMAGES;

  const ingestReference = useCallback(async (payload: FormData | { url: string }) => {
    const init: RequestInit = payload instanceof FormData
      ? { method: 'POST', body: payload }
      : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) };

    const response = await fetch('/api/generate/upload-reference', init);
    const data = await response.json().catch(() => ({}));

    if (!response.ok || typeof data?.url !== 'string') {
      throw new Error(typeof data?.error === 'string' ? data.error : 'Reference upload failed');
    }

    return data.url as string;
  }, []);

  const uploadReferenceFile = useCallback(async (file: File) => {
    if (!user) {
      showToast('LOGIN REQUIRED');
      return;
    }
    if (!file.type.startsWith('image/')) {
      showToast('IMAGE FILES ONLY');
      return;
    }
    if (file.size > 15 * 1024 * 1024) {
      showToast('MAX 15MB');
      return;
    }

    setIsUploadingRef(true);
    try {
      const form = new FormData();
      form.append('file', file);
      const hostedUrl = await ingestReference(form);
      const added = addReferenceImageUrl(hostedUrl);
      showToast(added ? 'REFERENCE READY' : `MAX ${MAX_REFERENCE_IMAGES} REFERENCES`);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'UPLOAD FAILED';
      showToast(message.length > 32 ? 'UPLOAD FAILED' : message.toUpperCase());
    } finally {
      setIsUploadingRef(false);
    }
  }, [addReferenceImageUrl, ingestReference, showToast, user]);

  const fetchUrlAsBlobInBrowser = useCallback(async (url: string): Promise<Blob | null> => {
    try {
      const response = await fetch(url, { mode: 'cors', credentials: 'omit' });
      if (!response.ok) return null;
      const blob = await response.blob();
      return blob.size > 0 ? blob : null;
    } catch {
      return null;
    }
  }, []);

  const ingestReferenceFromUrl = useCallback(async (url: string) => {
    if (!user) {
      showToast('LOGIN REQUIRED');
      return;
    }
    setIsUploadingRef(true);
    try {
      const blob = await fetchUrlAsBlobInBrowser(url);
      let hostedUrl: string;
      if (blob) {
        const ext = (blob.type.split('/')[1] || 'png').split(';')[0];
        const form = new FormData();
        form.append('file', new File([blob], `reference.${ext}`, { type: blob.type || 'image/png' }));
        hostedUrl = await ingestReference(form);
      } else {
        hostedUrl = await ingestReference({ url });
      }
      const added = addReferenceImageUrl(hostedUrl);
      showToast(added ? 'REFERENCE READY' : `MAX ${MAX_REFERENCE_IMAGES} REFERENCES`);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'REFERENCE FETCH FAILED';
      showToast(message.length > 32 ? 'REFERENCE FETCH FAILED' : message.toUpperCase());
    } finally {
      setIsUploadingRef(false);
    }
  }, [addReferenceImageUrl, fetchUrlAsBlobInBrowser, ingestReference, showToast, user]);

  const handleReferenceDrop = useCallback(async (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDragOver(false);

    if (isAtReferenceLimit) {
      showToast(`MAX ${MAX_REFERENCE_IMAGES} REFERENCES`);
      return;
    }

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
    if (file) {
      await uploadReferenceFile(file);
      return;
    }

    const uriList = event.dataTransfer.getData('text/uri-list');
    const plain = event.dataTransfer.getData('text/plain');
    const html = event.dataTransfer.getData('text/html');
    let url = (uriList || plain || '').split('\n').find((line) => line.trim() && !line.startsWith('#'))?.trim();
    if (!url && html) {
      const match = html.match(/<img[^>]+src=["']([^"']+)["']/i);
      if (match) url = match[1];
    }

    if (url && /^https?:\/\//i.test(url)) {
      await ingestReferenceFromUrl(url);
    } else {
      showToast('DROP AN IMAGE');
    }
  }, [ingestReferenceFromUrl, isAtReferenceLimit, showToast, uploadReferenceFile]);

  return {
    isDragOver,
    setIsDragOver,
    isUploadingRef,
    isAtReferenceLimit,
    handleReferenceDrop,
  };
}
