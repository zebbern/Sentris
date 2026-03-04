-- ticketing_connections: stores org-scoped Jira OAuth connections
CREATE TABLE ticketing_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id VARCHAR(191) NOT NULL,
  provider VARCHAR(32) NOT NULL DEFAULT 'jira',
  access_token JSONB NOT NULL,
  refresh_token JSONB,
  token_expires_at TIMESTAMPTZ,
  cloud_id VARCHAR(128),
  config JSONB NOT NULL DEFAULT '{}',
  webhook_secret VARCHAR(256),
  created_by VARCHAR(191) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ticketing_connections_org_provider_uidx UNIQUE (organization_id, provider)
);

CREATE INDEX ticketing_connections_org_idx ON ticketing_connections (organization_id);

-- ticket_links: links finding triage records to external ticketing issues
CREATE TABLE ticket_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  finding_triage_id UUID NOT NULL REFERENCES finding_triage(id) ON DELETE CASCADE,
  organization_id VARCHAR(191) NOT NULL,
  provider VARCHAR(32) NOT NULL DEFAULT 'jira',
  external_id VARCHAR(128) NOT NULL,
  external_url TEXT NOT NULL,
  sync_status VARCHAR(16) NOT NULL DEFAULT 'synced',
  last_synced_at TIMESTAMPTZ,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ticket_links_triage_provider_uidx UNIQUE (finding_triage_id, provider)
);

CREATE INDEX ticket_links_org_provider_idx ON ticket_links (organization_id, provider);
CREATE INDEX ticket_links_external_id_idx ON ticket_links (external_id);
