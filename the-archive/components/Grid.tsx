'use client';

import { useState, useEffect } from 'react';
import Card from './Card';
import { supabase } from '@/lib/supabaseClient';

import { useAuth } from './AuthContext';

interface GridProps {
  items: any[];
  activeTab: 'main' | 'systems' | 'community';
  filter: string;
  searchQuery: string;
}

export default function Grid({ items, activeTab, filter, searchQuery }: GridProps) {
  const [filteredItems, setFilteredItems] = useState<any[]>([]);
  const [likedIds, setLikedIds] = useState<Set<string>>(new Set());
  const { user } = useAuth();

  useEffect(() => {
    let isMounted = true;
    const itemType = activeTab === 'main' ? 'visual' : activeTab === 'systems' ? 'system' : 'community';

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
    let typeField: 'volume' | 'prompt_type' | 'author' = 'volume';
    if (activeTab === 'systems') typeField = 'prompt_type';
    if (activeTab === 'community') typeField = 'author';

    const filtered = items.filter(item => {
      const itemType = (item[typeField] || 'GENERAL').toString().trim().toUpperCase();
      const matchesType = filter === 'ALL' || itemType === filter;
      
      const searchStr = (
        (item.prompt_text || '') + 
        (item.title || '') + 
        (item.model || '') + 
        (item.category || '') +
        (item.volume || '') +
        (item.prompt_type || '') +
        (item.author || '')
      ).toLowerCase();
      
      const matchesSearch = !searchQuery || searchStr.includes(searchQuery.toLowerCase());
      return matchesType && matchesSearch;
    });

    setFilteredItems(filtered);
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
          bottomLabel = 'AUTHOR';
        }

        const itemType = activeTab === 'main' ? 'visual' : activeTab === 'systems' ? 'system' : 'community';

        return (
          <Card 
            key={item.id}
            item={item}
            cardTitle={cardTitle}
            secondaryLabel={secondaryLabel}
            bottomLabel={bottomLabel}
            itemType={itemType}
            initialIsLiked={likedIds.has(item.id.toString())}
          />
        );
      })}
    </main>
  );
}
