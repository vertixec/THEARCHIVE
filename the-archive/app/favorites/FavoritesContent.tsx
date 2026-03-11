'use client';

import { useState, useEffect } from 'react';
import Card from '@/components/Card';
import { useSync } from '@/components/SyncContext';
import { supabase } from '@/lib/supabaseClient';

interface Props {
  initialItems: any[];
}

export default function FavoritesContent({ initialItems }: Props) {
  const { setStatus } = useSync();

  const [likedItems, setLikedItems] = useState<any[]>(initialItems);
  const [currentSource, setCurrentSource] = useState('ALL');
  const [flippedId, setFlippedId] = useState<string | null>(null);

  useEffect(() => { setStatus('ONLINE'); }, [setStatus]);

  const sources = [
    { id: 'ALL', label: 'ALL SOURCES' },
    { id: 'visual', label: 'VISUALS' },
    { id: 'system', label: 'SYSTEMS' },
    { id: 'community', label: 'COMMUNITY' },
    { id: 'workflow', label: 'WORKFLOWS' },
  ];

  const filteredItems = currentSource === 'ALL'
    ? likedItems
    : likedItems.filter(item => item._itemType === currentSource);

  const handleToggle = async (itemId: string, itemType: string, newIsLiked: boolean) => {
    if (!newIsLiked) {
      setLikedItems(prev => prev.filter(item => !(item.id.toString() === itemId.toString() && item._itemType === itemType)));
    }
  };

  function getCardLabels(item: any) {
    const activeTab = item._itemType;
    let cardTitle = 'ASSET', secondaryLabel = 'VOL', bottomLabel = 'CATEGORY';
    if (activeTab === 'visual')    { cardTitle = item.category || 'ASSET'; secondaryLabel = item.volume || 'VOL'; bottomLabel = 'CATEGORY'; }
    if (activeTab === 'system')    { cardTitle = item.title || 'SYSTEM'; secondaryLabel = item.prompt_type || 'TYPE'; bottomLabel = 'IDENTIFIER'; }
    if (activeTab === 'community') { cardTitle = item.author || 'COMMUNITY'; secondaryLabel = item.is_featured ? 'FEATURED' : 'MEMBER'; bottomLabel = 'AUTHOR'; }
    if (activeTab === 'workflow')  { cardTitle = item.name || 'WORKFLOW'; secondaryLabel = 'ACCESS'; bottomLabel = 'TYPE'; }
    return { cardTitle, secondaryLabel, bottomLabel };
  }

  return (
    <div id="view-content">
      {/* Header */}
      <header className="pt-12 pb-6 px-6 bg-panel/30">
        <div className="w-full text-left">
          <div className="flex items-center justify-between mb-4">
            <span className="bg-acid text-black font-mono text-[10px] px-2 py-0.5 font-bold uppercase tracking-widest text-shadow">
              USER DATASHORE
            </span>
          </div>
          <h1 id="view-title" className="font-anton text-6xl md:text-8xl text-white uppercase tracking-tighter leading-[0.8] mb-4">
            Saved Assets
          </h1>
          <p id="view-desc" className="font-mono text-xs text-white/60 border-l border-acid pl-4 max-w-lg uppercase tracking-wider">
            Your curated collection of prompts and references.
          </p>
        </div>
      </header>

      {/* Source Filters */}
      <section className="sticky top-[72px] z-40 bg-dark/90 backdrop-blur-md border-y border-white/10 px-6 py-4">
        <div className="flex flex-wrap gap-2 items-center">
          {sources.map((source) => (
            <button
              key={source.id}
              onClick={() => { setCurrentSource(source.id); setFlippedId(null); }}
              className={`px-4 py-1.5 border border-white/20 font-mono text-[10px] uppercase tracking-widest transition-all ${
                currentSource === source.id ? 'bg-acid text-black border-acid' : 'hover:border-acid/50 text-white/70'
              }`}
            >
              {source.label}
            </button>
          ))}
        </div>
      </section>

      {/* Items */}
      <section>
        {filteredItems.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-32 border-b border-white/5">
            <div className="font-anton text-4xl text-white/20 uppercase tracking-tighter mb-4">No Records</div>
            <p className="font-mono text-[10px] text-gray-600 uppercase tracking-widest">No assets found for the selected source.</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-[2px] p-[2px] min-h-[40vh] pb-20">
            {filteredItems.map((item) => {
              const { cardTitle, secondaryLabel, bottomLabel } = getCardLabels(item);
              return (
                <Card
                  key={`${item._itemType}-${item.id}`}
                  item={item}
                  cardTitle={cardTitle}
                  secondaryLabel={secondaryLabel}
                  bottomLabel={bottomLabel}
                  itemType={item._itemType}
                  initialIsLiked={true}
                  onToggle={handleToggle}
                  isFlipped={flippedId === `${item._itemType}-${item.id}`}
                  onFlip={() => setFlippedId(flippedId === `${item._itemType}-${item.id}` ? null : `${item._itemType}-${item.id}`)}
                />
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
