// Builds the callback URL passed to fal.queue.submit({ webhookUrl }) so FAL
// notifies /api/fal/webhook when a job finishes (finalization without the
// browser). Returns undefined when no public https base URL is configured
// (e.g. local dev, where FAL can't reach us) — everything still works via
// polling + the cron sweeper, just without the push path.
export function buildFalWebhookUrl(): string | undefined {
  const base = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/+$/, '');
  if (!base || !base.startsWith('https://')) return undefined;
  const url = `${base}/api/fal/webhook`;
  const secret = process.env.FAL_WEBHOOK_SECRET;
  return secret ? `${url}?token=${encodeURIComponent(secret)}` : url;
}
