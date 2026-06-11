import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabaseServer';
import { createOrder } from '@/lib/paypal';
import { isBillingEnabled } from '@/lib/billing';

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
  if (!isBillingEnabled()) {
    return NextResponse.json({ error: 'Payments are coming soon' }, { status: 503 });
  }
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
    .select('id, name, is_active')
    .eq('id', packId)
    .maybeSingle<{ id: string; name: string; is_active: boolean }>();

  if (packError) {
    return NextResponse.json({ error: packError.message }, { status: 500 });
  }
  if (!pack || !pack.is_active) {
    return NextResponse.json({ error: 'Pack not found or inactive' }, { status: 404 });
  }

  const { data: intentData, error: intentError } = await supabase.rpc('create_payment_intent', {
    p_pack_id: packId,
  });

  if (intentError || !Array.isArray(intentData) || !intentData[0]) {
    console.error('create_payment_intent failed', intentError);
    return NextResponse.json({ error: 'Could not create payment intent' }, { status: 500 });
  }

  const intent = intentData[0] as IntentResult;
  const base = siteUrl(request);

  let checkoutUrl: string;
  try {
    const order = await createOrder({
      amountUsd: Number(intent.amount_usd).toFixed(2),
      intentId: intent.intent_id,
      packName: pack.name,
      // PayPal appends ?token=<orderId>&PayerID=... to the return URL.
      returnUrl: `${base}/api/billing/capture?intent=${intent.intent_id}`,
      cancelUrl: `${base}/pricing?canceled=1`,
    });
    checkoutUrl = order.approveUrl;
  } catch (err) {
    console.error('PayPal checkout error', err);
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
