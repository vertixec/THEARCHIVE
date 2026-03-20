import { createClient } from '@/lib/supabaseServer';
import CommunityContent from './CommunityContent';

const PAGE_SIZE = 60;

export default async function CommunityPage() {
  const supabase = await createClient();
  const { data } = await supabase
    .from('community_visuals')
    .select('*')
    .order('is_featured', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(PAGE_SIZE);

  const items = data || [];

  return <CommunityContent initialItems={items} hasMore={items.length === PAGE_SIZE} />;
}
