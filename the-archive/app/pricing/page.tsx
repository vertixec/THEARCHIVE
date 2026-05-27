import Link from 'next/link';
import { createClient } from '@/lib/supabaseServer';
import { PLAN_CONFIG, resolveAccessTier, type AccessTier, type BusinessProfile } from '@/lib/business';

export const dynamic = 'force-dynamic';

const PUBLIC_PLANS = [PLAN_CONFIG.free, PLAN_CONFIG.community, PLAN_CONFIG.pro];

async function getCurrentTier(): Promise<AccessTier | null> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, status, role, access_tier, plan_id')
    .eq('id', user.id)
    .maybeSingle<BusinessProfile>();

  return resolveAccessTier(profile ?? null);
}

export default async function PricingPage() {
  const currentTier = await getCurrentTier();
  const currentPlan = currentTier ? PLAN_CONFIG[currentTier] : null;

  return (
    <main className="min-h-screen bg-dark text-white px-6 py-16 md:px-12">
      <section className="mx-auto max-w-6xl">
        <div className="mb-12 max-w-3xl">
          <div className="mb-4 inline-block bg-acid px-3 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.3em] text-black">
            Public Beta Plan
          </div>
          <h1 className="font-anton text-6xl uppercase leading-none tracking-tight md:text-8xl">
            Choose Your Archive Access
          </h1>
          <p className="mt-5 max-w-2xl font-mono text-xs uppercase leading-relaxed tracking-[0.18em] text-white/45">
            THE ARCHIVE is becoming a public creative operating system. Start free, keep the
            private community as the premium layer, and add credits when you need more output.
          </p>

          {currentPlan && (
            <div className="mt-8 inline-flex items-center gap-3 border border-acid/40 bg-acid/[0.08] px-4 py-2.5">
              <span className="h-2 w-2 rounded-full bg-acid shadow-[0_0_10px_rgba(200,255,0,0.7)]" />
              <span className="font-mono text-[10px] uppercase tracking-[0.25em] text-white/55">
                Current plan:
              </span>
              <span className="font-bebas text-xl uppercase tracking-wide text-acid">
                {currentPlan.name}
              </span>
            </div>
          )}
        </div>

        <div className="grid gap-px border border-white/10 bg-white/10 md:grid-cols-3">
          {PUBLIC_PLANS.map((plan) => {
            const isCurrent = currentTier === plan.id;
            return (
              <article
                key={plan.id}
                className={`relative bg-dark p-6 md:p-8 ${isCurrent ? 'ring-1 ring-inset ring-acid/60' : ''}`}
              >
                {isCurrent && (
                  <div className="absolute right-0 top-0 bg-acid px-3 py-1 font-mono text-[9px] font-bold uppercase tracking-[0.3em] text-black">
                    Your plan
                  </div>
                )}

                <div className="mb-6 flex min-h-24 flex-col justify-between gap-4">
                  <div>
                    <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-acid">
                      {plan.label}
                    </p>
                    <h2 className="mt-2 font-bebas text-5xl uppercase tracking-tight">
                      {plan.name}
                    </h2>
                  </div>
                  <p className="font-mono text-[10px] uppercase leading-relaxed tracking-widest text-white/45">
                    {plan.description}
                  </p>
                </div>

                <div className="mb-8 grid grid-cols-2 gap-px bg-white/10">
                  <Stat label="Images / mo" value={plan.monthlyImageLimit} />
                  <Stat label="Videos / mo" value={plan.monthlyVideoLimit} />
                </div>

                <ul className="mb-8 space-y-3 font-mono text-[10px] uppercase tracking-widest text-white/60">
                  <li className="border-b border-white/5 pb-3">
                    {plan.features.includes('view_systems') ? 'Systems library included' : 'Preview access'}
                  </li>
                  <li className="border-b border-white/5 pb-3">
                    {plan.features.includes('view_workflows') ? 'Workflows included' : 'Basic workspace'}
                  </li>
                  <li className="border-b border-white/5 pb-3">
                    {plan.id === 'community' ? 'Best value for Skool members' : 'Credit packs coming next'}
                  </li>
                </ul>

                {isCurrent ? (
                  <div className="block border border-acid/40 bg-acid/[0.08] px-5 py-3 text-center font-mono text-[10px] uppercase tracking-[0.25em] text-acid">
                    Currently active
                  </div>
                ) : (
                  <Link
                    href={plan.id === 'community' ? '/inactive-membership' : '/login'}
                    className={`block border px-5 py-3 text-center font-mono text-[10px] uppercase tracking-[0.25em] transition-colors ${
                      plan.id === 'community'
                        ? 'border-acid bg-acid text-black hover:bg-white'
                        : 'border-white/15 text-white/70 hover:border-acid hover:text-acid'
                    }`}
                  >
                    {plan.id === 'free' ? 'Create Free Profile' : plan.id === 'community' ? 'Join Community' : 'Coming Soon'}
                  </Link>
                )}
              </article>
            );
          })}
        </div>
      </section>
    </main>
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
