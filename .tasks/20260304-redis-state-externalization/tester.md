# Agent: tester

## Purpose
Write unit tests for all new Redis-backed services and a multi-instance integration test verifying cross-instance state sharing.

## Skills
Load before starting: testing-patterns

## Subtasks

### FlowContextCacheService Tests
- [x] Create `backend/src/workflows/__tests__/flow-context-cache.service.spec.ts`
- [x] Test `set()` + `get()` round-trip: store a FlowContext, retrieve it, verify all fields including deserialized `targetsBySource` Map
- [x] Test `get()` returns null for missing key
- [x] Test `delete()` removes the key: set, delete, verify get returns null
- [x] Test null Redis: when injected Redis is null, all methods are no-ops (get returns null, set/delete don't throw)
- [x] Test Redis error handling: mock Redis to throw, verify warn-level log and graceful fallback (no exception propagated)
- [x] Test TTL is set correctly: verify `SET` is called with `EX` and the expected TTL value

### ArchivingLockService Tests
- [x] Create `backend/src/workflows/__tests__/archiving-lock.service.spec.ts`
- [x] Test `tryAcquire()` returns true on first call (SETNX succeeds)
- [x] Test `tryAcquire()` returns false on second call with same runId (SETNX fails — already locked)
- [x] Test `release()` deletes the key: acquire, release, verify acquire succeeds again
- [x] Test null Redis fallback: uses local Set behavior (acquire/release within same instance)
- [x] Test Redis error handling: mock Redis to throw, verify graceful fallback

### ProvisioningLockService Tests
- [x] Create `backend/src/common/redis/__tests__/provisioning-lock.service.spec.ts`
- [x] Test `tryAcquire()` returns true when no lock exists
- [x] Test `tryAcquire()` returns false when another instance holds the lock
- [x] Test `release()` only deletes if the lock value matches this instance's ID (compare-and-delete)
- [x] Test `isProvisioned()` returns true when completion marker exists
- [x] Test `markProvisioned()` sets the completion marker with correct TTL
- [x] Test null Redis fallback: `tryAcquire()` returns true, `isProvisioned()` returns false
- [x] Test Redis error handling: mock Redis to throw, verify graceful fallback

### InstanceHeartbeatService Tests
- [x] Create `backend/src/common/redis/__tests__/instance-heartbeat.service.spec.ts`
- [x] Test `register()` sets the correct key with expected JSON payload and TTL
- [x] Test `listAliveInstances()` returns registered instances
- [x] Test `isInstanceAlive()` returns true for registered instance, false for unknown
- [x] Test `onModuleDestroy()` clears interval and deletes instance key
- [x] Test null Redis: all methods return graceful defaults

### EtagCacheService Tests
- [x] Create `backend/src/templates/__tests__/etag-cache.service.spec.ts`
- [x] Test `set()` + `get()` round-trip with URL hashing
- [x] Test `get()` returns null for missing URL
- [x] Test TTL is set to 35 minutes
- [x] Test null Redis fallback
- [x] Test Redis error handling

### Provider Overrides Invalidation Tests
- [x] Test version counter is incremented when provider config is saved (upsert/delete)
- [x] Test `checkVersionAndReload()` reloads from DB when remote version exceeds local version
- [x] Test no reload when version has not changed
- [x] Test null Redis: no polling, service works as before

### Integration / Scenario Test
- [x] Test cross-instance FlowContext sharing: embedded in flow-context-cache tests (would need real Redis for true E2E)
- [x] Test archiving lock: Instance A acquires lock, Instance B's `tryAcquire()` returns false (cross-instance locking section in archiving-lock tests)
- [x] Test provisioning lock: Instance A provisions org, Instance B sees `isProvisioned() = true` (cross-instance provisioning section in provisioning-lock tests)

## Notes
- Follow existing test patterns: see `backend/src/mcp/__tests__/mcp-internal.integration.spec.ts` for mock Redis injection pattern
- Use `jest.fn()` or `vi.fn()` to mock ioredis methods: `get`, `set`, `del`, `setnx`, `expire`, `keys`, `mget`, `publish`, `subscribe`
- For pub/sub tests, mock both publisher and subscriber Redis instances
- The multi-instance integration test may use two actual Redis-connected service instances with a real Redis (if available in CI) or mock both with separate in-memory state
- All tests must verify the non-fatal error handling pattern: Redis errors are caught and logged, never propagated

## Completion Summary
<!-- Appended by orchestrator after agent completes. Do not fill manually. -->
