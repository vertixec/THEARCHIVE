'use client';

import { useCallback, useState } from 'react';
import { useAuth } from '@/components/AuthContext';
import { useToast } from '@/components/Toast';
import { extractImageFromDrop, ingestReference, ingestReferenceFromUrl } from './referenceIngest';

// Upload behavior for a SINGLE independent image slot (one URL, not the global
// list). Used by Style Transfer's two labeled drop zones. Reuses the same drop
// primitives as the global reference list.
export function useImageSlot(setUrl: (url: string) => void) {
  const { user } = useAuth();
  const { showToast } = useToast();
  const [isDragOver, setIsDragOver] = useState(false);
  const [isUploading, setIsUploading] = useState(false);

  const uploadFile = useCallback(async (file: File) => {
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

    setIsUploading(true);
    try {
      const form = new FormData();
      form.append('file', file);
      setUrl(await ingestReference(form));
      showToast('REFERENCE READY');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'UPLOAD FAILED';
      showToast(message.length > 32 ? 'UPLOAD FAILED' : message.toUpperCase());
    } finally {
      setIsUploading(false);
    }
  }, [setUrl, showToast, user]);

  const handleDrop = useCallback(async (event: React.DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDragOver(false);

    const { file, url } = extractImageFromDrop(event);
    if (file) {
      await uploadFile(file);
      return;
    }
    if (url) {
      if (!user) {
        showToast('LOGIN REQUIRED');
        return;
      }
      setIsUploading(true);
      try {
        setUrl(await ingestReferenceFromUrl(url));
        showToast('REFERENCE READY');
      } catch (err) {
        const message = err instanceof Error ? err.message : 'REFERENCE FETCH FAILED';
        showToast(message.length > 32 ? 'REFERENCE FETCH FAILED' : message.toUpperCase());
      } finally {
        setIsUploading(false);
      }
      return;
    }
    showToast('DROP AN IMAGE');
  }, [setUrl, showToast, uploadFile, user]);

  return { isDragOver, setIsDragOver, isUploading, uploadFile, handleDrop };
}
