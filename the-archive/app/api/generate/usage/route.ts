import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabaseServer';

const IMAGE_LIMIT = 10;
const VIDEO_LIMIT = 2;

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const yearMonth = new Date().toISOString().slice(0, 7);

  const { data, error } = await supabase
    .from('user_generation_usage')
    .select('image_count, video_count')
    .eq('user_id', user.id)
    .eq('year_month', yearMonth)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: 'Usage lookup failed' }, { status: 500 });
  }

  return NextResponse.json({
    image_count: data?.image_count ?? 0,
    video_count: data?.video_count ?? 0,
    image_limit: IMAGE_LIMIT,
    video_limit: VIDEO_LIMIT,
  });
}
