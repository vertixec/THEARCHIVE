'use client';

import { useMemo, useState } from 'react';
import { useGenerate } from '@/components/GenerateContext';
import { useToast } from '@/components/Toast';
import { getTool } from '@/lib/tools/registry';
import type { ToolImageResult, ToolRunResponse } from '@/lib/tools/types';
import ReferenceImages from './ReferenceImages';

export default function ToolRunner({
  toolId,
  onSpend,
}: {
  toolId: string;
  onSpend?: (creditsLeft: number | null, count: number) => void;
}) {
  const tool = useMemo(() => getTool(toolId), [toolId]);
  const { referenceImageUrls, closeTool, markNewCreation } = useGenerate();
  const { showToast } = useToast();

  const [values, setValues] = useState<Record<string, string>>({});
  const [selectedAngles, setSelectedAngles] = useState<string[]>(
    tool?.angleOptions ? [tool.angleOptions[0].id] : [],
  );
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<ToolImageResult[] | null>(null);

  if (!tool) {
    return (
      <div className="flex-1 flex items-center justify-center font-mono text-[10px] uppercase tracking-widest text-white/40">
        Tool not found
      </div>
    );
  }

  const hasAngles = !!tool.angleOptions?.length;
  const outputNoun = tool.outputNoun ?? 'result';
  const setValue = (key: string, value: string) => setValues((prev) => ({ ...prev, [key]: value }));
  const toggleAngle = (id: string) =>
    setSelectedAngles((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  // Keep the user's original angle order for a predictable result order.
  const orderedAngles = hasAngles
    ? tool.angleOptions!.filter((a) => selectedAngles.includes(a.id)).map((a) => a.id)
    : [];
  const runCount = hasAngles ? orderedAngles.length : tool.outputCount;
  // creditCost is per single output; the full run costs cost × outputs.
  const runCost = runCount * tool.creditCost;

  const missingRequired = tool.inputs.some((input) => {
    if (!input.required) return false;
    if (input.type === 'reference-images') return referenceImageUrls.length < (input.min ?? 1);
    return !(values[input.key]?.trim());
  });

  const canRun = !missingRequired && !isRunning && !!tool.endpoint && (!hasAngles || runCount > 0);

  const handleRun = async () => {
    if (!canRun || !tool.endpoint) return;
    setIsRunning(true);
    setError(null);
    setResults(null);

    try {
      const response = await fetch(tool.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...values, count: runCount, angleIds: orderedAngles, referenceImageUrls }),
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
      const partial = data.succeeded < data.requested ? ` (${data.succeeded}/${data.requested})` : '';
      showToast(`${data.succeeded} RESULTS READY${partial}`);
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
      {/* Tool header with back */}
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
        {tool.inputs.map((input) => {
          if (input.type === 'reference-images') {
            return <ReferenceImages key={input.key} label={input.label} />;
          }
          return (
            <div key={input.key} className="shrink-0">
              <label className="font-mono text-[9px] text-white/40 uppercase tracking-widest mb-1.5 block">
                {input.label}
                {!input.required && <span className="text-white/20"> · optional</span>}
              </label>
              {input.type === 'textarea' ? (
                <textarea
                  value={values[input.key] ?? ''}
                  maxLength={input.maxLength}
                  onChange={(e) => setValue(input.key, e.target.value)}
                  className="min-h-[88px] w-full resize-none bg-black border border-white/10 focus:border-acid outline-none p-3 font-mono text-[10px] leading-relaxed text-white placeholder:text-white/20 scroll-custom"
                  placeholder={input.placeholder}
                />
              ) : (
                <input
                  type="text"
                  value={values[input.key] ?? ''}
                  onChange={(e) => setValue(input.key, e.target.value)}
                  className="h-11 w-full bg-black border border-white/10 focus:border-acid outline-none px-3 font-mono text-[10px] text-white placeholder:text-white/20"
                  placeholder={input.placeholder}
                />
              )}
              {input.helpText && (
                <p className="mt-1 font-mono text-[8px] uppercase tracking-widest text-white/25">{input.helpText}</p>
              )}
            </div>
          );
        })}

        {hasAngles && (
          <div className="shrink-0 mt-2">
            <div className="mb-1.5 flex items-center justify-center gap-2">
              <label className="font-mono text-[9px] text-white/40 uppercase tracking-widest">
                Angles to generate
              </label>
              <span className="font-mono text-[9px] uppercase tracking-widest text-acid/60">
                · {runCount} selected
              </span>
            </div>
            <div className="flex flex-wrap justify-center gap-1.5">
              {tool.angleOptions!.map((angle) => {
                const selected = selectedAngles.includes(angle.id);
                return (
                  <button
                    key={angle.id}
                    type="button"
                    onClick={() => toggleAngle(angle.id)}
                    disabled={isRunning}
                    aria-pressed={selected}
                    className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 font-mono text-[9px] uppercase tracking-wide transition-colors disabled:opacity-40 ${
                      selected
                        ? 'border-acid bg-acid/15 text-acid'
                        : 'border-white/15 bg-black/40 text-white/55 hover:border-white/30 hover:text-white/80'
                    }`}
                  >
                    <span
                      className={`flex h-3 w-3 items-center justify-center rounded-full border ${
                        selected ? 'border-acid bg-acid text-black' : 'border-white/25'
                      }`}
                    >
                      {selected && (
                        <svg viewBox="0 0 24 24" className="h-2 w-2" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M20 6 9 17l-5-5" />
                        </svg>
                      )}
                    </span>
                    {angle.label}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {error && (
          <div className="shrink-0 rounded-2xl border border-danger/30 bg-danger/5 px-3 py-2 font-mono text-[9px] uppercase tracking-widest text-danger">
            {error}
          </div>
        )}

        {isRunning && (
          <div className="shrink-0 flex items-center gap-2 font-mono text-[9px] uppercase tracking-widest text-acid/80">
            <span className="h-2 w-2 rounded-full bg-acid animate-pulse" />
            Generating {runCount} {runCount === 1 ? 'version' : 'versions'}... don&apos;t close this tab
          </div>
        )}

        {results && results.length > 0 && (
          <div className="shrink-0">
            <div className="font-mono text-[9px] text-white/40 uppercase tracking-widest mb-1.5">
              Results · also in Creations
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
      <div className="shrink-0 flex flex-col items-stretch gap-2.5">
        <div className="flex flex-col items-center gap-1.5">
          <button
            type="button"
            onClick={handleRun}
            disabled={!canRun}
            className="generate-shine relative overflow-hidden rounded-full bg-acid text-black font-oswald text-sm uppercase tracking-[0.25em] px-10 py-3 hover:bg-white transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <span className="relative z-10 flex items-center justify-center gap-2">
              <span>
                {isRunning
                  ? 'Generating...'
                  : runCount === 0
                  ? 'Pick an angle'
                  : results
                  ? 'Generate again'
                  : `Generate ${runCount} ${runCount === 1 ? outputNoun : `${outputNoun}s`}`}
              </span>
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden="true">
                <path d="M13 2 3 14h7l-1 8 11-13h-7l1-7z" />
              </svg>
            </span>
          </button>
          <div className="font-mono text-[8px] uppercase tracking-widest text-white/35">
            Cost: {runCost} {runCost === 1 ? 'credit' : 'credits'}
          </div>
        </div>
      </div>
    </div>
  );
}
