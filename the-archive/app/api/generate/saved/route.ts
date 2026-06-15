import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabaseServer';
import { setGenerationSaved } from '@/lib/generationSecurity';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: { generation_id?: unknown; is_saved?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const generationId = body.generation_id;
  const isSaved = body.is_saved;
  if (typeof generationId !== 'string' || generationId.length === 0) {
    return NextResponse.json({ error: 'generation_id is required' }, { status: 400 });
  }
  if (typeof isSaved !== 'boolean') {
    return NextResponse.json({ error: 'is_saved must be boolean' }, { status: 400 });
  }

  try {
    await setGenerationSaved(user.id, generationId, isSaved);
  } catch (error) {
    console.error('Generation save failed:', error);
    return NextResponse.json({ error: 'Save failed' }, { status: 500 });
  }

  return NextResponse.json({ ok: true, is_saved: isSaved });
}
