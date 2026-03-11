import { createClient } from '@/lib/supabaseServer';
import MoodboardContent from './MoodboardContent';

export default async function MoodboardPage() {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return <MoodboardContent initialBoards={[]} />;
  }

  const { data: boards } = await supabase
    .from('boards')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false });

  const boardIds = (boards || []).map(b => b.id);
  let boardItemsList: any[] = [];

  if (boardIds.length > 0) {
    const { data } = await supabase
      .from('board_items')
      .select('*')
      .in('board_id', boardIds);
    boardItemsList = data || [];
  }

  const boardsWithMosaic = (boards || []).map(board => {
    const items = boardItemsList.filter(bi => bi.board_id === board.id);
    return {
      ...board,
      mosaicImages: items.slice(0, 6).map(bi => bi.image_url ?? null) as (string | null)[],
      itemCount: items.length,
    };
  });

  return <MoodboardContent initialBoards={boardsWithMosaic} />;
}
