import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabaseServer';
import type { CreditPack, CreditTransaction, PaymentIntent } from '@/lib/types';
import CreditsPurchaseGrid from '@/components/CreditsPurchaseGrid';

export const dynamic = 'force-dynamic';

type SearchParams = {
  success?: string;
  intent?: string;
};

export default async function CreditsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  const [{ data: balance }, { data: packs }, { data: intents }, { data: transactions }] = await Promise.all([
    supabase
      .from('user_credit_balances')
      .select('credits, video_credits, updated_at')
      .eq('user_id', user.id)
      .maybeSingle<{ credits: number; video_credits: number; updated_at: string | null }>(),
    supabase
      .from('credit_packs')
      .select('id, name, description, price_usd, image_credits, video_credits, lemonsqueezy_variant_id, is_active, sort_order')
      .eq('is_active', true)
      .order('sort_order', { ascending: true }),
    supabase
      .from('payment_intents')
      .select('id, user_id, pack_id, amount_usd, image_credits, video_credits, provider, provider_reference, checkout_url, status, metadata, created_at, confirmed_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(10),
    supabase
      .from('credit_transactions')
      .select('id, user_id, amount, balance_after, credit_type, reason, related_generation_id, payment_provider, payment_reference, metadata, created_at')
      .eq('user_id', user.id)
      .in('reason', ['purchase', 'refund'])
      .order('created_at', { ascending: false })
      .limit(20),
  ]);

  const showSuccess = params.success === '1';

  return (
    <main className="min-h-screen bg-dark text-white px-6 py-16 md:px-12">
      <section className="mx-auto max-w-6xl">
        <header className="mb-12 max-w-3xl">
          <div className="mb-4 inline-block bg-acid px-3 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.3em] text-black">
            Credits & Billing
          </div>
          <h1 className="font-anton text-6xl uppercase leading-none tracking-tight md:text-8xl">
            Top Up Your Archive
          </h1>
          <p className="mt-5 max-w-2xl font-mono text-xs uppercase leading-relaxed tracking-[0.18em] text-white/45">
            Buy credit packs to keep generating. Image and video credits are added instantly after payment.
          </p>
        </header>

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

        <section className="mb-14 grid grid-cols-1 gap-px border border-white/10 bg-white/10 md:grid-cols-2">
          <BalanceCell label="Image credits" value={balance?.credits ?? 0} />
          <BalanceCell label="Video credits" value={balance?.video_credits ?? 0} />
        </section>

        <CreditsPurchaseGrid packs={(packs ?? []) as CreditPack[]} />

        <section className="mt-14">
          <h2 className="mb-6 font-anton text-3xl uppercase tracking-tight md:text-4xl">Purchase History</h2>
          <HistoryList
            intents={(intents ?? []) as PaymentIntent[]}
            transactions={(transactions ?? []) as CreditTransaction[]}
          />
        </section>

        <div className="mt-12">
          <Link
            href="/pricing"
            className="font-mono text-[10px] uppercase tracking-[0.25em] text-white/45 underline-offset-4 hover:text-acid hover:underline"
          >
            See all access tiers &rarr;
          </Link>
        </div>
      </section>
    </main>
  );
}

function BalanceCell({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-dark p-6 md:p-8">
      <div className="font-mono text-[10px] uppercase tracking-[0.3em] text-acid">{label}</div>
      <div className="mt-3 font-bebas text-7xl leading-none">{value}</div>
    </div>
  );
}

function HistoryList({
  intents,
  transactions,
}: {
  intents: PaymentIntent[];
  transactions: CreditTransaction[];
}) {
  if (intents.length === 0 && transactions.length === 0) {
    return (
      <div className="border border-white/10 bg-black/40 p-8 text-center font-mono text-[10px] uppercase tracking-[0.25em] text-white/40">
        No purchases yet
      </div>
    );
  }

  return (
    <div className="border border-white/10 bg-black/40">
      {intents.map((intent) => (
        <div
          key={intent.id}
          className="grid grid-cols-12 items-center gap-3 border-b border-white/5 px-5 py-4 font-mono text-[10px] uppercase tracking-widest last:border-b-0"
        >
          <span className="col-span-3 text-white/40">
            {new Date(intent.created_at).toLocaleDateString()}
          </span>
          <span className="col-span-3 text-white/70">{intent.pack_id}</span>
          <span className="col-span-2 text-acid">${intent.amount_usd}</span>
          <span className="col-span-2 text-white/45">
            +{intent.image_credits} img / +{intent.video_credits} vid
          </span>
          <span
            className={
              'col-span-2 text-right ' +
              (intent.status === 'confirmed'
                ? 'text-acid'
                : intent.status === 'refunded'
                  ? 'text-orange-400'
                  : intent.status === 'failed'
                    ? 'text-red-400'
                    : 'text-white/40')
            }
          >
            {intent.status}
          </span>
        </div>
      ))}
    </div>
  );
}
