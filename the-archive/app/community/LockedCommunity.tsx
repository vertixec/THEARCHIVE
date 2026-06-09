/* eslint-disable @next/next/no-img-element */

const SKOOL_URL =
  process.env.NEXT_PUBLIC_SKOOL_URL ||
  process.env.NEXT_PUBLIC_VERTIX_OS_URL ||
  '#';

function LockIcon({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="4" y="11" width="16" height="9" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </svg>
  );
}

// Locked teaser shown to logged-in non-members. Real member visuals are
// rendered behind a heavy blur to create desire, with a CTA to join the Skool.
export default function LockedCommunity({ previews }: { previews: string[] }) {
  // Always paint a full grid; pad with empty tiles if we have few previews.
  const tiles = Array.from({ length: 9 }, (_, i) => previews[i % Math.max(previews.length, 1)] ?? null);

  return (
    <div id="view-content" className="relative min-h-[80vh] overflow-hidden">
      {/* Blurred preview wall */}
      <div className="absolute inset-0 grid grid-cols-2 gap-1 md:grid-cols-3 opacity-40">
        {tiles.map((src, i) =>
          src ? (
            <img
              key={i}
              src={src}
              alt=""
              className="h-full w-full object-cover"
              style={{ filter: 'blur(18px) saturate(0.7)', transform: 'scale(1.1)' }}
            />
          ) : (
            <div key={i} className="h-full w-full bg-panel/40" />
          ),
        )}
      </div>

      {/* Dark scrim */}
      <div className="absolute inset-0 bg-gradient-to-b from-dark/80 via-dark/85 to-dark" />

      {/* Locked message */}
      <div className="relative z-10 flex min-h-[80vh] flex-col items-center justify-center px-6 text-center">
        <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-full border border-acid/40 bg-black/50">
          <LockIcon className="h-7 w-7 text-acid" />
        </div>

        <span className="mb-4 bg-acid px-3 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.3em] text-black">
          Members Only
        </span>

        <h1 className="font-anton text-5xl uppercase leading-none tracking-tight text-white md:text-8xl">
          Community Is
          <br />
          Locked
        </h1>

        <p className="mt-6 max-w-xl font-mono text-[11px] uppercase leading-relaxed tracking-[0.18em] text-white/55">
          The members area — community visuals, exclusive workflows and drops — is
          reserved for the VERTIX Skool community. Join to unlock full access plus
          800 monthly credits.
        </p>

        <div className="mt-10 flex flex-col gap-3 sm:flex-row">
          <a
            href={SKOOL_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="bg-acid px-8 py-3 font-mono text-[10px] font-bold uppercase tracking-[0.25em] text-black transition-colors hover:bg-white"
          >
            Join The Community →
          </a>
          <a
            href="/pricing"
            className="border border-white/15 px-8 py-3 font-mono text-[10px] uppercase tracking-[0.25em] text-white/60 transition-colors hover:border-acid hover:text-acid"
          >
            See What&apos;s Inside
          </a>
        </div>

        <p className="mt-8 font-mono text-[9px] uppercase tracking-[0.3em] text-white/25">
          Already a member? Make sure you signed in with your community email.
        </p>
      </div>
    </div>
  );
}
