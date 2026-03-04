# Agent: database-perf

## Purpose

Add a composite index on `workflow_versions(organization_id, workflow_id, version)` and replace the Redis SCAN loop in `TerminalStreamService` with a tracked key set.

## Skills

Load before starting: database-patterns

## Context

### Workflow Versions Schema

- File: `backend/src/database/schema/workflow-versions.ts`
- Table: `workflow_versions`
- Columns: `id` (uuid PK), `workflow_id` (uuid), `version` (int), `graph` (jsonb), `organization_id` (varchar 191), `compiled_definition` (jsonb), `created_at` (timestamptz)
- Existing index: `workflow_versions_workflow_version_uidx` — uniqueIndex on `(workflow_id, version)`
- **Missing**: composite index on `(organization_id, workflow_id, version)` for org-scoped version lookups

### Migrations

- Latest migration: `0029_add-workflow-runs-status-index.sql`
- Migration `0028_add-performance-indexes.sql` added indexes to `workflow_runs`, `webhook_configurations`, `webhook_deliveries`, `workflow_terminal_records`, `workflow_schedules`
- Next migration should be numbered `0030`

### Redis SCAN

- File: `backend/src/terminal/terminal-stream.service.ts`
- `scanKeys()` method (line 136) iterates with `redis.scan(cursor, 'MATCH', pattern, 'COUNT', 50)` in a do-while loop
- Called by: `listStreams()`, `deleteStreams()`, `fetchChunks()` — all use pattern `terminal:{runId}:*`
- Test file: `backend/src/terminal/__tests__/terminal-stream.service.spec.ts`

## Subtasks

### Composite Index

- [x] Add a composite index `workflow_versions_org_workflow_version_idx` on `(organization_id, workflow_id, version)` to the Drizzle schema in `backend/src/database/schema/workflow-versions.ts`
- [x] Create migration `0030_add-workflow-versions-org-index.sql` with `CREATE INDEX CONCURRENTLY IF NOT EXISTS` matching the pattern used in `0028`
- [x] Verify the new index doesn't conflict with the existing `workflow_versions_workflow_version_uidx` unique index

### Redis SCAN Optimization

- [x] Refactor `TerminalStreamService` to track terminal stream keys in a Redis SET (e.g., `terminal:{runId}:_keys`) when streams are created, instead of discovering them via SCAN
- [x] Update `listStreams()` to read from the tracking SET (`SMEMBERS`) instead of scanning
- [x] Update `deleteStreams()` to read from the tracking SET, delete matching keys, and clean up the SET entry
- [x] Update `fetchChunks()` to read from the tracking SET instead of scanning
- [x] Add a method to register keys in the tracking SET when terminal streams are written (check where streams are created — likely in a write/append method or in the worker)
- [x] Update `terminal-stream.service.spec.ts` tests to cover the new SET-based key tracking
- [x] Keep the `scanKeys()` method as a fallback for cases where the tracking SET doesn't exist (backward compatibility with existing data)

## Notes

- Use `CREATE INDEX CONCURRENTLY` to avoid locking the table during index creation.
- The Redis SCAN optimization requires finding where terminal stream keys are WRITTEN (not just read). Check the worker or any stream-append logic.
- The SCAN-based approach is O(N) across all Redis keys; SET-based tracking is O(1) for membership + O(M) for the tracked keys only.
- Backward compat: if `terminal:{runId}:_keys` SET doesn't exist, fall back to SCAN.

## Completion Summary

<!-- Appended by orchestrator after agent completes. Do not fill manually. -->
