# Plan: Redis State Externalization

## Overview

Externalize five in-memory Maps/Sets from backend services into Redis so that multiple backend instances can share state. The work follows the established `SessionRegistryService` pattern: inject ioredis via a Symbol token, null-safe Redis checks, JSON serialization, SET with EX TTL, and non-fatal error handling. Services that cannot be externalized (MCP transports, protocol objects) rely on sticky sessions already implemented.

## Architecture Decisions

| Decision | Alternatives | Rationale |
|----------|-------------|----------|
| Per-service Redis injection token (reuse `REDIS_CLIENT` from config) | Single shared Redis service, per-module Redis instances | Matches existing `SESSION_REGISTRY_REDIS` / `TOOL_REGISTRY_REDIS` pattern; each service declares its own dependency |
| `sentris:{domain}:{key}` namespace convention | Flat keys, hash-per-service | Prevents key collisions across services; scannable by domain; consistent with `mcp:sessions:*` pattern |
| Graceful fallback to in-memory on Redis unavailable | Hard fail, circuit breaker | Follows existing SessionRegistryService pattern; single-instance deployments should work without Redis |
| Redlock for distributed locking (provisioningOrgs) | Simple SETNX, advisory locks in Postgres | provisioningOrgs is a dedup/lock pattern; Redlock handles multi-instance with TTL auto-expiry |
| ETag cache shared via Redis (all instances sync independently) | Per-instance cache only, shared DB table | Reduces GitHub API calls across instances; natural TTL alignment with 30-min sync interval |
| Instance heartbeat via Redis key with TTL | Health-check polling, gossip protocol | Simple, uses existing Redis; TTL auto-expires dead instances; no additional dependencies |

## Affected Files

| Action | File Path | Change Description |
|--------|-----------|-------------------|
| CREATE | `backend/src/common/redis/redis.tokens.ts` | Shared Redis injection token symbol(s) |
| CREATE | `backend/src/workflows/flow-context-cache.service.ts` | Redis-backed flow context cache replacing in-memory Map |
| CREATE | `backend/src/workflows/archiving-lock.service.ts` | Redis-backed Set replacement for archivingRuns dedup |
| CREATE | `backend/src/common/redis/provisioning-lock.service.ts` | Distributed lock for org provisioning |
| CREATE | `backend/src/templates/etag-cache.service.ts` | Redis-backed ETag cache for GitHub sync |
| CREATE | `backend/src/common/redis/instance-heartbeat.service.ts` | Instance heartbeat registration + dead instance detection |
| MODIFY | `backend/src/workflows/workflows.service.ts` | Inject FlowContextCacheService, delegate flowContexts to Redis |
| MODIFY | `backend/src/workflows/workflows.module.ts` | Register new Redis-backed services |
| MODIFY | `backend/src/workflows/terminal-archive.service.ts` | Inject ArchivingLockService, delegate archivingRuns to Redis |
| MODIFY | `backend/src/app.controller.ts` | Inject ProvisioningLockService, delegate provisioningOrgs to Redis |
| MODIFY | `backend/src/app.module.ts` | Register Redis provider tokens, ProvisioningLockService |
| MODIFY | `backend/src/templates/github-sync.service.ts` | Inject EtagCacheService, delegate etagCache to Redis |
| MODIFY | `backend/src/templates/templates.module.ts` | Register EtagCacheService + Redis provider |
| MODIFY | `backend/src/integrations/integrations.service.ts` | Add cache invalidation broadcast via Redis pub/sub |
| MODIFY | `backend/src/integrations/integrations.module.ts` | Register Redis provider for invalidation |
| MODIFY | `backend/src/config/redis.config.ts` | Add `stateUrl` config for state externalization Redis |
| CREATE | `backend/src/workflows/__tests__/flow-context-cache.service.spec.ts` | Unit tests |
| CREATE | `backend/src/workflows/__tests__/archiving-lock.service.spec.ts` | Unit tests |
| CREATE | `backend/src/common/redis/__tests__/provisioning-lock.service.spec.ts` | Unit tests |
| CREATE | `backend/src/templates/__tests__/etag-cache.service.spec.ts` | Unit tests |
| CREATE | `backend/src/common/redis/__tests__/instance-heartbeat.service.spec.ts` | Unit tests |

## Phases

| Phase | Agents | Purpose | Depends On |
|-------|--------|---------|------------|
| 1 | architect | Design Redis key patterns, TTL policies, namespace conventions, error handling strategy, data schema | — |
| 2a | implementer-core | Externalize flowContexts + archivingRuns (highest impact) | Phase 1 |
| 2b | implementer-locks | Externalize provisioningOrgs with distributed locking | Phase 1 |
| 3 | implementer-sticky | Instance heartbeat, failover detection, stale session cleanup | Phase 1 |
| 4 | implementer-caches | Externalize etagCache + providerOverrides invalidation | Phase 1 |
| 5 | tester | Unit tests for all Redis-backed services + multi-instance scenario test | Phases 2–4 |
| 6a | code-reviewer | Code quality review | Phase 5 |
| 6b | arch-reviewer | Architecture review | Phase 5 |

## Dependencies

- Phase 1 (architect) must complete before any implementation begins — establishes key patterns and conventions.
- Phases 2a and 2b can execute in parallel after Phase 1.
- Phase 3 can execute after Phase 1 (independent of 2a/2b).
- Phase 4 can execute after Phase 1 (independent of 2a/2b/3).
- Phase 5 (tester) needs all implementation phases complete.
- Phase 6 (reviews) need implementation and tests complete.

## Risk Assessment

| Risk | Mitigation |
|------|-----------|
| Redis outage breaks core workflows | All services fall back to in-memory Maps when `redis` is null; non-fatal error handling in every Redis call |
| Serialization of FlowContext `targetsBySource` (Map of arrays) | Convert Map to/from plain object via `Object.entries()` / `new Map(Object.entries())` |
| Race condition in archivingRuns across instances | Use Redis SETNX with TTL — only the instance that wins the SETNX proceeds with archiving |
| provisioningOrgs Promise-based dedup doesn't translate to Redis | Replace with Redis SETNX lock; local Promise tracking remains for in-flight requests on same instance |
| ETag cache size grows unbounded in Redis | Apply TTL (35 min, slightly exceeding sync interval) to each ETag key; keys auto-expire |
| Instance heartbeat introduces new failure mode | Heartbeat is observability-only; no routing decisions depend on it initially |
