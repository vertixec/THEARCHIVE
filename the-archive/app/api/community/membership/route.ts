import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabaseServer';
import { createAdminClient } from '@/lib/supabaseAdmin';

export const runtime = 'nodejs';

// ============================================================
// Community membership management.
//
// One endpoint serves BOTH access paths agreed for THE ARCHIVE:
//   * MANUAL NOW  — an admin (logged-in profile.role='admin') calls this to
//                   grant/revoke community access for someone.
//   * WEBHOOK LATER — Skool (via Zapier/Make) calls this with the shared
//                   secret header to auto-sync joins/leaves. No code change
//                   needed; just point the automation at this URL.
//
// Body: { email?: string, user_id?: string, action: 'grant' | 'revoke' }
// Auth: admin session OR  x-community-secret: <COMMUNITY_WEBHOOK_SECRET>
//
// grant  -> access_tier='community', status='active', + immediate 800 credits
// revoke -> access_tier='free', monthly_credits zeroed (allowance removed)
// ============================================================

async function isAdminSession(): Promise<boolean> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return false;
  const { data } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .maybeSingle<{ role: string | null }>();
  return data?.role === 'admin';
}

function hasWebhookSecret(req: NextRequest): boolean {
  const secret = process.env.COMMUNITY_WEBHOOK_SECRET;
  if (!secret) return false;
  return req.headers.get('x-community-secret') === secret;
}

export async function POST(req: NextRequest) {
  // Authorize: either an admin user session, or the shared webhook secret.
  const authorized = hasWebhookSecret(req) || (await isAdminSession());
  if (!authorized) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: { email?: string; user_id?: string; action?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const action = body.action;
  if (action !== 'grant' && action !== 'revoke') {
    return NextResponse.json({ error: "action must be 'grant' or 'revoke'" }, { status: 400 });
  }

  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : null;
  const userId = typeof body.user_id === 'string' ? body.user_id : null;
  if (!email && !userId) {
    return NextResponse.json({ error: 'Provide email or user_id' }, { status: 400 });
  }

  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return NextResponse.json(
      { error: 'Server not configured for membership management (missing service key)' },
      { status: 500 },
    );
  }

  // Resolve the target profile.
  const lookup = admin.from('profiles').select('id, email, access_tier, status');
  const { data: profile, error: lookupError } = userId
    ? await lookup.eq('id', userId).maybeSingle<{ id: string; email: string; access_tier: string | null; status: string | null }>()
    : await lookup.eq('email', email!).maybeSingle<{ id: string; email: string; access_tier: string | null; status: string | null }>();

  if (lookupError) {
    return NextResponse.json({ error: 'Profile lookup failed' }, { status: 500 });
  }
  if (!profile) {
    // The person may not have created an Archive account yet. Surface clearly
    // so the automation/admin knows to ask them to sign up first.
    return NextResponse.json(
      { error: 'No Archive account found for that user. They must sign up first.' },
      { status: 404 },
    );
  }

  if (action === 'grant') {
    const { error: updateError } = await admin
      .from('profiles')
      .update({ access_tier: 'community', status: 'active', role: 'member' })
      .eq('id', profile.id);
    if (updateError) {
      return NextResponse.json({ error: 'Could not update profile' }, { status: 500 });
    }

    // Grant this cycle's allowance immediately (reset semantics).
    const { data: granted, error: grantError } = await admin.rpc('grant_community_credits_for_user', {
      p_user_id: profile.id,
    });
    if (grantError) {
      return NextResponse.json(
        { ok: true, user_id: profile.id, tier: 'community', credits_granted: 0, warning: 'tier set but credit grant failed' },
        { status: 200 },
      );
    }

    return NextResponse.json({ ok: true, user_id: profile.id, tier: 'community', credits_granted: granted ?? 0 });
  }

  // action === 'revoke': demote to free and remove the monthly allowance.
  const { error: demoteError } = await admin
    .from('profiles')
    .update({ access_tier: 'free', role: 'user' })
    .eq('id', profile.id);
  if (demoteError) {
    return NextResponse.json({ error: 'Could not update profile' }, { status: 500 });
  }

  // Zero the unused community allowance; purchased credits are left untouched.
  await admin
    .from('user_credit_balances')
    .update({ monthly_credits: 0, updated_at: new Date().toISOString() })
    .eq('user_id', profile.id);

  return NextResponse.json({ ok: true, user_id: profile.id, tier: 'free' });
}
