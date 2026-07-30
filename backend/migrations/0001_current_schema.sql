CREATE TYPE "public"."asset_type" AS ENUM('subdomain', 'host', 'ip-address', 'open-port', 'http-probe', 'dns-record', 'crawled-url', 'url');--> statement-breakpoint
CREATE TYPE "public"."finding_triage_status" AS ENUM('new', 'triaged', 'in_progress', 'fixed', 'verified', 'wont_fix', 'accepted_risk');--> statement-breakpoint
CREATE TABLE "agent_skills" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar(191) NOT NULL,
	"name" varchar(191) NOT NULL,
	"slug" varchar(128) NOT NULL,
	"description" text,
	"content" text NOT NULL,
	"files" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"tags" text[] DEFAULT '{}' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_by" varchar(191),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "asset_inventory" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar(191) NOT NULL,
	"scope_id" uuid NOT NULL,
	"asset_type" "asset_type" NOT NULL,
	"asset_value" varchar(1024) NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"first_seen_run_id" text,
	"last_seen_run_id" text,
	"source_component_id" varchar(191),
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "finding_triage_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"finding_triage_id" uuid NOT NULL,
	"event_type" varchar(32) NOT NULL,
	"field_changed" varchar(64),
	"old_value" text,
	"new_value" text,
	"user_id" varchar(191) NOT NULL,
	"comment" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "finding_triage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar(191) NOT NULL,
	"finding_opensearch_id" varchar(512) NOT NULL,
	"status" "finding_triage_status" DEFAULT 'new' NOT NULL,
	"assignee_user_id" varchar(191),
	"severity_override" varchar(32),
	"notes" text,
	"sla_deadline" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_channels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar(191) NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"config" jsonb NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"events" jsonb NOT NULL,
	"created_by" varchar(191),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"channel_id" uuid NOT NULL,
	"run_id" text,
	"event_type" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"payload" jsonb NOT NULL,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	"duration_ms" integer,
	"response_status" smallint,
	"response_body" text
);
--> statement-breakpoint
CREATE TABLE "registry_catalog" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(191) NOT NULL,
	"display_name" varchar(255) NOT NULL,
	"description" text,
	"server_type" varchar(32) NOT NULL,
	"category" varchar(64),
	"tags" jsonb DEFAULT '[]'::jsonb,
	"icon_url" text,
	"source_url" text,
	"docker_image" varchar(512),
	"remote_config" jsonb DEFAULT 'null'::jsonb,
	"config_schema" jsonb DEFAULT 'null'::jsonb,
	"run_config" jsonb DEFAULT 'null'::jsonb,
	"oauth_config" jsonb DEFAULT 'null'::jsonb,
	"is_featured" boolean DEFAULT false NOT NULL,
	"registry_commit_sha" varchar(64),
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "registry_catalog_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "registry_sync_state" (
	"id" varchar(64) PRIMARY KEY DEFAULT 'default' NOT NULL,
	"last_tree_sha" varchar(64),
	"last_commit_sha" varchar(64),
	"last_sync_at" timestamp with time zone,
	"last_sync_status" varchar(32),
	"servers_synced" integer DEFAULT 0,
	"servers_added" integer DEFAULT 0,
	"servers_removed" integer DEFAULT 0,
	"servers_updated" integer DEFAULT 0,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflow_tags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workflow_id" uuid NOT NULL,
	"name" varchar(100) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_workflow_tags_workflow_id_name" UNIQUE("workflow_id","name")
);
--> statement-breakpoint
CREATE TABLE "sla_policies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar(191) NOT NULL,
	"severity" varchar(32) NOT NULL,
	"deadline_hours" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ticket_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"finding_triage_id" uuid NOT NULL,
	"organization_id" varchar(191) NOT NULL,
	"provider" varchar(32) DEFAULT 'jira' NOT NULL,
	"external_id" varchar(128) NOT NULL,
	"external_url" text NOT NULL,
	"sync_status" varchar(16) DEFAULT 'synced' NOT NULL,
	"last_synced_at" timestamp with time zone,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ticketing_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar(191) NOT NULL,
	"provider" varchar(32) DEFAULT 'jira' NOT NULL,
	"access_token" jsonb NOT NULL,
	"refresh_token" jsonb DEFAULT 'null'::jsonb,
	"token_expires_at" timestamp with time zone,
	"cloud_id" varchar(128),
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"webhook_secret" varchar(256),
	"created_by" varchar(191) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scopes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar(191) NOT NULL,
	"name" varchar(191) NOT NULL,
	"description" text,
	"domains" text[] DEFAULT '{}' NOT NULL,
	"repos" text[] DEFAULT '{}' NOT NULL,
	"ip_ranges" text[] DEFAULT '{}' NOT NULL,
	"runtime_values" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" varchar(191),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP INDEX "workflow_log_streams_run_node_stream_idx";--> statement-breakpoint
ALTER TABLE "workflow_runs" ADD COLUMN "scope_id" uuid;--> statement-breakpoint
ALTER TABLE "mcp_servers" ADD COLUMN "registry_source_name" varchar(191);--> statement-breakpoint
ALTER TABLE "asset_inventory" ADD CONSTRAINT "asset_inventory_scope_id_scopes_id_fk" FOREIGN KEY ("scope_id") REFERENCES "public"."scopes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finding_triage_events" ADD CONSTRAINT "finding_triage_events_finding_triage_id_finding_triage_id_fk" FOREIGN KEY ("finding_triage_id") REFERENCES "public"."finding_triage"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_channel_id_notification_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."notification_channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_tags" ADD CONSTRAINT "workflow_tags_workflow_id_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_links" ADD CONSTRAINT "ticket_links_finding_triage_id_finding_triage_id_fk" FOREIGN KEY ("finding_triage_id") REFERENCES "public"."finding_triage"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_skills_org_idx" ON "agent_skills" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "agent_skills_enabled_idx" ON "agent_skills" USING btree ("enabled");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_skills_org_slug_uidx" ON "agent_skills" USING btree ("organization_id","slug");--> statement-breakpoint
CREATE INDEX "asset_inventory_org_idx" ON "asset_inventory" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "asset_inventory_scope_idx" ON "asset_inventory" USING btree ("scope_id");--> statement-breakpoint
CREATE UNIQUE INDEX "asset_inventory_org_scope_type_value_uidx" ON "asset_inventory" USING btree ("organization_id","scope_id","asset_type","asset_value");--> statement-breakpoint
CREATE INDEX "asset_inventory_scope_lastseen_idx" ON "asset_inventory" USING btree ("scope_id","last_seen_at");--> statement-breakpoint
CREATE INDEX "finding_triage_events_triage_idx" ON "finding_triage_events" USING btree ("finding_triage_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "finding_triage_org_finding_idx" ON "finding_triage" USING btree ("organization_id","finding_opensearch_id");--> statement-breakpoint
CREATE INDEX "finding_triage_status_idx" ON "finding_triage" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "finding_triage_assignee_idx" ON "finding_triage" USING btree ("organization_id","assignee_user_id");--> statement-breakpoint
CREATE INDEX "finding_triage_org_created_at_idx" ON "finding_triage" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "finding_triage_org_severity_created_at_idx" ON "finding_triage" USING btree ("organization_id","severity_override","created_at");--> statement-breakpoint
CREATE INDEX "notification_channels_org_created_at_idx" ON "notification_channels" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "notification_deliveries_channel_created_at_idx" ON "notification_deliveries" USING btree ("channel_id","created_at");--> statement-breakpoint
CREATE INDEX "notification_deliveries_run_id_idx" ON "notification_deliveries" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "registry_catalog_category_idx" ON "registry_catalog" USING btree ("category");--> statement-breakpoint
CREATE INDEX "registry_catalog_server_type_idx" ON "registry_catalog" USING btree ("server_type");--> statement-breakpoint
CREATE INDEX "registry_catalog_featured_idx" ON "registry_catalog" USING btree ("is_featured");--> statement-breakpoint
CREATE INDEX "idx_workflow_tags_workflow_id" ON "workflow_tags" USING btree ("workflow_id");--> statement-breakpoint
CREATE INDEX "idx_workflow_tags_name" ON "workflow_tags" USING btree ("name");--> statement-breakpoint
CREATE UNIQUE INDEX "sla_policies_org_severity_uidx" ON "sla_policies" USING btree ("organization_id","severity");--> statement-breakpoint
CREATE UNIQUE INDEX "ticket_links_triage_provider_uidx" ON "ticket_links" USING btree ("finding_triage_id","provider");--> statement-breakpoint
CREATE INDEX "ticket_links_org_provider_idx" ON "ticket_links" USING btree ("organization_id","provider");--> statement-breakpoint
CREATE INDEX "ticket_links_external_id_idx" ON "ticket_links" USING btree ("external_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ticketing_connections_org_provider_uidx" ON "ticketing_connections" USING btree ("organization_id","provider");--> statement-breakpoint
CREATE INDEX "ticketing_connections_org_idx" ON "ticketing_connections" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "scopes_org_idx" ON "scopes" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "scopes_org_name_uidx" ON "scopes" USING btree ("organization_id","name");--> statement-breakpoint
CREATE INDEX "artifacts_organization_id_idx" ON "artifacts" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "human_input_requests_run_id_idx" ON "human_input_requests" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "human_input_requests_organization_id_idx" ON "human_input_requests" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "human_input_requests_status_idx" ON "human_input_requests" USING btree ("status");--> statement-breakpoint
CREATE INDEX "workflows_organization_id_idx" ON "workflows" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "workflows_org_created_at_idx" ON "workflows" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "workflows_updated_at_idx" ON "workflows" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "workflow_versions_org_workflow_version_idx" ON "workflow_versions" USING btree ("organization_id","workflow_id","version");--> statement-breakpoint
CREATE INDEX "workflow_runs_org_workflow_created_at_idx" ON "workflow_runs" USING btree ("organization_id","workflow_id","created_at");--> statement-breakpoint
CREATE INDEX "workflow_runs_org_created_at_idx" ON "workflow_runs" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "workflow_runs_parent_run_created_at_idx" ON "workflow_runs" USING btree ("parent_run_id","created_at");--> statement-breakpoint
CREATE INDEX "workflow_runs_org_status_created_at_idx" ON "workflow_runs" USING btree ("organization_id","status","created_at");--> statement-breakpoint
CREATE INDEX "workflow_runs_org_scope_created_at_idx" ON "workflow_runs" USING btree ("organization_id","scope_id","created_at");--> statement-breakpoint
CREATE INDEX "secret_versions_secret_id_idx" ON "secret_versions" USING btree ("secret_id");--> statement-breakpoint
CREATE INDEX "secrets_organization_id_idx" ON "secrets" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "workflow_schedules_org_workflow_idx" ON "workflow_schedules" USING btree ("organization_id","workflow_id");--> statement-breakpoint
CREATE INDEX "workflow_schedules_org_status_idx" ON "workflow_schedules" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "webhook_configs_org_workflow_created_at_idx" ON "webhook_configurations" USING btree ("organization_id","workflow_id","created_at");--> statement-breakpoint
CREATE INDEX "webhook_configs_org_created_at_idx" ON "webhook_configurations" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "webhook_deliveries_webhook_created_at_idx" ON "webhook_deliveries" USING btree ("webhook_id","created_at");--> statement-breakpoint
CREATE INDEX "webhook_deliveries_run_id_idx" ON "webhook_deliveries" USING btree ("workflow_run_id");--> statement-breakpoint
CREATE INDEX "terminal_records_run_org_created_at_idx" ON "workflow_terminal_records" USING btree ("run_id","organization_id","created_at");--> statement-breakpoint
CREATE INDEX "terminal_records_org_idx" ON "workflow_terminal_records" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "mcp_servers_registry_source_idx" ON "mcp_servers" USING btree ("registry_source_name");--> statement-breakpoint
CREATE INDEX "templates_submissions_organization_id_idx" ON "templates_submissions" USING btree ("organization_id");