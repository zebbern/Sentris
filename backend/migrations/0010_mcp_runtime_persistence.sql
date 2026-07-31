CREATE TABLE "mcp_capability_grants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"authority_key" varchar(64) NOT NULL,
	"organization_id" varchar(191),
	"subject_kind" varchar(32) NOT NULL,
	"subject_id" text NOT NULL,
	"grant" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "mcp_capability_grants_authority_key_unique" UNIQUE("authority_key"),
	CONSTRAINT "mcp_capability_grants_authority_key_check" CHECK ("mcp_capability_grants"."authority_key" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
CREATE TABLE "mcp_capability_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"capability_grant_id" uuid NOT NULL,
	"config_fingerprint" varchar(64) NOT NULL,
	"snapshot" jsonb NOT NULL,
	"invocation_manifest" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "mcp_capability_snapshots_capability_grant_id_unique" UNIQUE("capability_grant_id"),
	CONSTRAINT "mcp_capability_snapshots_config_fingerprint_check" CHECK ("mcp_capability_snapshots"."config_fingerprint" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
CREATE TABLE "mcp_invocation_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invocation_id" uuid NOT NULL,
	"attempt_number" integer NOT NULL,
	"source_id" text NOT NULL,
	"destination" varchar(32) NOT NULL,
	"retry_policy" varchar(32) NOT NULL,
	"status" varchar(32) NOT NULL,
	"prepared_at" timestamp with time zone,
	"dispatched_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	CONSTRAINT "mcp_invocation_attempts_attempt_number_check" CHECK ("mcp_invocation_attempts"."attempt_number" > 0),
	CONSTRAINT "mcp_invocation_attempts_destination_check" CHECK ("mcp_invocation_attempts"."destination" IN ('component-activity', 'mcp-activity')),
	CONSTRAINT "mcp_invocation_attempts_retry_policy_check" CHECK ("mcp_invocation_attempts"."retry_policy" IN ('pre-dispatch-only', 'reviewed-idempotent')),
	CONSTRAINT "mcp_invocation_attempts_status_check" CHECK ("mcp_invocation_attempts"."status" IN ('planned', 'prepared', 'dispatched', 'completed', 'failed', 'ambiguous', 'cancelled'))
);
--> statement-breakpoint
CREATE TABLE "mcp_invocations" (
	"invocation_id" uuid PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"organization_id" varchar(191),
	"capability_grant_id" uuid NOT NULL,
	"capability_snapshot_id" uuid NOT NULL,
	"tool_name" varchar(128) NOT NULL,
	"request_hash" varchar(64) NOT NULL,
	"request" jsonb NOT NULL,
	"status" varchar(32) NOT NULL,
	"current_attempt_number" integer DEFAULT 1 NOT NULL,
	"result" jsonb,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"terminal_at" timestamp with time zone,
	CONSTRAINT "mcp_invocations_request_hash_check" CHECK ("mcp_invocations"."request_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "mcp_invocations_status_check" CHECK ("mcp_invocations"."status" IN ('planned', 'prepared', 'dispatched', 'completed', 'failed', 'ambiguous', 'cancelled')),
	CONSTRAINT "mcp_invocations_current_attempt_number_check" CHECK ("mcp_invocations"."current_attempt_number" > 0)
);
--> statement-breakpoint
ALTER TABLE "mcp_capability_snapshots" ADD CONSTRAINT "mcp_capability_snapshots_capability_grant_id_mcp_capability_grants_id_fk" FOREIGN KEY ("capability_grant_id") REFERENCES "public"."mcp_capability_grants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_invocation_attempts" ADD CONSTRAINT "mcp_invocation_attempts_invocation_id_mcp_invocations_invocation_id_fk" FOREIGN KEY ("invocation_id") REFERENCES "public"."mcp_invocations"("invocation_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_invocations" ADD CONSTRAINT "mcp_invocations_capability_grant_id_mcp_capability_grants_id_fk" FOREIGN KEY ("capability_grant_id") REFERENCES "public"."mcp_capability_grants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_invocations" ADD CONSTRAINT "mcp_invocations_capability_snapshot_id_mcp_capability_snapshots_id_fk" FOREIGN KEY ("capability_snapshot_id") REFERENCES "public"."mcp_capability_snapshots"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "mcp_invocation_attempts_invocation_attempt_idx" ON "mcp_invocation_attempts" USING btree ("invocation_id","attempt_number");--> statement-breakpoint
CREATE INDEX "mcp_invocation_attempts_status_idx" ON "mcp_invocation_attempts" USING btree ("status");--> statement-breakpoint
CREATE INDEX "mcp_invocations_run_created_at_idx" ON "mcp_invocations" USING btree ("run_id","created_at");--> statement-breakpoint
CREATE INDEX "mcp_invocations_organization_created_at_idx" ON "mcp_invocations" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "mcp_invocations_status_updated_at_idx" ON "mcp_invocations" USING btree ("status","updated_at");