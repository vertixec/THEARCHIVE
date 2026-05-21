'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Card from './Card';
import { supabase } from '@/lib/supabaseClient';
import { useAuth } from './AuthContext';
import type { Visual } from '@/lib/types';
import type { SortMode } from './Filters';

type VisualWithLikeCount = Visual & {
  _likeCount?: number;
};

interface InfiniteVisualViewProps {
  items: VisualWithLikeCount[];
  filter: string;
  searchQuery: string;
  sortMode?: SortMode;
  highlightedId?: string;
  onClearHighlight?: () => void;
  selectionMode?: boolean;
  selectedIds?: Set<string>;
  onSelectItem?: (id: string, imageUrl: string | null) => void;
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

function seededOffset(index: number, range: number) {
  const value = Math.sin(index * 999.91) * 10000;
  return (value - Math.floor(value) - 0.5) * range;
}

export default function InfiniteVisualView({
  items,
  filter,
  searchQuery,
  sortMode = 'newest',
  highlightedId,
  onClearHighlight,
  selectionMode,
  selectedIds,
  onSelectItem,
}: InfiniteVisualViewProps) {
  const { user } = useAuth();
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const dragStartRef = useRef<Point | null>(null);
  const transformStartRef = useRef<Point>({ x: 0, y: 0 });
  const didDragRef = useRef(false);
  const activePointerIdRef = useRef<number | null>(null);
  const lastPointerRef = useRef<{ x: number; y: number; time: number } | null>(null);
  const velocityRef = useRef<Point>({ x: 0, y: 0 });
  const inertiaFrameRef = useRef<number | null>(null);
  const [likedIds, setLikedIds] = useState<Set<string>>(new Set());
  const [likeCounts, setLikeCounts] = useState<Map<string, number>>(new Map());
  const [flippedId, setFlippedId] = useState<string | null>(null);
  const [transform, setTransform] = useState({ x: 0, y: 0, scale: 0.78 });
  const transformRef = useRef(transform);

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
    stopInertia();
  }, [stopInertia]);

  const filteredItems = useMemo(() => {
    const query = searchQuery.toLowerCase();
    const filtered = items.filter(item => {
      const itemTypeValue = (item.volume || 'GENERAL').toString().trim().toUpperCase();
      const matchesType = filter === 'ALL' || itemTypeValue === filter;
      const searchStr = (
        (item.prompt_text || '') +
        (item.title || '') +
        (item.model || '') +
        (item.category || '') +
        (item.volume || '')
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
  }, [items, filter, searchQuery, sortMode, likeCounts]);

  const columns = Math.max(4, Math.ceil(Math.sqrt(filteredItems.length * 1.35)));
  const rows = Math.max(3, Math.ceil(filteredItems.length / columns));
  const canvasWidth = columns * CELL_WIDTH + TILE_WIDTH;
  const canvasHeight = rows * CELL_HEIGHT + TILE_HEIGHT;

  const positions = useMemo(() => {
    return new Map(
      filteredItems.map((item, index) => {
        const column = index % columns;
        const row = Math.floor(index / columns);
        const rowDrift = row % 2 === 0 ? 0 : CELL_WIDTH * 0.34;
        const x = column * CELL_WIDTH + rowDrift + seededOffset(index + 1, 68);
        const y = row * CELL_HEIGHT + seededOffset(index + 7, 76);
        return [item.id.toString(), { x: Math.max(24, x), y: Math.max(24, y) }];
      })
    );
  }, [filteredItems, columns]);

  function centerCanvas(scale = transform.scale) {
    const viewport = viewportRef.current;
    if (!viewport) return;
    updateTransform({
      x: viewport.clientWidth / 2 - (canvasWidth * scale) / 2,
      y: viewport.clientHeight / 2 - (canvasHeight * scale) / 2,
      scale,
    });
  }

  useEffect(() => {
    const resetToCenter = () => {
      const viewport = viewportRef.current;
      const scale = 0.78;
      if (!viewport) return;
      updateTransform({
        x: viewport.clientWidth / 2 - (canvasWidth * scale) / 2,
        y: viewport.clientHeight / 2 - (canvasHeight * scale) / 2,
        scale,
      });
    };

    resetToCenter();
    const handleResize = () => resetToCenter();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [canvasWidth, canvasHeight, updateTransform]);

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
        .eq('item_type', 'visual');

      if (data && isMounted) {
        setLikedIds(new Set(data.map(l => l.item_id.toString())));
      }
    }

    fetchLikes();
    return () => {
      isMounted = false;
    };
  }, [user]);

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
        .eq('item_type', 'visual')
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
  }, [items]);

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
    const target = event.target as HTMLElement;
    if (target.closest('button, input, textarea, a')) return;

    stopInertia();
    dragStartRef.current = { x: event.clientX, y: event.clientY };
    transformStartRef.current = { x: transformRef.current.x, y: transformRef.current.y };
    lastPointerRef.current = { x: event.clientX, y: event.clientY, time: performance.now() };
    velocityRef.current = { x: 0, y: 0 };
    didDragRef.current = false;
    activePointerIdRef.current = event.pointerId;
    event.currentTarget.setPointerCapture(event.pointerId);
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
    if (Math.abs(dx) + Math.abs(dy) > 6) didDragRef.current = true;
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
    if (!event.shiftKey) return;

    event.preventDefault();
    event.stopPropagation();

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

  return (
    <main className="relative min-h-[620px] border-y border-white/10 bg-black">
      <div className="pointer-events-none absolute left-4 top-4 z-30 border border-white/15 bg-black/80 px-3 py-2 font-mono text-[9px] uppercase tracking-widest text-white/45 backdrop-blur-md">
        DRAG TO MOVE / SHIFT + WHEEL TO ZOOM
      </div>

      <div className="absolute right-4 top-4 z-30 flex items-center gap-2">
        <button
          type="button"
          onClick={() => updateTransform(current => ({ ...current, scale: Math.max(MIN_SCALE, current.scale - 0.15) }))}
          className="h-9 w-9 border border-white/15 bg-black/80 font-mono text-sm text-white/60 transition-colors hover:border-acid/60 hover:text-acid"
          aria-label="Zoom out"
          title="Zoom out"
        >
          -
        </button>
        <button
          type="button"
          onClick={() => centerCanvas(0.78)}
          className="h-9 border border-white/15 bg-black/80 px-3 font-mono text-[9px] uppercase tracking-widest text-white/60 transition-colors hover:border-acid/60 hover:text-acid"
        >
          Reset
        </button>
        <button
          type="button"
          onClick={() => updateTransform(current => ({ ...current, scale: Math.min(MAX_SCALE, current.scale + 0.15) }))}
          className="h-9 w-9 border border-white/15 bg-black/80 font-mono text-sm text-white/60 transition-colors hover:border-acid/60 hover:text-acid"
          aria-label="Zoom in"
          title="Zoom in"
        >
          +
        </button>
      </div>

      <div
        ref={viewportRef}
        className={`relative h-[calc(100vh-168px)] min-h-[620px] overflow-hidden bg-[linear-gradient(rgba(255,255,255,0.045)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.045)_1px,transparent_1px)] bg-[length:84px_84px] ${dragStartRef.current ? 'cursor-grabbing' : 'cursor-grab'}`}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={resetCanvasDrag}
        onWheel={handleWheel}
        onLostPointerCapture={() => {
          dragStartRef.current = null;
          activePointerIdRef.current = null;
          lastPointerRef.current = null;
        }}
        onDragStart={resetCanvasDrag}
        onDragEnd={resetCanvasDrag}
        onClickCapture={event => {
          if (didDragRef.current) {
            event.preventDefault();
            event.stopPropagation();
          }
        }}
      >
        <div
          className="absolute left-0 top-0"
          style={{
            width: canvasWidth,
            height: canvasHeight,
            transform: `translate3d(${transform.x}px, ${transform.y}px, 0) scale(${transform.scale})`,
            transformOrigin: '0 0',
          }}
        >
          {filteredItems.map((item, index) => {
            const position = positions.get(item.id.toString()) ?? { x: 0, y: 0 };
            const cardTitle = item.category || 'ASSET';
            const secondaryLabel = item.volume || 'VOL';
            const isSelected = selectionMode && selectedIds?.has(item.id.toString());

            return (
              <div
                key={item.id}
                className="absolute"
                style={{
                  left: position.x,
                  top: position.y,
                  width: TILE_WIDTH,
                  height: TILE_HEIGHT,
                  zIndex: highlightedId === item.id.toString() ? 20 : 1 + (index % 8),
                }}
              >
                <Card
                  item={item}
                  cardTitle={cardTitle}
                  secondaryLabel={secondaryLabel}
                  secondaryLabelName="CATEGORY"
                  bottomLabel="VOLUME"
                  itemType="visual"
                  initialIsLiked={likedIds.has(item.id.toString())}
                  likeCount={likeCounts.get(item.id.toString()) ?? 0}
                  showLikeCount={sortMode === 'popular'}
                  onToggle={handleLikeToggle}
                  isFlipped={!selectionMode && flippedId === item.id.toString()}
                  onFlip={() => {
                    if (selectionMode) return;
                    setFlippedId(flippedId === item.id.toString() ? null : item.id.toString());
                  }}
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
    </main>
  );
}
