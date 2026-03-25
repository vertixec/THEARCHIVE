'use client';

import { useState, useEffect, useRef } from 'react';
import Grid from '@/components/Grid';
import { useSync } from '@/components/SyncContext';
import { useToast } from '@/components/Toast';
import { supabase } from '@/lib/supabaseClient';
import type { CommunityVisual } from '@/lib/types';

const PAGE_SIZE = 60;

export default function CommunityContent({ initialItems, hasMore: initialHasMore }: { initialItems: CommunityVisual[]; hasMore: boolean }) {
  const { setStatus } = useSync();
  const { showToast } = useToast();
  const [allItems, setAllItems] = useState<CommunityVisual[]>(initialItems);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const isLoadingRef = useRef(false);

  useEffect(() => {
    setStatus('ONLINE');
  }, [setStatus]);

  const loadMore = async () => {
    if (isLoadingRef.current || !hasMore) return;
    isLoadingRef.current = true;
    setIsLoadingMore(true);
    try {
      const { data, error } = await supabase
        .from('community_visuals')
        .select('*')
        .order('is_featured', { ascending: false })
        .order('created_at', { ascending: false })
        .range(allItems.length, allItems.length + PAGE_SIZE - 1);
      if (error) throw error;
      if (data && data.length > 0) {
        setAllItems(prev => [...prev, ...data]);
        setHasMore(data.length === PAGE_SIZE);
      } else {
        setHasMore(false);
      }
    } catch {
      showToast('ERROR LOADING MORE ITEMS');
    } finally {
      isLoadingRef.current = false;
      setIsLoadingMore(false);
    }
  };

  return (
    <div id="view-content">
      <header className="pt-8 md:pt-12 pb-6 px-4 md:px-6 bg-panel/30 text-center">
        <div className="w-full">
          <div className="flex items-center justify-center gap-3 mb-4">
            <span className="bg-acid text-black font-mono text-[9px] md:text-[10px] px-2 py-0.5 font-bold uppercase tracking-widest text-shadow mx-auto">VERTIX ACADEMY</span>
          </div>
          <h1 id="view-title" className="font-anton text-5xl sm:text-6xl md:text-9xl text-white uppercase tracking-tighter leading-[0.9] md:leading-[0.8] mb-4">Community Hub</h1>
          <p id="view-desc" className="font-mono text-[10px] md:text-xs text-white/60 max-w-lg mx-auto uppercase tracking-wider">Featured visuals created by the community.</p>
        </div>
      </header>

      <Grid
        items={allItems}
        activeTab="community"
        filter="ALL"
        searchQuery=""
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
