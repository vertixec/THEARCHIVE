import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabaseServer';

export const dynamic = 'force-dynamic';

export async function GET() {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('credit_packs')
    .select('id, name, description, price_usd, image_credits, video_credits, sort_order, is_active')
    .eq('is_active', true)
    .order('sort_order', { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ packs: data ?? [] });
}
