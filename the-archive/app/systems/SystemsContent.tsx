'use client';

import { useState, useEffect } from 'react';
import Filters from '@/components/Filters';
import Grid from '@/components/Grid';
import { useSync } from '@/components/SyncContext';
import { supabase } from '@/lib/supabaseClient';
import type { SystemPrompt } from '@/lib/types';

const PAGE_SIZE = 60;

export default function SystemsContent({ initialItems, hasMore: initialHasMore }: { initialItems: SystemPrompt[]; hasMore: boolean }) {
  const { setStatus } = useSync();
  const [allItems, setAllItems] = useState<SystemPrompt[]>(initialItems);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [currentFilter, setCurrentFilter] = useState('ALL');
  const [searchQuery, setSearchQuery] = useState('');

  const types = [...new Set(allItems.map(item => {
    const val = item.prompt_type || 'GENERAL';
    return val.toString().trim().toUpperCase();
  }))].sort() as string[];

  useEffect(() => {
    setStatus('ONLINE');
  }, [setStatus]);

  const loadMore = async () => {
    if (isLoadingMore || !hasMore) return;
    setIsLoadingMore(true);
    const { data } = await supabase
      .from('functional_prompts')
      .select('*')
      .order('created_at', { ascending: false })
      .range(allItems.length, allItems.length + PAGE_SIZE - 1);
    if (data && data.length > 0) {
      setAllItems(prev => [...prev, ...data]);
      setHasMore(data.length === PAGE_SIZE);
    } else {
      setHasMore(false);
    }
    setIsLoadingMore(false);
  };

  return (
    <div id="view-content">
      <header className="pt-8 md:pt-12 pb-6 px-4 md:px-6 bg-panel/30 text-center md:text-left">
        <div className="w-full">
          <div className="flex items-center justify-center md:justify-start gap-3 mb-4">
            <span className="bg-acid text-black font-mono text-[9px] md:text-[10px] px-2 py-0.5 font-bold uppercase tracking-widest text-shadow mx-auto md:mx-0">VERTIX ACADEMY</span>
          </div>
          <h1 id="view-title" className="font-anton text-4xl sm:text-5xl md:text-8xl text-white uppercase tracking-tighter leading-[0.9] md:leading-[0.8] mb-4">Archive Systems</h1>
          <p id="view-desc" className="font-mono text-[10px] md:text-xs text-white/60 border-l-0 md:border-l border-acid md:pl-4 pl-0 max-w-lg mx-auto md:mx-0 uppercase tracking-wider">Functional use cases and logic patterns.</p>
        </div>
      </header>

      <Filters
        activeTab="systems"
        currentFilter={currentFilter}
        onFilterChange={setCurrentFilter}
        onSearchChange={setSearchQuery}
        types={types}
      />

      <Grid
        items={allItems}
        activeTab="systems"
        filter={currentFilter}
        searchQuery={searchQuery}
      />

      {hasMore && (
        <div className="flex justify-center py-10">
          <button
            onClick={loadMore}
            disabled={isLoadingMore}
            className="font-mono text-[10px] uppercase tracking-widest border border-white/20 hover:border-acid/60 text-white/50 hover:text-acid px-8 py-3 transition-all disabled:opacity-40"
          >
            {isLoadingMore ? 'LOADING...' : `LOAD MORE — ${allItems.length} LOADED`}
          </button>
        </div>
      )}
    </div>
  );
}
