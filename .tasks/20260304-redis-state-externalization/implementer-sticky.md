# Agent: implementer-sticky

## Purpose
Implement instance heartbeat registration and dead-instance detection so the platform can identify which backend instances are alive and detect when sticky-session targets disappear.

## Skills
Load before starting: none

## Subtasks

### Instance Heartbeat Service
- [x] Create `backend/src/common/redis/instance-heartbeat.service.ts` as an `@Injectable()` NestJS service implementing `OnModuleInit` and `OnModuleDestroy`
- [x] Define instance ID: use `process.env.HOSTNAME || os.hostname()` (matching `SessionRegistryService` pattern)
- [x] Implement `register()` — SET `sentris:instances:{instanceId}` with JSON payload `{ instanceId, hostname, pid, startedAt, lastHeartbeat }` and TTL (30s)
- [x] Implement a heartbeat interval in `onModuleInit()` — call `register()` every 10s to refresh the TTL
- [x] Implement `onModuleDestroy()` — clear interval, DEL the instance key (graceful shutdown), call `redis?.quit()`
- [x] Implement `listAliveInstances(): Promise<InstanceInfo[]>` — SCAN for `sentris:instances:*` keys, MGET, parse JSON (admin/observability endpoint)
- [x] Implement `isInstanceAlive(instanceId: string): Promise<boolean>` — check if the key exists (for session registry cross-ref)
- [x] When Redis is unavailable (null), all methods return graceful defaults (empty list, true for isAlive)

### Stale Session Detection
- [x] Add method `detectStaleSessions()` to `SessionRegistryService` (or a new helper) — cross-reference `mcp:sessions:*` entries with `sentris:instances:{instanceId}` keys; sessions owned by dead instances are stale
- [x] Implement optional cleanup: delete stale session registry entries (the actual transport is already dead; this is registry cleanup only)
- [x] Guard with a config flag or admin-only trigger — do not auto-cleanup on every heartbeat tick

### Module Wiring
- [x] Register `InstanceHeartbeatService` globally (it should run in every backend instance)
- [x] Wire Redis injection — reuse the same provider token established by the architect
- [x] Ensure the heartbeat service starts on boot (`OnModuleInit`) and stops cleanly (`OnModuleDestroy`)

### Admin Observability (Optional)
- [x] Add `GET /api/v1/admin/instances` endpoint returning `listAliveInstances()` result
- [x] Include instance count, per-instance metadata (PID, uptime, last heartbeat), and session count per instance

## Notes
- The heartbeat TTL (30s) should be > 2× the refresh interval (10s) to tolerate one missed heartbeat without marking the instance as dead
- SCAN is preferred over KEYS for listing instances (following the same caution as `SessionRegistryService.listActiveSessions()`)
- This feature is primarily observability — no routing decisions should depend on heartbeat initially
- The `SessionRegistryService` already stores `instanceId` in session data, making cross-referencing straightforward
- Instance ID matches `SessionRegistryService.instanceId` — both use `process.env.HOSTNAME || os.hostname()`
- Heartbeat data should include the process start time (`process.uptime()`) for uptime calculation

## Completion Summary
<!-- Appended by orchestrator after agent completes. Do not fill manually. -->
