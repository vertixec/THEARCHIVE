'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Card from './Card';
import { supabase } from '@/lib/supabaseClient';
import { useAuth } from './AuthContext';
import { useGenerate } from './GenerateContext';
import type { AnyItem, ItemType } from '@/lib/types';
import type { SortMode } from './Filters';

interface InfiniteVisualViewProps {
  items: AnyItem[];
  activeTab?: 'main' | 'systems';
  filter: string;
  searchQuery: string;
  sortMode?: SortMode;
  highlightedId?: string;
  onClearHighlight?: () => void;
  selectionMode?: boolean;
  selectedIds?: Set<string>;
  onSelectItem?: (id: string, imageUrl: string | null) => void;
  onExit?: () => void;
  hasMore?: boolean;
  isLoadingMore?: boolean;
  onLoadMore?: () => Promise<void>;
}

type Point = { x: number; y: number };

const TILE_WIDTH = 210;
const TILE_HEIGHT = 280;
const CELL_WIDTH = 290;
const CELL_HEIGHT = 370;
const MIN_SCALE = 0.35;
const MAX_SCALE = 1.8;
const DRAG_FRICTION = 0.94;
const MIN_VELOCITY = 0.12;
const IDLE_CONTROLS_DELAY = 2800;

function seededOffset(index: number, range: number) {
  const value = Math.sin(index * 999.91) * 10000;
  return (value - Math.floor(value) - 0.5) * range;
}

function seededScale(index: number) {
  return 0.88 + Math.abs(seededOffset(index + 31, 0.34));
}

export default function InfiniteVisualView({
  items,
  activeTab = 'main',
  filter,
  searchQuery,
  sortMode = 'newest',
  highlightedId,
  onClearHighlight,
  selectionMode,
  selectedIds,
  onSelectItem,
  onExit,
  hasMore = false,
  isLoadingMore = false,
  onLoadMore,
}: InfiniteVisualViewProps) {
  const { user } = useAuth();
  const { isOpen: isStudioOpen, openPanel, closePanel, setPanelLayout, setPanelMode } = useGenerate();
  const itemType: ItemType = activeTab === 'systems' ? 'system' : 'visual';
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const dragStartRef = useRef<Point | null>(null);
  const transformStartRef = useRef<Point>({ x: 0, y: 0 });
  const didDragRef = useRef(false);
  const activePointerIdRef = useRef<number | null>(null);
  const lastPointerRef = useRef<{ x: number; y: number; time: number } | null>(null);
  const velocityRef = useRef<Point>({ x: 0, y: 0 });
  const inertiaFrameRef = useRef<number | null>(null);
  const controlsTimerRef = useRef<number | null>(null);
  const glideTimerRef = useRef<number | null>(null);
  const assetClickTimerRef = useRef<number | null>(null);
  const hasPositionedCanvasRef = useRef(false);
  const detailIdRef = useRef<string | null>(null);
  const onExitRef = useRef(onExit);
  const loadAttemptedAtItemCountRef = useRef<number | null>(null);
  const [likedIds, setLikedIds] = useState<Set<string>>(new Set());
  const [likeCounts, setLikeCounts] = useState<Map<string, number>>(new Map());
  const [flippedId, setFlippedId] = useState<string | null>(null);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [showControls, setShowControls] = useState(true);
  const [showIntro, setShowIntro] = useState(true);
  const [isDragging, setIsDragging] = useState(false);
  const [isGliding, setIsGliding] = useState(false);
  const [transform, setTransform] = useState({ x: 0, y: 0, scale: 0.68 });
  const transformRef = useRef(transform);

  useEffect(() => {
    detailIdRef.current = detailId;
  }, [detailId]);

  useEffect(() => {
    onExitRef.current = onExit;
  }, [onExit]);

  useEffect(() => {
    if (!hasMore || isLoadingMore || !onLoadMore) return;
    if (loadAttemptedAtItemCountRef.current === items.length) return;

    const timer = window.setTimeout(() => {
      loadAttemptedAtItemCountRef.current = items.length;
      void onLoadMore();
    }, 700);

    return () => window.clearTimeout(timer);
  }, [hasMore, isLoadingMore, items.length, onLoadMore]);

  const updateTransform = useCallback((next: typeof transform | ((current: typeof transform) => typeof transform)) => {
    setTransform(current => {
      const resolved = typeof next === 'function' ? next(current) : next;
      transformRef.current = resolved;
      return resolved;
    });
  }, []);

  const stopInertia = useCallback(() => {
    if (inertiaFrameRef.current !== null) {
      window.cancelAnimationFrame(inertiaFrameRef.current);
      inertiaFrameRef.current = null;
    }
  }, []);

  const resetCanvasDrag = useCallback(() => {
    const viewport = viewportRef.current;
    if (
      viewport &&
      activePointerIdRef.current !== null &&
      viewport.hasPointerCapture(activePointerIdRef.current)
    ) {
      viewport.releasePointerCapture(activePointerIdRef.current);
    }

    dragStartRef.current = null;
    activePointerIdRef.current = null;
    lastPointerRef.current = null;
    velocityRef.current = { x: 0, y: 0 };
    didDragRef.current = false;
    setIsDragging(false);
    stopInertia();
  }, [stopInertia]);

  const filteredItems = useMemo(() => {
    const query = searchQuery.toLowerCase();
    const typeField = activeTab === 'systems' ? 'prompt_type' : 'volume';
    const filtered = items.filter(item => {
      const itemTypeValue = (item[typeField] || 'GENERAL').toString().trim().toUpperCase();
      const matchesType = filter === 'ALL' || itemTypeValue === filter;
      const searchStr = (
        (item.prompt_text || '') +
        (item.title || '') +
        (item.model || '') +
        (item.category || '') +
        (item.volume || '') +
        (item.prompt_type || '')
      ).toLowerCase();

      return matchesType && (!query || searchStr.includes(query));
    });

    return filtered.sort((a, b) => {
      if (sortMode === 'popular') {
        const likesDelta = (likeCounts.get(b.id.toString()) ?? 0) - (likeCounts.get(a.id.toString()) ?? 0);
        if (likesDelta !== 0) return likesDelta;
      }

      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });
  }, [items, activeTab, filter, searchQuery, sortMode, likeCounts]);

  const columns = 8;
  const rows = Math.max(3, Math.ceil(filteredItems.length / columns));
  const canvasWidth = columns * (CELL_WIDTH + 90) + TILE_WIDTH;
  const canvasHeight = rows * (CELL_HEIGHT + 80) + TILE_HEIGHT;

  const positions = useMemo(() => {
    const itemOrder = new Map(items.map((item, index) => [item.id.toString(), index]));
    return new Map(
      filteredItems.map((item) => {
        const index = itemOrder.get(item.id.toString()) ?? 0;
        const column = index % columns;
        const row = Math.floor(index / columns);
        const rowDrift = row % 2 === 0 ? 0 : CELL_WIDTH * 0.42;
        const x = column * (CELL_WIDTH + 90) + rowDrift + seededOffset(index + 1, 110);
        const y = row * (CELL_HEIGHT + 80) + seededOffset(index + 7, 130);
        return [item.id.toString(), { x: Math.max(24, x), y: Math.max(24, y) }];
      })
    );
  }, [filteredItems, items]);

  const fitCanvas = useCallback((scale = 0.68) => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    updateTransform({
      x: viewport.clientWidth / 2 - (canvasWidth * scale) / 2,
      y: viewport.clientHeight / 2 - (canvasHeight * scale) / 2,
      scale,
    });
  }, [canvasHeight, canvasWidth, updateTransform]);

  useEffect(() => {
    if (hasPositionedCanvasRef.current || filteredItems.length === 0) return;
    hasPositionedCanvasRef.current = true;
    fitCanvas();
  }, [filteredItems.length, fitCanvas]);

  const focusItem = useCallback((itemId: string, scale = 1.08) => {
    const position = positions.get(itemId);
    const viewport = viewportRef.current;
    if (!position || !viewport) return;

    stopInertia();
    setIsGliding(true);
    if (glideTimerRef.current !== null) window.clearTimeout(glideTimerRef.current);
    glideTimerRef.current = window.setTimeout(() => setIsGliding(false), 1100);
    setFocusedId(itemId);
    updateTransform({
      scale,
      x: viewport.clientWidth / 2 - (position.x + TILE_WIDTH / 2) * scale,
      y: viewport.clientHeight / 2 - (position.y + TILE_HEIGHT / 2) * scale,
    });
  }, [positions, stopInertia, updateTransform]);

  const surpriseMe = useCallback(() => {
    if (filteredItems.length === 0) return;
    const nextIndex = Math.floor(Math.random() * filteredItems.length);
    focusItem(filteredItems[nextIndex].id.toString(), 1.02);
  }, [filteredItems, focusItem]);

  const resetExploreView = useCallback(() => {
    setFocusedId(null);
    setDetailId(null);
    setFlippedId(null);
    setIsGliding(true);
    if (glideTimerRef.current !== null) window.clearTimeout(glideTimerRef.current);
    glideTimerRef.current = window.setTimeout(() => setIsGliding(false), 1100);
    fitCanvas();
  }, [fitCanvas]);

  const openDetail = useCallback((itemId: string) => {
    if (assetClickTimerRef.current !== null) window.clearTimeout(assetClickTimerRef.current);
    setDetailId(itemId);
    setFlippedId(null);
  }, []);

  const closeDetail = useCallback(() => {
    resetExploreView();
  }, [resetExploreView]);

  const revealControls = useCallback(() => {
    setShowControls(true);
    if (controlsTimerRef.current !== null) window.clearTimeout(controlsTimerRef.current);
    controlsTimerRef.current = window.setTimeout(() => setShowControls(false), IDLE_CONTROLS_DELAY);
  }, []);

  const zoomFromCenter = useCallback((amount: number) => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const pointerX = viewport.clientWidth / 2;
    const pointerY = viewport.clientHeight / 2;

    updateTransform(current => {
      const nextScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, current.scale + amount));
      const scaleRatio = nextScale / current.scale;
      return {
        scale: nextScale,
        x: pointerX - (pointerX - current.x) * scaleRatio,
        y: pointerY - (pointerY - current.y) * scaleRatio,
      };
    });
  }, [updateTransform]);

  useEffect(() => {
    const introTimer = window.setTimeout(() => setShowIntro(false), 2600);
    controlsTimerRef.current = window.setTimeout(() => setShowControls(false), IDLE_CONTROLS_DELAY);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    if (!selectionMode) {
      setPanelLayout('floating');
      setPanelMode('generate');
      closePanel();
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      revealControls();
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return;
      if (event.key === 'Escape') {
        if (detailIdRef.current) closeDetail();
        else onExitRef.current?.();
      }
      if (event.key.toLowerCase() === 'f') resetExploreView();
      if (event.key === '0') zoomFromCenter(0.68 - transformRef.current.scale);
      if (event.key === ' ') {
        event.preventDefault();
        surpriseMe();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.clearTimeout(introTimer);
      if (controlsTimerRef.current !== null) window.clearTimeout(controlsTimerRef.current);
      if (glideTimerRef.current !== null) window.clearTimeout(glideTimerRef.current);
      if (assetClickTimerRef.current !== null) window.clearTimeout(assetClickTimerRef.current);
      document.body.style.overflow = previousOverflow;
      setPanelLayout('side');
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [closeDetail, closePanel, resetExploreView, revealControls, selectionMode, setPanelLayout, setPanelMode, surpriseMe, zoomFromCenter]);

  useEffect(() => {
    if (!highlightedId) return;
    const position = positions.get(highlightedId);
    const viewport = viewportRef.current;
    if (!position || !viewport) return;

    updateTransform(current => ({
      ...current,
      x: viewport.clientWidth / 2 - (position.x + TILE_WIDTH / 2) * current.scale,
      y: viewport.clientHeight / 2 - (position.y + TILE_HEIGHT / 2) * current.scale,
    }));
  }, [highlightedId, positions, updateTransform]);

  useEffect(() => {
    let isMounted = true;
    async function fetchLikes() {
      if (!user || !isMounted) {
        setLikedIds(new Set());
        return;
      }

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
    return () => {
      isMounted = false;
    };
  }, [user, itemType]);

  useEffect(() => {
    let isMounted = true;
    const itemIds = items.map(item => item.id.toString());

    async function fetchLikeCounts() {
      if (itemIds.length === 0) {
        setLikeCounts(new Map());
        return;
      }

      const providedCounts = items.reduce((counts, item) => {
        if (typeof item._likeCount === 'number') {
          counts.set(item.id.toString(), item._likeCount);
        }
        return counts;
      }, new Map<string, number>());

      if (providedCounts.size === itemIds.length) {
        setLikeCounts(providedCounts);
        return;
      }

      const { data } = await supabase
        .from('user_likes')
        .select('item_id')
        .eq('item_type', itemType)
        .in('item_id', itemIds);

      if (!isMounted) return;

      const counts = new Map(providedCounts);
      (data ?? []).forEach(like => {
        const id = like.item_id.toString();
        counts.set(id, (counts.get(id) ?? 0) + 1);
      });
      setLikeCounts(counts);
    }

    fetchLikeCounts();
    return () => {
      isMounted = false;
    };
  }, [items, itemType]);

  const handleLikeToggle = (itemId: string, _itemType: string, newIsLiked: boolean) => {
    setLikedIds(current => {
      const next = new Set(current);
      if (newIsLiked) next.add(itemId);
      else next.delete(itemId);
      return next;
    });

    setLikeCounts(current => {
      const next = new Map(current);
      const nextCount = Math.max(0, (next.get(itemId) ?? 0) + (newIsLiked ? 1 : -1));
      if (nextCount === 0) next.delete(itemId);
      else next.set(itemId, nextCount);
      return next;
    });
  };

  function handlePointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    revealControls();
    const target = event.target as HTMLElement;
    if (target.closest('button, input, textarea, a')) return;

    stopInertia();
    setIsGliding(false);
    dragStartRef.current = { x: event.clientX, y: event.clientY };
    transformStartRef.current = { x: transformRef.current.x, y: transformRef.current.y };
    lastPointerRef.current = { x: event.clientX, y: event.clientY, time: performance.now() };
    velocityRef.current = { x: 0, y: 0 };
    didDragRef.current = false;
    activePointerIdRef.current = event.pointerId;
    setIsDragging(true);
    // Note: pointer capture is deferred until an actual drag begins (see handlePointerMove).
    // Capturing on press would re-target the resulting click to the viewport, preventing
    // the underlying Card from receiving the click it needs to flip.
  }

  function handlePointerMove(event: React.PointerEvent<HTMLDivElement>) {
    if (!dragStartRef.current) return;
    const dx = event.clientX - dragStartRef.current.x;
    const dy = event.clientY - dragStartRef.current.y;
    const now = performance.now();
    const lastPointer = lastPointerRef.current;

    if (lastPointer) {
      const elapsed = Math.max(1, now - lastPointer.time);
      velocityRef.current = {
        x: ((event.clientX - lastPointer.x) / elapsed) * 16.67,
        y: ((event.clientY - lastPointer.y) / elapsed) * 16.67,
      };
    }

    lastPointerRef.current = { x: event.clientX, y: event.clientY, time: now };
    if (Math.abs(dx) + Math.abs(dy) > 6 && !didDragRef.current) {
      didDragRef.current = true;
      // Capture now that this is a real drag so move/up keep tracking outside the viewport.
      if (activePointerIdRef.current !== null) {
        event.currentTarget.setPointerCapture(activePointerIdRef.current);
      }
    }
    updateTransform(current => ({
      ...current,
      x: transformStartRef.current.x + dx,
      y: transformStartRef.current.y + dy,
    }));
  }

  function handlePointerUp(event: React.PointerEvent<HTMLDivElement>) {
    dragStartRef.current = null;
    lastPointerRef.current = null;
    activePointerIdRef.current = null;
    setIsDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    const coast = () => {
      velocityRef.current = {
        x: velocityRef.current.x * DRAG_FRICTION,
        y: velocityRef.current.y * DRAG_FRICTION,
      };

      if (Math.abs(velocityRef.current.x) < MIN_VELOCITY && Math.abs(velocityRef.current.y) < MIN_VELOCITY) {
        inertiaFrameRef.current = null;
        return;
      }

      updateTransform(current => ({
        ...current,
        x: current.x + velocityRef.current.x,
        y: current.y + velocityRef.current.y,
      }));
      inertiaFrameRef.current = window.requestAnimationFrame(coast);
    };

    if (didDragRef.current) {
      inertiaFrameRef.current = window.requestAnimationFrame(coast);
    }

    window.setTimeout(() => {
      didDragRef.current = false;
    }, 80);
  }

  function handleWheel(event: React.WheelEvent<HTMLDivElement>) {
    event.preventDefault();
    event.stopPropagation();
    revealControls();

    const viewport = viewportRef.current;
    if (!viewport) return;

    const rect = viewport.getBoundingClientRect();
    const pointerX = event.clientX - rect.left;
    const pointerY = event.clientY - rect.top;

    updateTransform(current => {
      const nextScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, current.scale - event.deltaY * 0.001));
      const scaleRatio = nextScale / current.scale;

      return {
        scale: nextScale,
        x: pointerX - (pointerX - current.x) * scaleRatio,
        y: pointerY - (pointerY - current.y) * scaleRatio,
      };
    });
  }

  useEffect(() => {
    window.addEventListener('drop', resetCanvasDrag);
    window.addEventListener('dragend', resetCanvasDrag);
    window.addEventListener('blur', resetCanvasDrag);

    return () => {
      window.removeEventListener('drop', resetCanvasDrag);
      window.removeEventListener('dragend', resetCanvasDrag);
      window.removeEventListener('blur', resetCanvasDrag);
      resetCanvasDrag();
    };
  }, [resetCanvasDrag]);

  if (filteredItems.length === 0) {
    return (
      <div className="py-32 text-center font-mono text-[10px] uppercase tracking-[0.2em] text-gray-600">
        0 RECORDS FOUND.
      </div>
    );
  }

  const focusedItem = focusedId
    ? filteredItems.find(item => item.id.toString() === focusedId)
    : null;
  const detailItem = detailId
    ? filteredItems.find(item => item.id.toString() === detailId)
    : null;

  return (
    <main
      className="fixed inset-0 z-[180] overflow-hidden bg-black text-white"
      onPointerMove={revealControls}
    >
      <div className="pointer-events-none absolute inset-0 z-20 bg-[radial-gradient(circle_at_center,transparent_30%,rgba(0,0,0,0.48)_100%)]" />
      <div className="pointer-events-none absolute inset-x-0 top-0 z-20 h-32 bg-gradient-to-b from-black/70 to-transparent" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 h-40 bg-gradient-to-t from-black/80 to-transparent" />

      <div
        className={`pointer-events-none absolute inset-0 z-50 flex items-center justify-center bg-black/65 backdrop-blur-sm transition-all duration-700 ${
          showIntro ? 'visible opacity-100' : 'invisible opacity-0'
        }`}
      >
        <div className="text-center">
          <div className="mb-4 font-anton text-5xl uppercase tracking-tighter md:text-8xl">Infinite Drift</div>
          <div className="font-mono text-[9px] uppercase tracking-[0.32em] text-white/55 md:text-[10px]">
            Drag to wander · Click to discover · Esc to exit
          </div>
        </div>
      </div>

      <div className={`absolute left-5 top-5 z-40 transition-all duration-500 md:left-8 md:top-8 ${
        showControls ? 'translate-y-0 opacity-100' : '-translate-y-3 pointer-events-none opacity-0'
      }`}>
        <button
          type="button"
          onClick={onExit}
          className="flex items-center gap-3 border border-white/15 bg-black/35 px-4 py-3 font-mono text-[9px] uppercase tracking-[0.24em] text-white/65 backdrop-blur-xl transition-all hover:border-acid/60 hover:text-acid"
        >
          <span aria-hidden="true">←</span>
          Exit drift
        </button>
        <div className="mt-2 font-mono text-[8px] uppercase tracking-[0.2em] text-white/30">
          {isLoadingMore
            ? `Expanding archive · ${items.length} loaded`
            : hasMore
              ? `${items.length} loaded · discovering more`
              : `${items.length} assets · archive complete`}
        </div>
      </div>

      <div className={`absolute right-5 top-5 z-40 flex items-center gap-2 transition-all duration-500 md:right-8 md:top-8 ${
        showControls ? 'translate-y-0 opacity-100' : '-translate-y-3 pointer-events-none opacity-0'
      }`}>
        <button
          type="button"
          onClick={() => zoomFromCenter(-0.15)}
          className="h-10 w-10 border border-white/15 bg-black/35 font-mono text-sm text-white/60 backdrop-blur-xl transition-colors hover:border-acid/60 hover:text-acid"
          aria-label="Zoom out"
          title="Zoom out"
        >
          -
        </button>
        <button
          type="button"
          onClick={() => fitCanvas()}
          className="h-10 border border-white/15 bg-black/35 px-4 font-mono text-[9px] uppercase tracking-widest text-white/60 backdrop-blur-xl transition-colors hover:border-acid/60 hover:text-acid"
        >
          Fit
        </button>
        <button
          type="button"
          onClick={() => zoomFromCenter(0.15)}
          className="h-10 w-10 border border-white/15 bg-black/35 font-mono text-sm text-white/60 backdrop-blur-xl transition-colors hover:border-acid/60 hover:text-acid"
          aria-label="Zoom in"
          title="Zoom in"
        >
          +
        </button>
      </div>

      {!selectionMode && !isStudioOpen && (
        <button
          type="button"
          onClick={() => {
            setPanelLayout('floating');
            setPanelMode('generate');
            if (isStudioOpen) closePanel();
            else openPanel();
          }}
          className={`fixed bottom-6 right-5 z-[235] flex items-center gap-2 rounded-full border px-4 py-3 font-mono text-[9px] uppercase tracking-[0.22em] backdrop-blur-xl transition-all md:bottom-8 md:right-8 ${
            isStudioOpen
              ? 'border-acid bg-acid text-black'
              : 'border-white/15 bg-black/45 text-white/65 hover:border-acid/70 hover:text-acid'
          }`}
        >
          <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="currentColor" aria-hidden="true">
            <path d="M13 2 3 14h7l-1 8 11-13h-7l1-7z" />
          </svg>
          Studio
        </button>
      )}

      <div
        ref={viewportRef}
        className={`relative h-dvh touch-none overflow-hidden bg-[linear-gradient(rgba(255,255,255,0.045)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.045)_1px,transparent_1px),radial-gradient(circle_at_center,rgba(255,255,255,0.035)_0,transparent_55%)] bg-[length:84px_84px,84px_84px,100%_100%] ${isDragging ? 'cursor-grabbing' : 'cursor-grab'}`}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={resetCanvasDrag}
        onWheel={handleWheel}
        onLostPointerCapture={() => {
          dragStartRef.current = null;
          activePointerIdRef.current = null;
          lastPointerRef.current = null;
          setIsDragging(false);
        }}
        onDragStart={resetCanvasDrag}
        onDragEnd={resetCanvasDrag}
        onClickCapture={event => {
          if (didDragRef.current) {
            event.preventDefault();
            event.stopPropagation();
          }
        }}
        onClick={event => {
          const target = event.target as HTMLElement;
          if (!target.closest('[data-infinite-asset]')) {
            resetExploreView();
          }
        }}
      >
        <div
          className={`absolute left-0 top-0 ${isGliding ? 'transition-transform duration-1000 ease-[cubic-bezier(0.16,1,0.3,1)]' : ''}`}
          style={{
            width: canvasWidth,
            height: canvasHeight,
            transform: `translate3d(${transform.x}px, ${transform.y}px, 0) scale(${transform.scale})`,
            transformOrigin: '0 0',
          }}
        >
          {filteredItems.map((item, index) => {
            const position = positions.get(item.id.toString()) ?? { x: 0, y: 0 };
            const cardTitle = activeTab === 'systems'
              ? (item.title || 'SYSTEM')
              : (item.category || 'ASSET');
            const secondaryLabel = activeTab === 'systems'
              ? (item.prompt_type || 'TYPE')
              : (item.volume || 'VOL');
            const secondaryLabelName = activeTab === 'systems' ? 'TYPE' : 'CATEGORY';
            const bottomLabel = activeTab === 'systems' ? 'IDENTIFIER' : 'VOLUME';
            const isSelected = selectionMode && selectedIds?.has(item.id.toString());

            return (
              <div
                key={item.id}
                data-infinite-asset
                className={`absolute transition-[filter,opacity] duration-700 ${
                  focusedId && focusedId !== item.id.toString()
                    ? 'opacity-45 blur-[1px]'
                    : 'opacity-100'
                }`}
                style={{
                  left: position.x,
                  top: position.y,
                  width: TILE_WIDTH,
                  height: TILE_HEIGHT,
                  zIndex: focusedId === item.id.toString() || highlightedId === item.id.toString() ? 20 : 1 + (index % 8),
                  transform: `scale(${seededScale(index)})`,
                  transformOrigin: 'center',
                }}
                onDoubleClick={event => {
                  event.stopPropagation();
                  if (selectionMode) return;
                  openDetail(item.id.toString());
                }}
                onClick={event => {
                  event.stopPropagation();
                  if (selectionMode || didDragRef.current) return;
                  if (assetClickTimerRef.current !== null) window.clearTimeout(assetClickTimerRef.current);
                  const itemId = item.id.toString();
                  if (focusedId === itemId) {
                    openDetail(itemId);
                    return;
                  }
                  assetClickTimerRef.current = window.setTimeout(() => focusItem(itemId), 220);
                }}
              >
                <Card
                  item={item}
                  cardTitle={cardTitle}
                  secondaryLabel={secondaryLabel}
                  secondaryLabelName={secondaryLabelName}
                  bottomLabel={bottomLabel}
                  itemType={itemType}
                  initialIsLiked={likedIds.has(item.id.toString())}
                  likeCount={likeCounts.get(item.id.toString()) ?? 0}
                  showLikeCount={sortMode === 'popular'}
                  onToggle={handleLikeToggle}
                  isFlipped={false}
                  highlighted={item.id.toString() === highlightedId}
                  onInteraction={onClearHighlight}
                  forceColor
                />

                {selectionMode && (
                  <div
                    className="absolute inset-0 z-40 cursor-pointer"
                    onClick={() => onSelectItem?.(item.id.toString(), item.image_url ?? null)}
                  >
                    <div className={`absolute left-2 top-2 flex h-5 w-5 items-center justify-center border-2 shadow-md transition-all ${
                      isSelected ? 'border-[#c8ff00] bg-[#c8ff00]' : 'border-white/60 bg-black/60 backdrop-blur-sm hover:border-[#c8ff00]'
                    }`}>
                      {isSelected && (
                        <svg className="h-3 w-3 text-black" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                    </div>
                    {isSelected && <div className="pointer-events-none absolute inset-0 border-2 border-[#c8ff00]" />}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className={`absolute left-1/2 z-40 flex -translate-x-1/2 flex-col items-center gap-3 transition-all duration-500 ${
        selectionMode ? 'bottom-24' : 'bottom-6 md:bottom-8'
      } ${
        showControls ? 'translate-y-0 opacity-100' : 'translate-y-3 pointer-events-none opacity-0'
      }`}>
        {focusedItem && (
          <div className="max-w-[70vw] truncate font-mono text-[9px] uppercase tracking-[0.26em] text-white/45">
            {activeTab === 'systems' ? focusedItem.title : focusedItem.category}
          </div>
        )}
        <button
          type="button"
          onClick={surpriseMe}
          className="border border-white/20 bg-black/40 px-6 py-3 font-mono text-[9px] uppercase tracking-[0.28em] text-white/70 backdrop-blur-xl transition-all hover:border-acid hover:bg-acid hover:text-black"
        >
          Surprise me
        </button>
      </div>

      <div className={`pointer-events-none absolute bottom-8 left-7 z-40 hidden font-mono text-[8px] uppercase tracking-[0.24em] text-white/25 transition-all duration-500 md:block ${
        showControls ? 'opacity-100' : 'opacity-0'
      }`}>
        Space: drift · F: fit · Click: focus · Double click: open
      </div>

      {detailItem && (
        <div
          className={`fixed inset-0 z-[220] flex items-center justify-center bg-black/78 p-5 backdrop-blur-xl transition-[padding] duration-300 ${
            isStudioOpen ? 'md:pr-[440px]' : ''
          }`}
          onClick={closeDetail}
        >
          <div
            className="relative aspect-[3/4] h-[min(78dvh,720px)] max-h-[78dvh] max-w-[88vw] shadow-[0_30px_120px_rgba(0,0,0,0.85)]"
            onClick={event => event.stopPropagation()}
          >
            <button
              type="button"
              onClick={closeDetail}
              className="absolute -right-3 -top-3 z-[230] flex h-10 w-10 items-center justify-center rounded-full border border-white/20 bg-black/85 font-mono text-xs text-white/60 backdrop-blur-xl transition-colors hover:border-acid hover:text-acid"
              aria-label="Close asset"
              title="Close asset"
            >
              X
            </button>
            <Card
              item={detailItem}
              cardTitle={activeTab === 'systems' ? (detailItem.title || 'SYSTEM') : (detailItem.category || 'ASSET')}
              secondaryLabel={activeTab === 'systems' ? (detailItem.prompt_type || 'TYPE') : (detailItem.volume || 'VOL')}
              secondaryLabelName={activeTab === 'systems' ? 'TYPE' : 'CATEGORY'}
              bottomLabel={activeTab === 'systems' ? 'IDENTIFIER' : 'VOLUME'}
              itemType={itemType}
              initialIsLiked={likedIds.has(detailItem.id.toString())}
              likeCount={likeCounts.get(detailItem.id.toString()) ?? 0}
              showLikeCount={sortMode === 'popular'}
              onToggle={handleLikeToggle}
              isFlipped={flippedId === detailItem.id.toString()}
              onFlip={() => setFlippedId(flippedId === detailItem.id.toString() ? null : detailItem.id.toString())}
              forceColor
            />
          </div>
        </div>
      )}
    </main>
  );
}
