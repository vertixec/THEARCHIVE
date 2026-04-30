import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabaseServer';
import {
  getProfileMetrics,
  getRecentActivity,
  getTopCategories,
  type ProfileRow,
} from '@/lib/profileMetrics';
import ProfileContent from '@/components/ProfileContent';

export const dynamic = 'force-dynamic';

export default async function ProfilePage() {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single<ProfileRow>();

  if (!profile) redirect('/login');

  const [metrics, activity, topCategories] = await Promise.all([
    getProfileMetrics(supabase, user.id, profile),
    getRecentActivity(supabase, user.id, 10),
    getTopCategories(supabase, user.id),
  ]);

  return (
    <ProfileContent
      profile={profile}
      metrics={metrics}
      activity={activity}
      topCategories={topCategories}
    />
  );
}
