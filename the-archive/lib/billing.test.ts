import { afterEach, describe, expect, it } from 'vitest';
import { isBillingEnabled } from './billing';

const originalBillingEnabled = process.env.BILLING_ENABLED;
const originalPayPalClientId = process.env.PAYPAL_CLIENT_ID;
const originalPayPalClientSecret = process.env.PAYPAL_CLIENT_SECRET;

afterEach(() => {
  if (originalBillingEnabled === undefined) delete process.env.BILLING_ENABLED;
  else process.env.BILLING_ENABLED = originalBillingEnabled;

  if (originalPayPalClientId === undefined) delete process.env.PAYPAL_CLIENT_ID;
  else process.env.PAYPAL_CLIENT_ID = originalPayPalClientId;

  if (originalPayPalClientSecret === undefined) delete process.env.PAYPAL_CLIENT_SECRET;
  else process.env.PAYPAL_CLIENT_SECRET = originalPayPalClientSecret;
});

describe('billing flag', () => {
  it('fails closed unless explicitly enabled with PayPal credentials', () => {
    delete process.env.BILLING_ENABLED;
    delete process.env.PAYPAL_CLIENT_ID;
    delete process.env.PAYPAL_CLIENT_SECRET;

    expect(isBillingEnabled()).toBe(false);
    process.env.BILLING_ENABLED = 'false';
    expect(isBillingEnabled()).toBe(false);
    process.env.BILLING_ENABLED = 'true';
    expect(isBillingEnabled()).toBe(false);
    process.env.PAYPAL_CLIENT_ID = 'client-id';
    expect(isBillingEnabled()).toBe(false);
    process.env.PAYPAL_CLIENT_SECRET = 'client-secret';
    expect(isBillingEnabled()).toBe(true);
  });
});
