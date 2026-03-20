'use client';

import { useState, useEffect } from 'react';
import Card from './Card';
import { supabase } from '@/lib/supabaseClient';
import { useAuth } from './AuthContext';
import type { AnyItem } from '@/lib/types';

interface GridProps {
  items: AnyItem[];
  activeTab: 'main' | 'systems' | 'community' | 'workflows';
  filter: string;
  searchQuery: string;
  highlightedId?: string;
  onClearHighlight?: () => void;
  selectionMode?: boolean;
  selectedIds?: Set<string>;
  onSelectItem?: (id: string, imageUrl: string | null) => void;
}

export default function Grid({ items, activeTab, filter, searchQuery, highlightedId, onClearHighlight, selectionMode, selectedIds, onSelectItem }: GridProps) {
  const [filteredItems, setFilteredItems] = useState<AnyItem[]>([]);
  const [likedIds, setLikedIds] = useState<Set<string>>(new Set());
  const [flippedId, setFlippedId] = useState<string | null>(null);
  const { user } = useAuth();

  useEffect(() => {
    let isMounted = true;
    const itemType = activeTab === 'main' ? 'visual' : activeTab === 'systems' ? 'system' : activeTab === 'community' ? 'community' : 'workflow';

    async function fetchLikes() {
      if (!user || !isMounted) return;

      const { data } = await supabase
        .from('user_likes')
        .select('item_id')
        .eq('user_id', user.id)
        .eq('item_type', itemType);

      if (data && isMounted) {
        setLikedIds(new Set(data.map(l => l.item_id.toString())));
      }
    }

    fetchLikes();

    if (!user) {
      setLikedIds(new Set());
    }

    return () => {
      isMounted = false;
    }
  }, [activeTab, user]);

  useEffect(() => {
    let typeField: 'volume' | 'prompt_type' | 'author' | 'name' = 'volume';
    if (activeTab === 'systems') typeField = 'prompt_type';
    if (activeTab === 'community') typeField = 'author';
    if (activeTab === 'workflows') typeField = 'name';

    const filtered = items.filter(item => {
      // For workflows, we don't really have a strict type filter yet, so we'll treat all as matches if filter is ALL
      const itemTypeValue = (item[typeField] || (activeTab === 'workflows' ? item.name : 'GENERAL')).toString().trim().toUpperCase();
      const matchesType = filter === 'ALL' || itemTypeValue === filter;
      
      const searchStr = (
        (item.prompt_text || '') + 
        (item.title || '') + 
        (item.model || '') + 
        (item.category || '') +
        (item.volume || '') +
        (item.prompt_type || '') +
        (item.author || '') +
        (item.name || '')
      ).toLowerCase();
      
      const matchesSearch = !searchQuery || searchStr.includes(searchQuery.toLowerCase());
      return matchesType && matchesSearch;
    });

    setFilteredItems(filtered);
    setFlippedId(null); // Reset flipped state on filter/tab change
  }, [items, activeTab, filter, searchQuery]);

  if (filteredItems.length === 0) {
    return (
      <div className="col-span-full py-32 text-center font-mono text-gray-600 uppercase text-[10px] tracking-[0.2em]">
        0 RECORDS FOUND.
      </div>
    );
  }

  return (
    <main id="grid-container" className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-[2px] p-[2px] min-h-screen pb-20">
      {filteredItems.map((item) => {
        let cardTitle = 'ASSET';
        let secondaryLabel = 'VOL';
        let bottomLabel = 'CATEGORY';

        if(activeTab === 'main') {
          cardTitle = item.category || 'ASSET';
          secondaryLabel = item.volume || 'VOL';
          bottomLabel = 'CATEGORY';
        } else if(activeTab === 'systems') {
          cardTitle = item.title || 'SYSTEM';
          secondaryLabel = item.prompt_type || 'TYPE';
          bottomLabel = 'IDENTIFIER';
        } else if(activeTab === 'community') {
          cardTitle = item.author || 'COMMUNITY';
          secondaryLabel = item.is_featured ? 'FEATURED' : 'MEMBER';
        } else if(activeTab === 'workflows') {
          cardTitle = item.name || 'WORKFLOW';
          secondaryLabel = 'ACCESS';
          bottomLabel = 'TYPE';
        }

        const itemType = activeTab === 'main' ? 'visual' : activeTab === 'systems' ? 'system' : activeTab === 'community' ? 'community' : activeTab === 'workflows' ? 'workflow' : 'visual';

        const isSelected = selectionMode && selectedIds?.has(item.id.toString());

        return (
          <div key={item.id} className="relative">
            <Card
              item={item}
              cardTitle={cardTitle}
              secondaryLabel={secondaryLabel}
              bottomLabel={bottomLabel}
              itemType={itemType}
              initialIsLiked={likedIds.has(item.id.toString())}
              isFlipped={!selectionMode && flippedId === item.id.toString()}
              onFlip={() => {
                if (selectionMode) return;
                setFlippedId(flippedId === item.id.toString() ? null : item.id.toString());
              }}
              highlighted={item.id.toString() === highlightedId}
              onInteraction={onClearHighlight}
            />
            {selectionMode && (
              <div
                className="absolute inset-0 z-40 cursor-pointer"
                onClick={() => onSelectItem?.(item.id.toString(), item.image_url ?? null)}
              >
                {/* Checkbox */}
                <div className={`absolute top-2 left-2 w-5 h-5 border-2 flex items-center justify-center transition-all shadow-md ${
                  isSelected ? 'bg-[#c8ff00] border-[#c8ff00]' : 'bg-black/60 backdrop-blur-sm border-white/60 hover:border-[#c8ff00]'
                }`}>
                  {isSelected && (
                    <svg className="w-3 h-3 text-black" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                </div>
                {/* Selected border highlight */}
                {isSelected && (
                  <div className="absolute inset-0 border-2 border-[#c8ff00] pointer-events-none" />
                )}
              </div>
            )}
          </div>
        );
      })}
    </main>
  );
}
