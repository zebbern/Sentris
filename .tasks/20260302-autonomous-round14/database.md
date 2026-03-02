# Agent: database

## Purpose

Add composite database indexes to 5 tables to support existing query patterns and eliminate full table scans.

## Skills

Load before starting: database-patterns

## Subtasks

### workflow_runs table (`backend/src/database/schema/workflow-runs.ts`)

- [x] Read `backend/src/workflows/repository/workflow-run.repository.ts` to confirm query patterns (list filters on workflowId, organizationId, parentRunId; ORDER BY createdAt DESC)
- [x] Convert the `workflowRunsTable` from `pgTable('workflow_runs', {...})` to the 3-argument form `pgTable('workflow_runs', {...}, (table) => ({...}))` following the pattern in `backend/src/database/schema/audit-logs.ts`
- [x] Add index: `orgWorkflowCreatedAtIdx` on `(organizationId, workflowId, createdAt)` — covers the primary list query filtered by org + workflow, sorted by createdAt
- [x] Add index: `orgCreatedAtIdx` on `(organizationId, createdAt)` — covers list-all-runs-for-org query sorted by createdAt
- [x] Add index: `parentRunCreatedAtIdx` on `(parentRunId, createdAt)` — covers listChildren query filtered by parentRunId, sorted by createdAt

### webhook_configurations table (`backend/src/database/schema/webhooks.ts`)

- [x] Read `backend/src/webhooks/repository/webhook.repository.ts` to confirm query patterns (list filters on organizationId, workflowId, status; ORDER BY createdAt DESC)
- [x] Convert `webhookConfigurationsTable` to the 3-argument `pgTable` form with an index callback
- [x] Add index: `orgWorkflowCreatedAtIdx` on `(organizationId, workflowId, createdAt)` — covers list filtered by org + workflow
- [x] Add index: `orgCreatedAtIdx` on `(organizationId, createdAt)` — covers list-all-for-org sorted by createdAt

### webhook_deliveries table (`backend/src/database/schema/webhooks.ts`)

- [x] Read `backend/src/webhooks/repository/webhook-delivery.repository.ts` to confirm query patterns (list by webhookId ORDER BY createdAt DESC; list by workflowRunId)
- [x] Convert `webhookDeliveriesTable` to the 3-argument `pgTable` form with an index callback
- [x] Add index: `webhookCreatedAtIdx` on `(webhookId, createdAt)` — covers list-deliveries-by-webhook sorted by createdAt
- [x] Add index: `runIdIdx` on `(workflowRunId)` — covers lookup by workflow run

### workflow_terminal_records table (`backend/src/database/schema/terminal-records.ts`)

- [x] Read `backend/src/workflows/repository/terminal-record.repository.ts` to confirm query patterns (list by runId + organizationId ORDER BY createdAt DESC; lookup by id + organizationId)
- [x] Convert `workflowTerminalRecordsTable` to the 3-argument `pgTable` form with an index callback
- [x] Add index: `runOrgCreatedAtIdx` on `(runId, organizationId, createdAt)` — covers list-records-for-run filtered by org, sorted by createdAt
- [x] Add index: `orgIdx` on `(organizationId)` — supports org-scoped queries

### workflow_schedules table (`backend/src/database/schema/workflow-schedules.ts`)

- [x] Read `backend/src/schedules/repository/schedule.repository.ts` to confirm query patterns (list filters on workflowId, organizationId, status; ORDER BY name ASC)
- [x] Convert `workflowSchedulesTable` to the 3-argument `pgTable` form with an index callback
- [x] Add index: `orgWorkflowIdx` on `(organizationId, workflowId)` — covers list filtered by org + workflow
- [x] Add index: `orgStatusIdx` on `(organizationId, status)` — covers list filtered by org + status

### Migration

- [x] Import `index` from `drizzle-orm/pg-core` in each modified schema file (if not already imported)
- [x] Generate a Drizzle migration by running `bunx drizzle-kit generate` from the `backend/` directory — NOTE: `drizzle-kit generate` failed due to pre-existing malformed snapshot files (0005-0007). Wrote migration SQL manually as `0028_add-performance-indexes.sql` with `CREATE INDEX CONCURRENTLY IF NOT EXISTS` statements.
- [x] Verify the generated SQL migration file contains only CREATE INDEX statements (no table alterations)

## Notes

- Follow the exact pattern from `backend/src/database/schema/audit-logs.ts` for the index callback syntax
- Use descriptive index names with the table prefix: e.g., `workflow_runs_org_workflow_created_at_idx`
- Place `organizationId` as the leading column in composite indexes (multi-tenant filtering is the most selective)
- The `createdAt` column should be the trailing column when it's used for ORDER BY (enables index-ordered scan)
- Drizzle config at `backend/drizzle.config.ts` reads schema from `./src/database/schema` and outputs to `./drizzle`

## Completion Summary

<!-- Appended by orchestrator after agent completes. Do not fill manually. -->
