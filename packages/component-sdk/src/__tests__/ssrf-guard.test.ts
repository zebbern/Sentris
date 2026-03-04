import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';

import { SsrfBlockedError, validateUrlForSsrf } from '../http/ssrf-guard';

// ─── DNS mock setup ──────────────────────────────────────────────────────────

// We mock dns/promises to control DNS resolution during tests, preventing
// actual network calls and enabling DNS rebinding attack simulation.

const mockResolve4 = mock<(hostname: string) => Promise<string[]>>();
const mockResolve6 = mock<(hostname: string) => Promise<string[]>>();

mock.module('dns/promises', () => ({
  resolve4: mockResolve4,
  resolve6: mockResolve6,
}));

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('SSRF Guard — validateUrlForSsrf', () => {
  beforeEach(() => {
    // Default: DNS calls return ENOTFOUND (no resolution)
    mockResolve4.mockRejectedValue(new Error('ENOTFOUND'));
    mockResolve6.mockRejectedValue(new Error('ENOTFOUND'));
  });

  afterEach(() => {
    mockResolve4.mockReset();
    mockResolve6.mockReset();
  });

  // ═══ Blocked: Private IPv4 ranges ═══════════════════════════════════════

  describe('blocks private IPv4 ranges', () => {
    const blockedIps = [
      { ip: '127.0.0.1', reason: 'loopback' },
      { ip: '127.0.0.2', reason: 'loopback /8' },
      { ip: '10.0.0.1', reason: 'RFC 1918 10/8' },
      { ip: '10.255.255.255', reason: 'RFC 1918 10/8 upper' },
      { ip: '172.16.0.1', reason: 'RFC 1918 172.16/12' },
      { ip: '172.31.255.255', reason: 'RFC 1918 172.16/12 upper' },
      { ip: '192.168.1.1', reason: 'RFC 1918 192.168/16' },
      { ip: '192.168.0.1', reason: 'RFC 1918 192.168/16' },
      { ip: '169.254.169.254', reason: 'AWS metadata' },
      { ip: '169.254.0.1', reason: 'link-local' },
      { ip: '0.0.0.0', reason: 'wildcard' },
      { ip: '100.64.0.1', reason: 'CGN 100.64/10 lower' },
      { ip: '100.100.100.200', reason: 'CGN / Alibaba metadata' },
      { ip: '100.127.255.255', reason: 'CGN 100.64/10 upper' },
    ];

    for (const { ip, reason } of blockedIps) {
      it(`blocks http://${ip} (${reason})`, async () => {
        await expect(validateUrlForSsrf(`http://${ip}`)).rejects.toThrow(/SSRF blocked/);
      });
    }

    it('allows 100.63.255.255 (just below CGN range)', async () => {
      await expect(validateUrlForSsrf('http://100.63.255.255')).resolves.toBeUndefined();
    });

    it('allows 100.128.0.0 (just above CGN range)', async () => {
      await expect(validateUrlForSsrf('http://100.128.0.0')).resolves.toBeUndefined();
    });
  });

  // ═══ Blocked: Cloud metadata ════════════════════════════════════════════

  describe('blocks cloud metadata endpoints', () => {
    it('blocks http://169.254.169.254/latest/meta-data/', async () => {
      await expect(
        validateUrlForSsrf('http://169.254.169.254/latest/meta-data/'),
      ).rejects.toThrow(/SSRF blocked/);
    });

    it('blocks Alibaba Cloud metadata 100.100.100.200', async () => {
      await expect(
        validateUrlForSsrf('http://100.100.100.200/latest/meta-data/'),
      ).rejects.toThrow(/SSRF blocked/);
    });

    it('blocks metadata.google.internal', async () => {
      await expect(
        validateUrlForSsrf('http://metadata.google.internal/computeMetadata/v1/'),
      ).rejects.toThrow(/SSRF blocked/);
    });
  });

  // ═══ Blocked: IPv6 ═════════════════════════════════════════════════════

  describe('blocks private IPv6 addresses', () => {
    it('blocks http://[::1]', async () => {
      await expect(validateUrlForSsrf('http://[::1]')).rejects.toThrow(/SSRF blocked/);
    });

    it('blocks http://[::1]:8080/path', async () => {
      await expect(validateUrlForSsrf('http://[::1]:8080/path')).rejects.toThrow(/SSRF blocked/);
    });

    it('blocks IPv6-mapped IPv4 loopback (::ffff:127.0.0.1)', async () => {
      await expect(
        validateUrlForSsrf('http://[::ffff:127.0.0.1]'),
      ).rejects.toThrow(/SSRF blocked/);
    });

    it('blocks IPv6-mapped IPv4 private (::ffff:10.0.0.1)', async () => {
      await expect(
        validateUrlForSsrf('http://[::ffff:10.0.0.1]'),
      ).rejects.toThrow(/SSRF blocked/);
    });

    it('blocks fe80::/10 link-local at fea0::1', async () => {
      await expect(validateUrlForSsrf('http://[fea0::1]')).rejects.toThrow(/SSRF blocked/);
    });

    it('blocks fe80::/10 link-local at feb0::1', async () => {
      await expect(validateUrlForSsrf('http://[feb0::1]')).rejects.toThrow(/SSRF blocked/);
    });

    it('blocks fe80::/10 link-local at febf::1', async () => {
      await expect(validateUrlForSsrf('http://[febf::1]')).rejects.toThrow(/SSRF blocked/);
    });

    it('allows fec0::1 (outside fe80::/10 range)', async () => {
      await expect(validateUrlForSsrf('http://[fec0::1]')).resolves.toBeUndefined();
    });
  });

  // ═══ Blocked: Hostnames ════════════════════════════════════════════════

  describe('blocks internal hostnames', () => {
    const blockedHosts = [
      'localhost',
      'postgres',
      'redis',
      'temporal',
      'dind',
      'minio',
      'backend',
      'opensearch',
      'loki',
      'redpanda',
    ];

    for (const host of blockedHosts) {
      it(`blocks http://${host}`, async () => {
        await expect(validateUrlForSsrf(`http://${host}`)).rejects.toThrow(/SSRF blocked/);
      });
    }

    it('blocks *.local suffix', async () => {
      await expect(validateUrlForSsrf('http://myservice.local')).rejects.toThrow(/SSRF blocked/);
    });

    it('blocks *.internal suffix', async () => {
      await expect(
        validateUrlForSsrf('http://some-service.internal'),
      ).rejects.toThrow(/SSRF blocked/);
    });

    it('blocks *.svc.cluster.local (Kubernetes)', async () => {
      await expect(
        validateUrlForSsrf('http://my-api.default.svc.cluster.local'),
      ).rejects.toThrow(/SSRF blocked/);
    });
  });

  // ═══ Blocked: Non-HTTP schemes ═════════════════════════════════════════

  describe('blocks non-HTTP schemes', () => {
    it('blocks file:///etc/passwd', async () => {
      await expect(validateUrlForSsrf('file:///etc/passwd')).rejects.toThrow(
        /scheme "file:" is not allowed/,
      );
    });

    it('blocks ftp://internal', async () => {
      await expect(validateUrlForSsrf('ftp://internal/data')).rejects.toThrow(
        /scheme "ftp:" is not allowed/,
      );
    });

    it('blocks gopher://', async () => {
      await expect(validateUrlForSsrf('gopher://evil.com')).rejects.toThrow(
        /scheme "gopher:" is not allowed/,
      );
    });

    it('blocks data: URIs', async () => {
      await expect(
        validateUrlForSsrf('data:text/html,<h1>hi</h1>'),
      ).rejects.toThrow(/SSRF blocked/);
    });

    it('blocks javascript: URIs', async () => {
      await expect(
        validateUrlForSsrf('javascript:alert(1)'),
      ).rejects.toThrow(/SSRF blocked/);
    });
  });

  // ═══ Blocked: Obfuscated IPs ══════════════════════════════════════════

  describe('blocks obfuscated IP addresses', () => {
    it('blocks decimal IP 2130706433 (= 127.0.0.1)', async () => {
      // URL parser normalizes decimal IPs to dotted-quad, so the guard
      // sees 127.0.0.1 directly and blocks it as a private IP.
      await expect(validateUrlForSsrf('http://2130706433')).rejects.toThrow(/SSRF blocked/);
    });

    it('blocks hex IP 0x7f000001 (= 127.0.0.1)', async () => {
      await expect(validateUrlForSsrf('http://0x7f000001')).rejects.toThrow(/SSRF blocked/);
    });

    it('blocks octal IP 0177.0.0.1 (= 127.0.0.1)', async () => {
      await expect(validateUrlForSsrf('http://0177.0.0.1')).rejects.toThrow(/SSRF blocked/);
    });

    it('blocks decimal IP 167772161 (= 10.0.0.1)', async () => {
      await expect(validateUrlForSsrf('http://167772161')).rejects.toThrow(/SSRF blocked/);
    });
  });

  // ═══ Blocked: Invalid URLs ════════════════════════════════════════════

  describe('blocks invalid URLs', () => {
    it('blocks completely invalid URLs', async () => {
      await expect(validateUrlForSsrf('not-a-url')).rejects.toThrow(/SSRF blocked: invalid URL/);
    });
  });

  // ═══ Blocked: URLs with credentials ═══════════════════════════════════

  describe('blocks private IPs even with credentials in URL', () => {
    it('blocks http://user:pass@127.0.0.1', async () => {
      await expect(
        validateUrlForSsrf('http://user:pass@127.0.0.1'),
      ).rejects.toThrow(/SSRF blocked/);
    });

    it('blocks http://admin:secret@10.0.0.1/admin', async () => {
      await expect(
        validateUrlForSsrf('http://admin:secret@10.0.0.1/admin'),
      ).rejects.toThrow(/SSRF blocked/);
    });
  });

  // ═══ Blocked: DNS rebinding ═══════════════════════════════════════════

  describe('DNS rebinding protection', () => {
    it('blocks hostname that resolves to 127.0.0.1', async () => {
      mockResolve4.mockResolvedValue(['127.0.0.1']);
      mockResolve6.mockRejectedValue(new Error('ENOTFOUND'));

      await expect(validateUrlForSsrf('http://evil.com')).rejects.toThrow(
        /SSRF blocked.*evil\.com.*resolves to private IP 127\.0\.0\.1/,
      );
    });

    it('blocks hostname that resolves to 10.x private IP', async () => {
      mockResolve4.mockResolvedValue(['10.0.0.5']);
      mockResolve6.mockRejectedValue(new Error('ENOTFOUND'));

      await expect(validateUrlForSsrf('http://attacker.com')).rejects.toThrow(
        /SSRF blocked.*attacker\.com.*resolves to private IP 10\.0\.0\.5/,
      );
    });

    it('blocks hostname that resolves to private IPv6 (::1)', async () => {
      mockResolve4.mockRejectedValue(new Error('ENOTFOUND'));
      mockResolve6.mockResolvedValue(['::1']);

      await expect(validateUrlForSsrf('http://ipv6-evil.com')).rejects.toThrow(
        /SSRF blocked.*ipv6-evil\.com.*resolves to private IPv6/,
      );
    });

    it('blocks when any resolved IP is private (mixed results)', async () => {
      mockResolve4.mockResolvedValue(['1.2.3.4', '127.0.0.1']);
      mockResolve6.mockRejectedValue(new Error('ENOTFOUND'));

      await expect(validateUrlForSsrf('http://mixed.com')).rejects.toThrow(/SSRF blocked/);
    });
  });

  // ═══ Allowed: Legitimate external URLs ════════════════════════════════

  describe('allows legitimate external URLs', () => {
    const allowedUrls = [
      'https://api.example.com',
      'https://hooks.slack.com/services/T123/B456/xxx',
      'http://httpbin.org/get',
      'https://www.google.com',
      'https://github.com/api/v3/repos',
    ];

    for (const url of allowedUrls) {
      it(`allows ${url}`, async () => {
        mockResolve4.mockResolvedValue(['93.184.216.34']); // example.com's IP
        mockResolve6.mockRejectedValue(new Error('ENOTFOUND'));

        await expect(validateUrlForSsrf(url)).resolves.toBeUndefined();
      });
    }

    it('allows public IP addresses directly', async () => {
      await expect(validateUrlForSsrf('http://93.184.216.34')).resolves.toBeUndefined();
    });

    it('allows https scheme', async () => {
      mockResolve4.mockResolvedValue(['1.2.3.4']);
      mockResolve6.mockRejectedValue(new Error('ENOTFOUND'));

      await expect(validateUrlForSsrf('https://secure.example.com')).resolves.toBeUndefined();
    });
  });

  // ═══ Allowlist override ═══════════════════════════════════════════════

  describe('allowedInternalHosts override', () => {
    it('allows localhost when explicitly in allowlist', async () => {
      await expect(
        validateUrlForSsrf('http://localhost:3211', {
          allowedInternalHosts: ['localhost'],
        }),
      ).resolves.toBeUndefined();
    });

    it('allows backend hostname when explicitly in allowlist', async () => {
      await expect(
        validateUrlForSsrf('http://backend:3211/api', {
          allowedInternalHosts: ['backend'],
        }),
      ).resolves.toBeUndefined();
    });

    it('allowlist is case-insensitive', async () => {
      await expect(
        validateUrlForSsrf('http://LOCALHOST:8080', {
          allowedInternalHosts: ['localhost'],
        }),
      ).resolves.toBeUndefined();
    });

    it('does not allow hosts not in allowlist', async () => {
      await expect(
        validateUrlForSsrf('http://redis:6379', {
          allowedInternalHosts: ['localhost'],
        }),
      ).rejects.toThrow(/SSRF blocked/);
    });
  });

  // ═══ Error type: SsrfBlockedError ═════════════════════════════════════════

  describe('throws SsrfBlockedError with nonRetryable flag', () => {
    it('throws SsrfBlockedError for blocked IPs', async () => {
      try {
        await validateUrlForSsrf('http://127.0.0.1');
        expect.unreachable('should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(SsrfBlockedError);
        expect((err as SsrfBlockedError).nonRetryable).toBe(true);
        expect((err as SsrfBlockedError).name).toBe('SsrfBlockedError');
      }
    });

    it('throws SsrfBlockedError for invalid URLs', async () => {
      try {
        await validateUrlForSsrf('not-a-url');
        expect.unreachable('should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(SsrfBlockedError);
        expect((err as SsrfBlockedError).nonRetryable).toBe(true);
      }
    });

    it('throws SsrfBlockedError for blocked schemes', async () => {
      try {
        await validateUrlForSsrf('ftp://internal/data');
        expect.unreachable('should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(SsrfBlockedError);
        expect((err as SsrfBlockedError).nonRetryable).toBe(true);
      }
    });
  });
});
