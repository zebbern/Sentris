# Agent: code-reviewer

## Purpose
Review all implementation code for correctness, consistency, error handling, and adherence to established patterns.

## Skills
Load before starting: none

## Subtasks

### Pattern Compliance
- [x] Verify all new services follow the `SessionRegistryService` pattern: `@Inject(TOKEN) private readonly redis: Redis | null`, null-safe check at method top, JSON serialize, SET with EX TTL, try/catch with warn-level logging
- [x] Verify all services implement `OnModuleDestroy` with `redis?.quit()` cleanup
- [x] Verify Redis key patterns follow the namespace convention defined by the architect
- [x] Verify all new services are properly registered in their NestJS modules with correct provider factories

### Error Handling
- [x] Verify every Redis call is wrapped in try/catch with non-fatal error handling (warn log, no exception propagated)
- [x] Verify error messages are actionable and include context (service name, operation, key)
- [x] Verify null Redis checks are at the top of every public method (early return pattern)
- [x] Verify the `finally` block in `TerminalArchiveService.archiveRun()` correctly releases the Redis lock

### Serialization Safety
- [x] Verify `FlowContext.targetsBySource` Map serialization is correct: `Object.fromEntries()` for serialization, `new Map(Object.entries())` for deserialization
- [x] Verify `WorkflowDefinition` is JSON-safe (no circular references, no functions, no Symbols)
- [x] Verify ETag cache URL hashing is consistent (same URL always produces same hash)
- [x] Verify no sensitive data is stored in Redis keys or values without encryption

### Concurrency & Race Conditions
- [x] Verify `provisioningOrgs` lock uses compare-and-delete (don't release another instance's lock)
- [x] Verify `archivingRuns` SETNX+TTL pattern handles the case where a lock TTL expires mid-archival
- [x] Verify pub/sub invalidation handles message ordering edge cases (stale message after fresh reload)
- [x] Verify heartbeat interval cleanup in `onModuleDestroy` prevents orphaned intervals

### Integration Correctness
- [x] Verify `WorkflowsService` write-through pattern: writes to both Redis and in-memory Map, reads try Redis first then in-memory
- [x] Verify `GitHubSyncService` L1/L2 cache pattern: local Map is hot cache, Redis is shared cache, write-through on cache miss
- [x] Verify `AppController` preserves the existing fire-and-forget provisioning behavior (no `await` blocking auth response)
- [x] Verify no existing tests are broken by the changes

### Code Quality
- [x] Check for unused imports in all modified files
- [x] Verify TypeScript types are correct (no `any` where a specific type is available)
- [x] Check for consistent naming conventions across all new files
- [x] Verify JSDoc comments on all public methods of new services

## Notes
- This is a read-only review. Do not modify source code files.
- Reference files for pattern comparison: `backend/src/mcp/session-registry.service.ts`, `backend/src/mcp/tool-registry.service.ts`
- Pay special attention to the `provisioningOrgs` migration — the original uses `Promise<boolean>` in a Map, which is a complex concurrency pattern
- The file list to review will be determined by the output of implementer agents

## Completion Summary
<!-- Appended by orchestrator after agent completes. Do not fill manually. -->
