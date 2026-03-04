/**
 * SSRF (Server-Side Request Forgery) Guard
 *
 * Validates URLs before making HTTP requests to prevent access to internal
 * infrastructure, cloud metadata endpoints, and private network ranges.
 *
 * ## Blocked destinations
 * - **RFC 1918 private ranges**: `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`
 * - **Loopback**: `127.0.0.0/8`, `::1`
 * - **Link-local**: `169.254.0.0/16` (includes AWS/GCP metadata at `169.254.169.254`), `fe80::/10`
 * - **Cloud metadata**: `169.254.169.254`, `metadata.google.internal`, `100.100.100.200`
 * - **IPv6-mapped IPv4**: `::ffff:` prefixed private IPs
 * - **Wildcard bind**: `0.0.0.0`, `[::]`
 * - **Non-HTTP schemes**: `file://`, `ftp://`, `gopher://`, etc.
 * - **Internal hostnames**: `localhost`, `*.local`, `*.internal`, `*.svc.cluster.local`,
 *   and known Docker service names (postgres, redis, temporal, etc.)
 * - **Obfuscated IPs**: decimal, octal, and hex notation
 *
 * ## DNS rebinding protection
 * After URL parsing, the hostname is resolved via DNS and the resolved IP(s)
 * are checked against the blocklist. This prevents an attacker's domain from
 * resolving to `127.0.0.1` or other internal addresses.
 *
 * ## Known limitation
 * HTTP redirects (3xx with `Location` pointing to an internal IP) are NOT
 * caught by this guard. Mitigating redirect-based SSRF requires a custom
 * fetch wrapper that intercepts the redirect chain — this is a follow-up task.
 *
 * @module
 */

import { resolve4, resolve6 } from 'dns/promises';

// ─── Errors ──────────────────────────────────────────────────────────────────

/**
 * Custom error thrown when an SSRF-blocked URL is detected.
 *
 * Marked as `nonRetryable` so Temporal workflows do not retry requests
 * that are guaranteed to be blocked by policy.
 */
export class SsrfBlockedError extends Error {
  /** Signals Temporal (and similar retry frameworks) to skip retries. */
  readonly nonRetryable = true as const;

  constructor(message: string) {
    super(message);
    this.name = 'SsrfBlockedError';
  }
}

// ─── Types ───────────────────────────────────────────────────────────────────

export interface SsrfGuardOptions {
  /** Whether SSRF validation is enabled. Defaults to `true`. */
  enabled: boolean;
  /**
   * Hostnames that are explicitly allowed even if they would otherwise be
   * blocked (e.g., the backend API host). Case-insensitive comparison.
   */
  allowedInternalHosts?: string[];
}

// ─── Constants ───────────────────────────────────────────────────────────────

const ALLOWED_SCHEMES = new Set(['http:', 'https:']);

/**
 * Known Docker/internal service hostnames that should be blocked
 * when SSRF protection is active.
 */
const BLOCKED_HOSTNAMES = new Set([
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
  'metadata.google.internal',
]);

/**
 * Hostname suffix patterns that indicate internal/local addresses.
 */
const BLOCKED_HOSTNAME_SUFFIXES = [
  '.local',
  '.internal',
  '.svc.cluster.local',
];

// ─── IP Parsing ──────────────────────────────────────────────────────────────

/**
 * Try to parse an obfuscated IP (decimal, octal, hex) into a standard
 * dotted-quad IPv4 string. Returns `null` if the input is not a
 * recognizable IP obfuscation.
 */
function deobfuscateIp(hostname: string): string | null {
  // Single decimal integer (e.g., 2130706433 = 127.0.0.1)
  if (/^\d+$/.test(hostname)) {
    const num = Number(hostname);
    if (num >= 0 && num <= 0xffffffff) {
      return [
        (num >>> 24) & 0xff,
        (num >>> 16) & 0xff,
        (num >>> 8) & 0xff,
        num & 0xff,
      ].join('.');
    }
  }

  // Single hex integer (e.g., 0x7f000001 = 127.0.0.1)
  if (/^0x[0-9a-fA-F]+$/i.test(hostname)) {
    const num = parseInt(hostname, 16);
    if (num >= 0 && num <= 0xffffffff) {
      return [
        (num >>> 24) & 0xff,
        (num >>> 16) & 0xff,
        (num >>> 8) & 0xff,
        num & 0xff,
      ].join('.');
    }
  }

  // Dotted octal/hex/decimal mix (e.g., 0177.0.0.1 = 127.0.0.1)
  const parts = hostname.split('.');
  if (parts.length === 4) {
    const octets: number[] = [];
    for (const part of parts) {
      let num: number;
      if (/^0x[0-9a-fA-F]+$/i.test(part)) {
        num = parseInt(part, 16);
      } else if (/^0\d+$/.test(part)) {
        num = parseInt(part, 8);
      } else if (/^\d+$/.test(part)) {
        num = parseInt(part, 10);
      } else {
        return null;
      }
      if (isNaN(num) || num < 0 || num > 255) return null;
      octets.push(num);
    }
    return octets.join('.');
  }

  return null;
}

// ─── IPv4 range checks ──────────────────────────────────────────────────────

function parseIpv4Octets(ip: string): number[] | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  const octets: number[] = [];
  for (const p of parts) {
    const n = parseInt(p, 10);
    if (isNaN(n) || n < 0 || n > 255) return null;
    octets.push(n);
  }
  return octets;
}

function isIpv4Private(ip: string): boolean {
  const octets = parseIpv4Octets(ip);
  if (!octets) return false;
  const [a, b] = octets;

  // 10.0.0.0/8
  if (a === 10) return true;

  // 172.16.0.0/12
  if (a === 172 && b >= 16 && b <= 31) return true;

  // 192.168.0.0/16
  if (a === 192 && b === 168) return true;

  // 127.0.0.0/8 (loopback)
  if (a === 127) return true;

  // 169.254.0.0/16 (link-local, AWS/GCP metadata)
  if (a === 169 && b === 254) return true;

  // 0.0.0.0 (wildcard)
  if (a === 0 && b === 0 && octets[2] === 0 && octets[3] === 0) return true;

  // 100.64.0.0/10 (Carrier-Grade NAT, RFC 6598)
  if (a === 100 && b >= 64 && b <= 127) return true;

  // 100.100.100.200 (Alibaba Cloud metadata — also covered by CGN range above)
  // Kept as a comment for documentation; CGN range check handles it.

  return false;
}

// ─── IPv6 checks ─────────────────────────────────────────────────────────────

function isIpv6Private(ip: string): boolean {
  const normalized = ip.toLowerCase();

  // ::1 (loopback)
  if (normalized === '::1') return true;

  // :: (wildcard)
  if (normalized === '::') return true;

  // fe80::/10 (link-local) — the /10 prefix means the top 10 bits are 1111 1110 10,
  // covering fe80:: through febf::. Check via bitmask on the first 16-bit group.
  const first16 = parseInt(normalized.split(':')[0], 16);
  if (!isNaN(first16) && (first16 & 0xffc0) === 0xfe80) return true;

  // ::ffff: mapped IPv4 — dotted-quad notation (e.g., ::ffff:127.0.0.1)
  const ffffDottedMatch = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (ffffDottedMatch) {
    return isIpv4Private(ffffDottedMatch[1]);
  }

  // ::ffff: mapped IPv4 — hex notation (e.g., ::ffff:7f00:1 = 127.0.0.1)
  // URL parser normalizes ::ffff:A.B.C.D to ::ffff:XXYY:ZZWW
  const ffffHexMatch = normalized.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (ffffHexMatch) {
    const high = parseInt(ffffHexMatch[1], 16);
    const low = parseInt(ffffHexMatch[2], 16);
    const ipv4 = [
      (high >> 8) & 0xff,
      high & 0xff,
      (low >> 8) & 0xff,
      low & 0xff,
    ].join('.');
    return isIpv4Private(ipv4);
  }

  return false;
}

// ─── Hostname checks ────────────────────────────────────────────────────────

function isBlockedHostname(hostname: string): boolean {
  const lower = hostname.toLowerCase();

  if (BLOCKED_HOSTNAMES.has(lower)) return true;

  for (const suffix of BLOCKED_HOSTNAME_SUFFIXES) {
    if (lower.endsWith(suffix)) return true;
  }

  return false;
}

// ─── Main validator ──────────────────────────────────────────────────────────

/**
 * Validates a URL for SSRF safety. Throws a {@link SsrfBlockedError} if the
 * URL targets a blocked destination (private network, cloud metadata, internal
 * hostname, etc.).
 *
 * Performs DNS resolution to prevent DNS rebinding attacks, where an
 * attacker-controlled domain resolves to a private IP.
 *
 * **DNS TOCTOU caveat:** There is an inherent time-of-check / time-of-use
 * race between DNS resolution here and the subsequent HTTP request. An
 * attacker could serve a safe IP during validation and a private IP when
 * the actual connection is made. Full mitigation requires a connect-time
 * socket guard or a custom fetch agent that pins resolved IPs — see the
 * redirect limitation note above for related follow-up work.
 *
 * @param url - The URL string to validate.
 * @param options - Optional configuration (e.g., allowedInternalHosts).
 * @throws {SsrfBlockedError} If the URL targets a blocked destination.
 *
 * @example
 * ```ts
 * await validateUrlForSsrf('https://api.example.com'); // OK
 * await validateUrlForSsrf('http://127.0.0.1');         // throws
 * await validateUrlForSsrf('http://169.254.169.254');    // throws
 * ```
 */
export async function validateUrlForSsrf(
  url: string,
  options?: Pick<SsrfGuardOptions, 'allowedInternalHosts'>,
): Promise<void> {
  // ── 1. Parse URL ──────────────────────────────────────────────────────
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new SsrfBlockedError(`SSRF blocked: invalid URL "${url}"`);
  }

  // ── 2. Scheme check ───────────────────────────────────────────────────
  if (!ALLOWED_SCHEMES.has(parsed.protocol)) {
    throw new SsrfBlockedError(
      `SSRF blocked: scheme "${parsed.protocol}" is not allowed. Only http: and https: are permitted.`,
    );
  }

  // ── 3. Extract hostname (strip brackets from IPv6) ────────────────────
  let hostname = parsed.hostname.toLowerCase();
  if (hostname.startsWith('[') && hostname.endsWith(']')) {
    hostname = hostname.slice(1, -1);
  }

  // ── 4. Allowlist check ────────────────────────────────────────────────
  const allowedHosts = options?.allowedInternalHosts ?? [];
  if (allowedHosts.some((h) => h.toLowerCase() === hostname)) {
    return; // Explicitly allowed
  }

  // ── 5. Blocked hostname check ─────────────────────────────────────────
  if (isBlockedHostname(hostname)) {
    throw new SsrfBlockedError(
      `SSRF blocked: hostname "${hostname}" is a known internal/blocked host.`,
    );
  }

  // ── 6. IPv6 literal check ─────────────────────────────────────────────
  if (isIpv6Private(hostname)) {
    throw new SsrfBlockedError(
      `SSRF blocked: IPv6 address "${hostname}" resolves to a private/internal range.`,
    );
  }

  // ── 7. IPv4 direct check (standard dotted-quad) ───────────────────────
  if (parseIpv4Octets(hostname)) {
    if (isIpv4Private(hostname)) {
      throw new SsrfBlockedError(
        `SSRF blocked: IP address "${hostname}" is in a private/internal range.`,
      );
    }
    // It's a valid public IP — no DNS resolution needed
    return;
  }

  // ── 8. Obfuscated IP check (decimal, octal, hex) ─────────────────────
  const deobfuscated = deobfuscateIp(hostname);
  if (deobfuscated) {
    if (isIpv4Private(deobfuscated)) {
      throw new SsrfBlockedError(
        `SSRF blocked: obfuscated IP "${hostname}" resolves to private address ${deobfuscated}.`,
      );
    }
    // Public IP in obfuscated form — allow
    return;
  }

  // ── 9. DNS resolution check (prevents DNS rebinding) ──────────────────
  const resolvedIps: string[] = [];

  try {
    const ipv4Addrs = await resolve4(hostname);
    resolvedIps.push(...ipv4Addrs);
  } catch {
    // ENOTFOUND / ENODATA is fine — hostname may only have AAAA records
  }

  try {
    const ipv6Addrs = await resolve6(hostname);
    resolvedIps.push(...ipv6Addrs);
  } catch {
    // ENOTFOUND / ENODATA is fine — hostname may only have A records
  }

  for (const ip of resolvedIps) {
    if (isIpv4Private(ip)) {
      throw new SsrfBlockedError(
        `SSRF blocked: hostname "${hostname}" resolves to private IP ${ip}.`,
      );
    }
    if (isIpv6Private(ip)) {
      throw new SsrfBlockedError(
        `SSRF blocked: hostname "${hostname}" resolves to private IPv6 address ${ip}.`,
      );
    }
  }
}
