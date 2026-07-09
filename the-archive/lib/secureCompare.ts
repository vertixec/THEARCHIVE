import { timingSafeEqual } from 'node:crypto';

// Constant-time string comparison for shared secrets (webhook tokens, cron
// auth). A plain === leaks how many leading characters matched via timing.
export function secureCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
