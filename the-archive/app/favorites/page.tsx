import { createClient } from '@/lib/supabaseServer';
import FavoritesContent from './FavoritesContent';
import type { AnyItem, ItemType } from '@/lib/types';

type FavoriteItem = AnyItem & {
  id: string | number;
  _itemType: ItemType;
};

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

  const { data: savedGenerations } = await supabase
    .from('generations')
    .select('*')
    .eq('user_id', user.id)
    .eq('is_saved', true)
    .order('created_at', { ascending: false });

  if ((!likes || likes.length === 0) && (!savedGenerations || savedGenerations.length === 0)) {
    return <FavoritesContent initialItems={[]} />;
  }

  const safeLikes = likes || [];
  const visualIds     = safeLikes.filter(l => l.item_type === 'visual').map(l => l.item_id);
  const systemIds     = safeLikes.filter(l => l.item_type === 'system').map(l => l.item_id);
  const communityIds  = safeLikes.filter(l => l.item_type === 'community').map(l => l.item_id);
  const workflowIds   = safeLikes.filter(l => l.item_type === 'workflow').map(l => l.item_id);
  const generationIds = safeLikes.filter(l => l.item_type === 'generation').map(l => l.item_id);

  const fetchPromises: PromiseLike<FavoriteItem[]>[] = [];

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

  if (generationIds.length > 0)
    fetchPromises.push(supabase.from('generations').select('*').in('id', generationIds)
      .then(res => (res.data || []).map(item => ({
        ...item,
        _itemType: 'generation' as const,
        image_url: item.result_url,
        prompt_text: item.prompt,
        title: 'CREATION',
        category: item.generation_type,
      }))));

  const results = await Promise.all(fetchPromises);
  const likedGenerationIds = new Set(generationIds.map(id => id.toString()));
  const savedGenerationItems = (savedGenerations || [])
    .filter(item => !likedGenerationIds.has(item.id.toString()))
    .map(item => ({
      ...item,
      _itemType: 'generation' as const,
      image_url: item.result_url,
      prompt_text: item.prompt,
      title: 'CREATION',
      category: item.generation_type,
    }));
  const allItems = [...results.flat(), ...savedGenerationItems];

  const sortedItems = [
    ...safeLikes
    .map(like => allItems.find(item => item.id.toString() === like.item_id.toString() && item._itemType === like.item_type))
    .filter(Boolean),
    ...savedGenerationItems,
  ];

  return <FavoritesContent initialItems={sortedItems} />;
}
