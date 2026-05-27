import Link from 'next/link';

const LAST_UPDATED = '2026-05-26';

export const metadata = {
  title: 'AI Acceptable Use Policy — THE ARCHIVE',
  description: 'Rules for generating content on THE ARCHIVE.',
};

export default function AIPolicyPage() {
  return (
    <main className="min-h-screen bg-dark px-6 py-16 text-white md:px-12">
      <section className="mx-auto max-w-3xl">
        <div className="mb-4 inline-block bg-acid px-3 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.3em] text-black">
          Legal
        </div>
        <h1 className="font-anton text-5xl uppercase leading-none tracking-tight md:text-7xl">
          AI Acceptable Use
        </h1>
        <p className="mt-4 font-mono text-[10px] uppercase tracking-[0.25em] text-white/45">
          Last updated: {LAST_UPDATED}
        </p>

        <div className="mt-10 space-y-8 font-mono text-xs leading-relaxed text-white/70">
          <section>
            <p>
              THE ARCHIVE gives creators access to powerful generative models. Power requires
              rules. By using the Service you agree not to generate or share content that falls
              into any of the categories below.
            </p>
          </section>

          <section>
            <h2 className="font-bebas text-2xl uppercase tracking-wider text-white">Prohibited content</h2>
            <ul className="mt-3 list-disc space-y-2 pl-5">
              <li>
                Child sexual abuse material (CSAM), or any sexualized depiction of minors. Zero
                tolerance — accounts are terminated and reported.
              </li>
              <li>
                Non-consensual intimate imagery, including sexual deepfakes of real people.
              </li>
              <li>
                Content that incites violence against people based on protected characteristics
                (race, ethnicity, religion, gender, sexual orientation, disability, nationality).
              </li>
              <li>
                Realistic depictions of identifiable private individuals without a credible basis
                (parody, public commentary on a public figure is permitted).
              </li>
              <li>
                Instructions, weapon designs, or images intended to enable real-world violence,
                terrorism, or mass casualties.
              </li>
              <li>
                Content designed to defraud, including fake IDs, fake currency, fake signatures,
                or impersonation of officials or brands.
              </li>
              <li>
                Material that infringes copyright, trademark, or other IP held by third parties.
              </li>
              <li>
                Malware, phishing pages, or other content built to harm computer systems.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="font-bebas text-2xl uppercase tracking-wider text-white">Disclosure</h2>
            <p className="mt-3">
              If you publish content generated through THE ARCHIVE, you must disclose AI use when
              required by the platform of publication or by applicable law (EU AI Act, state
              disclosure laws, ad platform rules, etc.). You are responsible for compliance in
              your jurisdiction.
            </p>
          </section>

          <section>
            <h2 className="font-bebas text-2xl uppercase tracking-wider text-white">Reporting and enforcement</h2>
            <p className="mt-3">
              To report a violation, email vertix.ia@gmail.com. We may review generations to
              investigate abuse reports. Violations may result in content removal, credit
              forfeiture, account suspension, or termination. Severe violations are reported to
              authorities.
            </p>
          </section>

          <section>
            <h2 className="font-bebas text-2xl uppercase tracking-wider text-white">Model provider terms</h2>
            <p className="mt-3">
              Our underlying providers (currently FAL.ai and its partner labs) have their own
              acceptable use rules. Your use of the Service must also comply with theirs.
            </p>
          </section>

          <section>
            <h2 className="font-bebas text-2xl uppercase tracking-wider text-white">Updates</h2>
            <p className="mt-3">
              We may update this policy as risks and regulations evolve. Continued use means you
              accept the current version.
            </p>
          </section>

          <p className="border-t border-white/10 pt-6 text-[10px] uppercase tracking-[0.25em] text-white/35">
            Also see our{' '}
            <Link href="/terms" className="text-acid underline-offset-4 hover:underline">
              Terms of Service
            </Link>{' '}and{' '}
            <Link href="/privacy" className="text-acid underline-offset-4 hover:underline">
              Privacy Policy
            </Link>
            . This document is a working draft and must be reviewed by qualified legal counsel
            before commercial launch.
          </p>
        </div>
      </section>
    </main>
  );
}
