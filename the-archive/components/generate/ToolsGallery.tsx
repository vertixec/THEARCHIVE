'use client';

import { useGenerate } from '@/components/GenerateContext';
import { TOOLS } from '@/lib/tools/registry';
import type { ToolDefinition } from '@/lib/tools/types';

function ToolIcon({ icon }: { icon: string }) {
  if (icon === 'reels') {
    return (
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="4" width="18" height="16" rx="2" />
        <path d="M3 9h18" />
        <path d="m8 4 2 5" />
        <path d="m14 4 2 5" />
        <path d="m10.5 12.5 4 2.5-4 2.5z" />
      </svg>
    );
  }
  if (icon === 'style') {
    return (
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="13.5" cy="6.5" r="1.5" />
        <circle cx="17.5" cy="10.5" r="1.5" />
        <circle cx="8.5" cy="7.5" r="1.5" />
        <circle cx="6.5" cy="12.5" r="1.5" />
        <path d="M12 2a10 10 0 0 0 0 20 2.5 2.5 0 0 0 2-4 2.5 2.5 0 0 1 2-4h2a4 4 0 0 0 4-4 10 10 0 0 0-10-8z" />
      </svg>
    );
  }
  // ads (default)
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="m3 11 14-7v16L3 13z" />
      <path d="M17 8a3 3 0 0 1 0 8" />
      <path d="M6 13v4a2 2 0 0 0 2 2h1" />
    </svg>
  );
}

function ToolCard({ tool, onOpen }: { tool: ToolDefinition; onOpen: (id: string) => void }) {
  const isLive = tool.status === 'live';
  return (
    <button
      type="button"
      disabled={!isLive}
      onClick={() => isLive && onOpen(tool.id)}
      className={`group w-full text-left border p-4 transition-all duration-200 ${
        isLive
          ? 'border-white/10 bg-black/40 hover:border-acid/60 hover:bg-acid/[0.04] cursor-pointer'
          : 'border-white/[0.06] bg-black/20 opacity-60 cursor-not-allowed'
      }`}
    >
      <div className="flex items-start gap-3">
        <span
          className={`mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border transition-colors ${
            isLive ? 'border-acid/30 bg-acid/10 text-acid' : 'border-white/10 bg-white/[0.03] text-white/40'
          }`}
        >
          <ToolIcon icon={tool.icon} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="font-oswald text-sm uppercase tracking-wide text-white">{tool.name}</h3>
            {!isLive && (
              <span className="font-mono text-[9px] uppercase tracking-widest text-white/40 border border-white/15 px-1.5 py-0.5">
                Soon
              </span>
            )}
          </div>
          <p className="font-mono text-[9px] uppercase tracking-widest text-acid/70 mt-0.5">{tool.tagline}</p>
          <p className="mt-2 font-mono text-[10px] leading-relaxed text-white/45">{tool.description}</p>
          {isLive && (
            <div className="mt-2.5 flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-widest text-white/35">
              <span className="text-acid/60">
                {tool.angleOptions ? `up to ${tool.outputCount}` : tool.outputCount} results
              </span>
              <span>·</span>
              <span>1 credit each</span>
            </div>
          )}
        </div>
      </div>
    </button>
  );
}

export default function ToolsGallery() {
  const { openTool } = useGenerate();

  return (
    <div className="flex-1 min-h-0 overflow-y-auto scroll-custom flex flex-col gap-3 px-1">
      <p className="shrink-0 font-mono text-[9px] leading-relaxed uppercase tracking-widest text-white/35">
        Tools that generate ready-to-use results. Pick one to start.
      </p>
      <div className="flex flex-col gap-2.5">
        {TOOLS.map((tool) => (
          <ToolCard key={tool.id} tool={tool} onOpen={openTool} />
        ))}
      </div>
    </div>
  );
}
