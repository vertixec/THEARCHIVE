import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { createClient } from '@/lib/supabaseServer';
import { isActivePlatformUser, getPlanForProfile, resolveAccessTier, type BusinessProfile } from '@/lib/business';
import { listKeys } from '@/lib/mcp/keys';
import McpContent from './McpContent';

export const dynamic = 'force-dynamic';

/** Absolute URL of this deployment, for the copy-paste config snippets. */
async function resolveBaseUrl(): Promise<string> {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/+$/, '');
  if (configured) return configured;
  const headerList = await headers();
  const host = headerList.get('x-forwarded-host') || headerList.get('host');
  const protocol = headerList.get('x-forwarded-proto') || 'https';
  return host ? `${protocol}://${host}` : 'https://your-archive-domain';
}

export default async function McpPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, status, role, access_tier, plan_id')
    .eq('id', user.id)
    .maybeSingle<BusinessProfile>();

  if (!isActivePlatformUser(profile)) redirect('/inactive-membership');

  const keys = await listKeys(user.id).catch(() => []);
  const plan = getPlanForProfile(profile);

  return (
    <McpContent
      initialKeys={keys}
      baseUrl={await resolveBaseUrl()}
      tier={resolveAccessTier(profile)}
      planName={plan.name}
      features={plan.features}
    />
  );
}
