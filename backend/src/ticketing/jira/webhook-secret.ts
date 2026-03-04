import { randomBytes } from 'crypto';

/**
 * Generate a cryptographically random webhook secret suitable for URL-path
 * authentication and HMAC signing.
 *
 * The resulting string is 64 hex characters (256 bits of entropy).
 */
export function generateWebhookSecret(): string {
  return randomBytes(32).toString('hex');
}

/**
 * Build the full webhook callback URL for a Jira connection.
 *
 * @param baseUrl  The application's public base URL (e.g. `https://app.shipsec.ai`).
 * @param secret   The webhook secret stored in `ticketing_connections.webhookSecret`.
 * @returns A URL like `https://app.shipsec.ai/api/v1/ticketing/jira/webhook/<secret>`.
 */
export function buildWebhookCallbackUrl(baseUrl: string, secret: string): string {
  const trimmed = baseUrl.replace(/\/+$/, '');
  return `${trimmed}/api/v1/ticketing/jira/webhook/${encodeURIComponent(secret)}`;
}
