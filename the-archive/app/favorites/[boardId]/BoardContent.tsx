'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import Card from '@/components/Card';
import { useSync } from '@/components/SyncContext';
import { supabase } from '@/lib/supabaseClient';

interface Board {
  id: string;
  name: string;
  created_at: string;
}

interface Props {
  board: Board;
  initialItems: any[];
}

export default function BoardContent({ board, initialItems }: Props) {
  const { setStatus } = useSync();
  const router = useRouter();
  const [items, setItems] = useState<any[]>(initialItems);
  const [flippedId, setFlippedId] = useState<string | null>(null);
  const [currentSource, setCurrentSource] = useState('ALL');
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => { setStatus('ONLINE'); }, [setStatus]);

  const sources = [
    { id: 'ALL', label: 'ALL SOURCES' },
    { id: 'visual', label: 'VISUALS' },
    { id: 'system', label: 'SYSTEMS' },
    { id: 'community', label: 'COMMUNITY' },
    { id: 'workflow', label: 'WORKFLOWS' },
  ];

  const filteredItems = currentSource === 'ALL'
    ? items
    : items.filter(item => item._itemType === currentSource);

  const handleRemoveFromVault = async (itemId: string, itemType: string) => {
    const { error } = await supabase
      .from('board_items')
      .delete()
      .eq('board_id', board.id)
      .eq('item_id', itemId)
      .eq('item_type', itemType);

    if (!error) {
      setItems(prev => prev.filter(i => !(i.id.toString() === itemId && i._itemType === itemType)));
    }
  };

  const handleDeleteVault = async () => {
    if (!confirm(`DELETE VAULT "${board.name.toUpperCase()}"?\n\nThis will remove the vault and all its organization. Your saved items will remain in favorites.`)) return;
    setIsDeleting(true);
    const { error } = await supabase.from('boards').delete().eq('id', board.id);
    if (error) { setIsDeleting(false); return; }
    router.push('/favorites');
  };

  return (
    <div id="view-content">
      {/* Header */}
      <header className="pt-8 md:pt-12 pb-6 px-4 md:px-6 bg-panel/30">
        <div className="flex items-center gap-3 mb-4">
          <Link
            href="/favorites"
            className="font-mono text-[10px] text-white/40 hover:text-acid transition-colors uppercase tracking-widest"
          >
            ← DATASHORE
          </Link>
          <span className="text-white/20 font-mono text-[10px]">/</span>
          <span className="bg-acid text-black font-mono text-[9px] md:text-[10px] px-2 py-0.5 font-bold uppercase tracking-widest">
            VAULT
          </span>
        </div>

        <div className="flex items-end justify-between gap-4">
          <h1 className="font-anton text-3xl sm:text-4xl md:text-7xl text-white uppercase tracking-tighter leading-[0.85]">
            VAULT: {board.name} / {items.length} ITEMS
          </h1>
          <button
            onClick={handleDeleteVault}
            disabled={isDeleting}
            className="shrink-0 font-mono text-[10px] text-danger/60 hover:text-danger border border-danger/20 hover:border-danger px-4 py-1.5 transition-all uppercase tracking-widest disabled:opacity-40"
          >
            {isDeleting ? 'DELETING...' : 'DELETE VAULT'}
          </button>
        </div>
      </header>

      {/* Source filter bar */}
      <section className="sticky top-[72px] z-40 bg-dark/90 backdrop-blur-md border-y border-white/10 px-6 py-4">
        <div className="flex flex-wrap gap-2">
          {sources.map(s => (
            <button
              key={s.id}
              onClick={() => { setCurrentSource(s.id); setFlippedId(null); }}
              className={`px-4 py-1.5 border border-white/20 font-mono text-[10px] uppercase tracking-widest transition-all ${
                currentSource === s.id ? 'bg-acid text-black border-acid' : 'hover:border-acid/50 text-white/70'
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
      </section>

      {/* Grid */}
      {filteredItems.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-32">
          <div className="font-anton text-4xl text-white/20 uppercase tracking-tighter mb-4">
            {currentSource === 'ALL' ? 'VAULT EMPTY' : '0 RECORDS FOUND'}
          </div>
          <p className="font-mono text-[10px] text-gray-600 uppercase tracking-widest">
            {currentSource === 'ALL' ? 'Add items from your favorites.' : 'No items of this type in the vault.'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-[2px] p-[2px] min-h-screen pb-20">
          {filteredItems.map(item => {
            const activeTab = item._itemType;
            let cardTitle = 'ASSET';
            let secondaryLabel = 'VOL';
            let bottomLabel = 'CATEGORY';

            if (activeTab === 'visual')    { cardTitle = item.category || 'ASSET'; secondaryLabel = item.volume || 'VOL'; bottomLabel = 'CATEGORY'; }
            if (activeTab === 'system')    { cardTitle = item.title || 'SYSTEM'; secondaryLabel = item.prompt_type || 'TYPE'; bottomLabel = 'IDENTIFIER'; }
            if (activeTab === 'community') { cardTitle = item.author || 'COMMUNITY'; secondaryLabel = item.is_featured ? 'FEATURED' : 'MEMBER'; bottomLabel = 'AUTHOR'; }
            if (activeTab === 'workflow')  { cardTitle = item.name || 'WORKFLOW'; secondaryLabel = 'ACCESS'; bottomLabel = 'TYPE'; }

            return (
              <Card
                key={`${item._itemType}-${item.id}`}
                item={item}
                cardTitle={cardTitle}
                secondaryLabel={secondaryLabel}
                bottomLabel={bottomLabel}
                itemType={item._itemType}
                initialIsLiked={true}
                onToggle={(id, type, newLiked) => {
                  if (!newLiked) handleRemoveFromVault(id, type);
                }}
                isFlipped={flippedId === `${item._itemType}-${item.id}`}
                onFlip={() => setFlippedId(
                  flippedId === `${item._itemType}-${item.id}` ? null : `${item._itemType}-${item.id}`
                )}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
