import { createClient } from '@/lib/supabaseServer';
import SystemsContent from './SystemsContent';

export default async function SystemsPage() {
  const supabase = await createClient();
  const { data } = await supabase
    .from('functional_prompts')
    .select('*')
    .order('created_at', { ascending: false });

  return <SystemsContent initialItems={data || []} />;
}
