# Agent: code-reviewer (read-only)

## Purpose

Review all sticky session implementation code for correctness, consistency with existing codebase patterns, and adherence to project conventions.

## Skills

Load before starting: none

## Subtasks

### Nginx config review

- [x] Verify `map` block syntax is correct and the fallback to `$remote_addr` is properly configured
- [x] Verify `upstream backend_mcp` uses `hash $mcp_affinity_key consistent;` with correct syntax
- [x] Verify the MCP location blocks are placed before the generic `/api/v1/` block (longest prefix match)
- [x] Verify SSE/streaming support: `proxy_buffering off`, long `proxy_read_timeout`, WebSocket upgrade headers
- [x] Verify dev config includes CORS headers in MCP locations; prod config does not
- [x] Verify `keepalive` is set on the new upstream

### Cookie implementation review

- [x] Verify `res.cookie()` is called BEFORE `transport.handleRequest()` in all code paths (headers must be set before the transport writes the response)
- [x] Verify cookie attributes match the spec: `HttpOnly`, `SameSite=Strict`, scoped `Path`, `Max-Age=7200`
- [x] Verify the cookie helper function avoids duplication and is consistent across both controllers
- [x] Verify no breaking changes to existing request/response flow in `McpGatewayController` and `StudioMcpController`
- [x] Verify the `Secure` flag is conditionally set for production vs development

### Session registry review

- [x] Verify `SessionRegistryService` follows existing NestJS service patterns (injectable, Redis injection via token, `OnModuleDestroy`)
- [x] Verify Redis key pattern `mcp:sessions:{sessionId}` is consistent with existing patterns (`mcp:run:{runId}:tools`)
- [x] Verify TTL is set on all registry entries (no orphaned keys)
- [x] Verify registry failures are non-fatal — wrapped in try/catch in controllers, logged at `warn`
- [x] Verify the admin endpoint is protected with `@Roles('ADMIN')` and `@UseGuards(RolesGuard)`
- [x] Verify module registration in `mcp.module.ts` — provider, token, exports

### Test review

- [x] Verify tests cover the happy path and edge cases (missing cookie, Redis failure, session not found)
- [x] Verify mock patterns are consistent with existing test files
- [x] Verify no tests are skipped or incomplete

## Notes

- This is a read-only review. Do not modify any source files.
- Focus on correctness (will it work?), consistency (does it match codebase patterns?), and completeness (are edge cases handled?).
- Flag any issues as S0 (blocking), S1 (should fix), or S2 (nice to have).

## Completion Summary

<!-- Appended by orchestrator after agent completes. Do not fill manually. -->
