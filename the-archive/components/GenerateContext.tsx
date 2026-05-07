'use client';

import { createContext, ReactNode, useContext, useState } from 'react';

type GenerationType = 'image' | 'video';

interface GenerateState {
  isOpen: boolean;
  prompt: string;
  referenceImageUrl: string | null;
  generationType: GenerationType;
}

interface GenerateContextType extends GenerateState {
  openPanel: (prompt?: string, referenceImageUrl?: string | null) => void;
  closePanel: () => void;
  setPrompt: (prompt: string) => void;
  setReferenceImageUrl: (url: string | null) => void;
  setGenerationType: (type: GenerationType) => void;
  togglePanel: () => void;
}

const GenerateContext = createContext<GenerateContextType | null>(null);

export function GenerateProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [referenceImageUrl, setReferenceImageUrl] = useState<string | null>(null);
  const [generationType, setGenerationType] = useState<GenerationType>('image');

  const openPanel = (newPrompt = '', newImageUrl: string | null = null) => {
    if (newPrompt) setPrompt(newPrompt);
    setReferenceImageUrl(newImageUrl);
    setIsOpen(true);
  };

  const closePanel = () => setIsOpen(false);
  const togglePanel = () => setIsOpen((current) => !current);

  return (
    <GenerateContext.Provider
      value={{
        isOpen,
        prompt,
        referenceImageUrl,
        generationType,
        openPanel,
        closePanel,
        togglePanel,
        setPrompt,
        setReferenceImageUrl,
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
