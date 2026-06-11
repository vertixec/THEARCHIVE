import Link from 'next/link';

const LAST_UPDATED = '2026-05-26';

export const metadata = {
  title: 'Privacy Policy — THE ARCHIVE',
  description: 'How THE ARCHIVE collects and uses personal data.',
};

export default function PrivacyPage() {
  return (
    <main className="min-h-screen bg-dark px-6 py-16 text-white md:px-12">
      <section className="mx-auto max-w-3xl">
        <div className="mb-4 inline-block bg-acid px-3 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.3em] text-black">
          Legal
        </div>
        <h1 className="font-anton text-5xl uppercase leading-none tracking-tight md:text-7xl">
          Privacy Policy
        </h1>
        <p className="mt-4 font-mono text-[10px] uppercase tracking-[0.25em] text-white/45">
          Last updated: {LAST_UPDATED}
        </p>

        <div className="mt-10 space-y-8 font-mono text-xs leading-relaxed text-white/70">
          <section>
            <h2 className="font-bebas text-2xl uppercase tracking-wider text-white">1. What we collect</h2>
            <ul className="mt-3 list-disc space-y-2 pl-5">
              <li>Account data: email, name, avatar URL, username.</li>
              <li>Profile data: access tier, plan, onboarding status.</li>
              <li>Usage data: generations, prompts, moodboards, favorites, credit transactions.</li>
              <li>Payment metadata via PayPal (we do not store card numbers).</li>
              <li>Technical data: IP, user agent, log timestamps.</li>
            </ul>
          </section>

          <section>
            <h2 className="font-bebas text-2xl uppercase tracking-wider text-white">2. Why we collect it</h2>
            <ul className="mt-3 list-disc space-y-2 pl-5">
              <li>To run the Service and your account.</li>
              <li>To bill you and enforce credit limits.</li>
              <li>To improve product features and prevent abuse.</li>
              <li>To comply with legal obligations.</li>
            </ul>
          </section>

          <section>
            <h2 className="font-bebas text-2xl uppercase tracking-wider text-white">3. Processors we use</h2>
            <p className="mt-3">
              We share necessary data with the following processors:
            </p>
            <ul className="mt-3 list-disc space-y-2 pl-5">
              <li>Supabase — auth, database, storage.</li>
              <li>FAL.ai — AI generation infrastructure.</li>
              <li>PayPal — payment processing.</li>
              <li>Vercel — hosting and logs.</li>
            </ul>
          </section>

          <section>
            <h2 className="font-bebas text-2xl uppercase tracking-wider text-white">4. Prompts and outputs</h2>
            <p className="mt-3">
              Your prompts and generated outputs are stored to power your history, favorites, and
              moodboards. We may use anonymized or aggregated usage signals to improve the
              Service. We will not publish prompts or outputs marked as private.
            </p>
          </section>

          <section>
            <h2 className="font-bebas text-2xl uppercase tracking-wider text-white">5. Retention</h2>
            <p className="mt-3">
              Account data is kept while your account is active. On deletion we remove personal
              data within 30 days, except where retention is required by law or for fraud
              prevention.
            </p>
          </section>

          <section>
            <h2 className="font-bebas text-2xl uppercase tracking-wider text-white">6. Your rights</h2>
            <p className="mt-3">
              You may request access, correction, export, or deletion of your personal data by
              emailing vertix.ia@gmail.com. We will respond within 30 days.
            </p>
          </section>

          <section>
            <h2 className="font-bebas text-2xl uppercase tracking-wider text-white">7. Cookies</h2>
            <p className="mt-3">
              We use first-party cookies for authentication and session continuity. We do not use
              third-party advertising cookies.
            </p>
          </section>

          <section>
            <h2 className="font-bebas text-2xl uppercase tracking-wider text-white">8. Children</h2>
            <p className="mt-3">
              The Service is not directed to children under 16. If we learn we have collected
              data from a child under 16 we will delete it.
            </p>
          </section>

          <section>
            <h2 className="font-bebas text-2xl uppercase tracking-wider text-white">9. Contact</h2>
            <p className="mt-3">
              Privacy questions: vertix.ia@gmail.com
            </p>
          </section>

          <p className="mt-2 border-t border-white/10 pt-6 text-[10px] uppercase tracking-[0.25em] text-white/35">
            Also see our{' '}
            <Link href="/terms" className="text-acid underline-offset-4 hover:underline">
              Terms of Service
            </Link>{' '}and{' '}
            <Link href="/ai-policy" className="text-acid underline-offset-4 hover:underline">
              AI Acceptable Use Policy
            </Link>
            . This document is a working draft and must be reviewed by qualified legal counsel
            before commercial launch.
          </p>
        </div>
      </section>
    </main>
  );
}
