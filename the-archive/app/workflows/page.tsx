import { createClient } from '@/lib/supabaseServer';
import WorkflowsContent from './WorkflowsContent';

export default async function WorkflowsPage() {
  const supabase = await createClient();
  const { data } = await supabase
    .from('workflows')
    .select('*')
    .order('created_at', { ascending: false });

  return <WorkflowsContent initialItems={data || []} />;
}
