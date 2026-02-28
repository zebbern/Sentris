/**
 * URL security utilities to prevent open-redirect and unvalidated-redirect attacks.
 */

/**
 * Sanitize a redirect URL to ensure it is a safe, relative path.
 * Returns "/" for any URL that could redirect to an external site.
 */
export function sanitizeRedirectUrl(url: string | null | undefined): string {
  if (!url) return '/';
  if (url.includes('://')) return '/';
  if (url.startsWith('//')) return '/';
  if (!url.startsWith('/')) return '/';
  return url;
}

const ALLOWED_OAUTH_HOSTS: ReadonlySet<string> = new Set([
  'github.com',
  'accounts.google.com',
  'login.microsoftonline.com',
  'zoom.us',
  'gitlab.com',
  'bitbucket.org',
  'slack.com',
  'discord.com',
  'api.atlassian.com',
]);

/**
 * Check whether a URL points to a known, trusted OAuth provider.
 * Returns false for any URL whose hostname is not in the allowlist.
 */
export function isAllowedOAuthDomain(url: string): boolean {
  try {
    const parsed = new URL(url);
    return ALLOWED_OAUTH_HOSTS.has(parsed.hostname);
  } catch {
    return false;
  }
}
