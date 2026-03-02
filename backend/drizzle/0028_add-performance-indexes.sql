-- Migration: Add missing indexes to high-traffic tables
-- Tables: workflow_runs, webhook_configurations, webhook_deliveries, workflow_terminal_records, workflow_schedules

-- workflow_runs: list by org+workflow sorted by createdAt
CREATE INDEX CONCURRENTLY IF NOT EXISTS "workflow_runs_org_workflow_created_at_idx"
  ON "workflow_runs" ("organization_id", "workflow_id", "created_at");

-- workflow_runs: list all runs for org sorted by createdAt
CREATE INDEX CONCURRENTLY IF NOT EXISTS "workflow_runs_org_created_at_idx"
  ON "workflow_runs" ("organization_id", "created_at");

-- workflow_runs: listChildren by parentRunId sorted by createdAt
CREATE INDEX CONCURRENTLY IF NOT EXISTS "workflow_runs_parent_run_created_at_idx"
  ON "workflow_runs" ("parent_run_id", "created_at");

-- webhook_configurations: list by org+workflow sorted by createdAt
CREATE INDEX CONCURRENTLY IF NOT EXISTS "webhook_configs_org_workflow_created_at_idx"
  ON "webhook_configurations" ("organization_id", "workflow_id", "created_at");

-- webhook_configurations: list all for org sorted by createdAt
CREATE INDEX CONCURRENTLY IF NOT EXISTS "webhook_configs_org_created_at_idx"
  ON "webhook_configurations" ("organization_id", "created_at");

-- webhook_deliveries: list by webhook sorted by createdAt
CREATE INDEX CONCURRENTLY IF NOT EXISTS "webhook_deliveries_webhook_created_at_idx"
  ON "webhook_deliveries" ("webhook_id", "created_at");

-- webhook_deliveries: lookup by workflow run
CREATE INDEX CONCURRENTLY IF NOT EXISTS "webhook_deliveries_run_id_idx"
  ON "webhook_deliveries" ("workflow_run_id");

-- workflow_terminal_records: list by run+org sorted by createdAt
CREATE INDEX CONCURRENTLY IF NOT EXISTS "terminal_records_run_org_created_at_idx"
  ON "workflow_terminal_records" ("run_id", "organization_id", "created_at");

-- workflow_terminal_records: org-scoped queries
CREATE INDEX CONCURRENTLY IF NOT EXISTS "terminal_records_org_idx"
  ON "workflow_terminal_records" ("organization_id");

-- workflow_schedules: list by org+workflow
CREATE INDEX CONCURRENTLY IF NOT EXISTS "workflow_schedules_org_workflow_idx"
  ON "workflow_schedules" ("organization_id", "workflow_id");

-- workflow_schedules: list by org+status
CREATE INDEX CONCURRENTLY IF NOT EXISTS "workflow_schedules_org_status_idx"
  ON "workflow_schedules" ("organization_id", "status");
