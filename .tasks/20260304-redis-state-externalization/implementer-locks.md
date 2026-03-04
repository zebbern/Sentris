# Agent: implementer-locks

## Purpose
Externalize `provisioningOrgs` (AppController) from an in-memory Map to a Redis-backed distributed lock, enabling cross-instance deduplication of OpenSearch tenant provisioning.

## Skills
Load before starting: none

## Subtasks

### Provisioning Lock Service
- [x] Create `backend/src/common/redis/provisioning-lock.service.ts` following the `SessionRegistryService` pattern
- [x] Implement `tryAcquire(orgId: string): Promise<boolean>` — use Redis `SET key value NX EX ttl`; returns true if lock acquired (this instance should proceed), false if already locked (another instance is provisioning)
- [x] Implement `release(orgId: string): Promise<void>` — DEL the lock key; only release if the lock value matches this instance's ID (compare-and-delete for safety)
- [x] Implement `isProvisioned(orgId: string): Promise<boolean>` — check if a "completed" marker key exists (separate from lock key) indicating provisioning already succeeded
- [x] Implement `markProvisioned(orgId: string): Promise<void>` — SET a "completed" marker with long TTL (e.g., 24h) so other instances skip provisioning entirely
- [x] Use Redis key patterns: `sentris:provisioning:lock:{orgId}` (short-lived lock), `sentris:provisioning:done:{orgId}` (long-lived completion marker)
- [x] When Redis is unavailable (null), fall back to returning true from `tryAcquire()` so local provisioning works as before
- [x] Implement `onModuleDestroy()` — call `redis?.quit()`

### Integrate into AppController
- [x] Add `ProvisioningLockService` as a constructor dependency in `AppController`
- [x] Modify `validateAuth()` provisioning logic (line ~63): replace `this.provisioningOrgs.has(normalizedOrgId)` check with `ProvisioningLockService.isProvisioned()` first, then `tryAcquire()` if not provisioned
- [x] Keep the local `provisioningOrgs` Map as an in-memory fast path — check local Map first, then Redis, to avoid Redis round-trip on every auth request
- [x] On successful provisioning, call `markProvisioned()` and add to local Map
- [x] On failed provisioning, call `release()` and remove from local Map (matching existing error-handling behavior)
- [x] Ensure the fire-and-forget pattern is preserved — provisioning errors must never block auth validation

### Module Wiring
- [x] Create or update `backend/src/common/redis/redis.tokens.ts` with a shared `STATE_REDIS` token (or per-service token per architect design)
- [x] Register the Redis provider factory in `AppModule` (or a shared `RedisStateModule`) — follows `mcp.module.ts` pattern
- [x] Register `ProvisioningLockService` in the appropriate module
- [x] Update `backend/src/config/redis.config.ts` if a new env var is needed (e.g., `STATE_REDIS_URL`) or reuse existing `REDIS_URL`

## Notes
- The current `provisioningOrgs` Map stores `Map<string, Promise<boolean>>` — the Promise is used for dedup within a single instance (concurrent requests share the same in-flight Promise). This local Promise tracking should remain; Redis only handles cross-instance dedup.
- The provisioning call is to `this.tenantService.ensureTenantExists(normalizedOrgId)` — this is an OpenSearch API call that should only happen once per org across all instances.
- The `SkipThrottle()` decorator means this endpoint can receive very high traffic — Redis calls must be fast and non-blocking.
- The compare-and-delete pattern in `release()` prevents Instance A from releasing Instance B's lock. Use `SET lock {instanceId} NX EX ttl` and check value before DEL.
- `AppController` currently doesn't inject any Redis — this is a new dependency path.

## Completion Summary
<!-- Appended by orchestrator after agent completes. Do not fill manually. -->
