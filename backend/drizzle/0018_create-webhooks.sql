CREATE TABLE IF NOT EXISTS "webhook_configurations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "workflow_id" uuid NOT NULL,
  "workflow_version_id" uuid,
  "workflow_version" integer,
  "name" text NOT NULL,
  "description" text,
  "webhook_path" varchar(255) UNIQUE NOT NULL,
  "parsing_script" text NOT NULL,
  "expected_inputs" jsonb NOT NULL,
  "status" text NOT NULL DEFAULT 'active',
  "organization_id" varchar(191),
  "created_by" varchar(191),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "webhook_deliveries" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "webhook_id" uuid NOT NULL REFERENCES "webhook_configurations"("id") ON DELETE CASCADE,
  "workflow_run_id" text,
  "status" text NOT NULL DEFAULT 'processing',
  "payload" jsonb NOT NULL,
  "headers" jsonb,
  "parsed_data" jsonb,
  "error_message" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "completed_at" timestamptz
);

CREATE INDEX IF NOT EXISTS "webhook_configurations_workflow_idx" ON "webhook_configurations" ("workflow_id", "status");
CREATE INDEX IF NOT EXISTS "webhook_configurations_path_idx" ON "webhook_configurations" ("webhook_path");
CREATE INDEX IF NOT EXISTS "webhook_deliveries_webhook_idx" ON "webhook_deliveries" ("webhook_id", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "webhook_deliveries_run_id_idx" ON "webhook_deliveries" ("workflow_run_id");
