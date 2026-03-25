'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';
import { useSync } from '@/components/SyncContext';
import { useToast } from '@/components/Toast';

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

function getItemSpan(index: number): 'tall' | 'normal' {
  const pattern = [true, false, false, false, true, false, false, true, false, false, false, false];
  return pattern[index % pattern.length] ? 'tall' : 'normal';
}

export default function MoodboardDetailContent({ board, items: initialItems }: Props) {
  const { setStatus } = useSync();
  const { showToast } = useToast();
  const router = useRouter();
  const [items, setItems] = useState<BoardItem[]>(initialItems);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [lightboxImg, setLightboxImg] = useState<string | null>(null);
  // Upload state
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Link modal state
  const [showLinkModal, setShowLinkModal] = useState(false);
  const [linkUrl, setLinkUrl] = useState('');
  const [isAddingLink, setIsAddingLink] = useState(false);
  const [linkError, setLinkError] = useState('');

  useEffect(() => { setStatus('ONLINE'); }, [setStatus]);

  // Close lightbox on Escape
  useEffect(() => {
    if (!lightboxImg) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') setLightboxImg(null); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [lightboxImg]);

  // Close link modal on Escape
  useEffect(() => {
    if (!showLinkModal) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setShowLinkModal(false); setLinkUrl(''); setLinkError(''); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [showLinkModal]);

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
      // Clean up storage for uploaded files
      if (itemType === 'upload') {
        await supabase.storage.from('moodboard-uploads').remove([itemId]);
      }
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

  async function handleUploadFiles(files: FileList) {
    if (!files.length) return;

    const MAX_FILES = 10;
    if (files.length > MAX_FILES) {
      showToast(`MAX ${MAX_FILES} FILES AT ONCE`);
      return;
    }

    // Get user at call time — never rely on async state
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    setIsUploading(true);
    const newItems: BoardItem[] = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      setUploadProgress(`${i + 1} / ${files.length}`);

      if (!file.type.startsWith('image/')) continue;
      if (file.size > 15 * 1024 * 1024) continue; // 15MB limit

      const ext = file.name.split('.').pop() ?? 'jpg';
      const fileName = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
      const storagePath = `${user.id}/${board.id}/${fileName}`;

      const { data: uploadData, error: uploadError } = await supabase.storage
        .from('moodboard-uploads')
        .upload(storagePath, file, { cacheControl: '3600' });

      if (uploadError || !uploadData) {
        console.error('Storage upload error:', uploadError);
        continue;
      }

      const { data: { publicUrl } } = supabase.storage
        .from('moodboard-uploads')
        .getPublicUrl(storagePath);

      const newId = crypto.randomUUID();
      const { error: insertError } = await supabase
        .from('board_items')
        .insert({
          id: newId,
          board_id: board.id,
          item_id: storagePath,
          item_type: 'upload',
          image_url: publicUrl,
        });

      if (insertError) {
        console.error('DB insert error:', insertError);
        continue;
      }

      newItems.push({
        id: newId,
        board_id: board.id,
        item_id: storagePath,
        item_type: 'upload',
        image_url: publicUrl,
        created_at: new Date().toISOString(),
      });
    }

    setItems(prev => [...newItems, ...prev]);
    setIsUploading(false);
    setUploadProgress('');
    if (fileInputRef.current) fileInputRef.current.value = '';

    if (newItems.length > 0) {
      showToast(`${newItems.length} image${newItems.length > 1 ? 's' : ''} added`);
      router.refresh();
    } else {
      showToast('Upload failed — try again');
    }
  }

  async function handleAddFromLink() {
    const url = linkUrl.trim();
    if (!url) return;

    setLinkError('');

    try {
      const parsed = new URL(url);
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        setLinkError('Only http and https URLs are allowed.');
        return;
      }
    } catch {
      setLinkError('Please enter a valid URL.');
      return;
    }

    setIsAddingLink(true);

    const newId = crypto.randomUUID();
    const itemId = crypto.randomUUID();

    const { error } = await supabase
      .from('board_items')
      .insert({
        id: newId,
        board_id: board.id,
        item_id: itemId,
        item_type: 'link',
        image_url: url,
      });

    if (error) {
      console.error('Link insert error:', error);
      setLinkError(error.message);
      setIsAddingLink(false);
      return;
    }

    setItems(prev => [{
      id: newId,
      board_id: board.id,
      item_id: itemId,
      item_type: 'link',
      image_url: url,
      created_at: new Date().toISOString(),
    }, ...prev]);
    setLinkUrl('');
    setShowLinkModal(false);
    setIsAddingLink(false);
    showToast('Image added from link');
    router.refresh();
  }

  return (
    <div id="view-content" className="min-h-screen">

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => e.target.files && handleUploadFiles(e.target.files)}
      />

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

        <div className="ml-auto">
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

      {/* Action cards */}
      <div className="px-4 md:px-8 pb-10 grid grid-cols-1 sm:grid-cols-3 gap-3 max-w-3xl mx-auto">

        {/* Upload Images */}
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={isUploading}
          className="group flex flex-col gap-2 bg-white/[0.03] border border-white/10 hover:border-white/25 hover:bg-white/[0.06] p-4 text-left transition-all disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <div className="flex items-center gap-2">
            <svg className="w-4 h-4 text-acid/60 group-hover:text-acid transition-colors flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
            </svg>
            <span className="font-mono text-[11px] text-white/70 group-hover:text-white uppercase tracking-widest transition-colors">
              {isUploading ? `Uploading ${uploadProgress}` : 'Upload Images'}
            </span>
          </div>
          <p className="font-mono text-[9px] text-white/25 leading-relaxed">
            Upload images from your computer to add to your moodboard.
          </p>
        </button>

        {/* Add from Link */}
        <button
          onClick={() => setShowLinkModal(true)}
          className="group flex flex-col gap-2 bg-white/[0.03] border border-white/10 hover:border-white/25 hover:bg-white/[0.06] p-4 text-left transition-all"
        >
          <div className="flex items-center gap-2">
            <svg className="w-4 h-4 text-acid/60 group-hover:text-acid transition-colors flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m13.35-.622l1.757-1.757a4.5 4.5 0 00-6.364-6.364l-4.5 4.5a4.5 4.5 0 001.242 7.244" />
            </svg>
            <span className="font-mono text-[11px] text-white/70 group-hover:text-white uppercase tracking-widest transition-colors">
              Add from Link
            </span>
          </div>
          <p className="font-mono text-[9px] text-white/25 leading-relaxed">
            Add images from around the web to your moodboard.
          </p>
        </button>

        {/* From Archive */}
        <Link
          href={`/visuals?moodboardId=${board.id}&moodboardName=${encodeURIComponent(board.name)}`}
          className="group flex flex-col gap-2 bg-white/[0.03] border border-white/10 hover:border-white/25 hover:bg-white/[0.06] p-4 text-left transition-all"
        >
          <div className="flex items-center gap-2">
            <svg className="w-4 h-4 text-acid/60 group-hover:text-acid transition-colors flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3 18h12M13.5 3.75H6.75A2.25 2.25 0 004.5 6v12" />
            </svg>
            <span className="font-mono text-[11px] text-white/70 group-hover:text-white uppercase tracking-widest transition-colors">
              Add from Archive
            </span>
          </div>
          <p className="font-mono text-[9px] text-white/25 leading-relaxed">
            Select images from the visuals archive to add to your moodboard.
          </p>
        </Link>

      </div>

      {/* Empty state */}
      {items.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 px-4">
          <div className="w-16 h-16 border border-white/10 flex items-center justify-center mb-6">
            <svg className="w-7 h-7 text-white/20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3 18h12M13.5 3.75H6.75A2.25 2.25 0 004.5 6v12" />
            </svg>
          </div>
          <div className="font-anton text-3xl text-white/20 uppercase tracking-tighter mb-3">
            Board is empty
          </div>
          <p className="font-mono text-[10px] text-white/25 uppercase tracking-widest">
            Use the options above to start building your visual language.
          </p>
        </div>
      )}

      {/* Image grid */}
      {items.length > 0 && (
        <>
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

          {/* Non-image items */}
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

      {/* Add from Link modal */}
      {showLinkModal && (
        <div
          className="fixed inset-0 z-[100] bg-black/90 backdrop-blur-md flex items-center justify-center p-4"
          onClick={() => { setShowLinkModal(false); setLinkUrl(''); setLinkError(''); }}
        >
          <div
            className="bg-black border border-white/15 p-6 w-full max-w-md"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="font-anton text-2xl text-white uppercase tracking-tighter mb-1">
              Add from Link
            </h3>
            <p className="font-mono text-[9px] text-white/30 uppercase tracking-widest mb-5">
              Paste an image URL to add it to your board
            </p>

            <input
              type="url"
              value={linkUrl}
              onChange={(e) => { setLinkUrl(e.target.value); setLinkError(''); }}
              placeholder="https://example.com/image.jpg"
              className="w-full bg-white/[0.04] border border-white/15 text-white font-mono text-xs px-3 py-2.5 focus:outline-none focus:border-acid/40 placeholder:text-white/20"
              onKeyDown={(e) => e.key === 'Enter' && handleAddFromLink()}
              autoFocus
            />

            {linkError && (
              <p className="font-mono text-[9px] text-red-400/70 mt-2">{linkError}</p>
            )}

            <div className="flex gap-2 justify-end mt-5">
              <button
                onClick={() => { setShowLinkModal(false); setLinkUrl(''); setLinkError(''); }}
                className="font-mono text-[10px] text-white/40 hover:text-white uppercase tracking-widest px-4 py-2 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleAddFromLink}
                disabled={!linkUrl.trim() || isAddingLink}
                className="font-mono text-[10px] bg-acid text-black uppercase tracking-widest px-4 py-2 hover:bg-acid/80 transition-colors disabled:opacity-40"
              >
                {isAddingLink ? 'Adding...' : 'Add to Board'}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
