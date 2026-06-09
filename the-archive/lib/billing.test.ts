import { afterEach, describe, expect, it } from 'vitest';
import { isBillingEnabled } from './billing';

const original = process.env.BILLING_ENABLED;

afterEach(() => {
  if (original === undefined) delete process.env.BILLING_ENABLED;
  else process.env.BILLING_ENABLED = original;
});

describe('billing flag', () => {
  it('fails closed unless explicitly enabled', () => {
    delete process.env.BILLING_ENABLED;
    expect(isBillingEnabled()).toBe(false);
    process.env.BILLING_ENABLED = 'false';
    expect(isBillingEnabled()).toBe(false);
    process.env.BILLING_ENABLED = 'true';
    expect(isBillingEnabled()).toBe(true);
  });
});
