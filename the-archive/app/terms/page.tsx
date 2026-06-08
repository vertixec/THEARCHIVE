import Link from 'next/link';

const LAST_UPDATED = '2026-05-26';

export const metadata = {
  title: 'Terms of Service — THE ARCHIVE',
  description: 'Terms governing use of THE ARCHIVE platform.',
};

export default function TermsPage() {
  return (
    <main className="min-h-screen bg-dark px-6 py-16 text-white md:px-12">
      <section className="mx-auto max-w-3xl">
        <div className="mb-4 inline-block bg-acid px-3 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.3em] text-black">
          Legal
        </div>
        <h1 className="font-anton text-5xl uppercase leading-none tracking-tight md:text-7xl">
          Terms of Service
        </h1>
        <p className="mt-4 font-mono text-[10px] uppercase tracking-[0.25em] text-white/45">
          Last updated: {LAST_UPDATED}
        </p>

        <div className="mt-10 space-y-8 font-mono text-xs leading-relaxed text-white/70">
          <section>
            <h2 className="font-bebas text-2xl uppercase tracking-wider text-white">1. Acceptance</h2>
            <p className="mt-3">
              By creating an account or using THE ARCHIVE (&quot;the Service&quot;), you agree to these
              Terms. If you do not agree, do not use the Service.
            </p>
          </section>

          <section>
            <h2 className="font-bebas text-2xl uppercase tracking-wider text-white">2. The Service</h2>
            <p className="mt-3">
              THE ARCHIVE is a creative platform that provides curated AI prompts, generation
              tooling, moodboards, and community resources. Access is offered through Free,
              Community, Pro, and Admin tiers. Features and limits per tier are described on the
              <Link href="/pricing" className="text-acid underline-offset-4 hover:underline">
                {' '}pricing page
              </Link>{' '}and may change.
            </p>
          </section>

          <section>
            <h2 className="font-bebas text-2xl uppercase tracking-wider text-white">3. Accounts</h2>
            <p className="mt-3">
              You are responsible for keeping your credentials secure and for all activity under
              your account. You must be at least 16 years old to create an account.
            </p>
          </section>

          <section>
            <h2 className="font-bebas text-2xl uppercase tracking-wider text-white">4. Credits and Billing</h2>
            <p className="mt-3">
              Generations consume credits. Purchased credits do not expire unless we state
              otherwise in writing. Monthly plan credits reset each billing cycle and do not
              roll over. Payments are processed by Lemon Squeezy as Merchant of Record. Failed
              generations are refunded automatically when possible. Refunds for purchased credits
              are governed by our{' '}
              <Link href="/refund" className="text-acid underline-offset-4 hover:underline">
                Refund Policy
              </Link>
              .
            </p>
          </section>

          <section>
            <h2 className="font-bebas text-2xl uppercase tracking-wider text-white">5. Acceptable Use</h2>
            <p className="mt-3">
              You agree not to use the Service to generate content that is illegal, infringes
              third-party rights, depicts minors in a sexualized way, harasses real people, or
              violates our{' '}
              <Link href="/ai-policy" className="text-acid underline-offset-4 hover:underline">
                AI Acceptable Use Policy
              </Link>
              . We may suspend accounts that violate these rules.
            </p>
          </section>

          <section>
            <h2 className="font-bebas text-2xl uppercase tracking-wider text-white">6. Ownership of Generated Content</h2>
            <p className="mt-3">
              Subject to your compliance with these Terms and the underlying model providers&apos;
              terms, you own the outputs you generate. The Service retains the right to display
              outputs you choose to make public within community sections of the Service.
            </p>
          </section>

          <section>
            <h2 className="font-bebas text-2xl uppercase tracking-wider text-white">7. Third-Party Models</h2>
            <p className="mt-3">
              Generation is powered by third-party providers (currently FAL.ai and partner
              models). Their terms apply to your generations. Availability or pricing of any
              specific model may change.
            </p>
          </section>

          <section>
            <h2 className="font-bebas text-2xl uppercase tracking-wider text-white">8. Termination</h2>
            <p className="mt-3">
              We may suspend or terminate accounts for violation of these Terms. You may close
              your account at any time. Unused purchased credits may be forfeited on termination
              for cause.
            </p>
          </section>

          <section>
            <h2 className="font-bebas text-2xl uppercase tracking-wider text-white">9. Disclaimers</h2>
            <p className="mt-3">
              The Service is provided &quot;as is&quot;. We do not warrant that generations will be
              accurate, useful, or fit for any specific purpose. To the maximum extent permitted
              by law, our liability for any claim related to the Service is limited to the
              amount you paid to us in the prior twelve months.
            </p>
          </section>

          <section>
            <h2 className="font-bebas text-2xl uppercase tracking-wider text-white">10. Changes</h2>
            <p className="mt-3">
              We may update these Terms. Material changes will be announced in the product or by
              email. Continued use after changes constitutes acceptance.
            </p>
          </section>

          <section>
            <h2 className="font-bebas text-2xl uppercase tracking-wider text-white">11. Contact</h2>
            <p className="mt-3">
              Questions: vertix.ia@gmail.com
            </p>
          </section>

          <p className="border-t border-white/10 pt-6 text-[10px] uppercase tracking-[0.25em] text-white/35">
            This document is a working draft and must be reviewed by qualified legal counsel
            before commercial launch.
          </p>
        </div>
      </section>
    </main>
  );
}
