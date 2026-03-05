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
          setTimeout(() => {
            const element = document.getElementById(`card-${targetId}`);
            if (element) {
              element.scrollIntoView({ behavior: 'smooth', block: 'center' });
              element.classList.add('ring-2', 'ring-acid', 'ring-offset-4', 'ring-offset-black');
            }
          }, 500);
        }
      }
    }
    loadData();
  }, [setStatus, searchParams]);

  return (
    <div id="view-content">
      <header className="pt-12 pb-6 px-6 bg-panel/30">
        <div className="w-full text-left">
          <div className="flex items-center gap-3 mb-4">
            <span className="bg-acid text-black font-mono text-[10px] px-2 py-0.5 font-bold uppercase tracking-widest text-shadow text-black">VERTIX ACADEMY</span>
          </div>
          <h1 id="view-title" className="font-anton text-6xl md:text-8xl text-white uppercase tracking-tighter leading-[0.8] mb-4">Visuals Archive</h1>
          <p id="view-desc" className="font-mono text-xs text-white/60 border-l border-acid pl-4 max-w-lg uppercase tracking-wider">Complete collection of visual assets and creative references.</p>
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

