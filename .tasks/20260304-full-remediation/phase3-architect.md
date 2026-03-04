# Agent: architect

## Purpose

Design externalized state replacements for the 3 backend services that use in-memory Maps, blocking horizontal scaling.

## Skills

Load before starting: none

## Subtasks

### Audit current in-memory state

- [x] Read `backend/src/mcp/mcp-gateway.service.ts` and document the 4 Maps: `servers` (McpServer per cacheKey), `registeredToolNames` (Set<string> per cacheKey), `externalToolSchemas` (JSON schema per tool name), `externalClients` (MCP Client per endpoint URL)
- [x] Read `backend/src/mcp/mcp-gateway.controller.ts` and document: `transports` (StreamableHTTPServerTransport per cacheKey), `pendingInits` (Promise per cacheKey)
- [x] Read `backend/src/studio-mcp/studio-mcp.controller.ts` and document: `sessions` (McpSession per sessionId — transport + identity)
- [x] Catalog the lifecycle of each Map entry: creation trigger, access patterns, cleanup/eviction, and data size characteristics
- [x] Identify which Maps hold stateful protocol connections (MCP Client, StreamableHTTPServerTransport) vs pure data caches (tool schemas, registered tool names)

### Design state externalization strategy

- [x] For each Map, determine the appropriate externalization approach — choose from: Redis-backed cache, sticky sessions (load balancer affinity), or session-bound (no externalization needed if sticky)
- [x] Design a strategy for `servers` and `transports` Maps — these hold live WebSocket/SSE connections that cannot be serialized to Redis; determine whether sticky sessions suffice or if a shared session registry is needed
- [x] Design a strategy for `externalClients` Map — these are persistent MCP client connections to external servers that cannot be serialized; evaluate sticky sessions vs client pool per instance
- [x] Design a strategy for `externalToolSchemas` and `registeredToolNames` — these are pure data caches derivable from the DB; determine if Redis caching adds value or if per-instance cache with TTL is sufficient
- [x] Design a strategy for `studio-mcp` sessions — evaluate sticky sessions via Mcp-Session-Id header routing
- [x] Document cleanup/TTL requirements for each externalized entry (session timeout, eviction on run completion, max entries)

### Produce architecture decision document

- [x] Write an ADR (Architecture Decision Record) covering: decision, context, alternatives considered (Redis pub/sub, sticky sessions, stateful instances), chosen approach per Map, and migration path
- [x] Define the interface contracts for any new abstractions (e.g., `SessionStore`, `ToolSchemaCache`) that implementers will build
- [x] Specify configuration requirements (env vars for Redis URLs, TTLs, sticky session headers)
- [x] Document the horizontal scaling topology: which load balancer routing rules are needed, what happens when an instance dies mid-session
- [x] Identify risks and rollback strategy — how to fall back to single-instance if externalization causes issues

## Notes

- The `servers` Map in `mcp-gateway.service.ts` holds live `McpServer` instances with registered tools and Zod schemas. These are stateful objects bound to a specific workflow run — they cannot be trivially serialized to Redis.
- The `externalClients` Map holds persistent `Client` connections to external MCP servers (stdio-proxy). The comment says "stdio-proxy is stateful and rejects re-initialization, so we must reuse a single client per endpoint."
- The `transports` and `sessions` Maps hold `StreamableHTTPServerTransport` objects managing SSE connections — inherently pinned to the HTTP connection on a specific server instance.
- The `cleanupRun()` method in `mcp-gateway.service.ts` handles lifecycle cleanup for servers and external clients.
- The existing `SCALING LIMITATION` comments in the code already mention sticky sessions and Redis pub/sub as options — the architect should evaluate these.
- This is a design-only task. The architect produces the design document; a separate implementer will execute it in a later phase.

## Completion Summary

<!-- Appended by orchestrator after agent completes. Do not fill manually. -->
