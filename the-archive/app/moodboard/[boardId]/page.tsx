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

  const itemsList = items || [];
  const visualIds = itemsList
    .filter((i) => i.item_type === 'visual')
    .map((i) => i.item_id);
  const systemIds = itemsList
    .filter((i) => i.item_type === 'system')
    .map((i) => i.item_id);

  type PromptMeta = {
    prompt_text: string | null;
    model: string | null;
    title: string | null;
    category: string | null;
    volume: string | null;
    prompt_type: string | null;
    instructions: string | null;
  };
  const metaMap = new Map<string, PromptMeta>();

  if (visualIds.length > 0) {
    // NOTE: the `prompts` table has no `title` column — selecting it makes the
    // whole query fail (data => null) and silently drops all enrichment.
    const { data: prompts } = await supabase
      .from('prompts')
      .select('id, prompt_text, model, category, volume')
      .in('id', visualIds);
    for (const p of prompts || []) {
      // prompts.id is bigint (returned as a JS number) but board_items.item_id
      // is text. Key the map by String() so the get() below actually matches —
      // otherwise Map(123) !== Map("123") and every lookup silently misses.
      metaMap.set(String(p.id), {
        prompt_text: p.prompt_text ?? null,
        model: p.model ?? null,
        title: null,
        category: p.category ?? null,
        volume: p.volume ?? null,
        prompt_type: null,
        instructions: null,
      });
    }
  }

  if (systemIds.length > 0) {
    const { data: systems } = await supabase
      .from('functional_prompts')
      .select('id, prompt_text, model, title, prompt_type, instructions')
      .in('id', systemIds);
    for (const s of systems || []) {
      metaMap.set(String(s.id), {
        prompt_text: s.prompt_text ?? null,
        model: s.model ?? null,
        title: s.title ?? null,
        category: null,
        volume: null,
        prompt_type: s.prompt_type ?? null,
        instructions: s.instructions ?? null,
      });
    }
  }

  const enrichedItems = itemsList.map((i) => {
    const meta = (i.item_type === 'visual' || i.item_type === 'system')
      ? metaMap.get(String(i.item_id))
      : undefined;
    return {
      ...i,
      prompt_text: meta?.prompt_text ?? null,
      model: meta?.model ?? null,
      title: meta?.title ?? null,
      category: meta?.category ?? null,
      volume: meta?.volume ?? null,
      prompt_type: meta?.prompt_type ?? null,
      instructions: meta?.instructions ?? null,
    };
  });

  return <MoodboardDetailContent board={board} items={enrichedItems} />;
}
