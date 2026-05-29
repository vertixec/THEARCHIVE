import crypto from 'node:crypto';
import {
  lemonSqueezySetup,
  createCheckout,
} from '@lemonsqueezy/lemonsqueezy.js';

let initialized = false;

function ensureSetup() {
  if (initialized) return;
  const apiKey = process.env.LEMONSQUEEZY_API_KEY;
  if (!apiKey) throw new Error('LEMONSQUEEZY_API_KEY is not set');
  lemonSqueezySetup({ apiKey });
  initialized = true;
}

export function getStoreId(): string {
  const id = process.env.LEMONSQUEEZY_STORE_ID;
  if (!id) throw new Error('LEMONSQUEEZY_STORE_ID is not set');
  return id;
}

export function getWebhookSecret(): string {
  const secret = process.env.LEMONSQUEEZY_WEBHOOK_SECRET;
  if (!secret) throw new Error('LEMONSQUEEZY_WEBHOOK_SECRET is not set');
  return secret;
}

export interface CreateCheckoutParams {
  variantId: string;
  userId: string;
  userEmail: string;
  intentId: string;
  packId: string;
  redirectUrl: string;
}

export async function createCheckoutForPack(params: CreateCheckoutParams): Promise<string> {
  ensureSetup();
  const storeId = getStoreId();

  const { data, error } = await createCheckout(storeId, params.variantId, {
    checkoutOptions: {
      embed: false,
      media: false,
      logo: true,
    },
    checkoutData: {
      email: params.userEmail,
      custom: {
        user_id: params.userId,
        intent_id: params.intentId,
        pack_id: params.packId,
      },
    },
    productOptions: {
      redirectUrl: params.redirectUrl,
      receiptButtonText: 'Return to THE ARCHIVE',
      receiptThankYouNote: 'Your credits will appear in your balance shortly.',
    },
  });

  if (error) {
    throw new Error(`Lemon Squeezy createCheckout failed: ${error.message}`);
  }

  const url = data?.data?.attributes?.url;
  if (!url) throw new Error('Lemon Squeezy did not return a checkout URL');
  return url;
}

export function verifyWebhookSignature(rawBody: string, signatureHeader: string | null): boolean {
  if (!signatureHeader) return false;
  const secret = getWebhookSecret();
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  const received = signatureHeader.toLowerCase();

  if (expected.length !== received.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(received, 'hex'));
  } catch {
    return false;
  }
}

export interface LemonSqueezyWebhookPayload {
  meta: {
    event_name: string;
    custom_data?: {
      user_id?: string;
      intent_id?: string;
      pack_id?: string;
    };
  };
  data: {
    id: string;
    type: string;
    attributes: Record<string, unknown>;
  };
}
