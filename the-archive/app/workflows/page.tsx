'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import Filters from '@/components/Filters';
import Grid from '@/components/Grid';
import { useSync } from '@/components/SyncContext';

export default function WorkflowsPage() {
  const { setStatus } = useSync();
  const [dbItems, setDbItems] = useState<any[]>([]);
  const [types, setTypes] = useState<string[]>([]);
  const [currentFilter, setCurrentFilter] = useState('ALL');
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    async function loadData() {
      const { data, error } = await supabase
        .from('workflows')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) {
        console.error('Supabase Error:', error);
        setStatus('ERROR');
      } else {
        const items = data || [];
        setDbItems(items);
        setStatus('ONLINE');
        
        // For workflows, we might filter by category or just show all for now.
        // We'll extract unique "categories" if they exist, or just use 'GENERAL'
        const uniqueTypes = [...new Set(items.map(item => {
          const val = item.category || 'WORKFLOW';
          return val.toString().trim().toUpperCase();
        }))].sort();
        setTypes(uniqueTypes as string[]);
      }
    }
    loadData();
  }, []);

  return (
    <div id="view-content">
      <header className="pt-12 pb-6 px-6 bg-panel/30">
        <div className="w-full text-left">
          <div className="flex items-center gap-3 mb-4">
            <span className="bg-acid text-black font-mono text-[10px] px-2 py-0.5 font-bold uppercase tracking-widest text-shadow text-black">VERTIX ACADEMY</span>
          </div>
          <h1 id="view-title" className="font-anton text-6xl md:text-8xl text-white uppercase tracking-tighter leading-[0.8] mb-4">Workflows</h1>
          <p id="view-desc" className="font-mono text-xs text-white/60 border-l border-acid pl-4 max-w-lg uppercase tracking-wider">Direct access to design and development workflows.</p>
        </div>
      </header>

      <Filters 
        activeTab="main" // We reuse the 'main' filter layout for simplicity
        currentFilter={currentFilter}
        onFilterChange={setCurrentFilter}
        onSearchChange={setSearchQuery}
        types={types}
      />

      <Grid 
        items={dbItems}
        activeTab="workflows"
        filter={currentFilter}
        searchQuery={searchQuery}
      />
    </div>
  );
}
