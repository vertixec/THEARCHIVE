'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabaseClient';
import { useAuth } from '@/components/AuthContext';
import { useSync } from '@/components/SyncContext';

interface MoodboardWithMosaic {
  id: string;
  name: string;
  created_at: string;
  mosaicImages: (string | null)[];
  itemCount: number;
}

interface Props {
  initialBoards: MoodboardWithMosaic[];
}

export default function MoodboardContent({ initialBoards }: Props) {
  const { setStatus } = useSync();
  const { user } = useAuth();

  const [boards, setBoards] = useState<MoodboardWithMosaic[]>(initialBoards);
  const [filter, setFilter] = useState<'ALL' | 'SELECTED'>('ALL');
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortOrder, setSortOrder] = useState<'LATEST' | 'OLDEST'>('LATEST');
  const [showSortMenu, setShowSortMenu] = useState(false);
  const [showNewInput, setShowNewInput] = useState(false);
  const [newName, setNewName] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  const newInputRef = useRef<HTMLInputElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { setStatus('ONLINE'); }, [setStatus]);

  useEffect(() => {
    if (showNewInput) newInputRef.current?.focus();
  }, [showNewInput]);

  useEffect(() => {
    if (renamingId) renameInputRef.current?.focus();
  }, [renamingId]);

  useEffect(() => {
    if (searchOpen) searchInputRef.current?.focus();
  }, [searchOpen]);

  // Close menus on outside click
  useEffect(() => {
    if (!openMenuId && !showSortMenu) return;
    const handler = () => { setOpenMenuId(null); setShowSortMenu(false); };
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, [openMenuId, showSortMenu]);

  const filteredBoards = boards
    .filter(b => filter === 'SELECTED' ? b.itemCount > 0 : true)
    .filter(b => !searchQuery || b.name.toLowerCase().includes(searchQuery.toLowerCase()))
    .sort((a, b) => {
      const tA = new Date(a.created_at).getTime();
      const tB = new Date(b.created_at).getTime();
      return sortOrder === 'LATEST' ? tB - tA : tA - tB;
    });

  async function handleCreate() {
    if (!newName.trim() || !user || isCreating) return;
    setIsCreating(true);

    const { data, error } = await supabase
      .from('boards')
      .insert({ user_id: user.id, name: newName.trim().toUpperCase() })
      .select()
      .single();

    if (!error && data) {
      setBoards(prev => [{ ...data, mosaicImages: [], itemCount: 0 }, ...prev]);
    }

    setNewName('');
    setShowNewInput(false);
    setIsCreating(false);
  }

  async function handleRename(boardId: string) {
    const trimmed = renameValue.trim().toUpperCase();
    if (!trimmed) { setRenamingId(null); return; }

    const { error } = await supabase
      .from('boards')
      .update({ name: trimmed })
      .eq('id', boardId);

    if (!error) {
      setBoards(prev => prev.map(b => b.id === boardId ? { ...b, name: trimmed } : b));
    }
    setRenamingId(null);
  }

  async function handleDelete(boardId: string) {
    setOpenMenuId(null);
    await supabase.from('board_items').delete().eq('board_id', boardId);
    const { error } = await supabase.from('boards').delete().eq('id', boardId);
    if (!error) {
      setBoards(prev => prev.filter(b => b.id !== boardId));
    }
  }

  return (
    <div id="view-content">
      {/* Header */}
      <header className="pt-12 pb-10 px-6 text-center">
        <h1 className="font-anton text-5xl md:text-7xl text-white uppercase tracking-tighter leading-[1.05] mb-4">
          Set the aesthetic.<br />Own the direction.
        </h1>
        <p className="font-mono text-xs text-acid mb-3">
          Stop describing. Start showing. A moodboard is the brief.
        </p>
        <p className="font-mono text-[10px] text-white/40 max-w-xl mx-auto leading-relaxed">
          Pull references from the archive, lock in a visual language, and define the look before a single generation starts.{' '}
          Focused boards create consistency. Open ones unlock new territory.
        </p>
      </header>

      {/* Controls Bar */}
      <div className="sticky top-[72px] z-40 bg-dark/95 backdrop-blur-md border-y border-white/10 px-6 py-3 flex items-center gap-3 flex-wrap">

        {/* All / Selected filter */}
        <button
          onClick={() => setFilter('ALL')}
          className={`font-mono text-[11px] uppercase tracking-widest transition-all ${
            filter === 'ALL' ? 'text-white' : 'text-white/40 hover:text-white/70'
          }`}
        >
          All
        </button>
        <button
          onClick={() => setFilter('SELECTED')}
          className={`font-mono text-[11px] uppercase tracking-widest transition-all ${
            filter === 'SELECTED' ? 'text-white' : 'text-white/40 hover:text-white/70'
          }`}
        >
          Selected
        </button>

        <div className="w-px h-4 bg-white/20" />

        {/* Sort dropdown */}
        <div className="relative">
          <button
            onClick={e => { e.stopPropagation(); setShowSortMenu(!showSortMenu); }}
            className="flex items-center gap-1.5 font-mono text-[11px] text-white/60 uppercase tracking-widest hover:text-white transition-all"
          >
            {sortOrder === 'LATEST' ? 'Latest' : 'Oldest'}
            <span className="text-[9px] text-white/40">▾</span>
          </button>
          {showSortMenu && (
            <div
              className="absolute top-full left-0 mt-2 bg-[#0d0d0d] border border-white/15 min-w-[110px] z-50 shadow-2xl"
              onClick={e => e.stopPropagation()}
            >
              {(['LATEST', 'OLDEST'] as const).map(s => (
                <button
                  key={s}
                  onClick={() => { setSortOrder(s); setShowSortMenu(false); }}
                  className={`w-full text-left px-4 py-2.5 font-mono text-[10px] uppercase tracking-widest transition-colors ${
                    sortOrder === s ? 'text-acid' : 'text-white/50 hover:text-white hover:bg-white/5'
                  }`}
                >
                  {s === 'LATEST' ? 'Latest' : 'Oldest'}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Search */}
        {searchOpen ? (
          <div className="flex items-center gap-1.5">
            <input
              ref={searchInputRef}
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              onKeyDown={e => { if (e.key === 'Escape') { setSearchOpen(false); setSearchQuery(''); } }}
              placeholder="SEARCH..."
              className="bg-transparent border-b border-white/30 focus:border-acid font-mono text-[10px] text-white uppercase tracking-widest outline-none w-32 pb-0.5 placeholder:text-white/20 transition-colors"
            />
            <button
              onClick={() => { setSearchOpen(false); setSearchQuery(''); }}
              className="text-white/30 hover:text-white transition-colors font-mono text-[10px]"
            >✕</button>
          </div>
        ) : (
          <button
            onClick={() => setSearchOpen(true)}
            className="text-white/40 hover:text-white transition-all"
            title="Search"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </button>
        )}

        {/* New Moodboard */}
        <div className="ml-auto flex items-center">
          {showNewInput ? (
            <div className="flex items-center gap-2">
              <input
                ref={newInputRef}
                value={newName}
                onChange={e => setNewName(e.target.value.toUpperCase())}
                onKeyDown={e => {
                  if (e.key === 'Enter') handleCreate();
                  if (e.key === 'Escape') { setShowNewInput(false); setNewName(''); }
                }}
                placeholder="MOODBOARD NAME..."
                maxLength={40}
                className="bg-black border border-acid px-3 py-1 font-mono text-[10px] text-acid uppercase tracking-widest outline-none w-44 placeholder:text-acid/30"
              />
              <button
                onClick={handleCreate}
                disabled={isCreating || !newName.trim()}
                className="px-3 py-1 bg-acid text-black font-mono text-[10px] uppercase tracking-widest disabled:opacity-40 hover:bg-acid/80 transition-colors"
              >
                {isCreating ? '...' : 'CREATE'}
              </button>
              <button
                onClick={() => { setShowNewInput(false); setNewName(''); }}
                className="font-mono text-[10px] text-white/40 hover:text-white px-1 transition-colors"
              >✕</button>
            </div>
          ) : (
            <button
              onClick={() => setShowNewInput(true)}
              className="flex items-center gap-2 border border-white/20 font-mono text-[10px] text-white/70 uppercase tracking-widest px-3 py-1.5 hover:border-acid/50 hover:text-white transition-all"
            >
              <span className="text-acid font-bold text-sm leading-none">⊕</span>
              New Moodboard
            </button>
          )}
        </div>
      </div>

      {/* Grid */}
      {filteredBoards.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-40">
          <div className="font-anton text-4xl text-white/20 uppercase tracking-tighter mb-3">
            {boards.length === 0 ? 'NO MOODBOARDS YET' : 'NONE FOUND'}
          </div>
          <p className="font-mono text-[10px] text-white/30 uppercase tracking-widest">
            {boards.length === 0 ? 'Create your first moodboard above.' : 'Try changing the filter.'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 p-6">
          {filteredBoards.map(board => (
            <div key={board.id} className="relative bg-panel border border-white/10 hover:border-white/20 transition-all duration-300 flex flex-col group">

              {/* Mosaic or empty state */}
              {board.itemCount === 0 ? (
                <Link href={`/moodboard/${board.id}`} className="aspect-[4/3] flex items-center justify-center border-b border-white/10 bg-white/[0.02] hover:bg-white/[0.04] transition-colors">
                  <span className="font-mono text-[9px] text-white/20 uppercase tracking-widest">
                    Add an image to get started
                  </span>
                </Link>
              ) : (
                <Link href={`/moodboard/${board.id}`} className="grid grid-cols-3 aspect-[4/3] border-b border-white/10 overflow-hidden">
                  {[0, 1, 2, 3, 4, 5].map(i => (
                    board.mosaicImages[i] ? (
                      <div key={i} className="overflow-hidden border-[0.5px] border-black">
                        <img
                          src={board.mosaicImages[i]!}
                          alt=""
                          className="w-full h-full object-cover transition-all duration-500 group-hover:brightness-110"
                        />
                      </div>
                    ) : (
                      <div key={i} className="bg-white/[0.03] border-[0.5px] border-black" />
                    )
                  ))}
                </Link>
              )}

              {/* Card footer */}
              <div className="px-3 py-2.5 flex items-center gap-2 min-h-[44px]">

                {/* Name or rename input */}
                {renamingId === board.id ? (
                  <input
                    ref={renameInputRef}
                    value={renameValue}
                    onChange={e => setRenameValue(e.target.value.toUpperCase())}
                    onKeyDown={e => {
                      if (e.key === 'Enter') handleRename(board.id);
                      if (e.key === 'Escape') setRenamingId(null);
                    }}
                    maxLength={40}
                    className="flex-1 bg-transparent border-b border-acid font-mono text-[10px] text-acid uppercase tracking-widest outline-none min-w-0 pb-0.5"
                  />
                ) : (
                  <span className="flex-1 font-mono text-[10px] text-white/70 uppercase tracking-widest truncate group-hover:text-white/90 transition-colors">
                    {board.name}
                  </span>
                )}

                {/* Context menu */}
                <div className="relative shrink-0">
                  <button
                    onClick={e => { e.stopPropagation(); setOpenMenuId(openMenuId === board.id ? null : board.id); }}
                    className="w-6 h-6 flex items-center justify-center text-white/30 hover:text-white transition-colors font-bold text-xs tracking-tighter"
                    title="Options"
                  >
                    •••
                  </button>
                  {openMenuId === board.id && (
                    <div
                      className="absolute bottom-full right-0 mb-1 bg-[#111] border border-white/20 min-w-[130px] z-50 shadow-2xl"
                      onClick={e => e.stopPropagation()}
                    >
                      <button
                        onClick={() => { setRenamingId(board.id); setRenameValue(board.name); setOpenMenuId(null); }}
                        className="w-full text-left px-4 py-2.5 font-mono text-[10px] text-white/60 hover:bg-white/5 hover:text-white uppercase tracking-widest flex items-center gap-2.5 transition-colors border-b border-white/5"
                      >
                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                        </svg>
                        Rename
                      </button>
                      <button
                        onClick={() => handleDelete(board.id)}
                        className="w-full text-left px-4 py-2.5 font-mono text-[10px] text-red-400/70 hover:bg-red-500/10 hover:text-red-400 uppercase tracking-widest flex items-center gap-2.5 transition-colors"
                      >
                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                        Delete
                      </button>
                    </div>
                  )}
                </div>

                {/* Add Images button */}
                <Link
                  href={`/visuals?moodboardId=${board.id}&moodboardName=${encodeURIComponent(board.name)}`}
                  className="shrink-0 bg-white/10 hover:bg-acid hover:text-black text-white/60 font-mono text-[9px] uppercase tracking-widest px-2.5 py-1.5 transition-all duration-200 whitespace-nowrap"
                >
                  Add Images
                </Link>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
