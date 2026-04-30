import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabaseServer';
import {
  getProfileMetrics,
  getTopCategories,
  type ProfileRow,
} from '@/lib/profileMetrics';
import PublicProfileView from '@/components/PublicProfileView';

export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ username: string }>;
}

export default async function PublicProfilePage({ params }: Props) {
  const { username } = await params;
  const normalized = username.toLowerCase();

  const supabase = await createClient();

  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('username', normalized)
    .eq('is_public', true)
    .single<ProfileRow>();

  if (!profile) notFound();

  const [metrics, topCategories] = await Promise.all([
    getProfileMetrics(supabase, profile.id, profile),
    getTopCategories(supabase, profile.id),
  ]);

  return (
    <PublicProfileView
      profile={profile}
      metrics={metrics}
      topCategories={topCategories}
    />
  );
}
