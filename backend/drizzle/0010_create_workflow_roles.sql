CREATE TABLE IF NOT EXISTS workflow_roles (
  workflow_id UUID NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  user_id VARCHAR(191) NOT NULL,
  organization_id VARCHAR(191),
  role TEXT NOT NULL CHECK (role IN ('ADMIN', 'MEMBER')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (workflow_id, user_id)
);

CREATE INDEX IF NOT EXISTS workflow_roles_org_idx
  ON workflow_roles (organization_id, role);

CREATE INDEX IF NOT EXISTS workflow_roles_user_idx
  ON workflow_roles (user_id);
