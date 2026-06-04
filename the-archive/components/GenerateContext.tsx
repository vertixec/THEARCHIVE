'use client';

import { createContext, ReactNode, useCallback, useContext, useState } from 'react';

type GenerationType = 'image' | 'video';
type PanelMode = 'generate' | 'tools';

export const MAX_REFERENCE_IMAGES = 3;

interface GenerateState {
  isOpen: boolean;
  prompt: string;
  referenceImageUrls: string[];
  generationType: GenerationType;
  hasNewCreation: boolean;
  panelMode: PanelMode;
  activeToolId: string | null;
}

interface GenerateContextType extends GenerateState {
  openPanel: (prompt?: string, references?: string | string[] | null) => void;
  closePanel: () => void;
  setPrompt: (prompt: string) => void;
  setReferenceImageUrls: (urls: string[]) => void;
  addReferenceImageUrl: (url: string) => boolean;
  removeReferenceImageUrl: (index: number) => void;
  setGenerationType: (type: GenerationType) => void;
  markNewCreation: () => void;
  clearNewCreation: () => void;
  togglePanel: () => void;
  setPanelMode: (mode: PanelMode) => void;
  openTool: (toolId: string) => void;
  closeTool: () => void;
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
  const [hasNewCreation, setHasNewCreation] = useState(false);
  const [panelMode, setPanelMode] = useState<PanelMode>('generate');
  const [activeToolId, setActiveToolId] = useState<string | null>(null);

  const openPanel = useCallback((newPrompt = '', references: string | string[] | null = null) => {
    if (newPrompt) setPrompt(newPrompt);
    if (references !== null) setReferenceImageUrls(normalizeReferences(references));
    setIsOpen(true);
  }, []);

  const closePanel = useCallback(() => setIsOpen(false), []);
  const openTool = useCallback((toolId: string) => {
    setPanelMode('tools');
    setActiveToolId(toolId);
    setIsOpen(true);
  }, []);
  const closeTool = useCallback(() => setActiveToolId(null), []);
  const togglePanel = useCallback(() => setIsOpen((current) => !current), []);
  const markNewCreation = useCallback(() => setHasNewCreation(true), []);
  const clearNewCreation = useCallback(() => setHasNewCreation(false), []);

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
        hasNewCreation,
        panelMode,
        activeToolId,
        openPanel,
        closePanel,
        togglePanel,
        setPrompt,
        setReferenceImageUrls,
        addReferenceImageUrl,
        removeReferenceImageUrl,
        setGenerationType,
        markNewCreation,
        clearNewCreation,
        setPanelMode,
        openTool,
        closeTool,
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
