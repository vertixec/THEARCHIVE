import Link from 'next/link';

const LAST_UPDATED = '2026-06-08';

export const metadata = {
  title: 'Refund Policy — THE ARCHIVE',
  description: 'Refund and cancellation policy for THE ARCHIVE credit packs and plans.',
};

export default function RefundPage() {
  return (
    <main className="min-h-screen bg-dark px-6 py-16 text-white md:px-12">
      <section className="mx-auto max-w-3xl">
        <div className="mb-4 inline-block bg-acid px-3 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.3em] text-black">
          Legal
        </div>
        <h1 className="font-anton text-5xl uppercase leading-none tracking-tight md:text-7xl">
          Refund Policy
        </h1>
        <p className="mt-4 font-mono text-[10px] uppercase tracking-[0.25em] text-white/45">
          Last updated: {LAST_UPDATED}
        </p>

        <div className="mt-10 space-y-8 font-mono text-xs leading-relaxed text-white/70">
          <section>
            <h2 className="font-bebas text-2xl uppercase tracking-wider text-white">1. What we sell</h2>
            <p className="mt-3">
              THE ARCHIVE sells digital credit packs (Starter, Creator, and Studio) as one-time
              purchases. Credits are consumed when you generate AI images or videos inside the
              Service. Pricing for each pack is shown on the{' '}
              <Link href="/credits" className="text-acid underline-offset-4 hover:underline">
                credits page
              </Link>
              {' '}before checkout. All payments are processed securely by our payment provider,
              Lemon Squeezy, which acts as Merchant of Record.
            </p>
          </section>

          <section>
            <h2 className="font-bebas text-2xl uppercase tracking-wider text-white">2. 14-day money-back guarantee</h2>
            <p className="mt-3">
              You may request a full refund of any credit-pack purchase within 14 days of the
              transaction, provided you have not consumed a material portion of the purchased
              credits. As a general rule, if fewer than 20% of the credits in a pack have been
              used, we will refund the purchase in full. If a larger portion has been used, we may
              offer a partial refund at our discretion.
            </p>
          </section>

          <section>
            <h2 className="font-bebas text-2xl uppercase tracking-wider text-white">3. Failed or faulty generations</h2>
            <p className="mt-3">
              Credits spent on a generation that fails for a technical reason on our side are
              refunded to your balance automatically. If a generation failed and your balance was
              not restored, contact us and we will correct it.
            </p>
          </section>

          <section>
            <h2 className="font-bebas text-2xl uppercase tracking-wider text-white">4. How to request a refund</h2>
            <p className="mt-3">
              Email{' '}
              <a href="mailto:vertix.ia@gmail.com" className="text-acid underline-offset-4 hover:underline">
                vertix.ia@gmail.com
              </a>{' '}
              from the address on your account, including the order/receipt number from your Lemon
              Squeezy confirmation email and the reason for the request. We aim to respond within
              3 business days. Approved refunds are issued to the original payment method by Lemon
              Squeezy and typically appear within 5–10 business days, depending on your bank.
            </p>
          </section>

          <section>
            <h2 className="font-bebas text-2xl uppercase tracking-wider text-white">5. Exceptions</h2>
            <ul className="mt-3 list-disc space-y-2 pl-5">
              <li>Packs where most or all of the credits have already been consumed.</li>
              <li>Requests made more than 14 days after purchase, except where required by law.</li>
              <li>Accounts terminated for violating our{' '}
                <Link href="/terms" className="text-acid underline-offset-4 hover:underline">
                  Terms of Service
                </Link>{' '}or{' '}
                <Link href="/ai-policy" className="text-acid underline-offset-4 hover:underline">
                  AI Acceptable Use Policy
                </Link>.
              </li>
              <li>Promotional, bonus, or gifted credits, which carry no cash value.</li>
            </ul>
          </section>

          <section>
            <h2 className="font-bebas text-2xl uppercase tracking-wider text-white">6. Chargebacks</h2>
            <p className="mt-3">
              If you believe a charge is incorrect, please contact us first — we can usually
              resolve it faster than a bank dispute. Accounts with fraudulent chargebacks may be
              suspended.
            </p>
          </section>

          <section>
            <h2 className="font-bebas text-2xl uppercase tracking-wider text-white">7. Contact</h2>
            <p className="mt-3">
              Refund and billing questions:{' '}
              <a href="mailto:vertix.ia@gmail.com" className="text-acid underline-offset-4 hover:underline">
                vertix.ia@gmail.com
              </a>
            </p>
          </section>

          <p className="mt-2 border-t border-white/10 pt-6 text-[10px] uppercase tracking-[0.25em] text-white/35">
            Also see our{' '}
            <Link href="/terms" className="text-acid underline-offset-4 hover:underline">
              Terms of Service
            </Link>{' '}and{' '}
            <Link href="/privacy" className="text-acid underline-offset-4 hover:underline">
              Privacy Policy
            </Link>
            .
          </p>
        </div>
      </section>
    </main>
  );
}
