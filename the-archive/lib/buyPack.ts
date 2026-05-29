export async function buyPack(packId: string): Promise<void> {
  const response = await fetch('/api/billing/checkout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pack_id: packId }),
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data?.error || 'Checkout failed');
  }

  const data = (await response.json()) as { checkout_url?: string };
  if (!data.checkout_url) {
    throw new Error('No checkout URL returned');
  }

  window.location.href = data.checkout_url;
}
