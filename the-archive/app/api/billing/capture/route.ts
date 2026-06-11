import { NextResponse, type NextRequest } from 'next/server';
import { captureOrder } from '@/lib/paypal';
import { createAdminClient } from '@/lib/supabaseAdmin';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function siteUrl(request: NextRequest): string {
  const envUrl = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, '');
  if (envUrl) return envUrl;
  return request.nextUrl.origin.replace(/\/$/, '');
}

// PayPal redirects the buyer here after they approve the payment.
// We capture the order, grant credits via confirm_payment_intent (idempotent),
// then bounce the buyer to /pricing with a success/error flag.
export async function GET(request: NextRequest) {
  const base = siteUrl(request);
  const orderId = request.nextUrl.searchParams.get('token');
  const intentFromQuery = request.nextUrl.searchParams.get('intent');

  if (!orderId) {
    return NextResponse.redirect(`${base}/pricing?error=missing_order`);
  }

  try {
    const result = await captureOrder(orderId);

    if (result.status !== 'COMPLETED') {
      console.warn('PayPal capture not completed', { orderId, status: result.status });
      return NextResponse.redirect(`${base}/pricing?error=not_completed`);
    }

    const intentId = result.intentId ?? intentFromQuery;
    if (!intentId) {
      console.error('PayPal capture missing intent id', { orderId });
      return NextResponse.redirect(`${base}/pricing?error=missing_intent`);
    }

    const supabase = createAdminClient();
    const { error } = await supabase.rpc('confirm_payment_intent', {
      p_intent_id: intentId,
      p_provider_reference: result.captureId,
      p_payload: result.raw as unknown as Record<string, unknown>,
    });

    if (error) {
      console.error('confirm_payment_intent failed (capture)', error);
      return NextResponse.redirect(`${base}/pricing?error=confirm_failed`);
    }

    return NextResponse.redirect(`${base}/pricing?success=1&intent=${intentId}`);
  } catch (err) {
    console.error('PayPal capture error', err);
    return NextResponse.redirect(`${base}/pricing?error=capture_failed`);
  }
}
