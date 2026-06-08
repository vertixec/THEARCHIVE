'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import type { Generation } from '@/lib/types';
import { useAuth } from '@/components/AuthContext';
import { useToast } from '@/components/Toast';
import { useGenerate } from '@/components/GenerateContext';
import Avatar from '@/components/Avatar';

type ProfileSummary = {
  full_name: string | null;
  username: string | null;
  avatar_url: string | null;
  email: string | null;
};

function formatModel(model: string) {
  return model
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function filenameFor(item: Generation) {
  const extension = item.generation_type === 'video' ? 'mp4' : 'png';
  return `archive-${item.generation_type}-${item.id.slice(0, 8)}.${extension}`;
}

function FloatingAssetButton({
  title,
  children,
  onClick,
  active = false,
}: {
  title: string;
  children: React.ReactNode;
  onClick: (event: React.MouseEvent<HTMLButtonElement>) => void;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      className={`flex h-10 min-w-10 items-center justify-center gap-2 rounded-full border bg-black/55 px-3 shadow-[0_14px_40px_rgba(0,0,0,0.45),inset_0_1px_0_rgba(255,255,255,0.12)] backdrop-blur-xl transition-colors hover:border-acid/70 hover:bg-acid hover:text-black ${
        active ? 'border-acid/50 text-acid' : 'border-white/10 text-white/80'
      }`}
    >
      {children}
    </button>
  );
}

function CardActionButton({
  title,
  children,
  onClick,
}: {
  title: string;
  children: React.ReactNode;
  onClick: (event: React.MouseEvent<HTMLButtonElement>) => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      className="p-1 text-acid/50 transition-colors hover:text-acid"
    >
      {children}
    </button>
  );
}

export default function CreationsContent() {
  const { user, loading: authLoading } = useAuth();
  const { showToast } = useToast();
  const { openPanel } = useGenerate();
  const [items, setItems] = useState<Generation[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [profile, setProfile] = useState<ProfileSummary | null>(null);

  const selectedItem = useMemo(
    () => items.find((item) => item.id === selectedId) ?? null,
    [items, selectedId],
  );

  const selectedIndex = useMemo(
    () => (selectedId ? items.findIndex((item) => item.id === selectedId) : -1),
    [items, selectedId],
  );

  const closeAsset = useCallback(() => {
    setSelectedId(null);
  }, []);

  const openAsset = useCallback((item: Generation) => {
    setSelectedId(item.id);
  }, []);

  const moveSelection = useCallback((direction: 1 | -1) => {
    if (selectedIndex < 0 || items.length === 0) return;
    const nextIndex = (selectedIndex + direction + items.length) % items.length;
    setSelectedId(items[nextIndex].id);
  }, [items, selectedIndex]);

  const copyPrompt = useCallback(async () => {
    if (!selectedItem) return;
    await navigator.clipboard.writeText(selectedItem.prompt);
    showToast('PROMPT COPIED');
  }, [selectedItem, showToast]);

  const downloadItem = useCallback(async (item: Generation) => {
    if (!item.result_url) return;

    try {
      const response = await fetch(item.result_url);
      if (!response.ok) throw new Error('Download failed');
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = objectUrl;
      link.download = filenameFor(item);
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(objectUrl);
      showToast('DOWNLOAD STARTED');
    } catch {
      const link = document.createElement('a');
      link.href = item.result_url;
      link.download = filenameFor(item);
      link.target = '_blank';
      link.rel = 'noreferrer';
      link.click();
      showToast('DOWNLOAD STARTED');
    }
  }, [showToast]);

  const downloadAsset = useCallback(async () => {
    if (!selectedItem) return;
    await downloadItem(selectedItem);
  }, [downloadItem, selectedItem]);

  const toggleSavedItem = useCallback(async (item: Generation) => {
    if (!user) return;
    const nextSaved = !item.is_saved;
    setItems((current) => current.map((entry) => (entry.id === item.id ? { ...entry, is_saved: nextSaved } : entry)));

    const { error: generationError } = await supabase.from('generations').update({ is_saved: nextSaved }).eq('id', item.id);
    const { error: deleteLikeError } = await supabase
      .from('user_likes')
      .delete()
      .eq('user_id', user.id)
      .eq('item_id', item.id)
      .eq('item_type', 'generation');

    const { error: insertLikeError } = nextSaved
      ? await supabase.from('user_likes').insert({
        user_id: user.id,
        item_id: item.id,
        item_type: 'generation',
      })
      : { error: null };

    if (generationError || deleteLikeError || insertLikeError) {
      setItems((current) => current.map((entry) => (entry.id === item.id ? { ...entry, is_saved: !nextSaved } : entry)));
      showToast(insertLikeError ? 'FAVORITES SYNC FAILED' : 'SAVE FAILED');
      return;
    }

    showToast(nextSaved ? 'ADDED TO FAVORITES' : 'REMOVED FROM FAVORITES');
  }, [showToast, user]);

  const toggleSaved = useCallback(async () => {
    if (!selectedItem) return;
    await toggleSavedItem(selectedItem);
  }, [selectedItem, toggleSavedItem]);

  const sendPromptToGenerate = useCallback((item: Generation) => {
    openPanel(item.prompt, item.reference_image_url ?? null);
    showToast('PROMPT SENT TO GENERATE');
  }, [openPanel, showToast]);

  const copyItemPrompt = useCallback(async (item: Generation) => {
    await navigator.clipboard.writeText(item.prompt);
    showToast('PROMPT COPIED');
  }, [showToast]);

  useEffect(() => {
    if (authLoading || !user) return;

    let cancelled = false;

    const loadCreations = async () => {
      setLoading(true);
      setError(null);

      const [generationResponse, likesResponse, profileResponse] = await Promise.all([
        supabase
          .from('generations')
          .select('id, user_id, created_at, prompt, model, generation_type, result_url, reference_image_url, is_saved')
          .eq('status', 'completed')
          .order('created_at', { ascending: false }),
        supabase
          .from('user_likes')
          .select('item_id')
          .eq('user_id', user.id)
          .eq('item_type', 'generation'),
        supabase
          .from('profiles')
          .select('full_name, username, avatar_url, email')
          .eq('id', user.id)
          .maybeSingle(),
      ]);

      if (cancelled) return;

      if (generationResponse.error) {
        setError('Generation history is not available yet.');
        setItems([]);
      } else {
        const likedIds = new Set((likesResponse.data || []).map((like) => like.item_id.toString()));
        setItems(((generationResponse.data as Generation[]) || []).map((item) => ({
          ...item,
          is_saved: item.is_saved || likedIds.has(item.id.toString()),
        })));
        setProfile((profileResponse.data as ProfileSummary | null) || null);
      }

      setLoading(false);
    };

    loadCreations();

    return () => {
      cancelled = true;
    };
  }, [authLoading, user]);

  useEffect(() => {
    if (!selectedItem) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeAsset();
      if (event.key === 'ArrowRight') moveSelection(1);
      if (event.key === 'ArrowLeft') moveSelection(-1);
      if (event.key.toLowerCase() === 'c') copyPrompt();
      if (event.key.toLowerCase() === 'd') downloadAsset();
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [closeAsset, copyPrompt, downloadAsset, moveSelection, selectedItem]);

  const isLoading = authLoading || loading;
  const displayName = profile?.full_name || profile?.email?.split('@')[0] || user?.email?.split('@')[0] || 'MEMBER';
  const username = profile?.username ? `@${profile.username}` : '@member';

  return (
    <main className="min-h-screen bg-dark pb-28">
      <header className="border-b border-white/10 bg-panel/30 px-4 pb-6 pt-8 text-center md:px-6 md:pt-12">
        <div className="mb-4 inline-flex bg-acid px-2 py-0.5 font-mono text-[9px] font-bold uppercase tracking-widest text-black md:text-[10px]">
          CREATIVE OUTPUTS
        </div>
        <h1 className="font-anton text-5xl uppercase leading-none tracking-tighter md:text-7xl">Creations</h1>
        <p className="mx-auto mt-4 max-w-xl font-mono text-[10px] uppercase leading-relaxed tracking-widest text-white/40 md:text-xs">
          Your generated images and videos from The Archive.
        </p>
      </header>

      <section className="px-4 py-8 md:px-6">
        {isLoading && (
          <div className="py-20 text-center font-mono text-[10px] uppercase tracking-widest text-acid">
            Loading creations...
          </div>
        )}

        {!isLoading && error && (
          <div className="mx-auto max-w-xl border border-danger/30 bg-danger/5 px-5 py-4 text-center font-mono text-[10px] uppercase tracking-widest text-danger">
            {error}
          </div>
        )}

        {!isLoading && !error && items.length === 0 && (
          <div className="mx-auto max-w-xl border border-white/10 bg-panel px-5 py-12 text-center">
            <h2 className="mb-3 font-anton text-3xl uppercase tracking-tight">No creations yet</h2>
            <p className="font-mono text-[10px] uppercase leading-relaxed tracking-widest text-white/40">
              Use the dock to generate your first image or video.
            </p>
          </div>
        )}

        {!isLoading && !error && items.length > 0 && (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 md:gap-4 xl:grid-cols-5">
            {items.map((item) => (
              <div
                key={item.id}
                role="button"
                tabIndex={0}
                onClick={() => openAsset(item)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    openAsset(item);
                  }
                }}
                className="group relative cursor-pointer overflow-hidden border border-white/10 bg-panel text-left transition-colors hover:border-acid/50 focus:outline-none focus-visible:border-acid"
              >
                <div className="relative aspect-square overflow-hidden bg-black">
                  {item.generation_type === 'video' ? (
                    <video src={item.result_url || ''} className="h-full w-full object-cover" muted playsInline />
                  ) : (
                    <img src={item.result_url || ''} alt={item.prompt} className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105" />
                  )}

                  <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 transition-opacity duration-200 group-hover:opacity-100 group-focus-within:opacity-100" />

                  <div className="absolute right-2 top-2 flex items-center gap-1.5 opacity-0 transition-opacity duration-200 group-hover:opacity-100 group-focus-within:opacity-100">
                    <FloatingAssetButton
                      title={item.is_saved ? 'Remove favorite' : 'Save favorite'}
                      active={item.is_saved}
                      onClick={(event) => {
                        event.stopPropagation();
                        toggleSavedItem(item);
                      }}
                    >
                      <svg viewBox="0 0 24 24" className="h-4 w-4" fill={item.is_saved ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M12 21s-7-4.4-9-10a5 5 0 0 1 9-4 5 5 0 0 1 9 4c-2 5.6-9 10-9 10Z" />
                      </svg>
                    </FloatingAssetButton>
                    <FloatingAssetButton
                      title="Download"
                      onClick={(event) => {
                        event.stopPropagation();
                        downloadItem(item);
                      }}
                    >
                      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M12 4v10M8 10l4 4 4-4M5 20h14" />
                      </svg>
                    </FloatingAssetButton>
                  </div>
                </div>
                <div className="border-t border-white/10 p-3">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1">
                      <CardActionButton
                        title="Copy prompt"
                        onClick={(event) => {
                          event.stopPropagation();
                          copyItemPrompt(item);
                        }}
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                        </svg>
                      </CardActionButton>
                      <CardActionButton
                        title="Generate with this prompt"
                        onClick={(event) => {
                          event.stopPropagation();
                          sendPromptToGenerate(item);
                        }}
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
                        </svg>
                      </CardActionButton>
                    </div>
                    <span className="truncate font-mono text-[8px] uppercase tracking-widest text-white/30">{item.model}</span>
                  </div>
                  <p className="line-clamp-3 font-mono text-[9px] uppercase leading-relaxed text-white/55">{item.prompt}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {selectedItem && (
        <div className="fixed inset-0 z-[180] overflow-hidden bg-black/72 text-white backdrop-blur-xl" onClick={closeAsset}>
          {selectedItem.result_url && (
            <div
              className="absolute inset-0 scale-110 bg-cover bg-center opacity-25 blur-3xl"
              style={{ backgroundImage: `url(${selectedItem.result_url})` }}
            />
          )}
          <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(0,0,0,0.35),rgba(0,0,0,0.82))]" />

          <button
            type="button"
            onClick={closeAsset}
            className="absolute right-5 top-5 z-20 flex h-10 items-center gap-2 rounded-full border border-white/10 bg-black/55 px-3 text-white/75 shadow-[0_14px_40px_rgba(0,0,0,0.45),inset_0_1px_0_rgba(255,255,255,0.12)] backdrop-blur-xl transition-colors hover:border-acid/70 hover:bg-acid hover:text-black md:right-[calc(440px+24px)]"
            title="Close"
            aria-label="Close"
          >
            <span className="font-mono text-[10px] uppercase tracking-widest opacity-60">esc</span>
            <span className="h-4 w-px bg-current/25" />
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>

          <div className="relative z-10 grid h-dvh grid-rows-[1fr_auto] lg:grid-cols-[1fr_440px] lg:grid-rows-1">
            <section className="relative flex min-h-0 items-center justify-center overflow-hidden px-5 py-8 md:px-10 lg:px-14">
              <div className="group relative flex max-h-full max-w-full items-center justify-center" onClick={(event) => event.stopPropagation()}>
                {selectedItem.generation_type === 'video' ? (
                  <video src={selectedItem.result_url || ''} className="max-h-[calc(100dvh-104px)] max-w-full rounded-lg border border-white/10 object-contain shadow-[0_24px_90px_rgba(0,0,0,0.62)]" controls autoPlay loop playsInline />
                ) : (
                  <img
                    src={selectedItem.result_url || ''}
                    alt={selectedItem.prompt}
                    className="max-h-[calc(100dvh-104px)] max-w-full rounded-lg border border-white/10 object-contain shadow-[0_24px_90px_rgba(0,0,0,0.62)]"
                  />
                )}

                <div className="absolute right-4 top-4 flex items-center gap-2 opacity-100 transition-opacity md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100">
                  <FloatingAssetButton title={selectedItem.is_saved ? 'Remove favorite' : 'Save favorite'} active={selectedItem.is_saved} onClick={toggleSaved}>
                    <svg viewBox="0 0 24 24" className="h-4 w-4" fill={selectedItem.is_saved ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M12 21s-7-4.4-9-10a5 5 0 0 1 9-4 5 5 0 0 1 9 4c-2 5.6-9 10-9 10Z" />
                    </svg>
                  </FloatingAssetButton>
                  <FloatingAssetButton title="Download" onClick={downloadAsset}>
                    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M12 4v10M8 10l4 4 4-4M5 20h14" />
                    </svg>
                  </FloatingAssetButton>
                </div>

                <div className="absolute bottom-3 left-1/2 h-1 w-10 -translate-x-1/2 rounded-full bg-white/30" />
              </div>
            </section>

            <aside className="flex max-h-[50dvh] flex-col overflow-hidden border-t border-white/10 bg-black/[0.34] shadow-[inset_1px_0_0_rgba(255,255,255,0.08)] backdrop-blur-2xl lg:max-h-none lg:border-l lg:border-t-0" onClick={(event) => event.stopPropagation()}>
              <div className="flex items-center justify-between gap-4 border-b border-white/10 px-5 py-5">
                <div className="flex min-w-0 items-center gap-3">
                  <Avatar name={displayName} src={profile?.avatar_url} size="sm" className="rounded-full border border-acid/30" />
                  <div className="min-w-0">
                    <div className="truncate font-oswald text-base font-bold uppercase tracking-wide text-white">{displayName}</div>
                    <div className="font-mono text-[10px] text-white/40">{username}</div>
                  </div>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto px-5 py-6">
                <div className="mb-3 inline-flex rounded-full border border-acid/30 bg-acid/10 px-3 py-1.5 font-mono text-[10px] uppercase tracking-widest text-acid">
                  {formatModel(selectedItem.model)}
                </div>
                <div className="rounded-lg border border-white/10 bg-white/[0.06] p-5 font-mono text-[11px] uppercase leading-6 tracking-wide text-white/72 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]">
                  {selectedItem.prompt}
                </div>

                <div className="mt-5 flex items-center justify-end text-white/45">
                  <button type="button" onClick={copyPrompt} className="flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-white/[0.04] transition-colors hover:border-acid/60 hover:bg-acid hover:text-black" title="Copy prompt" aria-label="Copy prompt">
                    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="9" y="9" width="11" height="11" rx="2" />
                      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                    </svg>
                  </button>
                </div>
              </div>
            </aside>
          </div>
        </div>
      )}
    </main>
  );
}
