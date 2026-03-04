# Agent: implementer-core

## Purpose
Externalize `flowContexts` (WorkflowsService) and `archivingRuns` (TerminalArchiveService) from in-memory Maps/Sets to Redis-backed services.

## Skills
Load before starting: none

## Subtasks

### Flow Context Cache Service
- [x] Create `backend/src/workflows/flow-context-cache.service.ts` following the `SessionRegistryService` pattern: inject Redis via token, null-safe check, JSON serialize, SET with EX TTL
- [x] Implement `get(runId: string): Promise<FlowContext | null>` — deserialize JSON, reconstruct `targetsBySource` Map from plain object
- [x] Implement `set(runId: string, context: FlowContext): Promise<void>` — serialize FlowContext to JSON, convert `targetsBySource` Map to plain object, SET with EX (10 min TTL)
- [x] Implement `delete(runId: string): Promise<void>` — DEL the key
- [x] Implement `onModuleDestroy()` — call `redis?.quit()`
- [x] Use Redis key pattern: `sentris:flow-context:{runId}` (or as specified by architect)

### Integrate FlowContextCacheService into WorkflowsService
- [x] Add `FlowContextCacheService` as a constructor dependency in `WorkflowsService`
- [x] Modify `getFlowContext()` (line ~724): check Redis first via `FlowContextCacheService.get()`, fall back to in-memory Map, then fall back to DB lookup; write-through to both Redis and in-memory Map
- [x] Modify `releaseFlowContext()` (line ~719): delete from both Redis and in-memory Map
- [x] Keep the existing in-memory cleanup interval as a secondary eviction mechanism
- [x] Ensure all error paths are non-fatal — if Redis fails, the in-memory path still works

### Archiving Lock Service
- [x] Create `backend/src/workflows/archiving-lock.service.ts` — Redis SETNX-based dedup guard
- [x] Implement `tryAcquire(runId: string): Promise<boolean>` — SETNX with TTL (15 min); returns true if lock acquired, false if already held
- [x] Implement `release(runId: string): Promise<void>` — DEL the key
- [x] Implement `onModuleDestroy()` — call `redis?.quit()`
- [x] Use Redis key pattern: `sentris:archiving:{runId}`
- [x] When Redis is unavailable (null), fall back to local `Set<string>` behavior

### Integrate ArchivingLockService into TerminalArchiveService
- [x] Add `ArchivingLockService` as a constructor dependency in `TerminalArchiveService`
- [x] Modify `archiveRun()` (line ~30): replace `this.archivingRuns.has(runId)` / `.add()` / `.delete()` with `ArchivingLockService.tryAcquire()` / `.release()`
- [x] Keep the local `archivingRuns` Set as a fallback when Redis is unavailable
- [x] Ensure the `finally` block always calls `release()` to clean up the Redis key

### Module Wiring
- [x] Add a Redis provider token for state externalization in `backend/src/workflows/workflows.module.ts` (or reuse existing token per architect design)
- [x] Register `FlowContextCacheService` and `ArchivingLockService` in the workflows module
- [x] Ensure the Redis provider factory follows the pattern in `mcp.module.ts`: read URL from config, return null if not set, log warning

## Notes
- `FlowContext` interface is defined at line ~79 in `workflows.service.ts`: `{ workflowId, workflowVersionId, workflowVersion, definition (WorkflowDefinition), targetsBySource (Map) }`
- `targetsBySource` is a Map that must be serialized as `Object.fromEntries()` and deserialized with `new Map(Object.entries())` 
- `WorkflowDefinition` is imported from `../dsl/types` — verify it is JSON-serializable (it comes from DB so it should be)
- The in-memory cleanup interval (`flowContextCleanupInterval`) should remain as a secondary eviction in case Redis TTL handling changes
- `archivingRuns` is a simple `Set<string>` — the Redis equivalent is SETNX with TTL
- The `archiveRun()` method at `terminal-archive.service.ts:30` uses the Set in a try/finally pattern — Redis release must also be in finally

## Completion Summary
<!-- Appended by orchestrator after agent completes. Do not fill manually. -->
