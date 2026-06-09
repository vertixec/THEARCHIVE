'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { CreditPack } from '@/lib/types';
import { buyPack } from '@/lib/buyPack';
import { baselinePerCredit, packDisplay } from '@/lib/creditPacks';

interface Props {
  packs: CreditPack[];
  /** When false, the buy buttons send the visitor to /login first. */
  isAuthed?: boolean;
  billingEnabled?: boolean;
}

export default function CreditsPurchaseGrid({ packs, isAuthed = true, billingEnabled = false }: Props) {
  const router = useRouter();
  const [pendingPackId, setPendingPackId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleBuy(packId: string) {
    // Visitors can't check out — send them to sign in first.
    if (!isAuthed) {
      router.push('/login');
      return;
    }
    setPendingPackId(packId);
    setError(null);
    try {
      await buyPack(packId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Checkout failed');
      setPendingPackId(null);
    }
  }

  if (packs.length === 0) {
    return (
      <div className="border border-white/10 bg-black/40 p-8 text-center font-mono text-[10px] uppercase tracking-[0.25em] text-white/40">
        No packs available right now
      </div>
    );
  }

  // Highest $/credit across packs = baseline; savings on bigger packs are real.
  const baseline = baselinePerCredit(packs);

  return (
    <div>
      <div className="grid gap-px border border-white/10 bg-white/10 md:grid-cols-3">
        {packs.map((pack) => {
          const isPending = pendingPackId === pack.id;
          const isLocked = !billingEnabled || !pack.lemonsqueezy_variant_id;
          const { credits, images, videos, savings, badge } = packDisplay(pack, baseline);
          const featured = badge === 'Most Popular';
          return (
            <article
              key={pack.id}
              className={
                'relative bg-dark p-6 md:p-8 ' +
                (featured ? 'ring-1 ring-inset ring-acid/60' : '')
              }
            >
              {badge && (
                <div className="absolute right-0 top-0 bg-acid px-3 py-1 font-mono text-[9px] font-bold uppercase tracking-[0.3em] text-black">
                  {badge}
                </div>
              )}
              <div className="mb-6 flex min-h-24 flex-col gap-3">
                <div className="flex items-center gap-2">
                  <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-acid">
                    ${pack.price_usd}
                  </p>
                  {savings > 0 && (
                    <span className="border border-acid/40 px-1.5 py-0.5 font-mono text-[8px] uppercase tracking-widest text-acid">
                      Save {savings}%
                    </span>
                  )}
                </div>
                <h2 className="font-bebas text-5xl uppercase tracking-tight">{pack.name}</h2>
                {pack.description && (
                  <p className="font-mono text-[10px] uppercase leading-relaxed tracking-widest text-white/45">
                    {pack.description}
                  </p>
                )}
              </div>

              <div className="mb-3 bg-white/10 p-px">
                <Stat label="Credits" value={credits} />
              </div>
              <p className="mb-8 text-center font-mono text-[9px] uppercase tracking-widest text-white/40">
                ≈ {images.toLocaleString()} images · {videos} videos
              </p>

              <button
                type="button"
                disabled={isPending || isLocked}
                onClick={() => handleBuy(pack.id)}
                className={
                  'block w-full border px-5 py-3 text-center font-mono text-[10px] uppercase tracking-[0.25em] transition-colors ' +
                  (isLocked
                    ? 'cursor-not-allowed border-white/10 text-white/30'
                    : isPending
                      ? 'cursor-wait border-acid/40 bg-acid/10 text-acid'
                      : 'border-acid bg-acid text-black hover:bg-white')
                }
              >
                {isLocked
                  ? 'Payments coming soon'
                  : isPending
                    ? 'Redirecting...'
                    : isAuthed
                      ? `Buy for $${pack.price_usd}`
                      : 'Sign in to buy'}
              </button>
            </article>
          );
        })}
      </div>

      {error && (
        <div className="mt-4 border border-red-500/30 bg-red-500/10 px-4 py-3 font-mono text-[10px] uppercase tracking-widest text-red-400">
          {error}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-black/60 p-4 text-center">
      <div className="font-bebas text-4xl text-white">{value}</div>
      <div className="font-mono text-[8px] uppercase tracking-widest text-white/35">{label}</div>
    </div>
  );
}
