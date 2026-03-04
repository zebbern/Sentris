# Plan: Sticky Sessions for MCP Horizontal Scaling

## Overview

Add Nginx consistent-hash routing, `mcp_affinity` cookies, and a Redis session registry so that MCP and Studio-MCP requests are pinned to the backend instance that holds their in-memory transport/session state. This enables horizontal scaling without externalizing the inherently stateful `StreamableHTTPServerTransport` and `McpServer` objects.

## Architecture Decisions

| Decision                                           | Alternatives                                                               | Rationale                                                                                                            |
| -------------------------------------------------- | -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Nginx `hash $mcp_affinity_key consistent` upstream | IP hash, Redis session store for transports                                | Consistent hashing allows graceful redistribution when backends scale; cookie-based affinity is protocol-transparent |
| `mcp_affinity` cookie set by backend               | Nginx-injected `sticky` cookie (requires Nginx Plus), header-based routing | Backend controls the cookie value (session/run ID), no Nginx Plus dependency                                         |
| Redis session registry for observability           | PostgreSQL table, in-memory only                                           | Redis TTL auto-expires stale sessions; already in stack; low-latency reads for admin endpoint                        |
| Separate `upstream backend_mcp` block              | Reuse single upstream with conditional hash                                | Separate upstream keeps round-robin for non-MCP routes (healthchecks, API, frontend)                                 |

## Affected Files

| Action | File Path                                                        | Change Description                                                     |
| ------ | ---------------------------------------------------------------- | ---------------------------------------------------------------------- |
| MODIFY | `docker/nginx/nginx.dev.conf`                                    | Add `map` block, `upstream backend_mcp`, dedicated MCP location blocks |
| MODIFY | `docker/nginx/nginx.prod.conf`                                   | Same changes for production config                                     |
| MODIFY | `backend/src/mcp/mcp-gateway.controller.ts`                      | Set `mcp_affinity` cookie on responses (value = cacheKey)              |
| MODIFY | `backend/src/studio-mcp/studio-mcp.controller.ts`                | Set `mcp_affinity` cookie on responses (value = sessionId)             |
| CREATE | `backend/src/mcp/session-registry.service.ts`                    | Redis-backed session registry with TTL                                 |
| MODIFY | `backend/src/mcp/mcp.module.ts`                                  | Register `SessionRegistryService`, add Redis provider token            |
| CREATE | `backend/src/mcp/__tests__/session-registry.service.spec.ts`     | Unit tests for registry CRUD                                           |
| MODIFY | `backend/src/mcp/__tests__/mcp-gateway.spec.ts`                  | Add tests for cookie setting                                           |
| MODIFY | `backend/src/studio-mcp/__tests__/studio-mcp.controller.spec.ts` | Add tests for cookie setting                                           |

## Phases

| Phase | Agents                      | Purpose                                                     | Depends On   |
| ----- | --------------------------- | ----------------------------------------------------------- | ------------ |
| 1a    | sticky-implementer-cookie   | Set `mcp_affinity` cookie in MCP and Studio-MCP controllers | —            |
| 1b    | sticky-implementer-registry | Create Redis session registry service                       | —            |
| 1c    | sticky-implementer-nginx    | Configure Nginx consistent-hash upstream for MCP routes     | —            |
| 2     | sticky-tester               | Unit tests for cookies and registry                         | Phase 1a, 1b |
| 3a    | sticky-code-reviewer        | Code review all changes                                     | Phase 1, 2   |
| 3b    | sticky-security-reviewer    | Security review (cookie security, session hijacking)        | Phase 1, 2   |

## Dependencies

- Phase 1a, 1b, 1c are independent and can execute in parallel.
- Phase 2 (tester) needs the controller and registry code from Phase 1a/1b.
- Phase 3 reviews need all implementation and test code.

## Risk Assessment

| Risk                                                  | Mitigation                                                                                                                                                 |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cookie not set on first request (no affinity yet)     | First request goes to any instance via round-robin; cookie is set on response; subsequent requests are pinned. Document this one-request warmup.           |
| Instance dies mid-session                             | Client retries hit a different backend (consistent hash redistributes); transport is gone so a new session initializes. Existing behavior — no regression. |
| Cookie value leaks session info                       | Use HttpOnly + SameSite=Strict + Secure (prod). Value is an opaque UUID, not sensitive.                                                                    |
| Nginx `consistent` hash redistributes on scale events | Only ~1/N sessions are affected when adding/removing a backend. Acceptable for MCP sessions (short-lived).                                                 |
