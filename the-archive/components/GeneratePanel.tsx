'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { usePathname } from 'next/navigation';
import type { GenerationUsage } from '@/lib/types';
import { MODEL_OPTIONS, creditCostFor, defaultSelection } from '@/lib/modelOptions';
import { DEFAULT_MODEL, modelsOfType, type ProviderId } from '@/lib/modelCatalog';
import { useAuth } from './AuthContext';
import { MAX_REFERENCE_IMAGES, useGenerate } from './GenerateContext';
import { useToast } from './Toast';
import CreditsTopUpModal from './CreditsTopUpModal';
import ReferenceImages from './generate/ReferenceImages';
import ToolsGallery from './generate/ToolsGallery';
import ToolRunner from './generate/ToolRunner';
import StyleTransferRunner from './generate/StyleTransferRunner';
import { useReferenceUpload } from './generate/useReferenceUpload';

// Until /api/generate/usage reports which providers hold an API key, show the
// historical FAL line-up only — so a provider the operator never configured
// never flashes into the picker.
const ASSUMED_PROVIDERS: Record<ProviderId, boolean> = { fal: true, kie: false };

export default function GeneratePanel() {
  const {
    isOpen,
    prompt,
    referenceImageUrls,
    generationType,
    panelMode,
    activeToolId,
    panelLayout,
    closePanel,
    setPrompt,
    setGenerationType,
    markNewCreation,
    setPanelMode,
    removeReferenceImageUrl,
  } = useGenerate();
  const pathname = usePathname();
  const { user } = useAuth();
  const { showToast } = useToast();
  const [isGenerating, setIsGenerating] = useState(false);
  // Mirrors the active tool's running state so the header progress bar shows
  // during Tools runs too, not just freeform generation.
  const [toolRunning, setToolRunning] = useState(false);
  const [usage, setUsage] = useState<GenerationUsage | null>(null);
  const [selectedModel, setSelectedModel] = useState(DEFAULT_MODEL.image);
  // Per-model option selection (quality / format / resolution / duration).
  const [modelOptions, setModelOptions] = useState<Record<string, string>>(() =>
    defaultSelection(DEFAULT_MODEL.image),
  );
  const [error, setError] = useState<string | null>(null);
  // How many images to generate in one go (1–4). Each is an independent job.
  const [count, setCount] = useState(1);
  const [showTopUpModal, setShowTopUpModal] = useState(false);
  const { isDragOver, setIsDragOver, isUploadingRef, isAtReferenceLimit, handleReferenceDrop } = useReferenceUpload();

  const isTools = panelMode === 'tools';
  // Tools (currently image-based) always show the image credit footer.
  const footerType: 'image' | 'video' = isTools ? 'image' : generationType;
  // Only models whose provider actually has an API key configured server-side.
  const providers = usage?.providers ?? ASSUMED_PROVIDERS;
  const models = useMemo(
    () => modelsOfType(generationType).filter((model) => providers[model.provider]),
    [generationType, providers],
  );
  const optionControls = isTools ? [] : MODEL_OPTIONS[selectedModel]?.controls ?? [];
  // Cost is dynamic: model + selected options (quality / format / resolution /
  // duration). In tools mode the runner shows its own cost.
  const cost = isTools
    ? usage?.image_cost ?? 12
    : creditCostFor(selectedModel, modelOptions, generationType);
  const planName = usage?.plan_name ?? 'Community';
  // Multi-image count only applies to freeform image generation (videos and
  // Tools always run a single job).
  const effectiveCount = !isTools && generationType === 'image' ? count : 1;
  const totalCost = cost * effectiveCount;
  // Single unified credit pool — the only spend gate now.
  const balance = usage?.credit_balance ?? null;
  const hasCredits = balance == null || balance >= totalCost;
  // Wallet breakdown for the footer meter (community bucket vs purchased).
  const communityCredits = typeof usage?.monthly_credits === 'number' ? usage.monthly_credits : 0;
  const purchasedCredits = typeof usage?.purchased_credits === 'number' ? usage.purchased_credits : 0;
  const creditTotal = communityCredits + purchasedCredits;
  const communityPct = creditTotal > 0 ? Math.round((communityCredits / creditTotal) * 100) : 0;
  const lowBalance = typeof balance === 'number' && balance < totalCost;
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
    setSelectedModel(DEFAULT_MODEL[generationType]);
  }, [generationType]);

  // A model can vanish from the list once the real provider availability lands
  // (or the operator drops a key) — fall back to the first one still offered.
  useEffect(() => {
    if (models.length > 0 && !models.some((model) => model.id === selectedModel)) {
      setSelectedModel(models[0].id);
    }
  }, [models, selectedModel]);

  // Reset the option selection to the model's defaults whenever the model changes.
  useEffect(() => {
    setModelOptions(defaultSelection(selectedModel));
  }, [selectedModel]);

  // Free/visitor tiers can't generate video — snap back to image if needed.
  useEffect(() => {
    if (!canVideo && generationType === 'video') setGenerationType('image');
  }, [canVideo, generationType, setGenerationType]);

  // Submit + poll a single generation job. Resolves true on completion,
  // throws on failure/timeout. Each call charges its own credits server-side.
  const runOneJob = async (): Promise<boolean> => {
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

    const payload = await response.json().catch(() => ({}));

    if (response.status === 429) throw new Error(payload.error || 'Not enough credits');
    if (response.status === 401) throw new Error('Login required');
    if (response.status === 403) throw new Error(payload.error || 'Upgrade required');
    if (!response.ok || !payload.jobId) throw new Error(payload.error || 'Generation failed');

    // Poll the job status until it completes or fails.
    const POLL_INTERVAL = 3000;
    const MAX_ATTEMPTS = 120; // ~6 minutes
    for (let attempts = 0; attempts < MAX_ATTEMPTS; attempts += 1) {
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL));

      const statusRes = await fetch(`/api/generate/status?jobId=${encodeURIComponent(payload.jobId)}`);
      if (!statusRes.ok) continue; // transient; keep polling
      const statusPayload = await statusRes.json();

      if (statusPayload.status === 'completed') return true;
      if (statusPayload.status === 'failed') throw new Error(statusPayload.error || 'Generation failed');
      // status === 'queued' -> keep polling
    }

    throw new Error('Generation timed out. Check your Creations shortly.');
  };

  const handleGenerate = async () => {
    if (!canGenerate) return;

    const jobs = effectiveCount;
    setIsGenerating(true);
    setError(null);

    // Credits are charged at submit — reflect the spend optimistically; the
    // authoritative balance is reloaded once everything settles.
    setUsage((current) =>
      current && typeof current.credit_balance === 'number'
        ? { ...current, credit_balance: current.credit_balance - totalCost }
        : current,
    );

    try {
      const results = await Promise.allSettled(
        Array.from({ length: jobs }, () => runOneJob()),
      );
      const succeeded = results.filter((r) => r.status === 'fulfilled' && r.value).length;
      const failed = jobs - succeeded;

      if (succeeded > 0) {
        markNewCreation();
        showToast(jobs === 1 ? 'GENERATION READY' : `${succeeded}/${jobs} READY`);
        if (failed > 0) setError(`${failed} of ${jobs} generations failed`);
      } else {
        const firstError = results.find((r) => r.status === 'rejected') as PromiseRejectedResult | undefined;
        throw new Error(firstError?.reason?.message || 'Generation failed');
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Generation failed';
      setError(message);
      showToast('GENERATION FAILED');
    } finally {
      // Reconcile with the real balance (handles refunds on failed jobs).
      loadUsage();
      setIsGenerating(false);
    }
  };

  // Keep the credit footer in sync after a Tools run spends image credits.
  // Tools charge asynchronously (credits settle when each job finalizes), so we
  // bump the visible count immediately, then reload the authoritative balance.
  const applyToolSpend = useCallback((creditsLeft: number | null, spentCount: number) => {
    setUsage((current) => {
      if (!current) return current;
      return {
        ...current,
        image_count: current.image_count + spentCount,
        credit_balance: creditsLeft ?? current.credit_balance,
      };
    });
    loadUsage();
  }, [loadUsage]);

  const handlePromptDrop = useCallback((event: React.DragEvent<HTMLTextAreaElement>) => {
    const draggedPrompt = event.dataTransfer.getData('application/x-vertix-prompt');
    if (!draggedPrompt) return;

    event.preventDefault();
    event.stopPropagation();
    setPrompt(draggedPrompt);
    showToast('PROMPT LOADED');
  }, [setPrompt, showToast]);

  if (panelLayout === 'bottom') {
    return (
      <>
        <aside
          className={`fixed bottom-4 left-1/2 z-[200] w-[calc(100%-1.5rem)] max-w-[1180px] -translate-x-1/2 rounded-[28px] border border-white/15 bg-[#101214]/88 shadow-[0_32px_120px_rgba(0,0,0,0.8),inset_0_1px_0_rgba(255,255,255,0.12)] backdrop-blur-2xl transition-all duration-500 md:bottom-6 ${
            isOpen ? 'translate-y-0 opacity-100' : 'pointer-events-none translate-y-[130%] opacity-0'
          }`}
          aria-hidden={!isOpen}
        >
          <div className="relative p-2.5 md:p-3">
            {isGenerating && (
              <div className="panel-progress-bar absolute inset-x-6 top-0 h-0.5 overflow-hidden rounded-full bg-black/40" />
            )}

            <div className="flex items-start gap-2">
              <div
                onDragEnter={(event) => { event.preventDefault(); event.stopPropagation(); setIsDragOver(true); }}
                onDragOver={(event) => { event.preventDefault(); event.stopPropagation(); setIsDragOver(true); }}
                onDragLeave={(event) => { event.preventDefault(); event.stopPropagation(); setIsDragOver(false); }}
                onDrop={handleReferenceDrop}
                className={`flex h-[74px] w-[74px] shrink-0 items-center justify-center overflow-hidden rounded-[20px] border border-dashed transition-all ${
                  isDragOver
                    ? 'border-acid bg-acid/15 text-acid'
                    : 'border-white/15 bg-black/30 text-white/35 hover:border-acid/50 hover:text-acid'
                }`}
                title="Drop image reference"
              >
                {referenceImageUrls.length > 0 ? (
                  <div className="grid h-full w-full grid-cols-2 gap-px bg-white/10">
                    {referenceImageUrls.map((url, index) => (
                      <button
                        key={`${url}-${index}`}
                        type="button"
                        onClick={() => removeReferenceImageUrl(index)}
                        className="group relative overflow-hidden bg-black"
                        title="Remove reference"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={url} alt={`Reference ${index + 1}`} className="h-full w-full object-cover opacity-80 transition-all group-hover:scale-110 group-hover:opacity-35" />
                        <span className="absolute inset-0 hidden items-center justify-center font-mono text-xs text-white group-hover:flex">X</span>
                      </button>
                    ))}
                    {!isAtReferenceLimit && (
                      <div className="flex items-center justify-center bg-black/80 font-mono text-lg text-acid/70">+</div>
                    )}
                  </div>
                ) : (
                  <div className="px-2 text-center font-mono text-[8px] uppercase leading-relaxed tracking-widest">
                    {isUploadingRef ? 'Uploading' : isDragOver ? 'Drop here' : '+ Reference'}
                  </div>
                )}
              </div>

              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 items-center gap-3 rounded-[20px] border border-white/10 bg-black/30 px-4 transition-colors focus-within:border-acid/60">
                  <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-acid" fill="currentColor" aria-hidden="true">
                    <path d="M13 2 3 14h7l-1 8 11-13h-7l1-7z" />
                  </svg>
                  <textarea
                    id="infinite-generate-prompt"
                    value={prompt}
                    onChange={(event) => setPrompt(event.target.value)}
                    onDragOver={(event) => {
                      if (event.dataTransfer.types.includes('application/x-vertix-prompt')) {
                        event.preventDefault();
                        event.dataTransfer.dropEffect = 'copy';
                      }
                    }}
                    onDrop={handlePromptDrop}
                    rows={2}
                    className="max-h-[72px] min-h-[72px] flex-1 resize-none bg-transparent py-4 font-mono text-[10px] leading-relaxed uppercase text-white outline-none placeholder:text-white/30 scroll-custom md:text-[11px]"
                    placeholder="Describe what you want to create..."
                  />
                </div>
              </div>

              <button
                type="button"
                onClick={handleGenerate}
                disabled={!canGenerate}
                className="generate-shine relative h-[74px] shrink-0 overflow-hidden rounded-[20px] bg-acid px-5 font-oswald text-xs uppercase tracking-[0.18em] text-black transition-all hover:bg-white disabled:cursor-not-allowed disabled:opacity-30 md:w-36 md:text-sm"
              >
                <span className="relative z-10 flex flex-col items-center justify-center gap-1">
                  <span>{isGenerating ? 'Generating...' : 'Generate'}</span>
                  {!isGenerating && <span className="font-mono text-[8px] tracking-widest">{cost} credits</span>}
                </span>
              </button>

              <button
                type="button"
                onClick={closePanel}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-white/10 bg-black/25 font-mono text-xs text-white/40 transition-colors hover:border-acid/60 hover:text-acid"
                aria-label="Hide Studio"
                title="Hide Studio"
              >
                X
              </button>
            </div>

            <div className="mt-2 flex items-center gap-2 overflow-x-auto px-1 pb-0.5 no-scrollbar">
              <div className="flex shrink-0 items-center gap-1 rounded-full border border-white/10 bg-black/35 p-1">
                {genTypes.map((type) => (
                  <button
                    key={type}
                    type="button"
                    onClick={() => setGenerationType(type)}
                    className={`rounded-full px-4 py-2 font-mono text-[9px] uppercase tracking-widest transition-all ${
                      generationType === type
                        ? 'bg-acid text-black'
                        : 'text-white/55 hover:bg-white/10 hover:text-white'
                    }`}
                  >
                    {type}
                  </button>
                ))}
              </div>

              <div className="relative shrink-0">
                <select
                  aria-label="Generation model"
                  value={selectedModel}
                  onChange={(event) => setSelectedModel(event.target.value)}
                  className="h-10 min-w-44 cursor-pointer appearance-none rounded-full border border-white/10 bg-black/35 pl-4 pr-8 font-mono text-[9px] uppercase tracking-widest text-white/75 outline-none transition-colors hover:border-white/25 focus:border-acid"
                >
                  {models.map((model) => (
                    <option key={model.id} value={model.id}>{model.label}</option>
                  ))}
                </select>
                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-acid/60">v</span>
              </div>

              {optionControls.map((control) => (
                <div key={control.key} className="relative shrink-0">
                  <select
                    aria-label={control.label}
                    value={modelOptions[control.key] ?? control.default}
                    onChange={(event) => setModelOptions((prev) => ({ ...prev, [control.key]: event.target.value }))}
                    className="h-10 min-w-28 cursor-pointer appearance-none rounded-full border border-white/10 bg-black/35 pl-4 pr-8 font-mono text-[9px] uppercase tracking-widest text-white/65 outline-none transition-colors hover:border-white/25 focus:border-acid"
                  >
                    {control.options.map((option) => (
                      <option key={option.value} value={option.value}>{control.label}: {option.label}</option>
                    ))}
                  </select>
                  <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-acid/60">v</span>
                </div>
              ))}

              <div className="ml-auto shrink-0 px-2 font-mono text-[8px] uppercase tracking-widest text-white/35">
                {referenceImageUrls.length}/{MAX_REFERENCE_IMAGES} refs · {typeof balance === 'number' ? `${balance.toLocaleString()} credits` : planName}
              </div>
            </div>

            {error && (
              <div className="mt-2 font-mono text-[8px] uppercase tracking-widest text-danger">{error}</div>
            )}
          </div>
        </aside>
        <CreditsTopUpModal open={showTopUpModal} onClose={() => setShowTopUpModal(false)} />
      </>
    );
  }

  const isFloating = panelLayout === 'floating';

  return (
    <>
      {isOpen && !isFloating && <div className="fixed inset-0 z-[45] bg-black/40 backdrop-blur-[1px] md:hidden" onClick={closePanel} />}
      <aside
        className={`fixed w-full max-w-full overflow-hidden bg-black/[0.72] backdrop-blur-2xl border border-white/10 shadow-[0_18px_70px_rgba(0,0,0,0.65),inset_0_1px_0_rgba(255,255,255,0.10)] transform transition-transform duration-[450ms] ease-[cubic-bezier(0.16,1,0.3,1)] ${
          isFloating
            ? `bottom-3 right-3 top-3 z-[240] w-[calc(100%-1.5rem)] rounded-[26px] md:w-[420px] ${isOpen ? 'translate-x-0' : 'translate-x-[calc(100%+2rem)]'}`
            : `right-0 top-0 z-50 h-dvh border-y-0 border-r-0 rounded-l-[26px] md:w-[480px] ${isOpen ? 'translate-x-0' : 'translate-x-full'}`
        }`}
        aria-hidden={!isOpen}
      >
        {/* Glassy top sheen for depth */}
        <div className="pointer-events-none absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-white/[0.05] to-transparent" />
        {/* Acid seam on the docked edge to anchor the panel against the page */}
        {!isFloating && (
          <div className="pointer-events-none absolute inset-y-0 left-0 w-px bg-gradient-to-b from-transparent via-acid/30 to-transparent" />
        )}
        <div className="relative flex h-full flex-col">
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
              <h2 className="font-anton text-3xl md:text-4xl uppercase tracking-tight text-white leading-none">STUDIO</h2>
              <p className="font-mono text-[9px] uppercase tracking-widest text-acid/70 mt-1">{planName} ENGINE</p>
            </div>
            <div aria-hidden="true" />
          </header>

          {/* Indeterminate progress while a generation (freeform or tool) is in flight */}
          <div className="shrink-0 h-0.5 w-full bg-black/40 overflow-hidden">
            {(isGenerating || toolRunning) && <div className="panel-progress-bar h-full w-full" />}
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
            <div className={`flex-1 min-h-0 flex flex-col px-4 py-3 ${isOpen ? 'panel-stagger' : ''}`}>
              {activeToolId === 'style-transfer' ? (
                <StyleTransferRunner onSpend={applyToolSpend} onRunningChange={setToolRunning} />
              ) : activeToolId ? (
                <ToolRunner toolId={activeToolId} onSpend={applyToolSpend} onRunningChange={setToolRunning} />
              ) : (
                <ToolsGallery />
              )}
            </div>
          ) : (
            <div className={`flex-1 min-h-0 flex flex-col px-4 py-3 gap-3 ${isOpen ? 'panel-stagger' : ''}`}>
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
                    className="flex-1 min-h-[70px] w-full resize-none bg-black border border-white/10 focus:border-acid outline-none p-3 font-mono text-[10px] leading-relaxed uppercase text-white placeholder:text-white/20 scroll-custom"
                    placeholder="Describe the image or video..."
                  />
                </section>

                <div className="shrink-0 flex flex-col gap-2.5 rounded-2xl border border-white/10 bg-white/[0.02] p-2.5">
                <section className="flex items-center gap-2">
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

                  <div className="relative min-w-0 flex-1">
                    <select
                      id="generate-model"
                      aria-label="Model"
                      title="Model"
                      value={selectedModel}
                      onChange={(event) => setSelectedModel(event.target.value)}
                      className="pill-select h-9 w-full cursor-pointer appearance-none truncate [color-scheme:dark] rounded-full border border-white/10 bg-black/40 pl-3.5 pr-7 font-mono text-[10px] uppercase tracking-widest text-acid outline-none transition-colors hover:border-white/25 focus:border-acid"
                    >
                      {models.map((model) => {
                        const modelCost = usage?.model_costs?.[model.id];
                        return (
                          <option key={model.id} value={model.id}>
                            {model.label}
                            {typeof modelCost === 'number' ? ` · ${modelCost}cr` : ''}
                          </option>
                        );
                      })}
                    </select>
                    <svg
                      viewBox="0 0 24 24"
                      className="pointer-events-none absolute right-2.5 top-1/2 h-3 w-3 -translate-y-1/2 text-acid/60"
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

                  {/* Image count stepper (1–4). Each is an independent job. */}
                  {generationType === 'image' && (
                    <div className="flex h-9 shrink-0 items-center rounded-full border border-white/10 bg-black/40 px-1" title="Images to generate">
                      <button
                        type="button"
                        onClick={() => setCount((c) => Math.max(1, c - 1))}
                        disabled={count <= 1}
                        className="flex h-6 w-6 items-center justify-center rounded-full text-white/70 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-25 disabled:hover:bg-transparent"
                        aria-label="Fewer images"
                      >
                        <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
                          <path d="M5 12h14" />
                        </svg>
                      </button>
                      <span className="flex min-w-[2.25rem] items-center justify-center gap-1 font-mono text-[9px] uppercase tracking-widest tabular-nums text-white/80">
                        <svg viewBox="0 0 24 24" className="h-3 w-3 text-acid/70" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <rect x="8" y="8" width="12" height="12" rx="2" />
                          <path d="M4 16V6a2 2 0 0 1 2-2h10" />
                        </svg>
                        {count}
                      </span>
                      <button
                        type="button"
                        onClick={() => setCount((c) => Math.min(4, c + 1))}
                        disabled={count >= 4}
                        className="flex h-6 w-6 items-center justify-center rounded-full text-white/70 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-25 disabled:hover:bg-transparent"
                        aria-label="More images"
                      >
                        <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
                          <path d="M12 5v14" />
                          <path d="M5 12h14" />
                        </svg>
                      </button>
                    </div>
                  )}
                </section>

                {optionControls.length > 0 && (
                  <section className="flex items-stretch gap-1.5">
                    {optionControls.map((control) => (
                      <div key={control.key} className="relative min-w-0 flex-1">
                        <select
                          id={`opt-${control.key}`}
                          aria-label={control.label}
                          title={control.label}
                          value={modelOptions[control.key] ?? control.default}
                          onChange={(event) =>
                            setModelOptions((prev) => ({ ...prev, [control.key]: event.target.value }))
                          }
                          className="pill-select h-8 w-full cursor-pointer appearance-none truncate [color-scheme:dark] rounded-full border border-white/10 bg-black/40 pl-3 pr-7 font-mono text-[9px] uppercase tracking-widest text-white/80 outline-none transition-colors hover:border-white/25 focus:border-acid"
                        >
                          {control.options.map((opt) => (
                            <option key={opt.value} value={opt.value}>
                              {opt.label}
                            </option>
                          ))}
                        </select>
                        <svg
                          viewBox="0 0 24 24"
                          className="pointer-events-none absolute right-2.5 top-1/2 h-3 w-3 -translate-y-1/2 text-acid/50"
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
                </div>

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
                    className={`generate-shine relative mx-auto w-2/3 overflow-hidden rounded-full bg-acid text-black font-oswald text-sm uppercase tracking-[0.25em] py-3.5 hover:bg-white hover:scale-[1.02] active:scale-[0.99] transition-all duration-200 disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:scale-100 ${
                      canGenerate ? 'shadow-[0_0_18px_rgba(200,255,0,0.28)]' : 'shadow-none'
                    }`}
                  >
                    <span className="relative z-10 flex items-center justify-center gap-2">
                      <span>{isGenerating ? 'Generating...' : effectiveCount > 1 ? `Generate ${effectiveCount}` : 'Generate'}</span>
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

          <footer className="shrink-0 px-4 py-3">
            <div className="rounded-2xl border border-white/10 bg-white/[0.02] px-3.5 py-3">
            {typeof balance === 'number' ? (
              <>
                {/* Balance + cost chip */}
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-baseline gap-1.5">
                    <svg viewBox="0 0 24 24" className="h-3 w-3 translate-y-px text-acid/80" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <circle cx="8" cy="8" r="6" />
                      <path d="M18.09 10.37A6 6 0 1 1 10.34 18" />
                      <path d="M7 6h1v4" />
                      <path d="m16.71 13.88.7.71-2.82 2.82" />
                    </svg>
                    <span className="font-oswald text-base tabular-nums leading-none text-white">{balance.toLocaleString()}</span>
                    <span className="font-mono text-[8px] uppercase tracking-[0.2em] text-white/40">credits</span>
                  </div>
                  <span className="shrink-0 font-mono text-[8px] uppercase tracking-widest text-white/35">
                    {effectiveCount > 1 ? `${effectiveCount} × ${cost} = ${totalCost}` : `${cost} / ${footerType}`}
                  </span>
                </div>

                {/* Community vs purchased meter */}
                {creditTotal > 0 && (
                  <div className="mt-2">
                    <div className="flex h-1 w-full overflow-hidden rounded-full bg-black/50">
                      <div className="h-full bg-acid/70 transition-all duration-500" style={{ width: `${communityPct}%` }} />
                      <div className="h-full bg-acid/25 transition-all duration-500" style={{ width: `${100 - communityPct}%` }} />
                    </div>
                    <div className="mt-1 flex items-center justify-between font-mono text-[8px] uppercase tracking-widest text-white/35">
                      <span>{communityCredits.toLocaleString()} community</span>
                      {purchasedCredits > 0 && <span>{purchasedCredits.toLocaleString()} purchased</span>}
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div className="text-center font-mono text-[9px] uppercase tracking-widest text-acid/70">
                {planName} ENGINE
              </div>
            )}

            {usage?.access_tier !== 'admin' && (
              <div className="mt-2.5">
                {lowBalance && (
                  <div className="mb-1.5 text-center font-mono text-[8px] uppercase tracking-widest text-danger">
                    Not enough credits for this {footerType}
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => setShowTopUpModal(true)}
                  className={`relative flex w-full items-center justify-center gap-2 overflow-hidden rounded-full px-4 py-2 font-mono text-[9px] uppercase tracking-[0.22em] transition-colors ${
                    lowBalance
                      ? 'generate-shine bg-acid text-black hover:bg-white'
                      : 'border border-acid/30 bg-acid/[0.06] text-acid/90 hover:border-acid hover:bg-acid hover:text-black'
                  }`}
                >
                  <span className="relative z-10 flex items-center justify-center gap-2">
                    <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <circle cx="8" cy="8" r="6" />
                      <path d="M18.09 10.37A6 6 0 1 1 10.34 18" />
                      <path d="M7 6h1v4" />
                      <path d="m16.71 13.88.7.71-2.82 2.82" />
                    </svg>
                    <span>Buy Credits</span>
                  </span>
                </button>
              </div>
            )}
            </div>
          </footer>
        </div>
      </aside>
      <CreditsTopUpModal open={showTopUpModal} onClose={() => setShowTopUpModal(false)} />
    </>
  );
}
