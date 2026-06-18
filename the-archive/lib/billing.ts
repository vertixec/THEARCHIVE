export function isBillingEnabled() {
  return (
    process.env.BILLING_ENABLED === 'true' &&
    Boolean(process.env.PAYPAL_CLIENT_ID) &&
    Boolean(process.env.PAYPAL_CLIENT_SECRET)
  );
}
