-- Migration: Add compound index on workflow_runs(org, status, created_at)
-- Supports queries filtering by status within an organization sorted by time

CREATE INDEX CONCURRENTLY IF NOT EXISTS "workflow_runs_org_status_created_at_idx"
  ON "workflow_runs" ("organization_id", "status", "created_at");
