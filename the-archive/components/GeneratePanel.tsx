'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { usePathname } from 'next/navigation';
import type { GenerationUsage } from '@/lib/types';
import { MODEL_OPTIONS, creditCostFor, defaultSelection } from '@/lib/modelOptions';
import { useAuth } from './AuthContext';
import { useGenerate } from './GenerateContext';
import { useToast } from './Toast';
import CreditsTopUpModal from './CreditsTopUpModal';
import ReferenceImages from './generate/ReferenceImages';
import ToolsGallery from './generate/ToolsGallery';
import ToolRunner from './generate/ToolRunner';
import StyleTransferRunner from './generate/StyleTransferRunner';

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
    panelMode,
    activeToolId,
    closePanel,
    setPrompt,
    setGenerationType,
    markNewCreation,
    setPanelMode,
  } = useGenerate();
  const pathname = usePathname();
  const { user } = useAuth();
  const { showToast } = useToast();
  const [isGenerating, setIsGenerating] = useState(false);
  const [usage, setUsage] = useState<GenerationUsage | null>(null);
  const [selectedModel, setSelectedModel] = useState(IMAGE_MODELS[0].id);
  // Per-model option selection (quality / format / resolution / duration).
  const [modelOptions, setModelOptions] = useState<Record<string, string>>(() =>
    defaultSelection(IMAGE_MODELS[0].id),
  );
  const [error, setError] = useState<string | null>(null);
  const [showTopUpModal, setShowTopUpModal] = useState(false);

  const isTools = panelMode === 'tools';
  // Tools (currently image-based) always show the image credit footer.
  const footerType: 'image' | 'video' = isTools ? 'image' : generationType;
  const models = useMemo(() => (generationType === 'image' ? IMAGE_MODELS : VIDEO_MODELS), [generationType]);
  const optionControls = isTools ? [] : MODEL_OPTIONS[selectedModel]?.controls ?? [];
  // Cost is dynamic: model + selected options (quality / format / resolution /
  // duration). In tools mode the runner shows its own cost.
  const cost = isTools
    ? usage?.image_cost ?? 12
    : creditCostFor(selectedModel, modelOptions, generationType);
  const planName = usage?.plan_name ?? 'Community';
  // Single unified credit pool — the only spend gate now.
  const balance = usage?.credit_balance ?? null;
  const hasCredits = balance == null || balance >= cost;
  const canGenerate = prompt.trim().length > 0 && hasCredits && !isGenerating;
  // Only paid tiers can generate video (free/visitor are image-only). The
  // server enforces this too; here we just hide the unusable toggle.
  const canVideo = ['community', 'pro', 'admin'].includes(usage?.access_tier ?? '');
  const genTypes = canVideo ? (['image', 'video'] as const) : (['image'] as const);

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

  // Reset the option selection to the model's defaults whenever the model changes.
  useEffect(() => {
    setModelOptions(defaultSelection(selectedModel));
  }, [selectedModel]);

  // Free/visitor tiers can't generate video — snap back to image if needed.
  useEffect(() => {
    if (!canVideo && generationType === 'video') setGenerationType('image');
  }, [canVideo, generationType, setGenerationType]);

  const handleGenerate = async () => {
    if (!canGenerate) return;

    setIsGenerating(true);
    setError(null);

    try {
      // 1) Submit: charges credits and enqueues the job on the FAL queue.
      const response = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt,
          model: selectedModel,
          generationType,
          referenceImageUrls,
          options: modelOptions,
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
      if (!response.ok || !payload.jobId) {
        throw new Error(payload.error || 'Generation failed');
      }

      // Credits are deducted at submit — reflect the new balance immediately.
      if (payload.credits && typeof payload.credits === 'object') {
        setUsage((current) =>
          current
            ? {
                ...current,
                credit_balance: payload.credits.credits ?? current.credit_balance,
              }
            : current
        );
      }

      // 2) Poll the job status until it completes or fails.
      const POLL_INTERVAL = 3000;
      const MAX_ATTEMPTS = 120; // ~6 minutes
      let attempts = 0;

      while (attempts < MAX_ATTEMPTS) {
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL));
        attempts += 1;

        const statusRes = await fetch(`/api/generate/status?jobId=${encodeURIComponent(payload.jobId)}`);
        if (!statusRes.ok) continue; // transient; keep polling
        const statusPayload = await statusRes.json();

        if (statusPayload.status === 'completed') {
          // Monthly counter advances on completion (server-side).
          setUsage((current) => {
            if (!current) return current;
            return generationType === 'image'
              ? { ...current, image_count: current.image_count + 1 }
              : { ...current, video_count: current.video_count + 1 };
          });
          showToast('GENERATION READY');
          markNewCreation();
          return;
        }

        if (statusPayload.status === 'failed') {
          throw new Error(statusPayload.error || 'Generation failed');
        }
        // status === 'queued' -> keep polling
      }

      throw new Error('Generation timed out. Check your Creations shortly.');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Generation failed';
      setError(message);
      showToast('GENERATION FAILED');
    } finally {
      setIsGenerating(false);
    }
  };

  // Keep the credit footer in sync after a Tools run spends image credits.
  const applyToolSpend = useCallback((creditsLeft: number | null, spentCount: number) => {
    setUsage((current) => {
      if (!current) return current;
      return {
        ...current,
        image_count: current.image_count + spentCount,
        credit_balance: creditsLeft ?? current.credit_balance,
      };
    });
  }, []);

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
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <path d="M9 3v18" />
              </svg>
            </button>
            <div className="text-center">
              <h2 className="font-anton text-4xl md:text-5xl uppercase tracking-tight text-white leading-none">STUDIO</h2>
              <p className="font-mono text-[9px] uppercase tracking-widest text-acid/70 mt-1">{planName} ENGINE</p>
            </div>
            <div aria-hidden="true" />
          </header>

          {/* Indeterminate progress while a generation is in flight */}
          <div className="shrink-0 h-0.5 w-full bg-black/40 overflow-hidden">
            {isGenerating && <div className="panel-progress-bar h-full w-full" />}
          </div>

          {/* Mode toggle: freeform Generate vs Tools */}
          <div className="shrink-0 px-4 pt-3">
            <div className="grid grid-cols-2 gap-1 rounded-full border border-white/10 bg-black/[0.18] p-1">
              {(['generate', 'tools'] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setPanelMode(mode)}
                  className={`dock-icon h-8 rounded-full font-mono text-[10px] uppercase tracking-[0.2em] transition-all duration-200 ${
                    panelMode === mode ? 'bg-acid text-black shadow-[0_0_18px_rgba(200,255,0,0.35)]' : 'text-white/60 hover:text-white'
                  }`}
                >
                  {mode === 'generate' ? 'Generate' : 'Tools'}
                </button>
              ))}
            </div>
          </div>

          {isTools ? (
            <div className="flex-1 min-h-0 flex flex-col px-4 py-3">
              {activeToolId === 'style-transfer' ? (
                <StyleTransferRunner onSpend={applyToolSpend} />
              ) : activeToolId ? (
                <ToolRunner toolId={activeToolId} onSpend={applyToolSpend} />
              ) : (
                <ToolsGallery />
              )}
            </div>
          ) : (
            <div className="flex-1 min-h-0 flex flex-col px-4 py-3 gap-3">
              <ReferenceImages label="Reference images" />

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
                    {genTypes.map((type) => (
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

                  <div className="relative flex-1 min-w-0">
                    <select
                      id="generate-model"
                      aria-label="Model"
                      value={selectedModel}
                      onChange={(event) => setSelectedModel(event.target.value)}
                      className="w-full h-11 appearance-none [color-scheme:dark] bg-black border border-white/10 focus:border-acid hover:border-white/25 outline-none pl-3 pr-8 font-mono text-[10px] uppercase tracking-widest text-acid transition-colors cursor-pointer"
                    >
                      {models.map((model) => {
                        const modelCost = usage?.model_costs?.[model.id];
                        return (
                          <option key={model.id} value={model.id}>
                            {model.label}
                            {typeof modelCost === 'number' ? ` - ${modelCost} cr` : ''} - {model.description}
                          </option>
                        );
                      })}
                    </select>
                    <svg
                      viewBox="0 0 24 24"
                      className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-acid/60"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <path d="m6 9 6 6 6-6" />
                    </svg>
                  </div>
                </section>

                {optionControls.length > 0 && (
                  <section className="shrink-0 grid grid-cols-2 gap-2">
                    {optionControls.map((control) => (
                      <div key={control.key} className="relative min-w-0">
                        <label
                          htmlFor={`opt-${control.key}`}
                          className="mb-1 block font-mono text-[8px] uppercase tracking-widest text-white/40"
                        >
                          {control.label}
                        </label>
                        <select
                          id={`opt-${control.key}`}
                          value={modelOptions[control.key] ?? control.default}
                          onChange={(event) =>
                            setModelOptions((prev) => ({ ...prev, [control.key]: event.target.value }))
                          }
                          className="h-9 w-full cursor-pointer appearance-none [color-scheme:dark] border border-white/10 bg-black pl-2 pr-6 font-mono text-[9px] uppercase tracking-widest text-white/80 outline-none transition-colors hover:border-white/25 focus:border-acid"
                        >
                          {control.options.map((opt) => (
                            <option key={opt.value} value={opt.value}>
                              {opt.label}
                            </option>
                          ))}
                        </select>
                        <svg
                          viewBox="0 0 24 24"
                          className="pointer-events-none absolute bottom-2.5 right-2 h-3 w-3 text-acid/50"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          aria-hidden="true"
                        >
                          <path d="m6 9 6 6 6-6" />
                        </svg>
                      </div>
                    ))}
                  </section>
                )}

                {error && (
                  <div className="shrink-0 rounded-2xl border border-danger/30 bg-danger/5 px-3 py-2 font-mono text-[9px] uppercase tracking-widest text-danger">
                    {error}
                  </div>
                )}

                <div className="shrink-0 flex justify-center mt-2 mb-4">
                  <button
                    type="button"
                    onClick={handleGenerate}
                    disabled={!canGenerate}
                    className={`generate-shine relative mx-auto w-2/3 overflow-hidden rounded-full bg-acid text-black font-oswald text-sm uppercase tracking-[0.25em] py-3.5 hover:bg-white transition-all duration-200 disabled:opacity-30 disabled:cursor-not-allowed ${
                      canGenerate ? 'shadow-[0_0_30px_rgba(200,255,0,0.45)]' : 'shadow-none'
                    }`}
                  >
                    <span className="relative z-10 flex items-center justify-center gap-2">
                      <span>{isGenerating ? 'Generating...' : 'Generate'}</span>
                      {isGenerating ? (
                        <svg viewBox="0 0 24 24" className="h-4 w-4 animate-spin" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
                          <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                        </svg>
                      ) : (
                        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden="true">
                          <path d="M13 2 3 14h7l-1 8 11-13h-7l1-7z" />
                        </svg>
                      )}
                    </span>
                  </button>
                </div>
            </div>
          )}

          <footer className="shrink-0 border-t border-white/10 px-5 py-4 text-center">
            {typeof balance === 'number' && (
              <div className="font-mono text-[9px] uppercase tracking-widest text-acid">
                Balance: {balance.toLocaleString()} credits
              </div>
            )}
            {typeof usage?.monthly_credits === 'number' && usage.monthly_credits > 0 && (
              <div className="mt-0.5 font-mono text-[8px] uppercase tracking-widest text-white/45">
                {usage.monthly_credits.toLocaleString()} community
                {typeof usage.purchased_credits === 'number' && usage.purchased_credits > 0
                  ? ` + ${usage.purchased_credits.toLocaleString()} purchased`
                  : ''}
              </div>
            )}
            <div className="mt-1 font-mono text-[8px] uppercase tracking-widest text-white/35">
              Cost: {cost} {cost === 1 ? 'credit' : 'credits'} per {footerType}
            </div>
            {usage?.access_tier !== 'admin' && (
              typeof balance === 'number' && balance < cost ? (
                <button
                  type="button"
                  onClick={() => setShowTopUpModal(true)}
                  className="mt-3 flex w-full items-center justify-center gap-2 border border-acid bg-acid px-4 py-2.5 font-mono text-[10px] uppercase tracking-[0.25em] text-black transition-colors hover:bg-white"
                >
                  <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M12 5v14" />
                    <path d="M5 12h14" />
                  </svg>
                  <span>Buy Credits</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => setShowTopUpModal(true)}
                  className="mt-3 flex w-full items-center justify-center gap-2 border border-acid/40 bg-acid/10 px-4 py-2.5 font-mono text-[10px] uppercase tracking-[0.25em] text-acid transition-colors hover:border-acid hover:bg-acid hover:text-black"
                >
                  <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M12 5v14" />
                    <path d="M5 12h14" />
                  </svg>
                  <span>Buy Credits</span>
                </button>
              )
            )}
          </footer>
        </div>
      </aside>
      <CreditsTopUpModal open={showTopUpModal} onClose={() => setShowTopUpModal(false)} />
    </>
  );
}
