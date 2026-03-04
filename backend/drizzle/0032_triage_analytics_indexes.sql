-- Analytics-optimized indexes on finding_triage
CREATE INDEX IF NOT EXISTS "finding_triage_org_created_at_idx" ON "finding_triage" ("organization_id", "created_at");
CREATE INDEX IF NOT EXISTS "finding_triage_org_severity_created_at_idx" ON "finding_triage" ("organization_id", "severity_override", "created_at");

-- SLA policies table: configurable per-org severity→deadline mappings
CREATE TABLE IF NOT EXISTS "sla_policies" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" VARCHAR(191) NOT NULL,
  "severity" VARCHAR(32) NOT NULL,
  "deadline_hours" INTEGER NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS "sla_policies_org_severity_uidx" ON "sla_policies" ("organization_id", "severity");
