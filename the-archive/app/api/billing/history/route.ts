import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabaseServer';

export const dynamic = 'force-dynamic';

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { data: intents, error: intentsError } = await supabase
    .from('payment_intents')
    .select('id, pack_id, amount_usd, image_credits, video_credits, status, provider, provider_reference, checkout_url, created_at, confirmed_at')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(20);

  if (intentsError) {
    return NextResponse.json({ error: intentsError.message }, { status: 500 });
  }

  const { data: transactions, error: txError } = await supabase
    .from('credit_transactions')
    .select('id, amount, balance_after, credit_type, reason, payment_provider, payment_reference, metadata, created_at')
    .eq('user_id', user.id)
    .in('reason', ['purchase', 'refund'])
    .order('created_at', { ascending: false })
    .limit(40);

  if (txError) {
    return NextResponse.json({ error: txError.message }, { status: 500 });
  }

  return NextResponse.json({
    intents: intents ?? [],
    transactions: transactions ?? [],
  });
}
