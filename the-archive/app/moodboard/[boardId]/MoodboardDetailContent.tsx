'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';
import { useSync } from '@/components/SyncContext';
import { useToast } from '@/components/Toast';

// ── Export helpers ──────────────────────────────────────────────────────────

async function loadImageForCanvas(src: string): Promise<{ img: HTMLImageElement; blobUrl: string } | null> {
  try {
    const resp = await fetch(src, { mode: 'cors' });
    if (!resp.ok) return null;
    const blob = await resp.blob();
    const blobUrl = URL.createObjectURL(blob);
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve({ img, blobUrl });
      img.onerror = () => { URL.revokeObjectURL(blobUrl); resolve(null); };
      img.src = blobUrl;
    });
  } catch {
    return null;
  }
}

function drawCornerMarker(
  ctx: CanvasRenderingContext2D,
  x: number, y: number,
  corner: 'tl' | 'tr' | 'bl' | 'br',
  size: number, thickness: number, color: string
) {
  ctx.fillStyle = color;
  const s = size, t = thickness;
  if (corner === 'tl') { ctx.fillRect(x, y, s, t); ctx.fillRect(x, y, t, s); }
  if (corner === 'tr') { ctx.fillRect(x - s, y, s, t); ctx.fillRect(x - t, y, t, s); }
  if (corner === 'bl') { ctx.fillRect(x, y - t, s, t); ctx.fillRect(x, y - s, t, s); }
  if (corner === 'br') { ctx.fillRect(x - s, y - t, s, t); ctx.fillRect(x - t, y - s, t, s); }
}

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
  const [isExporting, setIsExporting] = useState(false);
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

  async function handleExport() {
    const imagesToExport = imageItems; // all images, no limit
    if (!imagesToExport.length) { showToast('No images to export'); return; }
    setIsExporting(true);

    try {
      const CANVAS_W = 2400;
      const COLS = 4;
      const GAP = 3;
      const COL_W = Math.floor((CANVAS_W - GAP * (COLS - 1)) / COLS);
      const BASE_ROW_H = 330;
      const TITLE_ZONE = 340;
      const ACCENT = '#C8FF00';
      const INSET = 28;
      const PAD = 52;

      // ── Load images first ────────────────────────────────────────────────
      const loadResults = await Promise.all(
        imagesToExport.map(item => loadImageForCanvas(item.image_url!))
      );

      // ── Pre-calculate masonry layout to know total height ────────────────
      const colHeights = new Array(COLS).fill(0);
      const placements: { x: number; y: number; w: number; h: number }[] = [];

      for (let i = 0; i < imagesToExport.length; i++) {
        const isTall = getItemSpan(i) === 'tall';
        const cellH = isTall ? BASE_ROW_H * 2 + GAP : BASE_ROW_H;
        const minH = Math.min(...colHeights);
        const col = colHeights.indexOf(minH);
        const x = col * (COL_W + GAP);
        const y = minH + (minH > 0 ? GAP : 0);
        placements.push({ x, y, w: COL_W, h: cellH });
        colHeights[col] = y + cellH;
      }

      const gridH = Math.max(...colHeights);
      const CANVAS_H = gridH + TITLE_ZONE;

      // ── Create canvas ────────────────────────────────────────────────────
      const canvas = document.createElement('canvas');
      canvas.width = CANVAS_W;
      canvas.height = CANVAS_H;
      const ctx = canvas.getContext('2d')!;

      // ── Background ──────────────────────────────────────────────────────
      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

      // ── Draw images ──────────────────────────────────────────────────────
      const blobUrls: string[] = [];

      for (let i = 0; i < imagesToExport.length; i++) {
        const result = loadResults[i];
        const { x, y, w, h } = placements[i];

        if (result) {
          blobUrls.push(result.blobUrl);
          const { img } = result;
          const srcAR = img.naturalWidth / img.naturalHeight;
          const dstAR = w / h;
          let sx = 0, sy = 0, sw = img.naturalWidth, sh = img.naturalHeight;
          if (srcAR > dstAR) { sw = sh * dstAR; sx = (img.naturalWidth - sw) / 2; }
          else { sh = sw / dstAR; sy = (img.naturalHeight - sh) / 2; }
          ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h);
        } else {
          ctx.fillStyle = '#0d0d0d';
          ctx.fillRect(x, y, w, h);
          ctx.strokeStyle = 'rgba(255,255,255,0.05)';
          ctx.lineWidth = 1;
          ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
        }
      }

      // ── Cinematic gradient (bottom of grid into title zone) ───────────────
      const gradStart = Math.max(gridH - 400, gridH * 0.65);
      const grad = ctx.createLinearGradient(0, gradStart, 0, CANVAS_H);
      grad.addColorStop(0, 'rgba(0,0,0,0)');
      grad.addColorStop(0.4, 'rgba(0,0,0,0.75)');
      grad.addColorStop(1, 'rgba(0,0,0,0.98)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, gradStart, CANVAS_W, CANVAS_H - gradStart);

      // ── Title zone solid fill (below grid) ────────────────────────────────
      ctx.fillStyle = '#000000';
      ctx.fillRect(0, gridH, CANVAS_W, TITLE_ZONE);

      // ── Top vignette ─────────────────────────────────────────────────────
      const topGrad = ctx.createLinearGradient(0, 0, 0, 200);
      topGrad.addColorStop(0, 'rgba(0,0,0,0.55)');
      topGrad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = topGrad;
      ctx.fillRect(0, 0, CANVAS_W, 200);

      // ── Scanlines ────────────────────────────────────────────────────────
      ctx.fillStyle = 'rgba(0,0,0,0.10)';
      for (let scanY = 0; scanY < CANVAS_H; scanY += 2) ctx.fillRect(0, scanY, CANVAS_W, 1);

      // ── Corner markers (tight to edges) ──────────────────────────────────
      drawCornerMarker(ctx, INSET, INSET, 'tl', 50, 3, ACCENT);
      drawCornerMarker(ctx, CANVAS_W - INSET, INSET, 'tr', 50, 3, ACCENT);
      drawCornerMarker(ctx, INSET, CANVAS_H - INSET, 'bl', 50, 3, ACCENT);
      drawCornerMarker(ctx, CANVAS_W - INSET, CANVAS_H - INSET, 'br', 50, 3, ACCENT);

      // ── Wait for fonts ───────────────────────────────────────────────────
      await document.fonts.ready;

      // ── Top-right: date ──────────────────────────────────────────────────
      const now = new Date();
      const dateStr = `${String(now.getMonth() + 1).padStart(2, '0')}.${String(now.getDate()).padStart(2, '0')}.${String(now.getFullYear()).slice(2)}`;
      ctx.font = '22px "Space Mono", monospace';
      ctx.fillStyle = 'rgba(200,255,0,0.55)';
      ctx.textAlign = 'right';
      ctx.textBaseline = 'top';
      ctx.fillText(dateStr, CANVAS_W - PAD, PAD);

      // ── Accent line above board name ─────────────────────────────────────
      ctx.fillStyle = ACCENT;
      ctx.fillRect(PAD, CANVAS_H - 280, 72, 3);

      // ── Board name (adaptive font size) ──────────────────────────────────
      const MAX_NAME_W = CANVAS_W - PAD * 2;
      let fontSize = 240;
      ctx.font = `bold ${fontSize}px "Bebas Neue", "Impact", sans-serif`;
      while (ctx.measureText(board.name.toUpperCase()).width > MAX_NAME_W && fontSize > 80) {
        fontSize -= 8;
        ctx.font = `bold ${fontSize}px "Bebas Neue", "Impact", sans-serif`;
      }
      ctx.fillStyle = '#FFFFFF';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
      // anchor everything to the top of the corner's horizontal bar
      const cornerInnerTop = CANVAS_H - INSET - 3;
      const labelBottom = cornerInnerTop - 16;   // 16px gap above corner line
      const nameBottom  = labelBottom - 80;       // breathing room above label

      ctx.fillText(board.name.toUpperCase(), PAD, nameBottom);

      // ── Bottom-left: MOODBOARD label ──────────────────────────────────────
      ctx.font = '22px "Space Mono", monospace';
      ctx.fillStyle = 'rgba(200,255,0,0.65)';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'bottom';
      ctx.fillText('MOODBOARD', PAD, labelBottom);

      // ── Image count (bottom right) ────────────────────────────────────────
      ctx.fillStyle = 'rgba(255,255,255,0.2)';
      ctx.textAlign = 'right';
      ctx.fillText(`${imageItems.length} IMAGES`, CANVAS_W - PAD, labelBottom);

      // ── Download ─────────────────────────────────────────────────────────
      canvas.toBlob((blob) => {
        if (!blob) return;
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${board.name.toLowerCase().replace(/\s+/g, '-')}-moodboard.png`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }, 'image/png');

      blobUrls.forEach(u => URL.revokeObjectURL(u));
      showToast('Moodboard exported');
    } catch (err) {
      console.error('Export error:', err);
      showToast('Export failed — try again');
    } finally {
      setIsExporting(false);
    }
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

        <div className="ml-auto flex items-center gap-3">

          {/* Export button */}
          <button
            onClick={handleExport}
            disabled={isExporting || imageItems.length === 0}
            className="flex items-center gap-1.5 font-mono text-[10px] text-acid/40 hover:text-acid uppercase tracking-widest transition-colors disabled:opacity-25 disabled:cursor-not-allowed"
            title="Export as PNG"
          >
            {isExporting ? (
              <>
                <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                <span>Exporting</span>
              </>
            ) : (
              <>
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
                </svg>
                <span>Export PNG</span>
              </>
            )}
          </button>

          <div className="w-px h-4 bg-white/10" />

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
          className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 md:p-8"
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
