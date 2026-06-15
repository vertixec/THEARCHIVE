import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabaseAdmin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type ShowcaseRow = {
  id: string | number;
  created_at: string;
  category: string | null;
  model: string | null;
  image_url: string | null;
  volume: string | null;
};

export async function GET() {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('prompts')
    .select('id, created_at, category, model, image_url, volume')
    .not('image_url', 'is', null)
    .order('created_at', { ascending: false })
    .limit(7)
    .returns<ShowcaseRow[]>();

  if (error) {
    return NextResponse.json({ error: 'SHOWCASE_UNAVAILABLE' }, { status: 500 });
  }

  const assets = (data ?? [])
    .filter((item): item is ShowcaseRow & { image_url: string } => typeof item.image_url === 'string')
    .map((item) => ({
      id: String(item.id),
      created_at: item.created_at,
      title: item.category || 'UNNAMED ASSET',
      category: item.volume || 'VISUAL',
      model: item.model || 'SDXL TURBO',
      image_url: item.image_url,
      volume: item.volume || 'GENERAL',
    }));

  return NextResponse.json({ assets });
}
