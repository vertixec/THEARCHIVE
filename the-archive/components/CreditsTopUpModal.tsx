'use client';

import { useEffect, useState } from 'react';
import type { CreditPack } from '@/lib/types';
import { buyPack } from '@/lib/buyPack';
import { baselinePerCredit, packDisplay } from '@/lib/creditPacks';

interface Props {
  open: boolean;
  onClose: () => void;
}

export default function CreditsTopUpModal({ open, onClose }: Props) {
  const [packs, setPacks] = useState<CreditPack[] | null>(null);
  const [pendingPackId, setPendingPackId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [billingEnabled, setBillingEnabled] = useState(false);
  const loading = open && packs === null && error === null;

  useEffect(() => {
    if (!open || packs !== null) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/billing/packs');
        const data = await res.json();
        if (cancelled) return;
        setPacks((data.packs ?? []) as CreditPack[]);
        setBillingEnabled(data.billing_enabled === true);
      } catch {
        if (cancelled) return;
        setError('Could not load packs');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, packs]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  async function handleBuy(packId: string) {
    setPendingPackId(packId);
    setError(null);
    try {
      await buyPack(packId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Checkout failed');
      setPendingPackId(null);
    }
  }

  const baseline = packs ? baselinePerCredit(packs) : 0;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 p-4"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-3xl border border-white/10 bg-dark p-6 md:p-10"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 font-mono text-[10px] uppercase tracking-[0.25em] text-white/40 hover:text-acid"
        >
          Close [esc]
        </button>

        <div className="mb-6 inline-block bg-acid px-3 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.3em] text-black">
          Top Up Credits
        </div>
        <h2 className="font-anton text-4xl uppercase leading-none tracking-tight md:text-6xl">
          Buy More Credits
        </h2>
        <p className="mt-3 max-w-lg font-mono text-[11px] uppercase leading-relaxed tracking-widest text-white/45">
          Credits are added to your balance instantly after payment.
        </p>

        {loading && (
          <div className="mt-8 font-mono text-[10px] uppercase tracking-widest text-white/45">
            Loading packs...
          </div>
        )}

        {!loading && packs && packs.length === 0 && (
          <div className="mt-8 font-mono text-[10px] uppercase tracking-widest text-white/45">
            No packs available
          </div>
        )}

        {!loading && packs && packs.length > 0 && (
          <div className="mt-8 grid gap-px border border-white/10 bg-white/10 md:grid-cols-3">
            {packs.map((pack) => {
              const isPending = pendingPackId === pack.id;
              const isLocked = !billingEnabled || !pack.lemonsqueezy_variant_id;
              const { credits, images, videos, savings, badge } = packDisplay(pack, baseline);
              return (
                <button
                  key={pack.id}
                  type="button"
                  disabled={isPending || isLocked}
                  onClick={() => handleBuy(pack.id)}
                  className={
                    'relative flex flex-col items-start bg-dark p-5 text-left transition-colors ' +
                    (badge === 'Most Popular' ? 'ring-1 ring-inset ring-acid/60 ' : '') +
                    (isLocked
                      ? 'cursor-not-allowed opacity-40'
                      : isPending
                        ? 'cursor-wait'
                        : 'hover:bg-acid hover:text-black')
                  }
                >
                  {badge && (
                    <span className="absolute right-0 top-0 bg-acid px-2 py-0.5 font-mono text-[8px] font-bold uppercase tracking-[0.25em] text-black">
                      {badge}
                    </span>
                  )}
                  <span className="flex items-center gap-1.5">
                    <span className="font-mono text-[10px] uppercase tracking-[0.25em] text-acid group-hover:text-black">
                      ${pack.price_usd}
                    </span>
                    {savings > 0 && (
                      <span className="border border-acid/40 px-1 py-0.5 font-mono text-[7px] uppercase tracking-widest text-acid">
                        Save {savings}%
                      </span>
                    )}
                  </span>
                  <span className="mt-2 font-bebas text-3xl uppercase">{pack.name}</span>
                  <span className="mt-3 font-mono text-[9px] uppercase tracking-widest text-white/55">
                    +{credits} credits
                  </span>
                  <span className="mt-1 font-mono text-[8px] uppercase tracking-widest text-white/35">
                    ≈ {images} images · {videos} videos
                  </span>
                  <span className="mt-4 border border-current px-3 py-1.5 font-mono text-[9px] uppercase tracking-[0.25em]">
                    {isLocked ? 'Payments coming soon' : isPending ? 'Redirecting' : 'Buy'}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {error && (
          <div className="mt-4 border border-red-500/30 bg-red-500/10 px-4 py-3 font-mono text-[10px] uppercase tracking-widest text-red-400">
            {error}
          </div>
        )}
      </div>
    </div>
  );
}
