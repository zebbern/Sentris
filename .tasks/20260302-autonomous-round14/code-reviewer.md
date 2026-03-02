# Agent: code-reviewer

## Purpose

Review the database index additions for correctness, naming consistency, and alignment with actual query patterns.

## Skills

Load before starting: database-patterns

## Subtasks

### Index Design Review

- [x] Verify each index's column order matches the WHERE clause column order in the corresponding repository queries
- [x] Confirm `organizationId` is the leading column in all multi-tenant composite indexes
- [x] Check that trailing `createdAt` columns are present only when the query uses ORDER BY on that column
- [x] Verify no redundant indexes (e.g., a single-column index that is a prefix of an existing composite index)
- [x] Confirm no over-indexing — each index serves at least one identified query pattern

### Pattern Consistency Review

- [x] Verify all modified schema files use the same 3-argument `pgTable` pattern as `backend/src/database/schema/audit-logs.ts`
- [x] Check index naming follows the `{table}_{columns}_idx` convention used in audit-logs.ts
- [x] Confirm `index` is imported from `drizzle-orm/pg-core` in each modified file

### Query Coverage Verification

- [x] Cross-reference `workflow-run.repository.ts` queries with `workflow_runs` indexes — confirm list, listChildren, and org-filtered queries are covered
- [x] Cross-reference `webhook.repository.ts` queries with `webhook_configurations` indexes — confirm list-by-org, list-by-workflow queries are covered
- [x] Cross-reference `webhook-delivery.repository.ts` queries with `webhook_deliveries` indexes — confirm list-by-webhook and list-by-run queries are covered
- [x] Cross-reference `terminal-record.repository.ts` queries with `workflow_terminal_records` indexes — confirm list-by-run and org-filtered queries are covered
- [x] Cross-reference `schedule.repository.ts` queries with `workflow_schedules` indexes — confirm list-by-org, filter-by-status, filter-by-workflow queries are covered

### Migration Review

- [x] Verify the generated migration SQL contains only CREATE INDEX statements
- [x] Confirm no DROP, ALTER TABLE, or column changes are present in the migration
- [x] Check that index names in the migration match the schema declarations

## Notes

- This is a read-only review. Do not modify source files.
- If index column order does not align with query patterns, flag as S1 finding.
- If naming is inconsistent but functionally correct, flag as S2 finding.
- Repository files to cross-reference:
  - `backend/src/workflows/repository/workflow-run.repository.ts`
  - `backend/src/workflows/repository/terminal-record.repository.ts`
  - `backend/src/webhooks/repository/webhook.repository.ts`
  - `backend/src/webhooks/repository/webhook-delivery.repository.ts`
  - `backend/src/schedules/repository/schedule.repository.ts`

## Completion Summary

<!-- Appended by orchestrator after agent completes. Do not fill manually. -->
