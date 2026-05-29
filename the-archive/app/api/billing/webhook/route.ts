import { NextResponse, type NextRequest } from 'next/server';
import { verifyWebhookSignature, type LemonSqueezyWebhookPayload } from '@/lib/lemonsqueezy';
import { createAdminClient } from '@/lib/supabaseAdmin';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  const signature = request.headers.get('x-signature');

  if (!verifyWebhookSignature(rawBody, signature)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  let payload: LemonSqueezyWebhookPayload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const eventName = payload.meta?.event_name;
  const intentId = payload.meta?.custom_data?.intent_id;
  const orderId = payload.data?.id;

  if (!eventName) {
    return NextResponse.json({ ok: true, ignored: 'no_event_name' });
  }

  const supabase = createAdminClient();

  try {
    if (eventName === 'order_created') {
      if (!intentId || !orderId) {
        console.warn('order_created without intent_id or order_id', { intentId, orderId });
        return NextResponse.json({ ok: true, ignored: 'missing_ids' });
      }

      const { error } = await supabase.rpc('confirm_payment_intent', {
        p_intent_id: intentId,
        p_provider_reference: orderId,
        p_payload: payload as unknown as Record<string, unknown>,
      });

      if (error) {
        console.error('confirm_payment_intent failed', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
      }

      return NextResponse.json({ ok: true, action: 'confirmed', intent_id: intentId });
    }

    if (eventName === 'order_refunded') {
      if (!orderId) {
        return NextResponse.json({ ok: true, ignored: 'missing_order_id' });
      }

      const { error } = await supabase.rpc('refund_payment_intent', {
        p_provider_reference: orderId,
        p_payload: payload as unknown as Record<string, unknown>,
      });

      if (error) {
        console.error('refund_payment_intent failed', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
      }

      return NextResponse.json({ ok: true, action: 'refunded', order_id: orderId });
    }

    return NextResponse.json({ ok: true, ignored: eventName });
  } catch (err) {
    console.error('Webhook handler crashed', err);
    return NextResponse.json({ error: 'Webhook handler crashed' }, { status: 500 });
  }
}
