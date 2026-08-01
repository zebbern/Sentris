import { createHash, timingSafeEqual } from 'node:crypto';

export const MCP_RUNTIME_INTERNAL_AUTH_HEADER = 'x-internal-token';

export function requireMcpRuntimeInternalToken(token: string | undefined): string {
  if (!token || token.trim().length < 16) {
    throw new Error('MCP runtime internal service token must contain at least 16 characters');
  }
  return token;
}

export function isValidMcpRuntimeInternalToken(
  provided: string | undefined,
  expected: string,
): boolean {
  const expectedDigest = createHash('sha256').update(expected).digest();
  const providedDigest = createHash('sha256')
    .update(provided ?? '')
    .digest();
  return timingSafeEqual(providedDigest, expectedDigest) && provided !== undefined;
}
