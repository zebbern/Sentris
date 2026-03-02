import { describe, expect, it } from 'bun:test';

import { sanitizeRedirectUrl, isAllowedOAuthDomain } from '../urlSecurity';

describe('sanitizeRedirectUrl', () => {
  describe('valid relative paths', () => {
    it('allows simple relative path', () => {
      expect(sanitizeRedirectUrl('/dashboard')).toBe('/dashboard');
    });

    it('allows nested paths', () => {
      expect(sanitizeRedirectUrl('/settings/profile')).toBe('/settings/profile');
    });

    it('allows root path', () => {
      expect(sanitizeRedirectUrl('/')).toBe('/');
    });

    it('preserves query parameters', () => {
      expect(sanitizeRedirectUrl('/search?q=test')).toBe('/search?q=test');
    });

    it('preserves hash fragments', () => {
      expect(sanitizeRedirectUrl('/page#section')).toBe('/page#section');
    });

    it('preserves complex query strings', () => {
      expect(sanitizeRedirectUrl('/callback?code=abc&state=xyz')).toBe(
        '/callback?code=abc&state=xyz',
      );
    });
  });

  describe('null/undefined/empty', () => {
    it('returns "/" for null', () => {
      expect(sanitizeRedirectUrl(null)).toBe('/');
    });

    it('returns "/" for undefined', () => {
      expect(sanitizeRedirectUrl(undefined)).toBe('/');
    });

    it('returns "/" for empty string', () => {
      expect(sanitizeRedirectUrl('')).toBe('/');
    });
  });

  describe('XSS and open redirect attacks', () => {
    it('blocks javascript: protocol', () => {
      expect(sanitizeRedirectUrl('javascript:alert(1)')).toBe('/');
    });

    it('blocks javascript: with encoding', () => {
      // This contains :// so it's blocked
      expect(sanitizeRedirectUrl('javascript://alert(1)')).toBe('/');
    });

    it('blocks data: URLs', () => {
      expect(sanitizeRedirectUrl('data:text/html,<script>alert(1)</script>')).toBe('/');
    });

    it('blocks protocol-relative URLs (//evil.com)', () => {
      expect(sanitizeRedirectUrl('//evil.com')).toBe('/');
    });

    it('blocks protocol-relative URLs with paths', () => {
      expect(sanitizeRedirectUrl('//evil.com/steal-cookies')).toBe('/');
    });

    it('blocks http:// URLs (external redirect)', () => {
      expect(sanitizeRedirectUrl('http://evil.com')).toBe('/');
    });

    it('blocks https:// URLs (external redirect)', () => {
      expect(sanitizeRedirectUrl('https://evil.com/phishing')).toBe('/');
    });

    it('blocks ftp:// URLs', () => {
      expect(sanitizeRedirectUrl('ftp://evil.com/malware')).toBe('/');
    });

    it('blocks URLs without leading slash', () => {
      expect(sanitizeRedirectUrl('evil.com')).toBe('/');
    });

    it('blocks relative path without leading slash', () => {
      expect(sanitizeRedirectUrl('dashboard')).toBe('/');
    });

    it('blocks vbscript: protocol', () => {
      expect(sanitizeRedirectUrl('vbscript:msgbox')).toBe('/');
    });

    it('blocks mailto: with ://', () => {
      // mailto: without :// has no "://", but without leading / it's still blocked
      expect(sanitizeRedirectUrl('mailto:attacker@evil.com')).toBe('/');
    });

    it('blocks URLs with embedded credentials', () => {
      expect(sanitizeRedirectUrl('https://user:pass@evil.com')).toBe('/');
    });

    it('blocks backslash-based protocol-relative URLs', () => {
      // Some browsers interpret \\ as //
      // This URL starts with a backslash, not "/", so it fails the startsWith('/') check
      expect(sanitizeRedirectUrl('\\\\evil.com')).toBe('/');
    });

    it('blocks URLs with query string containing ://', () => {
      // The URL contains "://" so it's blocked even though it has a query param
      expect(sanitizeRedirectUrl('/page?redirect=http://evil.com')).toBe('/');
    });
  });
});

describe('isAllowedOAuthDomain', () => {
  describe('allowed providers', () => {
    it('allows github.com', () => {
      expect(isAllowedOAuthDomain('https://github.com/login/oauth')).toBe(true);
    });

    it('allows accounts.google.com', () => {
      expect(isAllowedOAuthDomain('https://accounts.google.com/o/oauth2')).toBe(true);
    });

    it('allows login.microsoftonline.com', () => {
      expect(isAllowedOAuthDomain('https://login.microsoftonline.com/common/')).toBe(true);
    });

    it('allows zoom.us', () => {
      expect(isAllowedOAuthDomain('https://zoom.us/oauth/authorize')).toBe(true);
    });

    it('allows gitlab.com', () => {
      expect(isAllowedOAuthDomain('https://gitlab.com/oauth/authorize')).toBe(true);
    });

    it('allows bitbucket.org', () => {
      expect(isAllowedOAuthDomain('https://bitbucket.org/site/oauth2')).toBe(true);
    });

    it('allows slack.com', () => {
      expect(isAllowedOAuthDomain('https://slack.com/oauth/v2/authorize')).toBe(true);
    });

    it('allows discord.com', () => {
      expect(isAllowedOAuthDomain('https://discord.com/api/oauth2/authorize')).toBe(true);
    });

    it('allows api.atlassian.com', () => {
      expect(isAllowedOAuthDomain('https://api.atlassian.com/ex/confluence')).toBe(true);
    });
  });

  describe('blocked domains', () => {
    it('blocks evil.com', () => {
      expect(isAllowedOAuthDomain('https://evil.com/phish')).toBe(false);
    });

    it('blocks subdomain spoofing (evil.github.com)', () => {
      expect(isAllowedOAuthDomain('https://evil.github.com')).toBe(false);
    });

    it('blocks similar-looking domains (githubx.com)', () => {
      expect(isAllowedOAuthDomain('https://githubx.com')).toBe(false);
    });

    it('allows http protocol for allowed domains', () => {
      // http://github.com is parsed correctly but its hostname is github.com
      // So it's actually allowed — this tests that URL parsing works
      expect(isAllowedOAuthDomain('http://github.com')).toBe(true);
    });

    it('blocks localhost', () => {
      expect(isAllowedOAuthDomain('http://localhost:3000')).toBe(false);
    });

    it('blocks IP addresses', () => {
      expect(isAllowedOAuthDomain('http://192.168.1.1')).toBe(false);
    });
  });

  describe('invalid URLs', () => {
    it('returns false for empty string', () => {
      expect(isAllowedOAuthDomain('')).toBe(false);
    });

    it('returns false for non-URL string', () => {
      expect(isAllowedOAuthDomain('not a url')).toBe(false);
    });

    it('returns false for javascript: protocol', () => {
      expect(isAllowedOAuthDomain('javascript:alert(1)')).toBe(false);
    });

    it('returns false for relative path', () => {
      expect(isAllowedOAuthDomain('/github.com')).toBe(false);
    });

    it('returns false for protocol-relative URL', () => {
      // new URL('//github.com') throws in most environments without a base
      expect(isAllowedOAuthDomain('//github.com')).toBe(false);
    });
  });
});
