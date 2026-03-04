# Agent: security-reviewer (read-only)

## Purpose

Review the sticky session implementation for security vulnerabilities: cookie security, session hijacking, information disclosure, and admin endpoint authorization.

## Skills

Load before starting: none

## Subtasks

### Cookie security

- [x] Verify `mcp_affinity` cookie has `HttpOnly` flag (prevents JavaScript access / XSS exfiltration)
- [x] Verify `SameSite=Strict` is set (prevents CSRF-based session fixation)
- [x] Verify `Secure` flag is set in production (prevents cookie transmission over plain HTTP)
- [x] Verify the cookie `Path` is scoped narrowly (`/api/v1/mcp` or `/api/v1/studio-mcp`) — not `/`
- [x] Verify the cookie value (cacheKey or sessionId) does not leak sensitive information. UUIDs and run IDs are opaque — confirm no PII or credentials are embedded
- [x] Verify `Max-Age=7200` is appropriate — the cookie should not outlive the session by a large margin

### Session fixation / hijacking

- [x] Verify that the `mcp_affinity` cookie is a routing hint only — it does NOT grant access to a session. Authentication is still performed by `McpAuthGuard` (gateway) or the global `AuthGuard` (studio-mcp)
- [x] Verify that a client cannot use a crafted `mcp_affinity` cookie to access another user's session — the cookie only affects which backend instance receives the request, not authorization
- [x] Verify the existing session identity check in `StudioMcpController` (userId + organizationId match) remains intact and is not bypassed by the cookie

### Redis session registry

- [x] Verify session data stored in Redis does not include secrets, tokens, or credentials — only metadata (sessionId, instanceId, userId, orgId, timestamps)
- [x] Verify TTL is enforced on all Redis keys (no indefinite storage of session metadata)
- [x] Verify the `listActiveSessions` admin endpoint does not expose data that could aid an attacker (e.g., internal instance IPs, session tokens)

### Admin endpoint

- [x] Verify `GET /api/v1/mcp/sessions` requires `ADMIN` role — non-admin users should receive 403
- [x] Verify the endpoint does not accept user-controlled filtering that could lead to injection (Redis key injection via crafted session IDs)

### Nginx config

- [x] Verify the `map` block does not introduce header injection vulnerabilities (cookie values are used as hash keys, not interpolated into proxy headers)
- [x] Verify the `upstream backend_mcp` block does not expose internal backend hostnames or ports in error responses
- [x] Verify the prod config retains all existing security response headers (X-Frame-Options, CSP, HSTS, etc.) in the new MCP location blocks

## Notes

- This is a read-only review. Do not modify any source files.
- The `mcp_affinity` cookie is strictly a load-balancer routing hint. It has no authorization semantics. The security review should confirm this invariant.
- Flag findings as S0 (critical — must fix before merge), S1 (high — should fix), S2 (medium — track).

## Completion Summary

<!-- Appended by orchestrator after agent completes. Do not fill manually. -->
