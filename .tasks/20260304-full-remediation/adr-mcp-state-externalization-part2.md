# ADR Part 2: Options, Recommendation & Implementation

Continuation of `adr-mcp-state-externalization.md`.

---

## Options Considered

### Option A: Sticky Sessions (Load Balancer Affinity)

Configure nginx/ALB to route all requests for a given session to the same backend instance. No code changes to Maps — they remain in-memory, each instance serves its own sessions.

**Affinity keys**: Gateway uses `runId` (from JWT, exposed via cookie). Studio MCP uses `Mcp-Session-Id` header.

```nginx
upstream backend_mcp {
    hash $mcp_affinity_key consistent;
    server backend-1:3211;
    server backend-2:3211;
}
map $http_mcp_session_id $mcp_affinity_key {
    default $http_mcp_session_id;
    ""      $cookie_mcp_affinity;
}
```

**Pros**: Zero app code changes for Maps. Simplest. No serialization. Aligns with MCP protocol design.
**Cons**: Instance failure loses sessions (runs retry via Temporal). Uneven load possible. No session migration during deployments.
**Complexity**: Low (~2–4 hours)

### Option B: Redis-Backed Metadata + Sticky Sessions (Hybrid)

Keep connection-bound state in-memory with sticky sessions. Externalize derivable data to Redis.

**To Redis**: `externalToolSchemas` (hash, TTL 1h), `registeredToolNames` (set, TTL 1h), session registry (metadata).
**Stay in-memory**: `servers`, `transports`, `externalClients`, `pendingInits`, `sessions`.

**Pros**: Schemas survive restarts. Session registry enables health monitoring. Fixes `externalToolSchemas` leak.
**Cons**: More complexity. Still needs sticky sessions. Marginal benefit — externalized data is already derivable from DB.
**Complexity**: Medium (~8–16 hours)

### Option C: Full State Externalization

Externalize all Maps to Redis. Reconstruct McpServer on each request.

**Pros**: True horizontal scaling. No sticky sessions.
**Cons**: **Fundamentally incompatible with MCP Streamable HTTP** — SSE streams require persistent connections. Cannot reconstruct SSE on a different instance. stdio-proxy rejects re-init. Would require rewriting MCP SDK transport layer. Massive performance cost.
**Complexity**: Very High (weeks+, possibly impossible)

### Option D: Redis Pub/Sub Cache Invalidation

Keep all state in-memory. Use pub/sub to broadcast invalidation across instances.

**Pros**: Simple mental model.
**Cons**: Only solves cache coherence, not session binding. Tool registry already uses shared Redis. Still needs sticky sessions.
**Complexity**: Medium (~8 hours)

---

## Recommended Architecture: Option A + Selective Option B Enhancements

### Decision

**Sticky sessions as primary scaling mechanism**, with two targeted Redis additions for operational visibility and cleanup.

### Justification

MCP Streamable HTTP is inherently connection-bound. SSE streams, client connections, and server state cannot be serialized or moved between processes. This is a fundamental protocol property, not a code limitation. Sticky sessions align with how MCP actually works: a session starts on an instance and stays there. The session key is already in every request.

---

## Interface Contracts

### `McpSessionRegistry` (new service)

```typescript
interface McpSessionRegistry {
  /** Register a session as owned by this instance. */
  register(sessionKey: string, metadata: SessionMetadata): Promise<void>;

  /** Remove a session from the registry. */
  deregister(sessionKey: string): Promise<void>;

  /** Check which instance owns a session. */
  lookup(sessionKey: string): Promise<SessionMetadata | null>;

  /** List all sessions owned by a specific instance. */
  listByInstance(instanceId: string): Promise<SessionEntry[]>;

  /** Remove all sessions for a dead instance. */
  purgeInstance(instanceId: string): Promise<number>;
}

interface SessionMetadata {
  instanceId: string; // hostname or UUID
  runId: string;
  sessionType: 'gateway' | 'studio';
  organizationId: string | null;
  createdAt: string; // ISO timestamp
}

interface SessionEntry extends SessionMetadata {
  sessionKey: string;
}
```

### Redis Key Design

```
mcp:session:{sessionKey}          → JSON SessionMetadata     (TTL: 2h)
mcp:instance:{instanceId}        → SET of sessionKeys       (TTL: 2h, refreshed)
mcp:instance:{instanceId}:heartbeat → ISO timestamp          (TTL: 120s, refreshed every 60s)
```

### Affinity Cookie Contract

```
Name:     mcp_affinity
Value:    Base64(SHA256(cacheKey))
Path:     /api/v1/mcp/
HttpOnly: true
SameSite: Strict
Secure:   true (production)
MaxAge:   7200
```

Set by `McpGatewayController` on first successful response. Nginx uses it for consistent hashing.

### Instance Identity

```typescript
const INSTANCE_ID = process.env.HOSTNAME ?? `${os.hostname()}:${process.pid}`;
```

### Health Check Addition

```typescript
// GET /api/v1/health/mcp-sessions
interface McpSessionHealthResponse {
  instanceId: string;
  activeSessions: number;
  sessions: Array<{
    sessionKey: string;
    sessionType: 'gateway' | 'studio';
    runId: string;
    ageSeconds: number;
  }>;
}
```

---

## Configuration Requirements

```bash
# Existing (no changes)
REDIS_URL=redis://localhost:6379
TERMINAL_REDIS_URL=redis://localhost:6379
TOOL_REGISTRY_REDIS_URL=redis://localhost:6379

# New
MCP_SESSION_REDIS_URL=redis://localhost:6379     # Defaults to REDIS_URL
MCP_INSTANCE_ID=                                  # Auto from HOSTNAME
MCP_SESSION_TTL_SECONDS=7200                      # Default: 2h
MCP_HEARTBEAT_INTERVAL_SECONDS=60                 # Default: 60s
```

### Nginx Changes

```nginx
# New: MCP-specific upstream with consistent hashing
upstream backend_mcp {
    hash $mcp_affinity_key consistent;
    server backend-1:3211;
    server backend-2:3211;
}

map $cookie_mcp_affinity $mcp_affinity_from_cookie {
    default $cookie_mcp_affinity;
    ""      "";
}

map $http_mcp_session_id $mcp_affinity_key {
    default $http_mcp_session_id;
    ""      $mcp_affinity_from_cookie;
}

# MCP gateway + studio routes use sticky upstream
location /api/v1/mcp/ {
    proxy_pass http://backend_mcp/api/v1/mcp/;
    proxy_buffering off;
    proxy_read_timeout 300s;
}
location /api/v1/studio-mcp {
    proxy_pass http://backend_mcp/api/v1/studio-mcp;
    proxy_buffering off;
    proxy_read_timeout 300s;
}

# All other /api/v1/ routes: round-robin (existing)
location /api/v1/ {
    proxy_pass http://backend/api/v1/;
}
```

For **AWS ALB**: Application cookie stickiness on `mcp_affinity`, duration 2 hours.

---

## Migration Path

### Phase 1: Sticky Sessions (Immediate, ~4h)

1. Add `mcp_affinity` cookie in `McpGatewayController` on first response
2. Update `nginx.prod.conf` with `backend_mcp` upstream
3. Test with 2 backend instances locally
4. Deploy, verify sessions stick

### Phase 2: Session Registry (~8h)

1. Create `McpSessionRegistry` service
2. Add `register()` in controller init paths
3. Add `deregister()` in cleanup paths
4. Add heartbeat in `onModuleInit()`
5. Add health check endpoint
6. Add orphan detection scheduled task

### Phase 3: Cleanup Fixes (~4h)

1. Fix `externalToolSchemas` leak — scope to cache key, clean in `cleanupRun()`
2. Add TTL for `sessions` Map in studio-mcp (currently no timeout)
3. Add metrics: active session count, duration histogram

### Phase 4: Graceful Shutdown (~4h)

1. Implement `onModuleDestroy()` to drain active SSE connections
2. Deregister all sessions on shutdown
3. Configure nginx `max_fails=3 fail_timeout=30s`

---

## Risks & Mitigations

| Risk                                  | Severity          | Mitigation                                                                                                       |
| ------------------------------------- | ----------------- | ---------------------------------------------------------------------------------------------------------------- |
| Instance crash loses sessions         | Medium            | Temporal provides durable workflow state. Only SSE stream lost. Agent reconnects with new session.               |
| Uneven load from sticky sessions      | Low               | Consistent hashing distributes well. Sessions are short-lived. Monitor via session registry.                     |
| Rolling deploy breaks sessions        | Medium            | Blue-green deploy. Drain connections (Phase 4). nginx `max_fails` excludes dead instances.                       |
| Cookie doesn't work for all clients   | Low               | Studio MCP uses header (no cookie). Gateway SDK clients handle cookies. Fallback: `X-Mcp-Affinity` header.       |
| Redis registry adds failure mode      | Low               | Registry is advisory. If Redis down, in-memory Maps still work. Registry enables observability, not correctness. |
| `externalToolSchemas` grows unbounded | Medium (existing) | Phase 3 fix: scope to cache key, clean in `cleanupRun()`.                                                        |

---

## What This Does NOT Solve

1. **Active-active replication**: Instance death loses in-flight SSE. Agent reconnects. Acceptable because Temporal holds durable state.
2. **Cross-instance routing**: Requests must reach the owning instance. Sticky sessions ensure this.
3. **Session migration during scale events**: Consistent hashing minimizes disruption but some sessions may break.

---

## Decision Summary

| Map                   | Strategy                 | Rationale                                       |
| --------------------- | ------------------------ | ----------------------------------------------- |
| `servers`             | Sticky sessions          | Live McpServer with closures — cannot serialize |
| `registeredToolNames` | Sticky sessions          | Coupled to `servers`, trivial to reconstruct    |
| `externalToolSchemas` | Sticky + scoped cleanup  | Fix leak; Redis optional for sharing            |
| `externalClients`     | Sticky sessions          | Live TCP connections — cannot serialize         |
| `transports`          | Sticky sessions          | Bound to HTTP stream — per-connection           |
| `pendingInits`        | No change                | Ephemeral millisecond Promises                  |
| `sessions` (studio)   | Sticky + header affinity | `Mcp-Session-Id` is natural key                 |
| Session registry      | Redis (new)              | Cross-instance health, monitoring, shutdown     |
