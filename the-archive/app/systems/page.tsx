import { createClient } from '@/lib/supabaseServer';
import SystemsContent from './SystemsContent';

const PAGE_SIZE = 60;

export default async function SystemsPage() {
  const supabase = await createClient();
  const { data, count } = await supabase
    .from('functional_prompts')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false })
    .limit(PAGE_SIZE);

  const items = data || [];

  return <SystemsContent initialItems={items} hasMore={(count ?? 0) > items.length} />;
}
