import { Suspense } from 'react';
import { createClient } from '@/lib/supabaseServer';
import VisualsContent from './VisualsContent';

export default async function VisualsPage() {
  const supabase = await createClient();
  const { data } = await supabase
    .from('prompts')
    .select('*')
    .order('created_at', { ascending: false });

  return (
    <Suspense fallback={<div className="p-20 font-mono text-acid">LOADING_VISUALS...</div>}>
      <VisualsContent initialItems={data || []} />
    </Suspense>
  );
}
