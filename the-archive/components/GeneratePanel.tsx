'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';
import type { GenerationUsage } from '@/lib/types';
import { useAuth } from './AuthContext';
import { useGenerate, MAX_REFERENCE_IMAGES } from './GenerateContext';
import { useToast } from './Toast';

const IMAGE_MODELS = [
  { id: 'gpt-image-2', label: 'GPT Image 2', description: 'High fidelity, text-aware' },
  { id: 'flux-pro', label: 'Flux Pro', description: 'Creative image generation' },
  { id: 'nano-banana-pro', label: 'Nano Banana Pro', description: 'Reasoning image model' },
];

const VIDEO_MODELS = [
  { id: 'kling-1.6', label: 'Kling 1.6', description: 'Standard text to video' },
  { id: 'seedance', label: 'Seedance 2 Fast', description: 'Fast cinematic video' },
];

export default function GeneratePanel() {
  const {
    isOpen,
    prompt,
    referenceImageUrls,
    generationType,
    closePanel,
    setPrompt,
    addReferenceImageUrl,
    removeReferenceImageUrl,
    setGenerationType,
    markNewCreation,
  } = useGenerate();
  const pathname = usePathname();
  const { user } = useAuth();
  const { showToast } = useToast();
  const [isGenerating, setIsGenerating] = useState(false);
  const [usage, setUsage] = useState<GenerationUsage | null>(null);
  const [selectedModel, setSelectedModel] = useState(IMAGE_MODELS[0].id);
  const [error, setError] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [isUploadingRef, setIsUploadingRef] = useState(false);

  const models = useMemo(() => (generationType === 'image' ? IMAGE_MODELS : VIDEO_MODELS), [generationType]);
  const used = generationType === 'image' ? usage?.image_count ?? 0 : usage?.video_count ?? 0;
  const limit = generationType === 'image' ? usage?.image_limit ?? 10 : usage?.video_limit ?? 2;
  const cost = generationType === 'image' ? usage?.image_cost ?? 1 : usage?.video_cost ?? 5;
  const planName = usage?.plan_name ?? 'Community';
  const balance = generationType === 'image' ? usage?.credit_balance : usage?.video_credit_balance;
  const remaining = Math.max(limit - used, 0);
  const canGenerate = prompt.trim().length > 0 && remaining > 0 && !isGenerating;

  const loadUsage = useCallback(async () => {
    try {
      const response = await fetch('/api/generate/usage');
      if (response.status === 401) return;
      if (!response.ok) throw new Error('Usage request failed');
      setUsage(await response.json());
    } catch {
      setError('Usage unavailable');
    }
  }, []);

  useEffect(() => {
    if (!isOpen || !user) return;
    loadUsage();
  }, [isOpen, loadUsage, user]);

  useEffect(() => {
    if (pathname === '/' && isOpen) closePanel();
  }, [closePanel, isOpen, pathname]);

  useEffect(() => {
    if (!user && isOpen) {
      closePanel();
      setPrompt('');
      setUsage(null);
      setError(null);
    }
  }, [closePanel, isOpen, setPrompt, user]);

  useEffect(() => {
    const nextModels = generationType === 'image' ? IMAGE_MODELS : VIDEO_MODELS;
    setSelectedModel(nextModels[0].id);
  }, [generationType]);

  const handleGenerate = async () => {
    if (!canGenerate) return;

    setIsGenerating(true);
    setError(null);

    try {
      const response = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt,
          model: selectedModel,
          generationType,
          referenceImageUrls,
        }),
      });

      const payload = await response.json();

      if (response.status === 429) {
        showToast(generationType === 'image' ? 'IMAGE LIMIT REACHED' : 'VIDEO LIMIT REACHED');
        setError(payload.error || 'Monthly limit reached');
        return;
      }

      if (response.status === 401) {
        showToast('LOGIN REQUIRED');
        setError('Login required');
        return;
      }

      if (response.status === 403) {
        showToast('UPGRADE REQUIRED');
        setError(payload.error || 'Upgrade required');
        return;
      }

      if (!response.ok) {
        throw new Error(payload.error || 'Generation failed');
      }

      setUsage((current) => {
        if (!current) return current;
        const nextUsage = generationType === 'image'
          ? { ...current, image_count: current.image_count + 1 }
          : { ...current, video_count: current.video_count + 1 };

        if (payload.credits && typeof payload.credits === 'object') {
          return {
            ...nextUsage,
            credit_balance: payload.credits.credits ?? nextUsage.credit_balance,
            video_credit_balance: payload.credits.video_credits ?? nextUsage.video_credit_balance,
          };
        }

        return nextUsage;
      });
      showToast('GENERATION READY');
      markNewCreation();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Generation failed';
      setError(message);
      showToast('GENERATION FAILED');
    } finally {
      setIsGenerating(false);
    }
  };

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
      const ext = file.name.split('.').pop() ?? 'jpg';
      const path = `${user.id}/generate-refs/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
      const { error: uploadError } = await supabase.storage
        .from('moodboard-uploads')
        .upload(path, file, { cacheControl: '3600' });

      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabase.storage.from('moodboard-uploads').getPublicUrl(path);
      const added = addReferenceImageUrl(publicUrl);
      showToast(added ? 'REFERENCE READY' : `MAX ${MAX_REFERENCE_IMAGES} REFERENCES`);
    } catch {
      showToast('UPLOAD FAILED');
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

    const file = event.dataTransfer.files?.[0];
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
      const added = addReferenceImageUrl(url);
      showToast(added ? 'REFERENCE READY' : `MAX ${MAX_REFERENCE_IMAGES} REFERENCES`);
    } else {
      showToast('DROP AN IMAGE');
    }
  }, [addReferenceImageUrl, isAtReferenceLimit, showToast, uploadReferenceFile]);

  const handlePromptDrop = useCallback((event: React.DragEvent<HTMLTextAreaElement>) => {
    const draggedPrompt = event.dataTransfer.getData('application/x-vertix-prompt');
    if (!draggedPrompt) return;

    event.preventDefault();
    event.stopPropagation();
    setPrompt(draggedPrompt);
    showToast('PROMPT LOADED');
  }, [setPrompt, showToast]);

  return (
    <>
      {isOpen && <div className="fixed inset-0 z-[45] bg-black/40 backdrop-blur-[1px] md:hidden" onClick={closePanel} />}
      <aside
        className={`fixed right-0 top-0 z-50 h-dvh w-full max-w-full md:w-[480px] bg-black/[0.18] backdrop-blur-2xl border-l border-white/10 shadow-[0_18px_70px_rgba(0,0,0,0.55),inset_0_1px_0_rgba(255,255,255,0.10)] transform transition-transform duration-300 ease-out ${
          isOpen ? 'translate-x-0' : 'translate-x-full'
        }`}
        aria-hidden={!isOpen}
      >
        <div className="flex h-full flex-col">
          <header className="shrink-0 border-b border-white/10 px-5 pt-8 pb-3 grid grid-cols-[2.25rem_1fr_2.25rem] items-end gap-3">
            <button
              type="button"
              onClick={closePanel}
              className="h-9 w-9 border border-white/15 text-white/50 hover:text-acid hover:border-acid/60 transition-colors flex items-center justify-center"
              title="Collapse panel"
              aria-label="Collapse panel"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <path d="M9 3v18" />
              </svg>
            </button>
            <div className="text-center">
              <h2 className="font-anton text-4xl md:text-5xl uppercase tracking-tight text-white leading-none">GENERATE</h2>
              <p className="font-mono text-[9px] uppercase tracking-widest text-acid/70 mt-1">
                {planName} ENGINE
              </p>
            </div>
            <div aria-hidden="true" />
          </header>

          <div className="flex-1 min-h-0 flex flex-col px-4 py-3 gap-3">
            <section className="shrink-0">
              <div className="flex items-center justify-between mb-1.5">
                <div className="font-mono text-[9px] text-white/40 uppercase tracking-widest">Reference images</div>
                <div className="font-mono text-[9px] text-acid/60 uppercase tracking-widest">
                  {referenceImageUrls.length}/{MAX_REFERENCE_IMAGES}
                </div>
              </div>

              {referenceImageUrls.length > 0 ? (
                <div className="grid grid-cols-3 gap-2">
                  {referenceImageUrls.map((url, index) => (
                    <div key={`${url}-${index}`} className="relative aspect-square border border-white/10 bg-black overflow-hidden">
                      <img src={url} alt={`Reference ${index + 1}`} className="h-full w-full object-cover pointer-events-none" />
                      <button
                        type="button"
                        onClick={() => removeReferenceImageUrl(index)}
                        className="absolute right-1 top-1 h-5 w-5 bg-black/80 border border-white/20 font-mono text-[10px] leading-none uppercase text-white/60 hover:text-acid hover:border-acid/60 transition-colors flex items-center justify-center"
                        title="Remove"
                        aria-label="Remove reference"
                      >
                        ×
                      </button>
                    </div>
                  ))}

                  {!isAtReferenceLimit && (
                    <div
                      onDragEnter={(e) => { e.preventDefault(); e.stopPropagation(); setIsDragOver(true); }}
                      onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setIsDragOver(true); }}
                      onDragLeave={(e) => { e.preventDefault(); e.stopPropagation(); setIsDragOver(false); }}
                      onDrop={handleReferenceDrop}
                      className={`relative aspect-square border border-dashed flex items-center justify-center text-center transition-colors ${
                        isDragOver ? 'border-acid bg-acid/10' : 'border-white/15 bg-black/40 hover:border-white/25'
                      }`}
                    >
                      <span className={`font-mono text-[8px] uppercase tracking-widest leading-tight px-1 ${
                        isDragOver ? 'text-acid' : 'text-white/30'
                      }`}>
                        {isUploadingRef ? 'Uploading...' : isDragOver ? 'Drop here' : '+ Add'}
                      </span>
                    </div>
                  )}
                </div>
              ) : (
                <div
                  onDragEnter={(e) => { e.preventDefault(); e.stopPropagation(); setIsDragOver(true); }}
                  onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setIsDragOver(true); }}
                  onDragLeave={(e) => { e.preventDefault(); e.stopPropagation(); setIsDragOver(false); }}
                  onDrop={handleReferenceDrop}
                  className={`h-16 border border-dashed flex items-center justify-center px-4 text-center transition-colors ${
                    isDragOver
                      ? 'border-acid bg-acid/10'
                      : 'border-white/15 bg-black/40 hover:border-white/25'
                  }`}
                >
                  <span className={`font-mono text-[9px] uppercase tracking-widest leading-relaxed ${
                    isDragOver ? 'text-acid' : 'text-white/30'
                  }`}>
                    {isUploadingRef
                      ? 'Uploading...'
                      : isDragOver
                      ? 'Release to use as reference'
                      : `Drag up to ${MAX_REFERENCE_IMAGES} images here`}
                  </span>
                </div>
              )}
            </section>

            <section className="flex-1 min-h-0 flex flex-col">
              <label htmlFor="generate-prompt" className="font-mono text-[9px] text-white/40 uppercase tracking-widest mb-1.5 block shrink-0">
                Prompt
              </label>
              <textarea
                id="generate-prompt"
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                onDragOver={(event) => {
                  if (event.dataTransfer.types.includes('application/x-vertix-prompt')) {
                    event.preventDefault();
                    event.dataTransfer.dropEffect = 'copy';
                  }
                }}
                onDrop={handlePromptDrop}
                className="flex-1 min-h-[70px] max-h-[55%] w-full resize-none bg-black border border-white/10 focus:border-acid outline-none p-3 font-mono text-[10px] leading-relaxed uppercase text-white placeholder:text-white/20 scroll-custom"
                placeholder="Describe the image or video..."
              />
            </section>

            <section className="shrink-0 flex items-center gap-2">
              <div className="flex items-center gap-1.5 rounded-full border border-white/10 bg-black/[0.18] p-1 backdrop-blur-2xl shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] shrink-0">
                {(['image', 'video'] as const).map((type) => (
                  <button
                    key={type}
                    type="button"
                    onClick={() => setGenerationType(type)}
                    title={type === 'image' ? 'Image' : 'Video'}
                    aria-label={type === 'image' ? 'Image' : 'Video'}
                    className={`h-9 w-9 flex items-center justify-center rounded-full transition-all duration-200 ease-out ${
                      generationType === type
                        ? 'bg-acid text-black shadow-[0_0_18px_rgba(200,255,0,0.35)]'
                        : 'bg-white/[0.04] text-white/70 hover:bg-acid hover:text-black'
                    }`}
                  >
                    {type === 'image' ? (
                      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="4" y="5" width="16" height="14" rx="2" />
                        <circle cx="9" cy="10" r="1.5" />
                        <path d="m7 17 4-4 3 3 2-2 3 3" />
                      </svg>
                    ) : (
                      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="4" y="6" width="12" height="12" rx="2" />
                        <path d="m16 10 4-2.5v9L16 14" />
                        <path d="M8 3v3" />
                        <path d="M12 3v3" />
                      </svg>
                    )}
                  </button>
                ))}
              </div>

              <select
                id="generate-model"
                aria-label="Model"
                value={selectedModel}
                onChange={(event) => setSelectedModel(event.target.value)}
                className="flex-1 min-w-0 h-11 bg-black border border-white/10 focus:border-acid outline-none px-3 font-mono text-[10px] uppercase tracking-widest text-acid"
              >
                {models.map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.label} - {model.description}
                  </option>
                ))}
              </select>
            </section>

            {error && (
              <div className="shrink-0 rounded-2xl border border-danger/30 bg-danger/5 px-3 py-2 font-mono text-[9px] uppercase tracking-widest text-danger">
                {error}
              </div>
            )}

            <div className="shrink-0 flex justify-center">
              <button
                type="button"
                onClick={handleGenerate}
                disabled={!canGenerate}
                className="generate-shine relative overflow-hidden rounded-full bg-acid text-black font-oswald text-sm uppercase tracking-[0.25em] px-10 py-3 hover:bg-white transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              >
                <span className="relative z-10 flex items-center justify-center gap-2">
                  <span>{isGenerating ? 'Generating...' : 'Generate'}</span>
                  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden="true">
                    <path d="M13 2 3 14h7l-1 8 11-13h-7l1-7z" />
                  </svg>
                </span>
              </button>
            </div>
          </div>

          <footer className="shrink-0 border-t border-white/10 px-5 py-4 text-center">
            <div className="font-mono text-[9px] uppercase tracking-widest text-acid">
              {remaining}/{limit} {generationType === 'image' ? 'images' : 'videos'} remaining this month
            </div>
            <div className="mt-1 font-mono text-[8px] uppercase tracking-widest text-white/35">
              Cost: {cost} {cost === 1 ? 'credit' : 'credits'} per {generationType}
            </div>
            {typeof balance === 'number' && (
              <div className="mt-1 font-mono text-[8px] uppercase tracking-widest text-white/35">
                Balance: {balance} {generationType === 'image' ? 'image' : 'video'} credits
              </div>
            )}
            {usage?.access_tier !== 'admin' && (
              <Link
                href="/pricing"
                onClick={closePanel}
                className="mt-3 flex items-center justify-center gap-2 border border-acid/40 bg-acid/10 px-4 py-2.5 font-mono text-[10px] uppercase tracking-[0.25em] text-acid transition-colors hover:border-acid hover:bg-acid hover:text-black"
              >
                <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M12 19V5" />
                  <path d="m5 12 7-7 7 7" />
                </svg>
                <span>Upgrade Plan</span>
              </Link>
            )}
          </footer>
        </div>
      </aside>
    </>
  );
}
