ALTER TABLE "mcp_invocations" ADD COLUMN "subject_kind" varchar(32);--> statement-breakpoint
ALTER TABLE "mcp_invocations" ADD COLUMN "subject_id" text;--> statement-breakpoint
UPDATE "mcp_invocations"
SET "subject_kind" = 'run', "subject_id" = "run_id";--> statement-breakpoint
ALTER TABLE "mcp_invocations" ALTER COLUMN "subject_kind" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "mcp_invocations" ALTER COLUMN "subject_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "mcp_invocations" ALTER COLUMN "run_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "operator_actions" ADD COLUMN "started_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "mcp_invocations_subject_created_at_idx" ON "mcp_invocations" USING btree ("subject_kind","subject_id","created_at");--> statement-breakpoint
ALTER TABLE "mcp_invocations" ADD CONSTRAINT "mcp_invocations_subject_kind_check" CHECK ("mcp_invocations"."subject_kind" IN ('run', 'operator'));--> statement-breakpoint
ALTER TABLE "mcp_invocations" ADD CONSTRAINT "mcp_invocations_run_projection_check" CHECK (("mcp_invocations"."subject_kind" = 'run' AND "mcp_invocations"."run_id" = "mcp_invocations"."subject_id") OR ("mcp_invocations"."subject_kind" <> 'run' AND "mcp_invocations"."run_id" IS NULL));
