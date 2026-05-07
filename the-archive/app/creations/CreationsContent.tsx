'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import type { Generation } from '@/lib/types';
import { useAuth } from '@/components/AuthContext';

export default function CreationsContent() {
  const { user, loading: authLoading } = useAuth();
  const [items, setItems] = useState<Generation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (authLoading) return;

    if (!user) {
      setLoading(false);
      return;
    }

    let cancelled = false;

    const loadCreations = async () => {
      setLoading(true);
      setError(null);

      const { data, error: queryError } = await supabase
        .from('generations')
        .select('id, user_id, created_at, prompt, model, generation_type, result_url, reference_image_url, is_saved')
        .order('created_at', { ascending: false });

      if (cancelled) return;

      if (queryError) {
        setError('Generation history is not available yet.');
        setItems([]);
      } else {
        setItems((data as Generation[]) || []);
      }

      setLoading(false);
    };

    loadCreations();

    return () => {
      cancelled = true;
    };
  }, [authLoading, user]);

  return (
    <main className="min-h-screen bg-dark pb-28">
      <header className="pt-8 md:pt-12 pb-6 px-4 md:px-6 bg-panel/30 text-center border-b border-white/10">
        <div className="inline-flex bg-acid text-black font-mono text-[9px] md:text-[10px] px-2 py-0.5 font-bold uppercase tracking-widest mb-4">
          CREATIVE OUTPUTS
        </div>
        <h1 className="font-anton text-5xl md:text-7xl uppercase tracking-tighter leading-none">
          Creations
        </h1>
        <p className="font-mono text-[10px] md:text-xs text-white/40 uppercase tracking-widest mt-4 max-w-xl mx-auto leading-relaxed">
          Your generated images and videos from The Archive.
        </p>
      </header>

      <section className="px-4 md:px-6 py-8">
        {loading && (
          <div className="py-20 text-center font-mono text-[10px] text-acid uppercase tracking-widest">
            Loading creations...
          </div>
        )}

        {!loading && error && (
          <div className="max-w-xl mx-auto border border-danger/30 bg-danger/5 px-5 py-4 text-center font-mono text-[10px] text-danger uppercase tracking-widest">
            {error}
          </div>
        )}

        {!loading && !error && items.length === 0 && (
          <div className="max-w-xl mx-auto border border-white/10 bg-panel px-5 py-12 text-center">
            <h2 className="font-anton text-3xl uppercase tracking-tight mb-3">No creations yet</h2>
            <p className="font-mono text-[10px] text-white/40 uppercase tracking-widest leading-relaxed">
              Use the dock to generate your first image or video.
            </p>
          </div>
        )}

        {!loading && !error && items.length > 0 && (
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3 md:gap-4">
            {items.map((item) => (
              <article key={item.id} className="group bg-panel border border-white/10 hover:border-acid/40 transition-colors overflow-hidden">
                <div className="aspect-square bg-black overflow-hidden">
                  {item.generation_type === 'video' ? (
                    <video src={item.result_url || ''} className="h-full w-full object-cover" muted playsInline controls />
                  ) : (
                    <img src={item.result_url || ''} alt={item.prompt} className="h-full w-full object-cover group-hover:scale-105 transition-transform duration-500" />
                  )}
                </div>
                <div className="p-3 border-t border-white/10">
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <span className="font-mono text-[8px] text-acid uppercase tracking-widest">
                      {item.generation_type}
                    </span>
                    <span className="font-mono text-[8px] text-white/30 uppercase tracking-widest truncate">
                      {item.model}
                    </span>
                  </div>
                  <p className="font-mono text-[9px] text-white/55 uppercase leading-relaxed line-clamp-3">
                    {item.prompt}
                  </p>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
