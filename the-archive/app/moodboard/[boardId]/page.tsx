import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabaseServer';
import MoodboardDetailContent from './MoodboardDetailContent';

interface Props {
  params: Promise<{ boardId: string }>;
}

export default async function MoodboardDetailPage({ params }: Props) {
  const { boardId } = await params;
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) notFound();

  const { data: board, error } = await supabase
    .from('boards')
    .select('*')
    .eq('id', boardId)
    .eq('user_id', user.id)
    .single();

  if (error || !board) notFound();

  const { data: items } = await supabase
    .from('board_items')
    .select('*')
    .eq('board_id', boardId)
    .order('created_at', { ascending: false });

  const itemsList = items || [];
  const visualIds = itemsList
    .filter((i) => i.item_type === 'visual')
    .map((i) => i.item_id);

  const promptMap = new Map<string, string>();
  if (visualIds.length > 0) {
    const { data: prompts } = await supabase
      .from('prompts')
      .select('id, prompt_text')
      .in('id', visualIds);
    for (const p of prompts || []) {
      if (p.prompt_text) promptMap.set(p.id, p.prompt_text);
    }
  }

  const enrichedItems = itemsList.map((i) => ({
    ...i,
    prompt_text: i.item_type === 'visual' ? promptMap.get(i.item_id) ?? null : null,
  }));

  return <MoodboardDetailContent board={board} items={enrichedItems} />;
}
