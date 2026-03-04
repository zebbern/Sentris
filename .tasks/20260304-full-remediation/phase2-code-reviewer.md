# Agent: code-reviewer (Phase 2 Security Review)

## Purpose

Review the SSRF protection implementation and exec→spawn migration for correctness, completeness, and bypass vectors. This is a read-only review — do not modify source code.

## Skills

Load before starting: none

## Subtasks

### SSRF Blocklist Review

- [x] Verify the blocklist covers all RFC 1918 ranges: `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`
- [x] Verify loopback coverage: `127.0.0.0/8` (not just `127.0.0.1`), `::1`
- [x] Verify link-local coverage: `169.254.0.0/16`, `fe80::/10` — **FINDING: fe80::/10 check is incomplete (see findings)**
- [x] Verify cloud metadata endpoint blocking: `169.254.169.254` (AWS/GCP IMDS), `metadata.google.internal`
- [x] Check for IPv6-mapped IPv4 bypass: does the guard catch `::ffff:127.0.0.1`, `::ffff:10.0.0.1`, etc.?
- [x] Check for alternate IP encoding bypass: decimal (`2130706433`), octal (`0177.0.0.1`), hex (`0x7f000001`) — does the guard normalize these before checking?
- [x] Check for URL parsing bypass: `http://127.0.0.1@evil.com` (credentials in URL), `http://evil.com#@127.0.0.1` (fragment abuse), `http://127.0.0.1:80/` vs `http://127.0.0.1/` (port normalization)
- [x] Verify the DNS rebinding protection: confirm `dns.resolve4`/`dns.resolve6` is called AFTER URL parsing but BEFORE `fetch()`, and that ALL resolved IPs are checked (not just the first)
- [x] Check that non-HTTP schemes are blocked: `file://`, `ftp://`, `gopher://`, `data:`, `javascript:` — **FINDING: data: and javascript: not explicitly tested**
- [x] Verify the allowlist override mechanism works correctly and cannot be abused (caller must explicitly opt in)
- [x] Confirm that internal service calls (`callInternalApi` in mcp.activity.ts, raw `fetch()` in mcp-discovery.activity.ts) are NOT routed through the SSRF guard

### exec→spawn Migration Review

- [x] Verify ALL `exec()` / `execAsync()` calls in `mcp.activity.ts` have been replaced with `execFile()` / `execFileAsync()`
- [x] Verify ALL `exec()` / `execAsync()` calls in `mcp-discovery.activity.ts` have been replaced with `execFile()` / `execFileAsync()`
- [x] Confirm the Docker command arguments are correctly split into array form (no shell metacharacters concatenated into single strings)
- [x] Verify that `--filter` arguments with `=` are passed correctly to execFile (e.g., `'--filter', 'name=mcp-server-'` not `'--filter=name=mcp-server-'` — both work but verify consistency)
- [x] Confirm the `--format` template strings (`{{.Names}}`, `{{.Name}}`) are passed as single array elements, not split
- [x] Verify the existing input validation regex checks on containerId, runId, and volumeName are preserved (defense-in-depth)
- [x] Check for any other `exec()` calls in the worker that were missed — search `worker/src/` for `exec(`, `execSync(`, `child_process` — **CLEAN: all usage is execFile or spawn**

### General Security Review

- [x] Review error messages from both changes: ensure they don't leak internal infrastructure details (IP ranges, hostnames, Docker container names) to end users — **FINDING: error messages include resolved IPs, acceptable if not forwarded to end users**
- [x] Check that the SSRF guard error is a non-retryable error type (workflows should not retry SSRF-blocked requests) — **FINDING: plain Error thrown, not non-retryable**
- [x] Verify test coverage: SSRF guard tests cover the main bypass vectors, exec migration doesn't break existing tests

## Notes

- This review depends on Phase 2a (SSRF) and Phase 2b (exec→spawn) being complete.
- Focus on bypass vectors and edge cases — the basic implementation should be straightforward.
- The SSRF guard is at `packages/component-sdk/src/http/ssrf-guard.ts` and integrated in `packages/component-sdk/src/http/instrumented-fetch.ts`.
- The exec→spawn changes are in `worker/src/temporal/activities/mcp.activity.ts` and `worker/src/temporal/activities/mcp-discovery.activity.ts`.
- Known limitation to document (not a blocker): HTTP redirect-based SSRF (3xx redirect to internal IP) is not covered by the current guard. This requires a custom fetch wrapper and is a follow-up item.

## Completion Summary

<!-- Appended by orchestrator after agent completes. Do not fill manually. -->
