'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Grid from '@/components/Grid';
import { useSync } from '@/components/SyncContext';
import { useToast } from '@/components/Toast';
import { supabase } from '@/lib/supabaseClient';
import type { CommunityVisual, Workflow } from '@/lib/types';

const PAGE_SIZE = 60;

export type CommunityTab = 'visuals' | 'workflows' | 'drops';

const TABS: { id: CommunityTab; label: string }[] = [
  { id: 'visuals', label: 'Visuals' },
  { id: 'workflows', label: 'Workflows' },
  { id: 'drops', label: 'Drops' },
];

export default function CommunityContent({
  initialTab,
  initialVisuals,
  visualsHasMore: initialVisualsHasMore,
  initialWorkflows,
  workflowsHasMore: initialWorkflowsHasMore,
}: {
  initialTab: CommunityTab;
  initialVisuals: CommunityVisual[];
  visualsHasMore: boolean;
  initialWorkflows: Workflow[];
  workflowsHasMore: boolean;
}) {
  const { setStatus } = useSync();
  const { showToast } = useToast();
  const router = useRouter();
  const [tab, setTab] = useState<CommunityTab>(initialTab);

  const [visuals, setVisuals] = useState<CommunityVisual[]>(initialVisuals);
  const [visualsHasMore, setVisualsHasMore] = useState(initialVisualsHasMore);
  const [workflows, setWorkflows] = useState<Workflow[]>(initialWorkflows);
  const [workflowsHasMore, setWorkflowsHasMore] = useState(initialWorkflowsHasMore);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const isLoadingRef = useRef(false);

  useEffect(() => {
    setStatus('ONLINE');
  }, [setStatus]);

  // Keep the URL in sync so deep links / the /workflows redirect land right.
  const selectTab = useCallback(
    (next: CommunityTab) => {
      setTab(next);
      const qs = next === 'visuals' ? '/community' : `/community?tab=${next}`;
      router.replace(qs, { scroll: false });
    },
    [router],
  );

  const loadMore = async () => {
    if (isLoadingRef.current) return;
    if (tab === 'visuals' && !visualsHasMore) return;
    if (tab === 'workflows' && !workflowsHasMore) return;
    isLoadingRef.current = true;
    setIsLoadingMore(true);
    try {
      if (tab === 'visuals') {
        const { data, error } = await supabase
          .from('community_visuals')
          .select('*')
          .order('is_featured', { ascending: false })
          .order('created_at', { ascending: false })
          .range(visuals.length, visuals.length + PAGE_SIZE - 1);
        if (error) throw error;
        if (data && data.length > 0) {
          setVisuals((prev) => [...prev, ...data]);
          setVisualsHasMore(data.length === PAGE_SIZE);
        } else {
          setVisualsHasMore(false);
        }
      } else if (tab === 'workflows') {
        const { data, error } = await supabase
          .from('workflows')
          .select('*')
          .order('created_at', { ascending: false })
          .range(workflows.length, workflows.length + PAGE_SIZE - 1);
        if (error) throw error;
        if (data && data.length > 0) {
          setWorkflows((prev) => [...prev, ...data]);
          setWorkflowsHasMore(data.length === PAGE_SIZE);
        } else {
          setWorkflowsHasMore(false);
        }
      }
    } catch {
      showToast('ERROR LOADING MORE ITEMS');
    } finally {
      isLoadingRef.current = false;
      setIsLoadingMore(false);
    }
  };

  const hasMore = tab === 'visuals' ? visualsHasMore : tab === 'workflows' ? workflowsHasMore : false;
  const loadedCount = tab === 'visuals' ? visuals.length : workflows.length;

  return (
    <div id="view-content">
      <header className="pt-8 md:pt-12 pb-6 px-4 md:px-6 bg-panel/30 text-center">
        <div className="w-full">
          <div className="flex items-center justify-center gap-3 mb-4">
            <span className="bg-acid text-black font-mono text-[9px] md:text-[10px] px-2 py-0.5 font-bold uppercase tracking-widest text-shadow mx-auto">MEMBERS ONLY</span>
          </div>
          <h1 id="view-title" className="font-anton text-5xl sm:text-6xl md:text-9xl text-white uppercase tracking-tighter leading-[0.9] md:leading-[0.8] mb-4">Community</h1>
          <p id="view-desc" className="font-mono text-[10px] md:text-xs text-white/60 max-w-lg mx-auto uppercase tracking-wider">The private members area — visuals, workflows and exclusive drops.</p>
        </div>

        {/* Sub-tabs */}
        <div className="mt-7 flex items-center justify-center gap-1 md:gap-2">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => selectTab(t.id)}
              className={`font-mono text-[10px] md:text-[11px] uppercase tracking-[0.2em] px-4 md:px-6 py-2 border-b-2 transition-all ${
                tab === t.id
                  ? 'text-acid border-acid'
                  : 'text-white/40 border-transparent hover:text-white/70'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </header>

      {tab === 'drops' ? (
        <DropsEmptyState />
      ) : (
        <Grid
          items={tab === 'visuals' ? visuals : workflows}
          activeTab={tab === 'visuals' ? 'community' : 'workflows'}
          filter="ALL"
          searchQuery=""
        />
      )}

      {tab !== 'drops' && hasMore && (
        <div className="flex justify-center py-10">
          <button
            onClick={loadMore}
            disabled={isLoadingMore}
            className="font-mono text-[10px] uppercase tracking-widest border border-white/20 hover:border-acid/60 text-white/50 hover:text-acid px-8 py-3 transition-all disabled:opacity-40"
          >
            {isLoadingMore ? 'LOADING...' : `LOAD MORE — ${loadedCount} LOADED`}
          </button>
        </div>
      )}
    </div>
  );
}

function DropsEmptyState() {
  return (
    <div className="flex flex-col items-center justify-center gap-4 py-28 px-6 text-center">
      <span className="bg-white/10 text-white/60 font-mono text-[9px] px-3 py-1 uppercase tracking-[0.3em]">
        Coming soon
      </span>
      <h2 className="font-anton text-4xl md:text-6xl uppercase tracking-tighter text-white/80">Exclusive Drops</h2>
      <p className="font-mono text-[10px] md:text-xs text-white/40 max-w-md uppercase tracking-wider leading-relaxed">
        Member-only releases — packs, templates and resources. Dropping here soon.
      </p>
    </div>
  );
}
