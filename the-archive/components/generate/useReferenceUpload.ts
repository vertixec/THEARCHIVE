'use client';

import { useCallback, useState } from 'react';
import { useAuth } from '@/components/AuthContext';
import { useGenerate, MAX_REFERENCE_IMAGES } from '@/components/GenerateContext';
import { useToast } from '@/components/Toast';
import { extractImageFromDrop, ingestReference, ingestReferenceFromUrl } from './referenceIngest';

// Reference-image ingestion for the GLOBAL reference list (freeform generation
// and angle-based Tools like Ads). Single-image slots use useImageSlot instead;
// both share the primitives in referenceIngest.ts.
export function useReferenceUpload() {
  const { user } = useAuth();
  const { showToast } = useToast();
  const { referenceImageUrls, addReferenceImageUrl } = useGenerate();
  const [isDragOver, setIsDragOver] = useState(false);
  const [isUploadingRef, setIsUploadingRef] = useState(false);

  const isAtReferenceLimit = referenceImageUrls.length >= MAX_REFERENCE_IMAGES;

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
  }, [addReferenceImageUrl, showToast, user]);

  const uploadReferenceFromUrl = useCallback(async (url: string) => {
    if (!user) {
      showToast('LOGIN REQUIRED');
      return;
    }
    setIsUploadingRef(true);
    try {
      const hostedUrl = await ingestReferenceFromUrl(url);
      const added = addReferenceImageUrl(hostedUrl);
      showToast(added ? 'REFERENCE READY' : `MAX ${MAX_REFERENCE_IMAGES} REFERENCES`);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'REFERENCE FETCH FAILED';
      showToast(message.length > 32 ? 'REFERENCE FETCH FAILED' : message.toUpperCase());
    } finally {
      setIsUploadingRef(false);
    }
  }, [addReferenceImageUrl, showToast, user]);

  const handleReferenceDrop = useCallback(async (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDragOver(false);

    if (isAtReferenceLimit) {
      showToast(`MAX ${MAX_REFERENCE_IMAGES} REFERENCES`);
      return;
    }

    const { file, url } = extractImageFromDrop(event);
    if (file) {
      await uploadReferenceFile(file);
    } else if (url) {
      await uploadReferenceFromUrl(url);
    } else {
      showToast('DROP AN IMAGE');
    }
  }, [isAtReferenceLimit, showToast, uploadReferenceFile, uploadReferenceFromUrl]);

  return {
    isDragOver,
    setIsDragOver,
    isUploadingRef,
    isAtReferenceLimit,
    handleReferenceDrop,
  };
}
