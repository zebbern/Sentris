CREATE TABLE IF NOT EXISTS workflow_tags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id UUID NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_workflow_tags_workflow_id_name UNIQUE (workflow_id, name)
);

CREATE INDEX IF NOT EXISTS idx_workflow_tags_workflow_id
  ON workflow_tags (workflow_id);

CREATE INDEX IF NOT EXISTS idx_workflow_tags_name
  ON workflow_tags (name);
