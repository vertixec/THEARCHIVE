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

  return <MoodboardDetailContent board={board} items={items || []} />;
}
