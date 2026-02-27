CREATE TABLE IF NOT EXISTS platform_workflow_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id UUID NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  platform_agent_id VARCHAR(191) NOT NULL,
  organization_id VARCHAR(191),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS platform_workflow_links_agent_idx
  ON platform_workflow_links (platform_agent_id);

CREATE INDEX IF NOT EXISTS platform_workflow_links_org_idx
  ON platform_workflow_links (organization_id);
