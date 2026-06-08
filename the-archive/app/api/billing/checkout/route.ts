import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabaseServer';
import { createCheckoutForPack } from '@/lib/lemonsqueezy';

export const dynamic = 'force-dynamic';

type IntentResult = {
  intent_id: string;
  amount_usd: string;
  image_credits: number;
  video_credits: number;
};

function siteUrl(request: NextRequest): string {
  // In production set NEXT_PUBLIC_SITE_URL to the canonical site origin.
  // The request.nextUrl.origin fallback can be wrong behind a proxy/CDN
  // (it may reflect an internal host), which would produce a broken
  // post-checkout redirect URL.
  const envUrl = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, '');
  if (envUrl) return envUrl;
  const origin = request.nextUrl.origin;
  return origin.replace(/\/$/, '');
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: { pack_id?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const packId = body.pack_id;
  if (!packId || typeof packId !== 'string') {
    return NextResponse.json({ error: 'pack_id is required' }, { status: 400 });
  }

  const { data: pack, error: packError } = await supabase
    .from('credit_packs')
    .select('id, name, lemonsqueezy_variant_id, is_active')
    .eq('id', packId)
    .maybeSingle<{ id: string; name: string; lemonsqueezy_variant_id: string | null; is_active: boolean }>();

  if (packError) {
    return NextResponse.json({ error: packError.message }, { status: 500 });
  }
  if (!pack || !pack.is_active) {
    return NextResponse.json({ error: 'Pack not found or inactive' }, { status: 404 });
  }
  if (!pack.lemonsqueezy_variant_id) {
    return NextResponse.json(
      { error: 'This pack is not yet wired to Lemon Squeezy. Contact support.' },
      { status: 503 }
    );
  }

  const { data: intentData, error: intentError } = await supabase.rpc('create_payment_intent', {
    p_pack_id: packId,
  });

  if (intentError || !Array.isArray(intentData) || !intentData[0]) {
    console.error('create_payment_intent failed', intentError);
    return NextResponse.json({ error: 'Could not create payment intent' }, { status: 500 });
  }

  const intent = intentData[0] as IntentResult;

  let checkoutUrl: string;
  try {
    checkoutUrl = await createCheckoutForPack({
      variantId: pack.lemonsqueezy_variant_id,
      userId: user.id,
      userEmail: user.email ?? '',
      intentId: intent.intent_id,
      packId: pack.id,
      redirectUrl: `${siteUrl(request)}/credits?success=1&intent=${intent.intent_id}`,
    });
  } catch (err) {
    console.error('Lemon Squeezy checkout error', err);
    return NextResponse.json({ error: 'Checkout creation failed' }, { status: 502 });
  }

  await supabase.rpc('update_payment_intent_url', {
    p_intent_id: intent.intent_id,
    p_checkout_url: checkoutUrl,
  });

  return NextResponse.json({
    intent_id: intent.intent_id,
    checkout_url: checkoutUrl,
  });
}
