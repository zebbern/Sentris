-- Add optional organization scoping columns. These default to NULL until backfill logic runs.

ALTER TABLE workflows
  ADD COLUMN IF NOT EXISTS organization_id VARCHAR(191);

ALTER TABLE workflow_versions
  ADD COLUMN IF NOT EXISTS organization_id VARCHAR(191);

ALTER TABLE workflow_runs
  ADD COLUMN IF NOT EXISTS organization_id VARCHAR(191);

ALTER TABLE workflow_traces
  ADD COLUMN IF NOT EXISTS organization_id VARCHAR(191);

ALTER TABLE workflow_log_streams
  ADD COLUMN IF NOT EXISTS organization_id VARCHAR(191);

ALTER TABLE secrets
  ADD COLUMN IF NOT EXISTS organization_id VARCHAR(191);

ALTER TABLE secret_versions
  ADD COLUMN IF NOT EXISTS organization_id VARCHAR(191);

ALTER TABLE files
  ADD COLUMN IF NOT EXISTS organization_id VARCHAR(191);

CREATE INDEX IF NOT EXISTS workflows_organization_idx ON workflows (organization_id);
CREATE INDEX IF NOT EXISTS workflow_runs_organization_idx ON workflow_runs (organization_id);
CREATE INDEX IF NOT EXISTS workflow_traces_organization_idx ON workflow_traces (organization_id);
CREATE INDEX IF NOT EXISTS workflow_log_streams_organization_idx ON workflow_log_streams (organization_id);
CREATE INDEX IF NOT EXISTS secrets_organization_idx ON secrets (organization_id);
CREATE INDEX IF NOT EXISTS secret_versions_organization_idx ON secret_versions (organization_id);
CREATE INDEX IF NOT EXISTS files_organization_idx ON files (organization_id);
