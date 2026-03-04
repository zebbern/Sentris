import { createHmac } from 'crypto';

import { timingSafeCompare } from '../../common/crypto-utils';

/**
 * Verify a Jira webhook HMAC-SHA256 signature.
 *
 * @param body   Raw request body (string or Buffer).
 * @param signature  Value of the `x-hub-signature` header (hex-encoded HMAC).
 * @param secret The webhook secret stored in `ticketing_connections.webhookSecret`.
 * @returns `true` when the signature is valid.
 */
export function verifyJiraWebhookSignature(
  body: string | Buffer,
  signature: string,
  secret: string,
): boolean {
  if (!signature || !secret) {
    return false;
  }

  // Strip optional "sha256=" prefix that some webhook providers include.
  const rawSignature = signature.startsWith('sha256=') ? signature.slice(7) : signature;
  if (!rawSignature) {
    return false;
  }

  const expected = createHmac('sha256', secret)
    .update(typeof body === 'string' ? body : body)
    .digest('hex');

  return timingSafeCompare(expected, rawSignature);
}
