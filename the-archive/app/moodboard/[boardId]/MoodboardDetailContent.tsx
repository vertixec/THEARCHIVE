'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';
import { useSync } from '@/components/SyncContext';

interface Board {
  id: string;
  name: string;
  created_at: string;
}

interface BoardItem {
  id: string;
  board_id: string;
  item_id: string;
  item_type: string;
  image_url: string | null;
  created_at: string;
}

interface Props {
  board: Board;
  items: BoardItem[];
}

// Deterministic span pattern for cinematic masonry feel
function getItemSpan(index: number): 'tall' | 'normal' {
  const pattern = [true, false, false, false, true, false, false, true, false, false, false, false];
  return pattern[index % pattern.length] ? 'tall' : 'normal';
}

export default function MoodboardDetailContent({ board, items: initialItems }: Props) {
  const { setStatus } = useSync();
  const router = useRouter();
  const [items, setItems] = useState<BoardItem[]>(initialItems);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [lightboxImg, setLightboxImg] = useState<string | null>(null);

  useEffect(() => { setStatus('ONLINE'); }, [setStatus]);

  // Close lightbox on Escape
  useEffect(() => {
    if (!lightboxImg) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') setLightboxImg(null); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [lightboxImg]);

  const imageItems = items.filter(i => i.image_url);
  const nonImageItems = items.filter(i => !i.image_url);

  async function handleRemove(itemId: string, itemType: string, boardItemId: string) {
    setRemovingId(boardItemId);
    const { error } = await supabase
      .from('board_items')
      .delete()
      .eq('id', boardItemId);

    if (!error) {
      setItems(prev => prev.filter(i => i.id !== boardItemId));
    }
    setRemovingId(null);
  }

  async function handleDeleteBoard() {
    if (!confirm(`Delete moodboard "${board.name}"?\n\nThis cannot be undone.`)) return;
    setIsDeleting(true);
    await supabase.from('board_items').delete().eq('board_id', board.id);
    const { error } = await supabase.from('boards').delete().eq('id', board.id);
    if (!error) router.push('/moodboard');
    else setIsDeleting(false);
  }

  return (
    <div id="view-content" className="min-h-screen">

      {/* Top bar */}
      <div className="sticky top-[72px] z-40 bg-black/95 backdrop-blur-md border-b border-white/10 px-4 md:px-8 py-3 flex items-center gap-4">
        <Link
          href="/moodboard"
          className="flex items-center gap-1.5 font-mono text-[10px] text-white/40 hover:text-white transition-colors uppercase tracking-widest"
        >
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
          Back
        </Link>

        <div className="w-px h-4 bg-white/15" />

        <span className="font-mono text-[10px] text-white/30 uppercase tracking-widest">
          {items.length} {items.length === 1 ? 'item' : 'items'}
        </span>

        <div className="ml-auto flex items-center gap-3">
          <Link
            href={`/visuals?moodboardId=${board.id}&moodboardName=${encodeURIComponent(board.name)}`}
            className="flex items-center gap-2 border border-white/20 hover:border-acid/50 hover:text-white text-white/60 font-mono text-[10px] uppercase tracking-widest px-3 py-1.5 transition-all"
          >
            <span className="text-acid font-bold text-sm leading-none">⊕</span>
            Add Images
          </Link>

          <button
            onClick={handleDeleteBoard}
            disabled={isDeleting}
            className="font-mono text-[10px] text-red-500/30 hover:text-red-500/70 uppercase tracking-widest transition-colors disabled:opacity-30 px-1"
            title="Delete moodboard"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>
        </div>
      </div>

      {/* Hero title */}
      <header className="pt-12 pb-10 px-4 text-center">
        <h1 className="font-anton text-5xl sm:text-7xl md:text-[10rem] text-white uppercase tracking-tighter leading-[0.85]">
          {board.name}
        </h1>
      </header>

      {/* Empty state */}
      {items.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-32 px-4">
          <div className="w-16 h-16 border border-white/10 flex items-center justify-center mb-6">
            <svg className="w-7 h-7 text-white/20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3 18h12M13.5 3.75H6.75A2.25 2.25 0 004.5 6v12" />
            </svg>
          </div>
          <div className="font-anton text-3xl text-white/20 uppercase tracking-tighter mb-3">
            Board is empty
          </div>
          <p className="font-mono text-[10px] text-white/30 uppercase tracking-widest mb-8">
            Pull references from the archive to define your visual language.
          </p>
          <Link
            href={`/visuals?moodboardId=${board.id}&moodboardName=${encodeURIComponent(board.name)}`}
            className="flex items-center gap-2 bg-acid text-black font-mono text-[10px] uppercase tracking-widest px-5 py-2.5 hover:bg-acid/80 transition-colors"
          >
            <span className="font-bold text-sm leading-none">⊕</span>
            Browse Visuals Archive
          </Link>
        </div>
      ) : (
        <>
          {/* Cinematic image grid */}
          {imageItems.length > 0 && (
            <div
              className="px-1 md:px-2 pb-2"
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
                gridAutoRows: '200px',
                gap: '3px',
              }}
            >
              {imageItems.map((item, index) => {
                const span = getItemSpan(index);
                return (
                  <div
                    key={item.id}
                    className="relative group overflow-hidden bg-white/[0.02] cursor-pointer"
                    style={{ gridRow: span === 'tall' ? 'span 2' : 'span 1' }}
                    onClick={() => setLightboxImg(item.image_url!)}
                  >
                    <img
                      src={item.image_url!}
                      alt=""
                      className="w-full h-full object-cover transition-all duration-700 grayscale brightness-75 contrast-110 group-hover:grayscale-0 group-hover:brightness-100 group-hover:scale-105"
                    />

                    {/* Dark overlay */}
                    <div className="absolute inset-0 bg-black/20 group-hover:bg-black/0 transition-all duration-500" />

                    {/* Remove button */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleRemove(item.item_id, item.item_type, item.id);
                      }}
                      disabled={removingId === item.id}
                      className="absolute top-2 right-2 z-10 w-7 h-7 bg-black/80 backdrop-blur-sm border border-white/20 flex items-center justify-center text-white/50 hover:text-red-400 hover:border-red-400/40 transition-all opacity-0 group-hover:opacity-100 disabled:opacity-30"
                      title="Remove from board"
                    >
                      {removingId === item.id ? (
                        <span className="font-mono text-[8px]">...</span>
                      ) : (
                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      )}
                    </button>

                    {/* Item type badge */}
                    <div className="absolute bottom-2 left-2 opacity-0 group-hover:opacity-100 transition-all duration-300">
                      <span className="font-mono text-[8px] uppercase tracking-widest bg-black/80 backdrop-blur-sm text-white/60 px-1.5 py-0.5 border border-white/10">
                        {item.item_type}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Non-image items (systems, workflows, etc.) */}
          {nonImageItems.length > 0 && (
            <div className="px-4 md:px-8 pt-8 pb-12">
              <div className="border-t border-white/10 pt-6 mb-4">
                <span className="font-mono text-[10px] text-white/30 uppercase tracking-widest">
                  {nonImageItems.length} non-visual item{nonImageItems.length !== 1 ? 's' : ''}
                </span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                {nonImageItems.map(item => (
                  <div
                    key={item.id}
                    className="group relative border border-white/10 hover:border-white/20 bg-white/[0.02] p-4 flex items-center justify-between transition-all"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-1.5 h-1.5 rounded-full bg-acid/60" />
                      <span className="font-mono text-[10px] text-white/50 uppercase tracking-widest">
                        {item.item_type} — {item.item_id.slice(0, 8)}
                      </span>
                    </div>
                    <button
                      onClick={() => handleRemove(item.item_id, item.item_type, item.id)}
                      disabled={removingId === item.id}
                      className="opacity-0 group-hover:opacity-100 text-white/30 hover:text-red-400 transition-all disabled:opacity-30"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {/* Lightbox */}
      {lightboxImg && (
        <div
          className="fixed inset-0 z-[100] bg-black/95 backdrop-blur-xl flex items-center justify-center p-4 md:p-8"
          onClick={() => setLightboxImg(null)}
        >
          <button
            className="absolute top-4 right-4 w-10 h-10 flex items-center justify-center text-white/50 hover:text-white border border-white/20 hover:border-white/40 transition-all font-mono text-lg"
            onClick={() => setLightboxImg(null)}
          >
            ✕
          </button>
          <img
            src={lightboxImg}
            alt=""
            className="max-w-full max-h-full object-contain"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  );
}
