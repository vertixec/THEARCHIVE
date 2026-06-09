export function isBillingEnabled() {
  return process.env.BILLING_ENABLED === 'true';
}
