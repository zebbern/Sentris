# Agent: implementer (Redis Session Registry)

## Purpose

Create a Redis-backed session registry that tracks active MCP sessions for observability and admin tooling. This does NOT replace the in-memory transport Maps — it complements sticky sessions with a centralized view of all sessions across instances.

## Skills

Load before starting: none

## Subtasks

### Session Registry Service (`backend/src/mcp/session-registry.service.ts`)

- [x] Create `SessionRegistryService` as an `@Injectable()` NestJS service. Inject Redis using a custom token `SESSION_REGISTRY_REDIS` (following the existing pattern in `mcp.module.ts` with `TOOL_REGISTRY_REDIS` and `MCP_DISCOVERY_REDIS`)
- [x] Implement `register(sessionId: string, data: { instanceId: string; userId: string | null; organizationId: string | null; sessionType: 'mcp-gateway' | 'studio-mcp'; runId?: string })`: store in Redis key `mcp:sessions:{sessionId}` as a JSON string with `createdAt` timestamp appended. Set TTL to 7200 seconds (2 hours)
- [x] Implement `deregister(sessionId: string)`: delete the Redis key `mcp:sessions:{sessionId}`
- [x] Implement `refresh(sessionId: string, ttlSeconds?: number)`: reset the TTL on the existing key (call `redis.expire`). Default TTL is 7200 seconds
- [x] Implement `getSession(sessionId: string)`: return the parsed session data or `null` if expired/missing
- [x] Implement `listActiveSessions()`: use `redis.keys('mcp:sessions:*')` with `redis.mget()` to return all active sessions. Add a warning log if count exceeds 1000 (pagination TODO for future)
- [x] Implement `OnModuleDestroy` to handle graceful cleanup (optional: deregister sessions owned by this instance)

### Instance ID

- [x] Determine the instance ID to register with each session. Use `process.env.HOSTNAME` (set by Docker/PM2) or fall back to `os.hostname()`. Store it as a readonly property on the service

### Module registration (`backend/src/mcp/mcp.module.ts`)

- [x] Add the `SESSION_REGISTRY_REDIS` token (define in `mcp.tokens.ts` alongside `MCP_DISCOVERY_REDIS`)
- [x] Add a Redis provider factory for `SESSION_REGISTRY_REDIS` in `mcp.module.ts` (same pattern as `TOOL_REGISTRY_REDIS` — read URL from `ConfigService` using the existing `redis` config)
- [x] Register `SessionRegistryService` in the module's `providers` array and add it to `exports`

### Integration with controllers

- [x] In `McpGatewayController`, inject `SessionRegistryService`. Call `register()` after a transport is initialized (where the `mcp_affinity` cookie is set). Call `deregister()` in the SSE `res.on('close')` cleanup callback. Use `cacheKey` as the session ID
- [x] In `StudioMcpController`, inject `SessionRegistryService`. Call `register()` after a session is created. Call `deregister()` in the SSE `res.on('close')` callback and the DELETE handler. Use `transport.sessionId` as the session ID
- [x] Wrap registry calls in try/catch — registry failures must not break MCP functionality. Log errors at `warn` level

### Admin endpoint

- [x] Add a `GET /api/v1/mcp/sessions` endpoint in `McpGatewayController` (or a new dedicated controller). Protect it with `@UseGuards(RolesGuard)` and `@Roles('ADMIN')` — following the existing pattern in `templates.controller.ts` and `mcp-groups.controller.ts`
- [x] The endpoint returns `{ sessions: Array<{ sessionId, instanceId, userId, organizationId, sessionType, runId, createdAt }>, count: number }`

## Notes

- Redis is already in the stack and used extensively in the `mcp` module (tool registry, auth, discovery). The connection pattern with `ConfigService` and `ioredis` is well-established.
- The `SESSION_REGISTRY_REDIS` token should reuse the same Redis URL as `TOOL_REGISTRY_REDIS` (the `redis.toolRegistryUrl` config path). These are lightweight key operations — no need for a separate Redis instance.
- The registry key pattern `mcp:sessions:{sessionId}` follows the existing convention of `mcp:run:{runId}:tools` in `tool-registry.service.ts`.
- The `listActiveSessions()` method uses `KEYS` which is O(N) — acceptable for admin-only usage with <1000 sessions. For production scale, a `SCAN`-based approach would be better (note as a future improvement).
- Registry failures (Redis down) are non-fatal. The `try/catch` in controllers ensures MCP session creation/teardown works even without the registry, maintaining the same reliability as the current single-instance design.

## Completion Summary

<!-- Appended by orchestrator after agent completes. Do not fill manually. -->
