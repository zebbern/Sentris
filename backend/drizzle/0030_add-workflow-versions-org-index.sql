-- Migration: Add composite index on workflow_versions(organization_id, workflow_id, version)
-- Supports org-scoped workflow version lookups on the workflow list page

CREATE INDEX CONCURRENTLY IF NOT EXISTS "workflow_versions_org_workflow_version_idx"
  ON "workflow_versions" ("organization_id", "workflow_id", "version");
