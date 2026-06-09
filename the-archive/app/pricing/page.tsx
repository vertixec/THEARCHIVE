import Link from 'next/link';
import { createClient } from '@/lib/supabaseServer';
import type { CreditPack } from '@/lib/types';
import CreditsPurchaseGrid from '@/components/CreditsPurchaseGrid';

export const dynamic = 'force-dynamic';

export default async function PricingPage({
  searchParams,
}: {
  searchParams: Promise<{ success?: string }>;
}) {
  const params = await searchParams;
  const showSuccess = params.success === '1';
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: packs } = await supabase
    .from('credit_packs')
    .select('id, name, description, price_usd, image_credits, video_credits, lemonsqueezy_variant_id, is_active, sort_order')
    .eq('is_active', true)
    .order('sort_order', { ascending: true });

  return (
    <main className="min-h-screen bg-dark text-white px-6 py-16 md:px-12">
      <section className="mx-auto max-w-6xl">
        <div className="mb-12 mx-auto max-w-3xl text-center">
          <div className="mb-4 inline-block bg-acid px-3 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.3em] text-black">
            Pricing
          </div>
          <h1 className="font-anton text-6xl uppercase leading-none tracking-tight md:text-8xl">
            Buy Credits, Create
          </h1>
          <p className="mt-5 mx-auto max-w-2xl font-mono text-xs uppercase leading-relaxed tracking-[0.18em] text-white/45">
            One credit balance for everything. You pay per generation — the cost depends on the
            model and options you pick. Credits never expire.
          </p>
        </div>

        {showSuccess && (
          <div className="mb-10 border border-acid/40 bg-acid/[0.08] px-5 py-4">
            <div className="font-mono text-[10px] uppercase tracking-[0.25em] text-acid">
              Payment received
            </div>
            <p className="mt-2 font-mono text-[11px] uppercase leading-relaxed tracking-widest text-white/55">
              Your credits will appear in your balance within a few seconds. Refresh if needed.
            </p>
          </div>
        )}

        <CreditsPurchaseGrid packs={(packs ?? []) as CreditPack[]} isAuthed={!!user} />

        {/* Brief access note (content access is separate from credits) */}
        <section className="mt-16 grid gap-px border border-white/10 bg-white/10 md:grid-cols-2">
          <AccessCell
            tier="Free"
            line="Free account + 60 starter credits."
            detail="Create an account, get credits to try the engine, save moodboards and favorites."
          />
          <AccessCell
            tier="Community"
            line="Skool members — full library access."
            detail="Visuals, Systems, Workflows and Community, plus credits to generate. The premium insider layer."
          />
        </section>

        <div className="mt-12 text-center">
          {user ? (
            <Link
              href="/profile"
              className="font-mono text-[10px] uppercase tracking-[0.25em] text-white/45 underline-offset-4 hover:text-acid hover:underline"
            >
              View your balance &amp; history &rarr;
            </Link>
          ) : (
            <Link
              href="/login"
              className="font-mono text-[10px] uppercase tracking-[0.25em] text-white/45 underline-offset-4 hover:text-acid hover:underline"
            >
              Create a free account &rarr;
            </Link>
          )}
        </div>
      </section>
    </main>
  );
}

function AccessCell({ tier, line, detail }: { tier: string; line: string; detail: string }) {
  return (
    <div className="bg-dark p-6 md:p-8">
      <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-acid">{tier}</p>
      <h3 className="mt-2 font-bebas text-3xl uppercase tracking-tight">{line}</h3>
      <p className="mt-3 font-mono text-[10px] uppercase leading-relaxed tracking-widest text-white/45">
        {detail}
      </p>
    </div>
  );
}
