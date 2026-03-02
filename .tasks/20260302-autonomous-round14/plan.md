# Plan: Add Missing Database Indexes (Round 14)

## Overview

Five tables (`workflow_runs`, `webhook_configurations`, `webhook_deliveries`, `workflow_terminal_records`, `workflow_schedules`) currently only have primary key indexes. This causes full table scans on common list/filter queries. Add composite indexes matching actual query patterns found in repository files, following the existing pattern in `audit-logs.ts`.

## Architecture Decisions

| Decision                                               | Alternatives            | Rationale                                                                                                                               |
| ------------------------------------------------------ | ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Use Drizzle schema-level `index()` declarations        | Raw SQL migrations      | Keeps indexes co-located with schema, auto-generates migration via `drizzle-kit generate`                                               |
| Composite indexes with org-first column order          | Single-column indexes   | Matches multi-tenant WHERE patterns (orgId + other filters). Single-column indexes would be less selective for the common query shapes. |
| Include `createdAt` as trailing column on list indexes | Separate ORDER BY index | Common list queries filter + ORDER BY createdAt DESC. Trailing createdAt in composite enables index-only sort.                          |

## Affected Files

| Action | File Path                                           | Change Description                                                                                                                         |
| ------ | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| MODIFY | `backend/src/database/schema/workflow-runs.ts`      | Add composite indexes for org+workflow+createdAt, org+createdAt, parentRunId+createdAt                                                     |
| MODIFY | `backend/src/database/schema/webhooks.ts`           | Add composite indexes for webhook_configurations (org+workflowId+createdAt) and webhook_deliveries (webhookId+createdAt, webhookId+status) |
| MODIFY | `backend/src/database/schema/terminal-records.ts`   | Add composite index for runId+nodeRef, org+runId                                                                                           |
| MODIFY | `backend/src/database/schema/workflow-schedules.ts` | Add composite indexes for org+workflowId, org+status                                                                                       |
| CREATE | `backend/drizzle/XXXX_*.sql`                        | Auto-generated migration (via `drizzle-kit generate`)                                                                                      |

## Phases

| Phase | Agents        | Purpose                                                          | Depends On |
| ----- | ------------- | ---------------------------------------------------------------- | ---------- |
| 1     | database      | Add index declarations to all 5 schema files, generate migration | —          |
| 2     | code-reviewer | Review index design, column order, naming conventions            | Phase 1    |

## Dependencies

- code-reviewer needs database agent's changes completed before reviewing.

## Risk Assessment

- **Low risk**: Adding indexes is additive — no schema column changes, no data migration. Existing queries are unaffected.
- **Migration ordering**: The generated migration file must not conflict with any pending migrations. The database agent should verify no uncommitted migration files exist before generating.
- **Index bloat**: 5 tables × ~2-3 indexes each is reasonable. No risk of excessive write overhead at current scale.
