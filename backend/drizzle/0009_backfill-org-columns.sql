-- Backfill organization IDs for existing records so new auth enforcement can rely on scoped data.

UPDATE workflows
SET organization_id = 'local-dev'
WHERE organization_id IS NULL;

UPDATE workflow_versions
SET organization_id = 'local-dev'
WHERE organization_id IS NULL;

UPDATE workflow_runs
SET organization_id = 'local-dev'
WHERE organization_id IS NULL;

UPDATE workflow_traces
SET organization_id = 'local-dev'
WHERE organization_id IS NULL;

UPDATE workflow_log_streams
SET organization_id = 'local-dev'
WHERE organization_id IS NULL;

UPDATE secrets
SET organization_id = 'local-dev'
WHERE organization_id IS NULL;

UPDATE secret_versions
SET organization_id = 'local-dev'
WHERE organization_id IS NULL;

UPDATE files
SET organization_id = 'local-dev'
WHERE organization_id IS NULL;
