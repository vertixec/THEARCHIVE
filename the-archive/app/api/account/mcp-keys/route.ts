// Personal API key management for the MCP server.
//
// Session-authenticated (cookies), NOT token-authenticated: a key can never be
// used to mint another key, so a leaked token cannot escalate itself into a
// permanent foothold.

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabaseServer';
import { enforceRateLimit } from '@/lib/generationSecurity';
import { isActivePlatformUser, type BusinessProfile } from '@/lib/business';
import { MCP_SCOPES, createKey, listKeys, normalizeScopes, type McpScope } from '@/lib/mcp/keys';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ALLOWED_EXPIRY_DAYS = [30, 90, 365] as const;

async function requireActiveUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, status, role, access_tier, plan_id')
    .eq('id', user.id)
    .maybeSingle<BusinessProfile>();

  if (!isActivePlatformUser(profile)) {
    return { error: NextResponse.json({ error: 'Your account is not active' }, { status: 403 }) };
  }
  return { userId: user.id };
}

export async function GET() {
  const auth = await requireActiveUser();
  if (auth.error) return auth.error;

  try {
    const keys = await listKeys(auth.userId!);
    return NextResponse.json({ keys, scopes: MCP_SCOPES });
  } catch (error) {
    console.error('MCP key list failed:', error);
    return NextResponse.json({ error: 'Could not load your keys' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireActiveUser();
  if (auth.error) return auth.error;
  const userId = auth.userId!;

  // Key creation is cheap but irreversible-ish; keep it slow enough that a
  // stolen session can't mint a pile of tokens before the user notices.
  const limited = await enforceRateLimit(userId, 'mcp:keys', 5, 300);
  if (limited) return limited;

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const name = typeof body.name === 'string' ? body.name.trim().slice(0, 60) : '';
  if (name.length < 1) {
    return NextResponse.json({ error: 'Give the key a name' }, { status: 400 });
  }

  const scopes: McpScope[] = normalizeScopes(body.scopes);

  const rawExpiry = body.expires_in_days;
  let expiresInDays: number | null = 90;
  if (rawExpiry === null || rawExpiry === 'never') {
    expiresInDays = null;
  } else if (typeof rawExpiry === 'number') {
    if (!(ALLOWED_EXPIRY_DAYS as readonly number[]).includes(rawExpiry)) {
      return NextResponse.json(
        { error: `expires_in_days must be one of ${ALLOWED_EXPIRY_DAYS.join(', ')} or null` },
        { status: 400 },
      );
    }
    expiresInDays = rawExpiry;
  }

  try {
    const { key, token } = await createKey({ userId, name, scopes, expiresInDays });
    // `token` is returned exactly once. It is not stored anywhere in plaintext.
    return NextResponse.json({ key, token }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not create the key';
    if (message.includes('MCP key limit reached')) {
      return NextResponse.json({ error: message }, { status: 409 });
    }
    console.error('MCP key create failed:', error);
    return NextResponse.json({ error: 'Could not create the key' }, { status: 500 });
  }
}
