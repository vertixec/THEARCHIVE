'use client';

import { useEffect } from 'react';
import Grid from '@/components/Grid';
import { useSync } from '@/components/SyncContext';

export default function CommunityContent({ initialItems }: { initialItems: any[] }) {
  const { setStatus } = useSync();

  useEffect(() => {
    setStatus('ONLINE');
  }, [setStatus]);

  return (
    <div id="view-content">
      <header className="pt-8 md:pt-12 pb-6 px-4 md:px-6 bg-panel/30 text-center md:text-left">
        <div className="w-full">
          <div className="flex items-center justify-center md:justify-start gap-3 mb-4">
            <span className="bg-acid text-black font-mono text-[9px] md:text-[10px] px-2 py-0.5 font-bold uppercase tracking-widest text-shadow mx-auto md:mx-0">VERTIX ACADEMY</span>
          </div>
          <h1 id="view-title" className="font-anton text-4xl sm:text-5xl md:text-8xl text-white uppercase tracking-tighter leading-[0.9] md:leading-[0.8] mb-4">Community Hub</h1>
          <p id="view-desc" className="font-mono text-[10px] md:text-xs text-white/60 border-l-0 md:border-l border-acid md:pl-4 pl-0 max-w-lg mx-auto md:mx-0 uppercase tracking-wider">Featured visuals created by the community.</p>
        </div>
      </header>

      <Grid
        items={initialItems}
        activeTab="community"
        filter="ALL"
        searchQuery=""
      />
    </div>
  );
}
