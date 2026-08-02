CREATE TABLE "operator_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"turn_id" uuid NOT NULL,
	"tool_call_id" varchar(191) NOT NULL,
	"command_name" varchar(64) NOT NULL,
	"effect" varchar(32) NOT NULL,
	"approval_mode" varchar(32) NOT NULL,
	"approval_required" boolean DEFAULT false NOT NULL,
	"status" varchar(32) DEFAULT 'proposed' NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"arguments" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"result" jsonb DEFAULT 'null'::jsonb,
	"error" text,
	"run_id" text,
	"decided_by" varchar(191),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "operator_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"turn_id" uuid NOT NULL,
	"sequence" serial NOT NULL,
	"role" varchar(32) NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "operator_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar(191) NOT NULL,
	"user_id" varchar(191) NOT NULL,
	"title" varchar(191) DEFAULT 'New Operator session' NOT NULL,
	"approval_mode" varchar(32) DEFAULT 'ask' NOT NULL,
	"status" varchar(32) DEFAULT 'active' NOT NULL,
	"model_provider" varchar(64) NOT NULL,
	"model_id" varchar(191) NOT NULL,
	"api_key_secret_id" uuid NOT NULL,
	"base_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "operator_turns" (
	"id" uuid PRIMARY KEY NOT NULL,
	"session_id" uuid NOT NULL,
	"status" varchar(32) DEFAULT 'queued' NOT NULL,
	"temporal_workflow_id" text,
	"temporal_run_id" text,
	"context" jsonb DEFAULT 'null'::jsonb,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "operator_actions" ADD CONSTRAINT "operator_actions_session_id_operator_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."operator_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operator_actions" ADD CONSTRAINT "operator_actions_turn_id_operator_turns_id_fk" FOREIGN KEY ("turn_id") REFERENCES "public"."operator_turns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operator_messages" ADD CONSTRAINT "operator_messages_session_id_operator_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."operator_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operator_messages" ADD CONSTRAINT "operator_messages_turn_id_operator_turns_id_fk" FOREIGN KEY ("turn_id") REFERENCES "public"."operator_turns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operator_turns" ADD CONSTRAINT "operator_turns_session_id_operator_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."operator_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "operator_actions_turn_tool_call_uidx" ON "operator_actions" USING btree ("turn_id","tool_call_id");--> statement-breakpoint
CREATE INDEX "operator_actions_session_created_idx" ON "operator_actions" USING btree ("session_id","created_at");--> statement-breakpoint
CREATE INDEX "operator_actions_session_status_idx" ON "operator_actions" USING btree ("session_id","status");--> statement-breakpoint
CREATE INDEX "operator_actions_run_id_idx" ON "operator_actions" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "operator_messages_session_sequence_idx" ON "operator_messages" USING btree ("session_id","sequence");--> statement-breakpoint
CREATE UNIQUE INDEX "operator_messages_turn_role_uidx" ON "operator_messages" USING btree ("turn_id","role");--> statement-breakpoint
CREATE INDEX "operator_messages_turn_idx" ON "operator_messages" USING btree ("turn_id");--> statement-breakpoint
CREATE INDEX "operator_sessions_owner_updated_idx" ON "operator_sessions" USING btree ("organization_id","user_id","updated_at");--> statement-breakpoint
CREATE INDEX "operator_turns_session_created_idx" ON "operator_turns" USING btree ("session_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "operator_turns_temporal_workflow_uidx" ON "operator_turns" USING btree ("temporal_workflow_id");