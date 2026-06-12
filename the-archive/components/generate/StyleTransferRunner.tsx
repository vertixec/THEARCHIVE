'use client';

import { useRef, useState } from 'react';
import { useGenerate } from '@/components/GenerateContext';
import { useToast } from '@/components/Toast';
import { getTool } from '@/lib/tools/registry';
import type { ToolImageResult, ToolRunResponse } from '@/lib/tools/types';
import { useImageSlot } from './useImageSlot';

// A single labeled image slot: drag from the grid, drop a file, or click to
// upload. Holds exactly one image with a clear role (style vs. content).
function ImageSlot({
  label,
  hint,
  url,
  onChange,
  disabled,
}: {
  label: string;
  hint: string;
  url: string | null;
  onChange: (url: string | null) => void;
  disabled?: boolean;
}) {
  const { isDragOver, setIsDragOver, isUploading, uploadFile, handleDrop } = useImageSlot((u) => onChange(u));
  const inputRef = useRef<HTMLInputElement>(null);

  const dragProps = {
    onDragEnter: (e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); setIsDragOver(true); },
    onDragOver: (e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); setIsDragOver(true); },
    onDragLeave: (e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); setIsDragOver(false); },
    onDrop: handleDrop,
  };

  return (
    <div className="min-w-0">
      <div className="font-mono text-[9px] text-white/40 uppercase tracking-widest mb-1.5">{label}</div>
      {url ? (
        <div className="panel-fade-in group relative aspect-square border border-white/10 bg-black overflow-hidden hover:border-acid/40 transition-colors">
          <img src={url} alt={label} className="h-full w-full object-cover pointer-events-none" />
          <button
            type="button"
            onClick={() => onChange(null)}
            disabled={disabled}
            className="absolute right-1 top-1 h-5 w-5 bg-black/80 border border-white/20 font-mono text-[10px] leading-none uppercase text-white/60 hover:text-acid hover:border-acid/60 transition-colors flex items-center justify-center disabled:opacity-40"
            title="Remove"
            aria-label={`Remove ${label}`}
          >
            ×
          </button>
        </div>
      ) : (
        <div
          {...dragProps}
          onClick={() => !disabled && inputRef.current?.click()}
          role="button"
          tabIndex={0}
          className={`aspect-square border border-dashed flex items-center justify-center px-3 text-center cursor-pointer transition-colors ${
            isDragOver ? 'border-acid bg-acid/10' : 'border-white/15 bg-black/40 hover:border-white/25'
          } ${disabled ? 'opacity-40 cursor-not-allowed' : ''}`}
        >
          <span className={`font-mono text-[9px] uppercase tracking-widest leading-relaxed ${isDragOver ? 'text-acid' : 'text-white/30'}`}>
            {isUploading ? 'Uploading...' : isDragOver ? 'Drop here' : hint}
          </span>
        </div>
      )}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) uploadFile(file);
          e.target.value = '';
        }}
      />
    </div>
  );
}

export default function StyleTransferRunner({
  onSpend,
}: {
  onSpend?: (creditsLeft: number | null, count: number) => void;
}) {
  const tool = getTool('style-transfer');
  const { closeTool, markNewCreation } = useGenerate();
  const { showToast } = useToast();

  const [styleUrl, setStyleUrl] = useState<string | null>(null);
  const [contentUrl, setContentUrl] = useState<string | null>(null);
  const [prompt, setPrompt] = useState('');
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<ToolImageResult[] | null>(null);

  if (!tool || !tool.endpoint) {
    return (
      <div className="flex-1 flex items-center justify-center font-mono text-[10px] uppercase tracking-widest text-white/40">
        Tool not found
      </div>
    );
  }

  // Style is always required; then EITHER a content image OR a prompt.
  const canRun = !!styleUrl && (!!contentUrl || prompt.trim().length > 0) && !isRunning;

  const handleRun = async () => {
    if (!canRun || !tool.endpoint) return;
    setIsRunning(true);
    setError(null);
    setResults(null);

    try {
      // Order matters: [style, content?]. The server reads index 0 as style.
      const referenceImageUrls = [styleUrl, contentUrl].filter((u): u is string => !!u);
      const response = await fetch(tool.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, referenceImageUrls }),
      });
      const payload = await response.json().catch(() => ({}));

      if (response.status === 401) { showToast('LOGIN REQUIRED'); setError('Sign in to use this tool'); return; }
      if (response.status === 403) { showToast('UPGRADE REQUIRED'); setError(payload.error || 'Your plan does not allow this'); return; }
      if (response.status === 429) { showToast('LIMIT REACHED'); setError(payload.error || 'Limit reached'); return; }
      if (!response.ok) throw new Error(payload.error || 'The tool failed');

      const data = payload as ToolRunResponse;
      setResults(data.results ?? []);
      markNewCreation();
      onSpend?.(data.credits?.credits ?? null, data.succeeded);
      showToast(`${data.succeeded} RESULT READY`);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'The tool failed';
      setError(message);
      showToast('TOOL FAILED');
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <div className="flex-1 min-h-0 flex flex-col gap-3">
      {/* Header with back */}
      <div className="shrink-0 grid grid-cols-[1.75rem_1fr_1.75rem] items-center gap-2">
        <button
          type="button"
          onClick={closeTool}
          className="h-7 w-7 shrink-0 border border-white/15 text-white/50 hover:text-acid hover:border-acid/60 transition-colors flex items-center justify-center"
          aria-label="Back to tools"
          title="Back to tools"
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="m15 18-6-6 6-6" />
          </svg>
        </button>
        <div className="min-w-0 text-center">
          <h3 className="font-oswald text-base uppercase tracking-wide text-white leading-tight">{tool.name}</h3>
          <p className="font-mono text-[9px] uppercase tracking-widest text-acid/70">{tool.tagline}</p>
        </div>
        <div aria-hidden="true" />
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto scroll-custom flex flex-col gap-3 pr-0.5">
        {/* Two clearly separated slots */}
        <div className="grid grid-cols-2 gap-2.5">
          <ImageSlot
            label="Style reference"
            hint="Drag or upload the look to copy"
            url={styleUrl}
            onChange={setStyleUrl}
            disabled={isRunning}
          />
          <ImageSlot
            label="Image to restyle · optional"
            hint="Drop an image to re-skin, or use a prompt below"
            url={contentUrl}
            onChange={setContentUrl}
            disabled={isRunning}
          />
        </div>

        {/* Prompt — used when there's no content image (or as extra direction) */}
        <div className="shrink-0">
          <label className="font-mono text-[9px] text-white/40 uppercase tracking-widest mb-1.5 block">
            What to create
            {contentUrl ? <span className="text-white/20"> · optional extra direction</span> : null}
          </label>
          <textarea
            value={prompt}
            maxLength={600}
            onChange={(e) => setPrompt(e.target.value)}
            disabled={isRunning}
            className="min-h-[80px] w-full resize-none bg-black border border-white/10 focus:border-acid outline-none p-3 font-mono text-[10px] leading-relaxed text-white placeholder:text-white/20 scroll-custom disabled:opacity-50"
            placeholder={contentUrl ? 'Optional: nudge the result (e.g. warmer tones)' : 'E.g.: a fox sitting in a forest at dawn'}
          />
          <p className="mt-1 font-mono text-[9px] uppercase tracking-widest text-white/25">
            {contentUrl
              ? 'The 2nd image keeps its subject; the style reference sets the look.'
              : 'Describe the new subject — it will be rendered in the reference style.'}
          </p>
        </div>

        {error && (
          <div className="shrink-0 rounded-2xl border border-danger/30 bg-danger/5 px-3 py-2 font-mono text-[9px] uppercase tracking-widest text-danger">
            {error}
          </div>
        )}

        {isRunning && (
          <div className="shrink-0 flex items-center gap-2 font-mono text-[9px] uppercase tracking-widest text-acid/80">
            <span className="h-2 w-2 rounded-full bg-acid animate-pulse" />
            Transferring style... don&apos;t close this tab
          </div>
        )}

        {results && results.length > 0 && (
          <div className="shrink-0">
            <div className="font-mono text-[9px] text-white/40 uppercase tracking-widest mb-1.5">
              Result · also in Creations
            </div>
            <div className="grid grid-cols-2 gap-2">
              {results.map((item, index) => (
                <a
                  key={`${item.url}-${index}`}
                  href={item.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="relative block aspect-square border border-white/10 bg-black overflow-hidden group"
                >
                  <img src={item.url} alt={item.angle} className="h-full w-full object-cover" />
                  <span className="absolute inset-x-0 bottom-0 bg-black/70 px-1.5 py-1 font-mono text-[7px] uppercase tracking-widest text-acid/80 truncate">
                    {item.angle}
                  </span>
                </a>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Run bar */}
      <div className="shrink-0 flex flex-col items-center gap-1.5">
        <button
          type="button"
          onClick={handleRun}
          disabled={!canRun}
          className="generate-shine relative overflow-hidden rounded-full bg-acid text-black font-oswald text-sm uppercase tracking-[0.25em] px-10 py-3 hover:bg-white transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
        >
          <span className="relative z-10 flex items-center justify-center gap-2">
            <span>
              {isRunning ? 'Generating...' : !styleUrl ? 'Add a style ref' : results ? 'Generate again' : 'Transfer style'}
            </span>
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden="true">
              <path d="M13 2 3 14h7l-1 8 11-13h-7l1-7z" />
            </svg>
          </span>
        </button>
        <div className="font-mono text-[9px] uppercase tracking-widest text-white/35">
          Cost: {tool.creditCost} {tool.creditCost === 1 ? 'credit' : 'credits'}
        </div>
      </div>
    </div>
  );
}
