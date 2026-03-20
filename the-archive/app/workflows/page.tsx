import { createClient } from '@/lib/supabaseServer';
import WorkflowsContent from './WorkflowsContent';

const PAGE_SIZE = 60;

export default async function WorkflowsPage() {
  const supabase = await createClient();
  const { data } = await supabase
    .from('workflows')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(PAGE_SIZE);

  const items = data || [];

  return <WorkflowsContent initialItems={items} hasMore={items.length === PAGE_SIZE} />;
}
