# Agent: implementer (MCP Affinity Cookie)

## Purpose

Set an `mcp_affinity` cookie on MCP gateway and Studio-MCP controller responses so that Nginx's consistent-hash upstream can pin subsequent requests to the same backend instance.

## Skills

Load before starting: none

## Subtasks

### MCP Gateway Controller (`backend/src/mcp/mcp-gateway.controller.ts`)

- [x] After a new transport is successfully initialized and stored in `this.transports` (around the `this.transports.set(cacheKey, transport)` line), set the `mcp_affinity` cookie on the response. Cookie attributes: `HttpOnly`, `SameSite=Strict`, `Path=/api/v1/mcp`, `Max-Age=7200` (2 hours, matching session lifetime). The cookie value should be the `cacheKey` (which is `runId` or `runId:allowedNodeIds`)
- [x] For POST and DELETE requests on an existing transport (the `else` branch at the bottom of `handleGateway`), also set the `mcp_affinity` cookie before calling `transport.handleRequest()` — this ensures the cookie is refreshed on each request and set even if the client didn't have it yet
- [x] For the GET SSE path on an existing transport, set the cookie before calling `void transport.handleRequest(req, res)` — the SSE response headers are sent immediately so the cookie must be set before the transport takes over the response
- [x] Handle the cookie-absent case gracefully: when no `mcp_affinity` cookie is present on the incoming request, the controller should still proceed normally (Nginx falls back to `$remote_addr` hashing). The cookie is only SET, never required

### Studio-MCP Controller (`backend/src/studio-mcp/studio-mcp.controller.ts`)

- [x] After a new session is created and stored in `this.sessions` (after the `this.sessions.set(transport.sessionId, ...)` line), set the `mcp_affinity` cookie on the response. Cookie attributes: `HttpOnly`, `SameSite=Strict`, `Path=/api/v1/studio-mcp`, `Max-Age=7200`. The cookie value should be `transport.sessionId`
- [x] For requests on existing sessions (the `if (sessionId)` branch), set the `mcp_affinity` cookie before delegating to `transport.handleRequest()` — for all methods (GET, POST, DELETE)
- [x] On session DELETE, do NOT clear the cookie (the session is ending; the cookie will expire naturally or be overwritten by the next session)

### Cookie helper

- [x] Create a small helper function (either inline in each controller or as a shared utility in `backend/src/mcp/`) that sets the cookie with the standard attributes. Signature: `setAffinityCookie(res: Response, value: string, path: string): void`. This avoids duplicating the cookie attribute string in multiple places

## Notes

- The `res.cookie()` method is available on Express `Response` objects (already imported in both controllers).
- Cookie value must be URL-safe. `cacheKey` contains `runId` (UUID) and optionally `:nodeId1,nodeId2` — all URL-safe characters. `transport.sessionId` is a UUID.
- `Max-Age=7200` (2 hours) aligns with the MCP session lifetime. If sessions are shorter, the cookie persists harmlessly until it expires.
- In production, add `Secure: true` conditionally (when `X-Forwarded-Proto` is `https` or via a config flag). In dev, `Secure` must be omitted since dev uses plain HTTP on `localhost:80`.
- The `handleRequest` calls on `StreamableHTTPServerTransport` write to the response directly. The cookie MUST be set via `res.cookie()` BEFORE `handleRequest` is called, otherwise the headers will already have been sent.
- The `mcp_affinity` cookie is scoped by `Path` to avoid leaking into unrelated routes (`/api/v1/mcp` vs `/api/v1/studio-mcp`).

## Completion Summary

<!-- Appended by orchestrator after agent completes. Do not fill manually. -->
