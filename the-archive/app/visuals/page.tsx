import { Suspense } from 'react';
import { createClient } from '@/lib/supabaseServer';
import VisualsContent from './VisualsContent';

const PAGE_SIZE = 60;

export default async function VisualsPage() {
  const supabase = await createClient();
  const { data } = await supabase
    .from('prompts')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(PAGE_SIZE);

  const items = data || [];

  return (
    <Suspense fallback={<div className="p-20 font-mono text-acid">LOADING_VISUALS...</div>}>
      <VisualsContent initialItems={items} hasMore={items.length === PAGE_SIZE} />
    </Suspense>
  );
}
