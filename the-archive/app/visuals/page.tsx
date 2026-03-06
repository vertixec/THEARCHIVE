'use client';

import { useEffect, useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';
import Filters from '@/components/Filters';
import Grid from '@/components/Grid';
import { useSync } from '@/components/SyncContext';

function VisualsContent() {
  const { setStatus } = useSync();
  const searchParams = useSearchParams();
  const [dbItems, setDbItems] = useState<any[]>([]);
  const [types, setTypes] = useState<string[]>([]);
  const [currentFilter, setCurrentFilter] = useState('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [localHighlightId, setLocalHighlightId] = useState<string | null>(null);

  useEffect(() => {
    async function loadData() {
      const { data, error } = await supabase
        .from('prompts')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) {
        console.error('Supabase Error:', error);
        setStatus('ERROR');
      } else {
        const items = data || [];
        setDbItems(items);
        setStatus('ONLINE');
        
        const uniqueTypes = [...new Set(items.map(item => {
          const val = item.volume || 'GENERAL';
          return val.toString().trim().toUpperCase();
        }))].sort();
        setTypes(uniqueTypes as string[]);

        // Check for ?id=... and scroll to it
        const targetId = searchParams.get('id');
        if (targetId) {
          setLocalHighlightId(targetId);
          setTimeout(() => {
            const element = document.getElementById(`card-${targetId}`);
            if (element) {
              element.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
          }, 500);
          // Auto-dismiss highlight after 12 seconds
          setTimeout(() => {
            setLocalHighlightId(null);
          }, 12000);
        }
      }
    }
    loadData();
  }, [setStatus, searchParams]);

  return (
    <div id="view-content">
      <header className="pt-8 md:pt-12 pb-6 px-4 md:px-6 bg-panel/30 text-center md:text-left">
        <div className="w-full">
          <div className="flex items-center justify-center md:justify-start gap-3 mb-4">
            <span className="bg-acid text-black font-mono text-[9px] md:text-[10px] px-2 py-0.5 font-bold uppercase tracking-widest text-shadow mx-auto md:mx-0">VERTIX ACADEMY</span>
          </div>
          <h1 id="view-title" className="font-anton text-4xl sm:text-5xl md:text-8xl text-white uppercase tracking-tighter leading-[0.9] md:leading-[0.8] mb-4">Visuals Archive</h1>
          <p id="view-desc" className="font-mono text-[10px] md:text-xs text-white/60 border-l-0 md:border-l border-acid md:pl-4 pl-0 max-w-lg mx-auto md:mx-0 uppercase tracking-wider">Complete collection of visual assets and creative references.</p>
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
        items={dbItems}
        activeTab="main"
        filter={currentFilter}
        searchQuery={searchQuery}
        highlightedId={localHighlightId || undefined}
        onClearHighlight={() => setLocalHighlightId(null)}
      />
    </div>
  );
}

export default function VisualsPage() {
  return (
    <Suspense fallback={<div className="p-20 font-mono text-acid">LOADING_VISUALS...</div>}>
      <VisualsContent />
    </Suspense>
  );
}

