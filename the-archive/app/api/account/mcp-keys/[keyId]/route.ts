import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabaseServer';
import { revokeKey } from '@/lib/mcp/keys';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ keyId: string }> },
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { keyId } = await params;
  if (!UUID_RE.test(keyId)) {
    return NextResponse.json({ error: 'Invalid key id' }, { status: 400 });
  }

  try {
    // Scoped to the caller's user_id inside revokeKey, so one member can never
    // revoke another's key by guessing an id.
    const revoked = await revokeKey(user.id, keyId);
    if (!revoked) {
      return NextResponse.json({ error: 'Key not found' }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('MCP key revoke failed:', error);
    return NextResponse.json({ error: 'Could not revoke the key' }, { status: 500 });
  }
}
