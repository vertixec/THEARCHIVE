'use client';

import { useEffect, useState } from 'react';
import type { CreditPack } from '@/lib/types';
import CreditsPurchaseGrid from '@/components/CreditsPurchaseGrid';

interface Props {
  open: boolean;
  onClose: () => void;
}

type PacksPayload = { packs: CreditPack[]; billingEnabled: boolean };

// Shared across every instance (panel + profile) and across opens, so the
// fetch happens at most once per session and the modal opens with data ready.
let packsPromise: Promise<PacksPayload> | null = null;

function fetchPacks(): Promise<PacksPayload> {
  if (!packsPromise) {
    packsPromise = fetch('/api/billing/packs')
      .then((res) => res.json())
      .then((data) => ({
        packs: (data.packs ?? []) as CreditPack[],
        billingEnabled: data.billing_enabled === true,
      }))
      .catch((err) => {
        packsPromise = null; // allow a retry on the next mount/open
        throw err;
      });
  }
  return packsPromise;
}

export default function CreditsTopUpModal({ open, onClose }: Props) {
  const [packs, setPacks] = useState<CreditPack[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [billingEnabled, setBillingEnabled] = useState(false);
  const loading = open && packs === null && error === null;

  // Prefetch on mount (the modal stays mounted while closed), so packs are
  // already loaded by the time the user opens it.
  useEffect(() => {
    if (packs !== null) return;
    let cancelled = false;
    fetchPacks()
      .then((data) => {
        if (cancelled) return;
        setPacks(data.packs);
        setBillingEnabled(data.billingEnabled);
      })
      .catch(() => {
        if (cancelled) return;
        setError('Could not load packs');
      });
    return () => {
      cancelled = true;
    };
  }, [packs]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[100] overflow-y-auto bg-black/80"
      onClick={onClose}
    >
      <div className="flex min-h-full items-center justify-center p-4 py-10">
        <div
          className="group relative w-full max-w-6xl overflow-hidden border border-white/10 bg-panel p-6 md:p-12"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="film-grain-local" />
        <div className="scanline" />

        <button
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 z-10 font-mono text-[10px] uppercase tracking-[0.25em] text-white/40 hover:text-acid"
        >
          Close [esc]
        </button>

        {/* Same header as the /pricing page */}
        <div className="mb-12 mx-auto max-w-3xl text-center">
          <div className="mb-4 inline-block bg-acid px-3 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.3em] text-black">
            Pricing
          </div>
          <h2 className="font-anton text-5xl uppercase leading-none tracking-tight md:text-7xl">
            Buy Credits, Create
          </h2>
          <p className="mt-5 mx-auto max-w-2xl font-mono text-xs uppercase leading-relaxed tracking-[0.18em] text-white/45">
            One credit balance for everything. You pay per generation — the cost depends on the
            model and options you pick. Credits never expire.
          </p>
        </div>

        {loading && (
          <div className="text-center font-mono text-[10px] uppercase tracking-widest text-white/45">
            Loading packs...
          </div>
        )}

        {!loading && packs && (
          <CreditsPurchaseGrid packs={packs} isAuthed billingEnabled={billingEnabled} />
        )}

        {error && (
          <div className="mt-4 border border-red-500/30 bg-red-500/10 px-4 py-3 font-mono text-[10px] uppercase tracking-widest text-red-400">
            {error}
          </div>
        )}
        </div>
      </div>
    </div>
  );
}
