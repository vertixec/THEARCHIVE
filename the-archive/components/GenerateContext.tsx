'use client';

import { createContext, ReactNode, useCallback, useContext, useState } from 'react';

type GenerationType = 'image' | 'video';

export const MAX_REFERENCE_IMAGES = 3;

interface GenerateState {
  isOpen: boolean;
  prompt: string;
  referenceImageUrls: string[];
  generationType: GenerationType;
}

interface GenerateContextType extends GenerateState {
  openPanel: (prompt?: string, references?: string | string[] | null) => void;
  closePanel: () => void;
  setPrompt: (prompt: string) => void;
  setReferenceImageUrls: (urls: string[]) => void;
  addReferenceImageUrl: (url: string) => boolean;
  removeReferenceImageUrl: (index: number) => void;
  setGenerationType: (type: GenerationType) => void;
  togglePanel: () => void;
}

const GenerateContext = createContext<GenerateContextType | null>(null);

function normalizeReferences(input: string | string[] | null | undefined): string[] {
  if (!input) return [];
  const list = Array.isArray(input) ? input : [input];
  return list.filter((url): url is string => typeof url === 'string' && url.length > 0).slice(0, MAX_REFERENCE_IMAGES);
}

export function GenerateProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [referenceImageUrls, setReferenceImageUrls] = useState<string[]>([]);
  const [generationType, setGenerationType] = useState<GenerationType>('image');

  const openPanel = useCallback((newPrompt = '', references: string | string[] | null = null) => {
    if (newPrompt) setPrompt(newPrompt);
    setReferenceImageUrls(normalizeReferences(references));
    setIsOpen(true);
  }, []);

  const closePanel = useCallback(() => setIsOpen(false), []);
  const togglePanel = useCallback(() => setIsOpen((current) => !current), []);

  const addReferenceImageUrl = useCallback((url: string) => {
    if (!url) return false;
    let added = false;
    setReferenceImageUrls((current) => {
      if (current.length >= MAX_REFERENCE_IMAGES) return current;
      if (current.includes(url)) return current;
      added = true;
      return [...current, url];
    });
    return added;
  }, []);

  const removeReferenceImageUrl = useCallback((index: number) => {
    setReferenceImageUrls((current) => current.filter((_, i) => i !== index));
  }, []);

  return (
    <GenerateContext.Provider
      value={{
        isOpen,
        prompt,
        referenceImageUrls,
        generationType,
        openPanel,
        closePanel,
        togglePanel,
        setPrompt,
        setReferenceImageUrls,
        addReferenceImageUrl,
        removeReferenceImageUrl,
        setGenerationType,
      }}
    >
      {children}
    </GenerateContext.Provider>
  );
}

export function useGenerate() {
  const context = useContext(GenerateContext);
  if (!context) throw new Error('useGenerate must be used within GenerateProvider');
  return context;
}
