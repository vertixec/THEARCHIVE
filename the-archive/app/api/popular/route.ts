import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabaseServer';
import { createAdminClient } from '@/lib/supabaseAdmin';
import { canAccessFeature, type BusinessProfile, type Feature } from '@/lib/business';

const PAGE_SIZE = 60;

const TABLE_BY_TYPE = {
  visual: 'prompts',
  system: 'functional_prompts',
} as const;

type PopularType = keyof typeof TABLE_BY_TYPE;

const FEATURE_BY_TYPE: Record<PopularType, Feature> = {
  visual: 'view_visuals',
  system: 'view_systems',
};

function isPopularType(value: string | null): value is PopularType {
  return value === 'visual' || value === 'system';
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const type = searchParams.get('type');
  const from = Math.max(0, Number(searchParams.get('from') ?? 0) || 0);

  if (!isPopularType(type)) {
    return NextResponse.json({ error: 'INVALID_TYPE' }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const expandedProfile = await supabase
    .from('profiles')
    .select('id, status, role, access_tier, plan_id')
    .eq('id', user.id)
    .maybeSingle<BusinessProfile>();
  const profile = expandedProfile.error
    ? (
        await supabase
          .from('profiles')
          .select('id, status, role')
          .eq('id', user.id)
          .maybeSingle<BusinessProfile>()
      ).data ?? null
    : expandedProfile.data;

  if (!canAccessFeature(profile, FEATURE_BY_TYPE[type])) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const admin = createAdminClient();

  const { data: likes, error: likesError } = await admin
    .from('user_likes')
    .select('item_id')
    .eq('item_type', type);

  if (likesError) {
    return NextResponse.json({ error: likesError.message }, { status: 500 });
  }

  const counts = new Map<string, number>();
  (likes ?? []).forEach((like) => {
    const id = like.item_id.toString();
    counts.set(id, (counts.get(id) ?? 0) + 1);
  });

  const ranked = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
  const page = ranked.slice(from, from + PAGE_SIZE);
  const pageIds = page.map(([id]) => id);

  if (pageIds.length === 0) {
    return NextResponse.json({ items: [], hasMore: false });
  }

  const { data, error } = await supabase
    .from(TABLE_BY_TYPE[type])
    .select('*')
    .in('id', pageIds);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const order = new Map(page.map(([id, count], index) => [id, { index, count }]));
  const items = (data ?? [])
    .map((item) => ({
      ...item,
      _likeCount: order.get(item.id.toString())?.count ?? 0,
    }))
    .sort((a, b) => {
      const aRank = order.get(a.id.toString())?.index ?? 0;
      const bRank = order.get(b.id.toString())?.index ?? 0;
      return aRank - bRank;
    });

  return NextResponse.json({
    items,
    hasMore: from + PAGE_SIZE < ranked.length,
  });
}
