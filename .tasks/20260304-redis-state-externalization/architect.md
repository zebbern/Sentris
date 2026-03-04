# Agent: architect

## Purpose
Design Redis key patterns, TTL policies, namespace conventions, serialization schemas, and graceful degradation strategy for all externalized state.

## Skills
Load before starting: none

## Subtasks

- [x] Define the Redis key namespace convention document: `sentris:{domain}:{identifier}` — list every key pattern for all five services (flowContexts, archivingRuns, provisioningOrgs, etagCache, providerOverrides invalidation)
- [x] Specify TTL policy for each externalized key: flowContexts (10 min matching existing `FLOW_CONTEXT_TTL_MS`), archivingRuns (15 min safety bound), provisioningOrgs (5 min lock TTL), etagCache (35 min exceeding 30-min sync), instance heartbeat (30s with 10s refresh)
- [x] Define JSON serialization schema for `FlowContext` — document how `targetsBySource` Map is serialized (Map → Object.entries → JSON) and deserialized back
- [x] Define the distributed lock strategy for `provisioningOrgs` — specify whether to use simple SETNX+TTL or Redlock, document the lock/unlock flow, and handle the Promise-based dedup pattern
- [x] Specify graceful degradation rules: when `redis` is null or a Redis call throws, fall back to in-memory Map/Set; log warning but never throw; document which operations are best-effort vs critical
- [x] Define Redis connection sharing strategy — determine whether all new services share one injection token or get per-module tokens; document the provider factory pattern (following `mcp.module.ts` style)
- [x] Define cache invalidation strategy for `providerOverrides` — specify whether to use Redis pub/sub channel, key-change notification, or polling; document the message format
- [x] Specify instance heartbeat key pattern (`sentris:instances:{instanceId}`) and the data stored (hostname, PID, startedAt, lastHeartbeat); define how other instances detect a dead peer
- [x] Document the migration path: services start with dual-write (in-memory + Redis) so rollback is removing the Redis injection; no data migration needed since all state is ephemeral cache
- [x] Write the architecture decision document to `docs/architecture/adr-redis-state-externalization.md` covering all decisions above

## Notes
- Reference `SessionRegistryService` at `backend/src/mcp/session-registry.service.ts` as the canonical pattern
- Reference `ToolRegistryService` at `backend/src/mcp/tool-registry.service.ts` for Hash-based storage pattern
- Current Redis config is at `backend/src/config/redis.config.ts` — has `url`, `terminalUrl`, `toolRegistryUrl`
- Existing key patterns: `mcp:sessions:{sessionId}`, `mcp:run:{runId}:tools`, `mcp-discovery:{cacheToken}`
- The `FlowContext.targetsBySource` field is a `Map<string, Array<{targetRef, sourceHandle, inputKey}>>` — needs explicit serialization strategy
- `provisioningOrgs` stores `Map<string, Promise<boolean>>` — the Promise cannot be serialized; the Redis version should store a simple lock flag, while the local Promise tracking remains for in-flight dedup within the same instance

## Completion Summary
<!-- Appended by orchestrator after agent completes. Do not fill manually. -->
