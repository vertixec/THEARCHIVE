import Link from 'next/link';
import { PLAN_CONFIG } from '@/lib/business';

export default function UpgradePage() {
  return (
    <main className="min-h-screen bg-dark text-white px-6 py-16 md:px-12">
      <section className="mx-auto flex max-w-4xl flex-col items-center text-center">
        <div className="mb-5 bg-acid px-3 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.3em] text-black">
          Upgrade Required
        </div>
        <h1 className="font-anton text-6xl uppercase leading-none tracking-tight md:text-8xl">
          This Wing Is Premium
        </h1>
        <p className="mt-6 max-w-2xl font-mono text-xs uppercase leading-relaxed tracking-[0.18em] text-white/45">
          Your current access can explore the core Archive, but this section belongs to the
          Community or future Pro tiers. The gate is now tier-aware, so public beta users can
          exist without diluting the private member experience.
        </p>

        <div className="mt-10 grid w-full gap-px border border-white/10 bg-white/10 md:grid-cols-2">
          <div className="bg-dark p-6 text-left">
            <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-acid">
              {PLAN_CONFIG.community.label}
            </p>
            <h2 className="mt-2 font-bebas text-5xl uppercase">{PLAN_CONFIG.community.name}</h2>
            <p className="mt-3 font-mono text-[10px] uppercase leading-relaxed tracking-widest text-white/45">
              Full content library, community sections, workflows, systems, and higher monthly
              generation limits.
            </p>
          </div>
          <div className="bg-dark p-6 text-left">
            <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-acid">
              {PLAN_CONFIG.pro.label}
            </p>
            <h2 className="mt-2 font-bebas text-5xl uppercase">{PLAN_CONFIG.pro.name}</h2>
            <p className="mt-3 font-mono text-[10px] uppercase leading-relaxed tracking-widest text-white/45">
              Planned public paid tier for users outside the private community who want more
              credits and advanced workflows.
            </p>
          </div>
        </div>

        <div className="mt-10 flex flex-col gap-3 sm:flex-row">
          <Link
            href="/pricing"
            className="bg-acid px-8 py-3 font-mono text-[10px] uppercase tracking-[0.25em] text-black transition-colors hover:bg-white"
          >
            View Access Tiers
          </Link>
          <Link
            href="/"
            className="border border-white/15 px-8 py-3 font-mono text-[10px] uppercase tracking-[0.25em] text-white/60 transition-colors hover:border-acid hover:text-acid"
          >
            Back To Archive
          </Link>
        </div>
      </section>
    </main>
  );
}

