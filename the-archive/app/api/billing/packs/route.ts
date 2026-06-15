import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabaseAdmin';
import { isBillingEnabled } from '@/lib/billing';

export const dynamic = 'force-dynamic';

export async function GET() {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from('credit_packs')
    .select('id, name, description, price_usd, image_credits, video_credits, lemonsqueezy_variant_id, sort_order, is_active')
    .eq('is_active', true)
    .order('sort_order', { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ packs: data ?? [], billing_enabled: isBillingEnabled() });
}
