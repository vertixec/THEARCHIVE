import { createClient } from '@/lib/supabaseServer';
import CommunityContent from './CommunityContent';

export default async function CommunityPage() {
  const supabase = await createClient();
  const { data } = await supabase
    .from('community_visuals')
    .select('*')
    .order('is_featured', { ascending: false })
    .order('created_at', { ascending: false });

  return <CommunityContent initialItems={data || []} />;
}
