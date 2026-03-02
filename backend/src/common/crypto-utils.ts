import { timingSafeEqual } from 'crypto';

/**
 * Timing-safe string comparison to prevent timing attacks.
 *
 * Returns `false` immediately if lengths differ (unavoidable length leak),
 * then performs constant-time comparison of the buffer contents.
 */
export function timingSafeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}
