import { redirect } from 'next/navigation';

// Pricing and credit top-up are unified on /pricing. Logged-in users buy via
// the popup (CreditsTopUpModal) from the panel/profile; balance & history live
// in /profile. This route stays only so old links (and post-checkout
// redirects) keep working.
export default function CreditsPage() {
  redirect('/pricing');
}
