# Agent: implementer (SSRF Protection)

## Purpose

Add SSRF (Server-Side Request Forgery) protection to the component-sdk HTTP layer so that user-controlled outbound requests from workflow components cannot target internal infrastructure, cloud metadata endpoints, or private network ranges.

## Skills

Load before starting: none

## Subtasks

### SSRF Guard Module

- [x] Create `packages/component-sdk/src/http/ssrf-guard.ts` with a `validateUrlForSsrf(url: string)` function that throws a descriptive error if the URL targets a blocked destination
- [x] Block RFC 1918 private ranges: `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`
- [x] Block loopback addresses: `127.0.0.0/8`, `::1`
- [x] Block link-local ranges: `169.254.0.0/16` (AWS metadata), `fe80::/10`
- [x] Block cloud metadata endpoints: `169.254.169.254` (AWS/GCP), `metadata.google.internal`, `100.100.100.200` (Alibaba)
- [x] Block IPv6-mapped IPv4 addresses that encode private ranges (e.g., `::ffff:127.0.0.1`, `::ffff:10.0.0.1`)
- [x] Block `0.0.0.0` and `[::]` (wildcard bind addresses)
- [x] Block URL schemes other than `http:` and `https:` (e.g., `file://`, `ftp://`, `gopher://`)
- [x] Block hostnames that resolve to internal-only names: `localhost`, `*.local`, `*.internal`, `*.svc.cluster.local` (Kubernetes)
- [x] Add a DNS resolution check: after parsing the URL hostname, resolve it via `dns.resolve4`/`dns.resolve6` and validate the resolved IP(s) against the blocklist before allowing the request to proceed — this prevents DNS rebinding attacks where an attacker's domain resolves to `127.0.0.1`
- [x] Handle edge cases: decimal IP notation (e.g., `2130706433` = `127.0.0.1`), octal IP notation (e.g., `0177.0.0.1`), hex IP notation (e.g., `0x7f000001`), URLs with credentials (`http://user:pass@127.0.0.1`), URL redirects are NOT in scope (fetch follows redirects but re-checking post-redirect would require a custom fetch wrapper — document this as a known limitation)

### Integration into instrumented-fetch

- [x] Add an `SsrfGuardOptions` type to `packages/component-sdk/src/http/types.ts` with fields: `enabled: boolean` (default `true`), `allowedInternalHosts?: string[]` (for overrides like the backend API)
- [x] In `instrumentedFetch()` in `packages/component-sdk/src/http/instrumented-fetch.ts`, call `validateUrlForSsrf(url)` BEFORE the `globalThis.fetch()` call (around line 80). Only run the check when `options.ssrfGuard?.enabled !== false`
- [x] Ensure internal service calls are NOT affected: `callInternalApi()` in `mcp.activity.ts` uses raw `fetch()` directly, not `context.http.fetch()`, so it bypasses the guard. Verify this by reading callers.

### Testing

- [x] Create `packages/component-sdk/src/__tests__/ssrf-guard.test.ts` with unit tests covering:
  - Blocked: `http://127.0.0.1`, `http://10.0.0.1`, `http://172.16.0.1`, `http://192.168.1.1`, `http://169.254.169.254/latest/meta-data/`, `http://[::1]`, `http://localhost`, `file:///etc/passwd`, `http://0x7f000001`
  - Allowed: `https://api.example.com`, `https://hooks.slack.com/services/xxx`, `http://httpbin.org/get`
  - DNS rebinding: mock `dns.resolve4` to return `127.0.0.1` for `evil.com` — verify it is blocked
  - Allowlist override: when `allowedInternalHosts` includes `localhost`, `http://localhost:3211` should be allowed
- [x] Run the existing `http-instrumentation.test.ts` tests to confirm no regressions in the instrumented fetch flow

### Export and Documentation

- [x] Export `validateUrlForSsrf` and `SsrfGuardOptions` from `packages/component-sdk/src/index.ts`
- [x] Add a brief JSDoc comment on `validateUrlForSsrf` documenting which ranges are blocked and the DNS rebinding protection

## Notes

- The HTTP Request component at `worker/src/components/core/http-request.ts` calls `context.http.fetch(url, ...)` at line ~280. The `context.http` object is created by `createHttpClient(context)` in `packages/component-sdk/src/context.ts` (line ~157). `createHttpClient` wraps `instrumentedFetch()`. So adding the SSRF guard in `instrumentedFetch` automatically protects the HTTP Request component and any future components using `context.http.fetch()`.
- The `instrumentedFetch` function currently calls `globalThis.fetch` directly at line ~79 with no URL validation.
- Internal service calls (e.g., `callInternalApi` in `mcp.activity.ts`, `testMcpConnection` in `mcp-discovery.activity.ts`) use raw `fetch()`, NOT `context.http.fetch()`, so they are NOT affected by the SSRF guard.
- Known limitation: HTTP redirects (3xx responses where the `Location` header points to an internal IP) are not caught by this guard. Mitigating redirect-based SSRF requires intercepting the redirect chain, which is a follow-up task. Document this in the JSDoc.

## Completion Summary

<!-- Appended by orchestrator after agent completes. Do not fill manually. -->
