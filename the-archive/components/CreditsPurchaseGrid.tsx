'use client';

import { useState } from 'react';
import type { CreditPack } from '@/lib/types';
import { buyPack } from '@/lib/buyPack';

interface Props {
  packs: CreditPack[];
}

export default function CreditsPurchaseGrid({ packs }: Props) {
  const [pendingPackId, setPendingPackId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  if (packs.length === 0) {
    return (
      <div className="border border-white/10 bg-black/40 p-8 text-center font-mono text-[10px] uppercase tracking-[0.25em] text-white/40">
        No packs available right now
      </div>
    );
  }

  return (
    <div>
      <div className="grid gap-px border border-white/10 bg-white/10 md:grid-cols-3">
        {packs.map((pack) => {
          const isPending = pendingPackId === pack.id;
          const isLocked = !pack.lemonsqueezy_variant_id;
          return (
            <article key={pack.id} className="relative bg-dark p-6 md:p-8">
              <div className="mb-6 flex min-h-24 flex-col gap-3">
                <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-acid">
                  ${pack.price_usd}
                </p>
                <h2 className="font-bebas text-5xl uppercase tracking-tight">{pack.name}</h2>
                {pack.description && (
                  <p className="font-mono text-[10px] uppercase leading-relaxed tracking-widest text-white/45">
                    {pack.description}
                  </p>
                )}
              </div>

              <div className="mb-8 bg-white/10 p-px">
                <Stat label="Credits" value={pack.image_credits + pack.video_credits} />
              </div>

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
                {isLocked ? 'Coming soon' : isPending ? 'Redirecting...' : `Buy for $${pack.price_usd}`}
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
