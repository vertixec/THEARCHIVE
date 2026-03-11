import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabaseServer';
import BoardContent from './BoardContent';

interface Props {
  params: Promise<{ boardId: string }>;
}

export default async function BoardPage({ params }: Props) {
  const { boardId } = await params;
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) notFound();

  const { data: board, error: boardError } = await supabase
    .from('boards')
    .select('*')
    .eq('id', boardId)
    .single();

  if (boardError || !board) notFound();

  const { data: boardItems } = await supabase
    .from('board_items')
    .select('*')
    .eq('board_id', boardId)
    .order('created_at', { ascending: false });

  if (!boardItems || boardItems.length === 0) {
    return <BoardContent board={board} initialItems={[]} />;
  }

  const visualIds    = boardItems.filter(bi => bi.item_type === 'visual').map(bi => bi.item_id);
  const systemIds    = boardItems.filter(bi => bi.item_type === 'system').map(bi => bi.item_id);
  const communityIds = boardItems.filter(bi => bi.item_type === 'community').map(bi => bi.item_id);
  const workflowIds  = boardItems.filter(bi => bi.item_type === 'workflow').map(bi => bi.item_id);

  const fetchPromises: PromiseLike<any[]>[] = [];

  if (visualIds.length > 0)
    fetchPromises.push(supabase.from('prompts').select('*').in('id', visualIds)
      .then(r => (r.data || []).map(item => ({ ...item, _itemType: 'visual' as const }))));

  if (systemIds.length > 0)
    fetchPromises.push(supabase.from('functional_prompts').select('*').in('id', systemIds)
      .then(r => (r.data || []).map(item => ({ ...item, _itemType: 'system' as const }))));

  if (communityIds.length > 0)
    fetchPromises.push(supabase.from('community_visuals').select('*').in('id', communityIds)
      .then(r => (r.data || []).map(item => ({ ...item, _itemType: 'community' as const }))));

  if (workflowIds.length > 0)
    fetchPromises.push(supabase.from('workflows').select('*').in('id', workflowIds)
      .then(r => (r.data || []).map(item => ({ ...item, _itemType: 'workflow' as const }))));

  const results = await Promise.all(fetchPromises);
  const allItems = results.flat();

  const sortedItems = boardItems
    .map(bi => allItems.find(item => item.id.toString() === bi.item_id && item._itemType === bi.item_type))
    .filter(Boolean);

  return <BoardContent board={board} initialItems={sortedItems} />;
}
