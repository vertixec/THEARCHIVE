'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { usePathname } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';
import type { Generation, GenerationUsage } from '@/lib/types';
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
  } = useGenerate();
  const pathname = usePathname();
  const { user } = useAuth();
  const { showToast } = useToast();
  const [isGenerating, setIsGenerating] = useState(false);
  const [results, setResults] = useState<Generation[]>([]);
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

  const loadResults = useCallback(async () => {
    const { data } = await supabase
      .from('generations')
      .select('id, user_id, created_at, prompt, model, generation_type, result_url, reference_image_url, is_saved')
      .order('created_at', { ascending: false })
      .limit(10);

    setResults((data as Generation[]) || []);
  }, []);

  useEffect(() => {
    if (!isOpen || !user) return;
    loadUsage();
    loadResults();
  }, [isOpen, loadResults, loadUsage, user]);

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

      setResults((current) => [payload.generation as Generation, ...current].slice(0, 10));
      setUsage((current) => {
        if (!current) return current;
        return generationType === 'image'
          ? { ...current, image_count: current.image_count + 1 }
          : { ...current, video_count: current.video_count + 1 };
      });
      showToast('GENERATION READY');
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

  const toggleSaved = async (generation: Generation) => {
    const nextSaved = !generation.is_saved;
    setResults((current) => current.map((item) => (item.id === generation.id ? { ...item, is_saved: nextSaved } : item)));
    const { error: saveError } = await supabase
      .from('generations')
      .update({ is_saved: nextSaved })
      .eq('id', generation.id);

    if (saveError) {
      setResults((current) => current.map((item) => (item.id === generation.id ? generation : item)));
      showToast('SYNC ERROR');
      return;
    }

    showToast(nextSaved ? 'SAVED' : 'UNSAVED');
  };

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
          <header className="h-[88px] shrink-0 border-b border-white/10 px-5 flex items-center justify-between">
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
                rows={8}
                className="w-full resize-none bg-black border border-white/10 focus:border-acid outline-none p-3 font-mono text-[10px] leading-relaxed uppercase text-white placeholder:text-white/20"
                placeholder="Describe the image or video..."
              />
            </section>

            <section className="grid grid-cols-2 gap-2">
              {(['image', 'video'] as const).map((type) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => setGenerationType(type)}
                  className={`border px-3 py-2 font-mono text-[10px] uppercase tracking-widest transition-colors ${
                    generationType === type
                      ? 'bg-acid text-black border-acid'
                      : 'border-white/15 text-white/50 hover:border-acid/50 hover:text-acid'
                  }`}
                >
                  {type === 'image' ? 'IMG' : 'VID'}
                </button>
              ))}
            </section>

            <section>
              <label htmlFor="generate-model" className="font-mono text-[9px] text-white/40 uppercase tracking-widest mb-2 block">
                Model
              </label>
              <select
                id="generate-model"
                value={selectedModel}
                onChange={(event) => setSelectedModel(event.target.value)}
                className="w-full bg-black border border-white/10 focus:border-acid outline-none p-3 font-mono text-[10px] uppercase tracking-widest text-acid"
              >
                {models.map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.label} - {model.description}
                  </option>
                ))}
              </select>
            </section>

            <div className="font-mono text-[9px] uppercase tracking-widest text-acid">
              {remaining}/{limit} {generationType === 'image' ? 'images' : 'videos'} remaining this month
            </div>

            {error && (
              <div className="border border-danger/30 bg-danger/5 px-3 py-2 font-mono text-[9px] uppercase tracking-widest text-danger">
                {error}
              </div>
            )}

            <button
              type="button"
              onClick={handleGenerate}
              disabled={!canGenerate}
              className="w-full bg-acid text-black font-oswald text-sm uppercase tracking-[0.25em] py-3 hover:bg-white transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            >
              {isGenerating ? 'Generating...' : 'Generate'}
            </button>

            <section>
              <div className="font-mono text-[9px] text-white/40 uppercase tracking-widest mb-3">Latest results</div>
              <div className="grid grid-cols-2 gap-2">
                {results.map((generation) => (
                  <div key={generation.id} className="border border-white/10 bg-black/40">
                    <div className="aspect-square bg-black overflow-hidden">
                      {generation.generation_type === 'video' ? (
                        <video src={generation.result_url || ''} className="h-full w-full object-cover" muted playsInline controls />
                      ) : (
                        <img src={generation.result_url || ''} alt={generation.prompt} className="h-full w-full object-cover" />
                      )}
                    </div>
                    <div className="grid grid-cols-2 border-t border-white/10">
                      <a
                        href={generation.result_url || '#'}
                        download
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-center border-r border-white/10 py-2 font-mono text-[8px] uppercase tracking-widest text-white/50 hover:text-acid"
                      >
                        Down
                      </a>
                      <button
                        type="button"
                        onClick={() => toggleSaved(generation)}
                        className={`py-2 font-mono text-[8px] uppercase tracking-widest ${
                          generation.is_saved ? 'text-acid' : 'text-white/50 hover:text-acid'
                        }`}
                      >
                        Save
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          </div>
        </div>
      </aside>
    </>
  );
}
