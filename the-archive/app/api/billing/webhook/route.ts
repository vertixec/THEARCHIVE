import { NextResponse, type NextRequest } from 'next/server';
import { verifyWebhook, type PayPalWebhookHeaders } from '@/lib/paypal';
import { createAdminClient } from '@/lib/supabaseAdmin';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type PayPalLink = { href?: string; rel?: string };

// PayPal webhook. Acts as a safety net / async source of truth:
//   PAYMENT.CAPTURE.COMPLETED  -> confirm credits (idempotent; the capture
//                                 route usually already did this on return)
//   PAYMENT.CAPTURE.REFUNDED   -> revert credits
//   PAYMENT.CAPTURE.REVERSED   -> revert credits (chargeback)
export async function POST(request: NextRequest) {
  const rawBody = await request.text();

  const headers: PayPalWebhookHeaders = {
    authAlgo: request.headers.get('paypal-auth-algo'),
    certUrl: request.headers.get('paypal-cert-url'),
    transmissionId: request.headers.get('paypal-transmission-id'),
    transmissionSig: request.headers.get('paypal-transmission-sig'),
    transmissionTime: request.headers.get('paypal-transmission-time'),
  };

  let verified = false;
  try {
    verified = await verifyWebhook(headers, rawBody);
  } catch (err) {
    console.error('PayPal webhook verification error', err);
  }
  if (!verified) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  let event: { event_type?: string; resource?: Record<string, unknown> };
  try {
    event = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const eventType = event.event_type;
  const resource = (event.resource ?? {}) as Record<string, unknown>;

  if (!eventType) {
    return NextResponse.json({ ok: true, ignored: 'no_event_type' });
  }

  const supabase = createAdminClient();

  try {
    if (eventType === 'PAYMENT.CAPTURE.COMPLETED') {
      const intentId = resource.custom_id as string | undefined;
      const captureId = resource.id as string | undefined;

      if (!intentId || !captureId) {
        console.warn('CAPTURE.COMPLETED without custom_id or id', { intentId, captureId });
        return NextResponse.json({ ok: true, ignored: 'missing_ids' });
      }

      const { error } = await supabase.rpc('confirm_payment_intent', {
        p_intent_id: intentId,
        p_provider_reference: captureId,
        p_payload: event as unknown as Record<string, unknown>,
      });

      if (error) {
        console.error('confirm_payment_intent failed (webhook)', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
      }

      return NextResponse.json({ ok: true, action: 'confirmed', intent_id: intentId });
    }

    if (eventType === 'PAYMENT.CAPTURE.REFUNDED' || eventType === 'PAYMENT.CAPTURE.REVERSED') {
      // The refund/reversal resource id is NOT the original capture id.
      // The captured payment (our provider_reference) is the `up` link target.
      const links = (resource.links as PayPalLink[] | undefined) ?? [];
      const up = links.find((l) => l.rel === 'up');
      const captureId = up?.href?.split('/').pop();

      if (!captureId) {
        console.warn('REFUNDED without resolvable capture id', { resourceId: resource.id });
        return NextResponse.json({ ok: true, ignored: 'missing_capture_id' });
      }

      const { error } = await supabase.rpc('refund_payment_intent', {
        p_provider_reference: captureId,
        p_payload: event as unknown as Record<string, unknown>,
      });

      if (error) {
        console.error('refund_payment_intent failed (webhook)', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
      }

      return NextResponse.json({ ok: true, action: 'refunded', capture_id: captureId });
    }

    return NextResponse.json({ ok: true, ignored: eventType });
  } catch (err) {
    console.error('Webhook handler crashed', err);
    return NextResponse.json({ error: 'Webhook handler crashed' }, { status: 500 });
  }
}
