# ADR: MCP State Externalization for Horizontal Scaling

**Date**: 2026-03-04
**Status**: Proposed
**Deciders**: Architect agent, pending team review

---

## Problem Statement

Three backend services use in-memory `Map` objects to store session state, blocking horizontal scaling. With a single backend instance, all MCP protocol connections are pinned to that process. Deploying multiple instances behind a load balancer causes requests to land on instances with no session knowledge, breaking MCP protocol mid-flight.

### Affected Maps

| File                        | Map                   | Key                 | Value Type                                    | Serializable?      |
| --------------------------- | --------------------- | ------------------- | --------------------------------------------- | ------------------ |
| `mcp-gateway.service.ts`    | `servers`             | `{runId}:{nodeIds}` | `McpServer` (closures, Zod schemas, handlers) | **No**             |
| `mcp-gateway.service.ts`    | `registeredToolNames` | same cache key      | `Set<string>`                                 | Yes                |
| `mcp-gateway.service.ts`    | `externalToolSchemas` | proxied tool name   | JSON Schema                                   | Yes                |
| `mcp-gateway.service.ts`    | `externalClients`     | endpoint URL        | `Client` (TCP connection)                     | **No**             |
| `mcp-gateway.controller.ts` | `transports`          | same cache key      | `StreamableHTTPServerTransport` (SSE stream)  | **No**             |
| `mcp-gateway.controller.ts` | `pendingInits`        | same cache key      | `Promise<Transport>`                          | **No** (ephemeral) |
| `studio-mcp.controller.ts`  | `sessions`            | MCP session UUID    | `{ transport, userId, orgId }`                | **No**             |

### Lifecycle Summary

| Map                   | Created                             | Cleaned Up                  | Typical Lifetime       | Size              |
| --------------------- | ----------------------------------- | --------------------------- | ---------------------- | ----------------- |
| `servers`             | First `getServerForRun()`           | `cleanupRun()` on SSE close | Run duration (sec–min) | 1 per agent scope |
| `registeredToolNames` | With `servers`                      | Implicit GC                 | Same                   | ~5–50 entries     |
| `externalToolSchemas` | During `registerTools()`            | **Never** (leak)            | App lifetime           | ~100 max          |
| `externalClients`     | First `getOrCreateExternalClient()` | `cleanupRun()`              | Run duration           | 1 per endpoint    |
| `transports`          | MCP init (POST/GET)                 | SSE `close` event           | Run duration           | 1 per scope       |
| `pendingInits`        | Init race guard                     | `finally` block             | Milliseconds           | 0–1               |
| `sessions` (studio)   | Studio init                         | SSE close / DELETE          | Agent session          | 1 per session     |

---

## Constraints

1. **Protocol binding**: MCP Streamable HTTP binds sessions to a TCP socket. `StreamableHTTPServerTransport` manages SSE streams tied to one process. This is an MCP SDK design constraint.
2. **Stateful external clients**: stdio-proxy rejects re-initialization. A `Client` must be reused from the same process.
3. **Redis in stack**: Available via `REDIS_URL`, `TERMINAL_REDIS_URL`, `TOOL_REGISTRY_REDIS_URL`. Used for terminal streams, tool registry, discovery caching, distributed locks.
4. **Nginx reverse proxy**: Production runs nginx. `upstream backend` currently has a single server, no sticky support.
5. **Session identity exists**: `runId` (in JWT) and `Mcp-Session-Id` header are present in every request — natural affinity keys.
6. **Run lifetime**: Typically seconds to minutes. Not long-lived enough for complex replication.
