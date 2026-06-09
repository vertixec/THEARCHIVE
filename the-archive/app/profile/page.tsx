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

type CreditBalance = {
  credits: number;
  video_credits: number;
  monthly_credits: number;
  monthly_credits_reset_at: string | null;
  updated_at: string;
};

type CreditTransaction = {
  id: string;
  amount: number;
  balance_after: number | null;
  credit_type: string;
  reason: string;
  created_at: string;
  metadata: Record<string, unknown> | null;
};

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

  const [metrics, activity, topCategories, balanceResult, transactionsResult] = await Promise.all([
    getProfileMetrics(supabase, user.id, profile),
    getRecentActivity(supabase, user.id, 10),
    getTopCategories(supabase, user.id),
    supabase
      .from('user_credit_balances')
      .select('credits, video_credits, monthly_credits, monthly_credits_reset_at, updated_at')
      .eq('user_id', user.id)
      .maybeSingle<CreditBalance>(),
    supabase
      .from('credit_transactions')
      .select('id, amount, balance_after, credit_type, reason, created_at, metadata')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(20)
      .returns<CreditTransaction[]>(),
  ]);

  return (
    <ProfileContent
      profile={profile}
      metrics={metrics}
      activity={activity}
      topCategories={topCategories}
      creditBalance={balanceResult.data ?? null}
      creditTransactions={transactionsResult.data ?? []}
    />
  );
}
