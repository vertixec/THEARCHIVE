import type { SupabaseClient } from '@supabase/supabase-js';

export type ProfileRow = {
  id: string;
  email: string | null;
  full_name: string | null;
  username: string | null;
  avatar_url: string | null;
  is_public: boolean;
  status: string | null;
  role: string | null;
  created_at: string;
  updated_at: string;
};

export type ProfileMetrics = {
  likes_count: number;
  boards_count: number;
  items_count: number;
  days_since_join: number;
  completion_pct: number;
};

export type ActivityEvent = {
  type: 'like' | 'board';
  label: string;
  item_type?: string;
  created_at: string;
};

export type CategoryStat = {
  label: string;
  count: number;
};

const ITEM_TYPE_LABEL: Record<string, string> = {
  visual: 'VISUALS',
  system: 'SYSTEMS',
  community: 'COMMUNITY',
  workflow: 'WORKFLOWS',
};

export async function getProfileMetrics(
  supabase: SupabaseClient,
  userId: string,
  profile: ProfileRow,
): Promise<ProfileMetrics> {
  const [likesRes, boardsRes] = await Promise.all([
    supabase.from('user_likes').select('id', { count: 'exact', head: true }).eq('user_id', userId),
    supabase.from('boards').select('id').eq('user_id', userId),
  ]);

  const boardIds = (boardsRes.data ?? []).map((b) => b.id);

  let itemsCount = 0;
  if (boardIds.length > 0) {
    const { count } = await supabase
      .from('board_items')
      .select('id', { count: 'exact', head: true })
      .in('board_id', boardIds);
    itemsCount = count ?? 0;
  }

  const joinDate = new Date(profile.created_at);
  const daysSinceJoin = Math.max(
    0,
    Math.floor((Date.now() - joinDate.getTime()) / (1000 * 60 * 60 * 24)),
  );

  const filledFields = [
    Boolean(profile.full_name),
    Boolean(profile.username),
    profile.is_public !== null && profile.is_public !== undefined,
  ].filter(Boolean).length;
  const completionPct = Math.round((filledFields / 3) * 100);

  return {
    likes_count: likesRes.count ?? 0,
    boards_count: boardIds.length,
    items_count: itemsCount,
    days_since_join: daysSinceJoin,
    completion_pct: completionPct,
  };
}

export async function getRecentActivity(
  supabase: SupabaseClient,
  userId: string,
  limit = 10,
): Promise<ActivityEvent[]> {
  const [likesRes, boardsRes] = await Promise.all([
    supabase
      .from('user_likes')
      .select('item_id, item_type, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(limit),
    supabase
      .from('boards')
      .select('name, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(limit),
  ]);

  const likeEvents: ActivityEvent[] = (likesRes.data ?? []).map((l) => ({
    type: 'like',
    label: `Liked a ${ITEM_TYPE_LABEL[l.item_type] ?? l.item_type.toUpperCase()} item`,
    item_type: l.item_type,
    created_at: l.created_at,
  }));

  const boardEvents: ActivityEvent[] = (boardsRes.data ?? []).map((b) => ({
    type: 'board',
    label: `Created moodboard "${b.name}"`,
    created_at: b.created_at,
  }));

  return [...likeEvents, ...boardEvents]
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, limit);
}

export async function getTopCategories(
  supabase: SupabaseClient,
  userId: string,
): Promise<CategoryStat[]> {
  const { data: likes } = await supabase
    .from('user_likes')
    .select('item_type')
    .eq('user_id', userId);

  if (!likes || likes.length === 0) return [];

  const counts = new Map<string, number>();
  for (const like of likes) {
    const key = ITEM_TYPE_LABEL[like.item_type] ?? like.item_type.toUpperCase();
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  return [...counts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 3);
}

export function getInitials(name: string | null | undefined, fallback = '?'): string {
  if (!name) return fallback;
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return fallback;
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

export function formatJoinDate(iso: string): string {
  const d = new Date(iso);
  return d
    .toLocaleString('en-US', { month: 'short', year: 'numeric' })
    .toUpperCase();
}

export function formatRelative(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60000);
  if (min < 1) return 'JUST NOW';
  if (min < 60) return `${min}M AGO`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}H AGO`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}D AGO`;
  const mo = Math.floor(day / 30);
  if (mo < 12) return `${mo}MO AGO`;
  return `${Math.floor(mo / 12)}Y AGO`;
}
