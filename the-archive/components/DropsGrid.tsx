'use client';

import type { CommunityDrop } from '@/lib/types';

// HTML drops open in a new tab (they render standalone); everything else
// (packs, .zip, templates) is offered as a download.
function isInlineHtml(drop: CommunityDrop): boolean {
  return drop.kind === 'html' || /\.html?($|\?)/i.test(drop.file_url);
}

function DropCard({ drop }: { drop: CommunityDrop }) {
  const openInTab = isInlineHtml(drop);
  const actionLabel = openInTab ? 'OPEN' : 'DOWNLOAD';

  return (
    <div className="group relative flex flex-col border border-white/10 bg-panel/30 hover:border-acid/50 transition-all">
      {/* Cover */}
      <div className="relative aspect-[16/10] overflow-hidden bg-black">
        {drop.thumbnail_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={drop.thumbnail_url}
            alt={drop.title}
            loading="lazy"
            className="h-full w-full object-cover opacity-90 group-hover:opacity-100 group-hover:scale-[1.02] transition-all duration-300"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <span className="font-anton text-5xl text-white/10 uppercase tracking-tighter">
              {(drop.kind || 'drop').slice(0, 4)}
            </span>
          </div>
        )}
        <span className="absolute top-2 left-2 bg-black/70 backdrop-blur-sm text-white/70 font-mono text-[8px] px-2 py-0.5 uppercase tracking-[0.2em]">
          {drop.kind}
        </span>
        {drop.is_featured && (
          <span className="absolute top-2 right-2 bg-acid text-black font-mono text-[8px] px-2 py-0.5 font-bold uppercase tracking-[0.2em]">
            Featured
          </span>
        )}
      </div>

      {/* Body */}
      <div className="flex flex-1 flex-col gap-2 p-4">
        <h3 className="font-anton text-lg md:text-xl uppercase tracking-tight leading-none text-white">
          {drop.title}
        </h3>
        {drop.description && (
          <p className="font-mono text-[10px] text-white/45 uppercase tracking-wider leading-relaxed line-clamp-3">
            {drop.description}
          </p>
        )}
        <a
          href={drop.file_url}
          target={openInTab ? '_blank' : undefined}
          rel={openInTab ? 'noopener noreferrer' : undefined}
          download={openInTab ? undefined : ''}
          className="mt-auto inline-flex items-center justify-center gap-2 border border-white/20 hover:border-acid hover:text-acid text-white/70 font-mono text-[10px] uppercase tracking-[0.2em] px-4 py-2.5 transition-all"
        >
          {actionLabel} →
        </a>
      </div>
    </div>
  );
}

export default function DropsGrid({ drops }: { drops: CommunityDrop[] }) {
  if (drops.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-28 px-6 text-center">
        <span className="bg-white/10 text-white/60 font-mono text-[9px] px-3 py-1 uppercase tracking-[0.3em]">
          Coming soon
        </span>
        <h2 className="font-anton text-4xl md:text-6xl uppercase tracking-tighter text-white/80">
          Exclusive Drops
        </h2>
        <p className="font-mono text-[10px] md:text-xs text-white/40 max-w-md uppercase tracking-wider leading-relaxed">
          Member-only releases — packs, templates and resources. Dropping here soon.
        </p>
      </div>
    );
  }

  return (
    <main className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 p-3 pb-20">
      {drops.map((drop) => (
        <DropCard key={drop.id} drop={drop} />
      ))}
    </main>
  );
}
