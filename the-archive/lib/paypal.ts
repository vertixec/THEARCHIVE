// PayPal REST integration (Orders v2 + webhook verification).
// No SDK dependency — plain fetch against the PayPal REST API.
// Env: PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET, PAYPAL_WEBHOOK_ID, PAYPAL_ENV (sandbox|live).

function apiBase(): string {
  const env = (process.env.PAYPAL_ENV ?? 'sandbox').toLowerCase();
  return env === 'live'
    ? 'https://api-m.paypal.com'
    : 'https://api-m.sandbox.paypal.com';
}

function getCredentials(): { clientId: string; secret: string } {
  const clientId = process.env.PAYPAL_CLIENT_ID;
  const secret = process.env.PAYPAL_CLIENT_SECRET;
  if (!clientId || !secret) {
    throw new Error('PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET are not set');
  }
  return { clientId, secret };
}

async function getAccessToken(): Promise<string> {
  const { clientId, secret } = getCredentials();
  const auth = Buffer.from(`${clientId}:${secret}`).toString('base64');

  const res = await fetch(`${apiBase()}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`PayPal token request failed: ${res.status} ${text}`);
  }

  const data = (await res.json()) as { access_token: string };
  return data.access_token;
}

// ------------------------------------------------------------
// Create order
// ------------------------------------------------------------

export interface CreateOrderParams {
  amountUsd: string; // e.g. "5.00"
  intentId: string; // our payment_intents.id — travels back via custom_id
  packName: string;
  returnUrl: string;
  cancelUrl: string;
}

export interface CreateOrderResult {
  orderId: string;
  approveUrl: string;
}

export async function createOrder(params: CreateOrderParams): Promise<CreateOrderResult> {
  const token = await getAccessToken();

  const res = await fetch(`${apiBase()}/v2/checkout/orders`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      intent: 'CAPTURE',
      purchase_units: [
        {
          custom_id: params.intentId,
          description: params.packName.slice(0, 127),
          amount: {
            currency_code: 'USD',
            value: params.amountUsd,
          },
        },
      ],
      application_context: {
        brand_name: 'THE ARCHIVE',
        user_action: 'PAY_NOW',
        shipping_preference: 'NO_SHIPPING',
        return_url: params.returnUrl,
        cancel_url: params.cancelUrl,
      },
    }),
  });

  const data = (await res.json()) as {
    id?: string;
    links?: { href: string; rel: string }[];
  };

  if (!res.ok || !data.id) {
    throw new Error(`PayPal createOrder failed: ${res.status} ${JSON.stringify(data)}`);
  }

  const approve = data.links?.find((l) => l.rel === 'approve' || l.rel === 'payer-action');
  if (!approve) {
    throw new Error('PayPal did not return an approve link');
  }

  return { orderId: data.id, approveUrl: approve.href };
}

// ------------------------------------------------------------
// Capture order (called on return_url)
// ------------------------------------------------------------

export interface CaptureResult {
  captureId: string;
  intentId: string | null;
  status: string;
  raw: Record<string, unknown>;
}

function extractCapture(order: Record<string, unknown>): CaptureResult {
  const pu = (order as { purchase_units?: { custom_id?: string; payments?: { captures?: { id?: string; status?: string; custom_id?: string }[] } }[] })
    .purchase_units?.[0];
  const capture = pu?.payments?.captures?.[0];
  return {
    captureId: capture?.id ?? String((order as { id?: string }).id ?? ''),
    intentId: pu?.custom_id ?? capture?.custom_id ?? null,
    status: capture?.status ?? String((order as { status?: string }).status ?? 'UNKNOWN'),
    raw: order,
  };
}

async function getOrder(orderId: string, token: string): Promise<Record<string, unknown>> {
  const res = await fetch(`${apiBase()}/v2/checkout/orders/${orderId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = (await res.json()) as Record<string, unknown>;
  if (!res.ok) {
    throw new Error(`PayPal getOrder failed: ${res.status} ${JSON.stringify(data)}`);
  }
  return data;
}

export async function captureOrder(orderId: string): Promise<CaptureResult> {
  const token = await getAccessToken();

  const res = await fetch(`${apiBase()}/v2/checkout/orders/${orderId}/capture`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      // Lets PayPal safely de-dupe if the buyer re-hits the return URL.
      'PayPal-Request-Id': `capture-${orderId}`,
    },
  });

  const data = (await res.json()) as Record<string, unknown>;

  if (res.ok) {
    return extractCapture(data);
  }

  // Already captured (double return / webhook race): fetch the order and read
  // the existing capture instead of failing the buyer's redirect.
  const issue = (data as { details?: { issue?: string }[] }).details?.[0]?.issue;
  if (res.status === 422 && issue === 'ORDER_ALREADY_CAPTURED') {
    const order = await getOrder(orderId, token);
    return extractCapture(order);
  }

  throw new Error(`PayPal captureOrder failed: ${res.status} ${JSON.stringify(data)}`);
}

// ------------------------------------------------------------
// Webhook signature verification
// ------------------------------------------------------------

export interface PayPalWebhookHeaders {
  authAlgo: string | null;
  certUrl: string | null;
  transmissionId: string | null;
  transmissionSig: string | null;
  transmissionTime: string | null;
}

export async function verifyWebhook(
  headers: PayPalWebhookHeaders,
  rawBody: string
): Promise<boolean> {
  const webhookId = process.env.PAYPAL_WEBHOOK_ID;
  if (!webhookId) throw new Error('PAYPAL_WEBHOOK_ID is not set');

  if (
    !headers.authAlgo ||
    !headers.certUrl ||
    !headers.transmissionId ||
    !headers.transmissionSig ||
    !headers.transmissionTime
  ) {
    return false;
  }

  const token = await getAccessToken();

  const res = await fetch(`${apiBase()}/v1/notifications/verify-webhook-signature`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      auth_algo: headers.authAlgo,
      cert_url: headers.certUrl,
      transmission_id: headers.transmissionId,
      transmission_sig: headers.transmissionSig,
      transmission_time: headers.transmissionTime,
      webhook_id: webhookId,
      webhook_event: JSON.parse(rawBody),
    }),
  });

  if (!res.ok) return false;
  const data = (await res.json()) as { verification_status?: string };
  return data.verification_status === 'SUCCESS';
}
