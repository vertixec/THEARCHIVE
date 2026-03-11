import { createClient } from '@/lib/supabaseServer';
import FavoritesContent from './FavoritesContent';

export default async function FavoritesPage() {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return <FavoritesContent initialItems={[]} />;
  }

  const { data: likes } = await supabase
    .from('user_likes')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false });

  if (!likes || likes.length === 0) {
    return <FavoritesContent initialItems={[]} />;
  }

  const visualIds    = likes.filter(l => l.item_type === 'visual').map(l => l.item_id);
  const systemIds    = likes.filter(l => l.item_type === 'system').map(l => l.item_id);
  const communityIds = likes.filter(l => l.item_type === 'community').map(l => l.item_id);
  const workflowIds  = likes.filter(l => l.item_type === 'workflow').map(l => l.item_id);

  const fetchPromises: PromiseLike<any[]>[] = [];

  if (visualIds.length > 0)
    fetchPromises.push(supabase.from('prompts').select('*').in('id', visualIds)
      .then(res => (res.data || []).map(item => ({ ...item, _itemType: 'visual' as const }))));

  if (systemIds.length > 0)
    fetchPromises.push(supabase.from('functional_prompts').select('*').in('id', systemIds)
      .then(res => (res.data || []).map(item => ({ ...item, _itemType: 'system' as const }))));

  if (communityIds.length > 0)
    fetchPromises.push(supabase.from('community_visuals').select('*').in('id', communityIds)
      .then(res => (res.data || []).map(item => ({ ...item, _itemType: 'community' as const }))));

  if (workflowIds.length > 0)
    fetchPromises.push(supabase.from('workflows').select('*').in('id', workflowIds)
      .then(res => (res.data || []).map(item => ({ ...item, _itemType: 'workflow' as const }))));

  const results = await Promise.all(fetchPromises);
  const allItems = results.flat();

  const sortedItems = likes
    .map(like => allItems.find(item => item.id.toString() === like.item_id.toString() && item._itemType === like.item_type))
    .filter(Boolean);

  return <FavoritesContent initialItems={sortedItems} />;
}
