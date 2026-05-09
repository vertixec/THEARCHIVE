'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
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

      if (!response.ok) {
        throw new Error(payload.error || 'Generation failed');
      }

      setUsage((current) => {
        if (!current) return current;
        return generationType === 'image'
          ? { ...current, image_count: current.image_count + 1 }
          : { ...current, video_count: current.video_count + 1 };
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
    const draggedPrompt = event.dataTransfer.getData('application/x-vertix-prompt');

    let url = (uriList || plain || '').split('\n').find((line) => line.trim() && !line.startsWith('#'))?.trim();
    if (!url && html) {
      const match = html.match(/<img[^>]+src=["']([^"']+)["']/i);
      if (match) url = match[1];
    }

    if (url && /^https?:\/\//i.test(url)) {
      const added = addReferenceImageUrl(url);
      if (added && draggedPrompt) setPrompt(draggedPrompt);
      showToast(added ? 'REFERENCE READY' : `MAX ${MAX_REFERENCE_IMAGES} REFERENCES`);
    } else {
      showToast('DROP AN IMAGE');
    }
  }, [addReferenceImageUrl, isAtReferenceLimit, setPrompt, showToast, uploadReferenceFile]);

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
          <header className="shrink-0 border-b border-white/10 px-5 pt-14 pb-5 flex items-end justify-between">
            <div>
              <h2 className="font-anton text-4xl md:text-5xl uppercase tracking-tight text-white leading-none">GENERATE</h2>
              <p className="font-mono text-[9px] uppercase tracking-widest text-acid/70 mt-1">CREATIVE ENGINE</p>
            </div>
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
                <polyline points="13 17 18 12 13 7" />
                <polyline points="6 17 11 12 6 7" />
              </svg>
            </button>
          </header>

          <div className="flex-1 overflow-y-auto scroll-custom px-4 py-5 space-y-5">
            <section>
              <div className="flex items-center justify-between mb-2">
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
                  className={`min-h-32 border border-dashed flex items-center justify-center px-4 text-center transition-colors ${
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
                      : `Drag up to ${MAX_REFERENCE_IMAGES} images here or click generate on any card`}
                  </span>
                </div>
              )}
            </section>

            <section>
              <label htmlFor="generate-prompt" className="font-mono text-[9px] text-white/40 uppercase tracking-widest mb-2 block">
                Prompt
              </label>
              <textarea
                id="generate-prompt"
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                rows={12}
                className="w-full resize-none bg-black border border-white/10 focus:border-acid outline-none p-3 font-mono text-[10px] leading-relaxed uppercase text-white placeholder:text-white/20"
                placeholder="Describe the image or video..."
              />
            </section>

            <section className="flex justify-center">
              <div className="flex items-center gap-2 rounded-[30px] border border-white/10 bg-black/[0.18] px-4 py-2 backdrop-blur-2xl shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]">
                {(['image', 'video'] as const).map((type) => (
                  <button
                    key={type}
                    type="button"
                    onClick={() => setGenerationType(type)}
                    title={type === 'image' ? 'Image' : 'Video'}
                    aria-label={type === 'image' ? 'Image' : 'Video'}
                    className={`h-12 w-12 flex items-center justify-center rounded-2xl transition-all duration-200 ease-out ${
                      generationType === type
                        ? 'bg-acid text-black shadow-[0_0_22px_rgba(200,255,0,0.35)]'
                        : 'bg-white/[0.04] text-white/70 hover:bg-acid hover:text-black'
                    }`}
                  >
                    {type === 'image' ? (
                      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="4" y="5" width="16" height="14" rx="2" />
                        <circle cx="9" cy="10" r="1.5" />
                        <path d="m7 17 4-4 3 3 2-2 3 3" />
                      </svg>
                    ) : (
                      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="4" y="6" width="12" height="12" rx="2" />
                        <path d="m16 10 4-2.5v9L16 14" />
                        <path d="M8 3v3" />
                        <path d="M12 3v3" />
                      </svg>
                    )}
                  </button>
                ))}
              </div>
            </section>

            <section className="flex flex-col items-center">
              <label htmlFor="generate-model" className="font-mono text-[9px] text-white/40 uppercase tracking-widest mb-2 block">
                Model
              </label>
              <select
                id="generate-model"
                value={selectedModel}
                onChange={(event) => setSelectedModel(event.target.value)}
                className="w-full max-w-[280px] bg-black border border-white/10 focus:border-acid outline-none p-3 font-mono text-[10px] uppercase tracking-widest text-acid text-center"
              >
                {models.map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.label} - {model.description}
                  </option>
                ))}
              </select>
            </section>

            {error && (
              <div className="rounded-2xl border border-danger/30 bg-danger/5 px-3 py-2 font-mono text-[9px] uppercase tracking-widest text-danger">
                {error}
              </div>
            )}

            <button
              type="button"
              onClick={handleGenerate}
              disabled={!canGenerate}
              className="generate-shine relative overflow-hidden w-full rounded-lg bg-acid text-black font-oswald text-sm uppercase tracking-[0.25em] py-3 hover:bg-white transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <span className="relative z-10 flex items-center justify-center gap-2">
                <span>{isGenerating ? 'Generating...' : 'Generate'}</span>
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden="true">
                  <path d="M13 2 3 14h7l-1 8 11-13h-7l1-7z" />
                </svg>
              </span>
            </button>
          </div>

          <footer className="shrink-0 border-t border-white/10 px-5 py-4 text-center">
            <div className="font-mono text-[9px] uppercase tracking-widest text-acid">
              {remaining}/{limit} {generationType === 'image' ? 'images' : 'videos'} remaining this month
            </div>
          </footer>
        </div>
      </aside>
    </>
  );
}
