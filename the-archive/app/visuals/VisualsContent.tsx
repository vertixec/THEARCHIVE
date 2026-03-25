'use client';

import { useState, useEffect, useRef } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Filters from '@/components/Filters';
import Grid from '@/components/Grid';
import { useSync } from '@/components/SyncContext';
import { useToast } from '@/components/Toast';
import { supabase } from '@/lib/supabaseClient';
import type { Visual } from '@/lib/types';

const PAGE_SIZE = 60;

export default function VisualsContent({ initialItems, hasMore: initialHasMore }: { initialItems: Visual[]; hasMore: boolean }) {
  const { setStatus } = useSync();
  const { showToast } = useToast();
  const searchParams = useSearchParams();
  const router = useRouter();

  const [allItems, setAllItems] = useState<Visual[]>(initialItems);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const isLoadingRef = useRef(false);
  const [currentFilter, setCurrentFilter] = useState('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [localHighlightId, setLocalHighlightId] = useState<string | null>(null);

  const loadMore = async () => {
    if (isLoadingRef.current || !hasMore) return;
    isLoadingRef.current = true;
    setIsLoadingMore(true);
    try {
      const { data, error } = await supabase
        .from('prompts')
        .select('*')
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

  // Moodboard selection mode
  const moodboardId = searchParams.get('moodboardId');
  const moodboardName = searchParams.get('moodboardName');
  const isSelectionMode = !!(moodboardId && moodboardName);

  const [selectedItems, setSelectedItems] = useState<Map<string, string | null>>(new Map());
  const [isConfirming, setIsConfirming] = useState(false);

  const types = [...new Set(allItems.map(item => {
    const val = item.volume || 'GENERAL';
    return val.toString().trim().toUpperCase();
  }))].sort() as string[];

  useEffect(() => {
    setStatus('ONLINE');

    const targetId = searchParams.get('id');
    if (targetId) {
      setLocalHighlightId(targetId);
      setTimeout(() => {
        const element = document.getElementById(`card-${targetId}`);
        if (element) {
          element.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }, 500);
      setTimeout(() => {
        setLocalHighlightId(null);
      }, 12000);
    }
  }, [setStatus, searchParams]);

  function handleSelectItem(id: string, imageUrl: string | null) {
    setSelectedItems(prev => {
      const next = new Map(prev);
      if (next.has(id)) next.delete(id);
      else next.set(id, imageUrl);
      return next;
    });
  }

  async function confirmSelection() {
    if (!moodboardId || selectedItems.size === 0 || isConfirming) return;
    setIsConfirming(true);

    const rows = Array.from(selectedItems.entries()).map(([id, imageUrl]) => ({
      board_id: moodboardId,
      item_id: id,
      item_type: 'visual',
      image_url: imageUrl,
    }));

    await supabase
      .from('board_items')
      .upsert(rows, { onConflict: 'board_id,item_id,item_type', ignoreDuplicates: true } as any);

    router.push(`/moodboard/${moodboardId}`);
  }

  return (
    <div id="view-content">

      {/* Selection mode banner */}
      {isSelectionMode && (
        <div className="bg-[#c8ff00]/10 border-b border-[#c8ff00]/30 px-6 py-3 flex items-center gap-3">
          <div className="w-2 h-2 rounded-full bg-[#c8ff00] animate-pulse" />
          <span className="font-mono text-[10px] text-[#c8ff00] uppercase tracking-widest">
            Selection mode — Adding to: <span className="font-bold">{moodboardName}</span>
          </span>
          <button
            onClick={() => router.push('/moodboard')}
            className="ml-auto font-mono text-[10px] text-white/40 hover:text-white uppercase tracking-widest border border-white/10 hover:border-white/30 px-3 py-1 transition-all"
          >
            Cancel
          </button>
        </div>
      )}

      <header className="pt-8 md:pt-12 pb-6 px-4 md:px-6 bg-panel/30 text-center">
        <div className="w-full">
          <div className="flex items-center justify-center gap-3 mb-4">
            <span className="bg-acid text-black font-mono text-[9px] md:text-[10px] px-2 py-0.5 font-bold uppercase tracking-widest text-shadow mx-auto">VERTIX ACADEMY</span>
          </div>
          <h1 id="view-title" className="font-anton text-5xl sm:text-6xl md:text-9xl text-white uppercase tracking-tighter leading-[0.9] md:leading-[0.8] mb-4">Visuals Archive</h1>
          <p id="view-desc" className="font-mono text-[10px] md:text-xs text-white/60 max-w-lg mx-auto uppercase tracking-wider">Complete collection of visual assets and creative references.</p>
        </div>
      </header>

      <Filters
        activeTab="main"
        currentFilter={currentFilter}
        onFilterChange={setCurrentFilter}
        onSearchChange={setSearchQuery}
        types={types}
      />

      <Grid
        items={allItems}
        activeTab="main"
        filter={currentFilter}
        searchQuery={searchQuery}
        highlightedId={localHighlightId || undefined}
        onClearHighlight={() => setLocalHighlightId(null)}
        selectionMode={isSelectionMode}
        selectedIds={new Set(selectedItems.keys())}
        onSelectItem={handleSelectItem}
      />

      {hasMore && !isSelectionMode && (
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

      {/* Floating confirm bar */}
      {isSelectionMode && (
        <div className={`fixed bottom-0 left-0 right-0 z-[55] bg-black/98 backdrop-blur-xl border-t transition-all duration-300 px-6 py-4 flex items-center gap-4 ${
          selectedItems.size > 0 ? 'border-[#c8ff00]/40 translate-y-0' : 'border-white/10 translate-y-0'
        }`}>
          <span className="font-mono text-xs uppercase tracking-widest text-white/50">
            {selectedItems.size === 0
              ? 'Tap images to select them'
              : <span className="text-[#c8ff00]">{selectedItems.size} image{selectedItems.size !== 1 ? 's' : ''} selected</span>
            }
          </span>

          <div className="ml-auto flex items-center gap-3">
            {selectedItems.size > 0 && (
              <button
                onClick={() => setSelectedItems(new Map())}
                className="font-mono text-[10px] text-white/30 hover:text-white uppercase tracking-widest transition-colors"
              >
                Clear
              </button>
            )}
            <button
              onClick={confirmSelection}
              disabled={selectedItems.size === 0 || isConfirming}
              className="px-5 py-2 bg-[#c8ff00] text-black font-mono text-[10px] uppercase tracking-widest disabled:opacity-30 hover:bg-[#c8ff00]/80 transition-colors"
            >
              {isConfirming ? 'Adding...' : `Add to ${moodboardName}`}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
