'use client';

import { useCallback, useState, useEffect, useRef } from 'react';
import Filters from '@/components/Filters';
import Grid from '@/components/Grid';
import InfiniteVisualView from '@/components/InfiniteVisualView';
import { useSync } from '@/components/SyncContext';
import { useToast } from '@/components/Toast';
import { supabase } from '@/lib/supabaseClient';
import type { SystemPrompt } from '@/lib/types';
import type { SortMode, ViewMode } from '@/components/Filters';

const PAGE_SIZE = 60;
type FetchResult = {
  items: SystemPrompt[];
  hasMore: boolean;
};

export default function SystemsContent({ initialItems, hasMore: initialHasMore }: { initialItems: SystemPrompt[]; hasMore: boolean }) {
  const { setStatus } = useSync();
  const { showToast } = useToast();
  const [allItems, setAllItems] = useState<SystemPrompt[]>(initialItems);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const isLoadingRef = useRef(false);
  const [currentFilter, setCurrentFilter] = useState('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortMode, setSortMode] = useState<SortMode>('newest');
  const [viewMode, setViewMode] = useState<ViewMode>('catalog');

  const types = [...new Set(allItems.map(item => {
    const val = item.prompt_type || 'GENERAL';
    return val.toString().trim().toUpperCase();
  }))].sort() as string[];

  useEffect(() => {
    setStatus('ONLINE');
  }, [setStatus]);

  const fetchNewest = useCallback(async (from: number): Promise<FetchResult> => {
    const { data, error, count } = await supabase
      .from('functional_prompts')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    const items = data ?? [];
    return {
      items,
      hasMore: typeof count === 'number' ? from + items.length < count : items.length === PAGE_SIZE,
    };
  }, []);

  const fetchPopular = useCallback(async (from: number): Promise<FetchResult> => {
    const response = await fetch(`/api/popular?type=system&from=${from}`);
    if (!response.ok) throw new Error('Popular fetch failed');
    const payload = await response.json() as { items: SystemPrompt[]; hasMore: boolean };
    return { items: payload.items, hasMore: payload.hasMore };
  }, []);

  const fetchItems = useCallback((mode: SortMode, from: number) => {
    return mode === 'popular' ? fetchPopular(from) : fetchNewest(from);
  }, [fetchNewest, fetchPopular]);

  const applySortMode = async (mode: SortMode) => {
    isLoadingRef.current = true;
    setIsLoadingMore(true);
    try {
      const result = await fetchItems(mode, 0);
      setSortMode(mode);
      setAllItems(result.items);
      setHasMore(result.hasMore);
    } catch {
      showToast(mode === 'popular' ? 'POPULAR METRICS UNAVAILABLE' : 'ERROR LOADING ITEMS');
    } finally {
      isLoadingRef.current = false;
      setIsLoadingMore(false);
    }
  };

  const loadMore = useCallback(async () => {
    if (isLoadingRef.current || !hasMore) return;
    isLoadingRef.current = true;
    setIsLoadingMore(true);
    try {
      const result = await fetchItems(sortMode, allItems.length);
      if (result.items.length > 0) {
        setAllItems(prev => [...prev, ...result.items]);
        setHasMore(result.hasMore);
      } else {
        setHasMore(false);
      }
    } catch {
      showToast(sortMode === 'popular' ? 'POPULAR METRICS UNAVAILABLE' : 'ERROR LOADING MORE ITEMS');
    } finally {
      isLoadingRef.current = false;
      setIsLoadingMore(false);
    }
  }, [allItems.length, fetchItems, hasMore, showToast, sortMode]);

  useEffect(() => {
    if (viewMode !== 'infinite' || !hasMore || isLoadingRef.current) return;
    loadMore();
  }, [hasMore, loadMore, viewMode]);

  return (
    <div id="view-content">
      <header className="pt-8 md:pt-12 pb-6 px-4 md:px-6 bg-panel/30 text-center">
        <div className="w-full">
          <div className="flex items-center justify-center gap-3 mb-4">
            <span className="bg-acid text-black font-mono text-[9px] md:text-[10px] px-2 py-0.5 font-bold uppercase tracking-widest text-shadow mx-auto">VERTIX ACADEMY</span>
          </div>
          <h1 id="view-title" className="font-anton text-5xl sm:text-6xl md:text-9xl text-white uppercase tracking-tighter leading-[0.9] md:leading-[0.8] mb-4">Archive Systems</h1>
          <p id="view-desc" className="font-mono text-[10px] md:text-xs text-white/60 max-w-lg mx-auto uppercase tracking-wider">Functional use cases and logic patterns.</p>
        </div>
      </header>

      <Filters
        activeTab="systems"
        currentFilter={currentFilter}
        onFilterChange={setCurrentFilter}
        onSearchChange={setSearchQuery}
        sortMode={sortMode}
        onSortChange={applySortMode}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        types={types}
      />

      {viewMode === 'catalog' ? (
        <Grid
          items={allItems}
          activeTab="systems"
          filter={currentFilter}
          searchQuery={searchQuery}
          sortMode={sortMode}
        />
      ) : (
        <InfiniteVisualView
          items={allItems}
          activeTab="systems"
          filter={currentFilter}
          searchQuery={searchQuery}
          sortMode={sortMode}
        />
      )}

      {viewMode === 'catalog' && hasMore && (
        <div className="flex justify-center pt-10 pb-36 md:pb-40">
          <button
            onClick={loadMore}
            disabled={isLoadingMore || !hasMore}
            className="font-mono text-[10px] uppercase tracking-widest border border-white/20 hover:border-acid/60 text-white/50 hover:text-acid px-8 py-3 transition-all disabled:opacity-40"
          >
            {isLoadingMore ? 'LOADING...' : `LOAD MORE — ${allItems.length} LOADED`}
          </button>
        </div>
      )}
    </div>
  );
}
