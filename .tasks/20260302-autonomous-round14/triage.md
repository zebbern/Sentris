# Triage: Round 14 — Add Missing Database Indexes

## Scope

Add missing composite indexes to 5 tables that currently only have primary key indexes.

## Tables & Indexes Needed

1. **workflow_runs** — `workflowId`, `organizationId`, `parentRunId`, `createdAt`
2. **webhook_configurations** — `organizationId`, `workflowId`
3. **webhook_deliveries** — `webhookId`, `status`, `createdAt`
4. **workflow_terminal_records** — `runId`, `nodeRef`, `organizationId`
5. **workflow_schedules** — `workflowId`, `organizationId`, `status`

## Schema Files

- `backend/src/database/schema/workflow-runs.ts`
- `backend/src/database/schema/webhooks.ts`
- `backend/src/database/schema/terminal-records.ts`
- `backend/src/database/schema/workflow-schedules.ts`
- Pattern reference: `backend/src/database/schema/audit-logs.ts`

## Repository Files (query patterns)

- `backend/src/workflows/repository/workflow-run.repository.ts`
- `backend/src/workflows/repository/terminal-record.repository.ts`
- `backend/src/webhooks/repository/webhook.repository.ts`
- `backend/src/webhooks/repository/webhook-delivery.repository.ts`
- `backend/src/schedules/repository/schedule.repository.ts`

## Agents

| Agent         | Purpose                                |
| ------------- | -------------------------------------- |
| database      | Add indexes to all 5 tables            |
| code-reviewer | Review index additions for correctness |

## Execution Order

1. database agent: Add indexes following audit-logs.ts pattern
2. code-reviewer: Review for correctness (column order, composite index design)
3. Commit
