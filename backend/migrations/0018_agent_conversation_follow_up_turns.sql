CREATE TABLE "agent_conversation_turns" (
	"id" uuid PRIMARY KEY NOT NULL,
	"conversation_id" text NOT NULL,
	"agent_run_id" text NOT NULL,
	"source_agent_run_id" text NOT NULL,
	"turn_index" integer NOT NULL,
	"organization_id" varchar(191),
	"workflow_run_id" text NOT NULL,
	"node_ref" text NOT NULL,
	"prompt" text NOT NULL,
	"source_state_file_id" uuid NOT NULL,
	"source_state_root_file_id" uuid NOT NULL,
	"temporal_workflow_id" text NOT NULL,
	"temporal_run_id" text,
	"status" varchar(32) DEFAULT 'queued' NOT NULL,
	"response_text" text,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE UNIQUE INDEX "agent_conversation_turns_conversation_turn_uidx" ON "agent_conversation_turns" USING btree ("conversation_id","turn_index");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_conversation_turns_agent_run_uidx" ON "agent_conversation_turns" USING btree ("agent_run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_conversation_turns_temporal_workflow_uidx" ON "agent_conversation_turns" USING btree ("temporal_workflow_id");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_conversation_turns_active_conversation_uidx" ON "agent_conversation_turns" USING btree ("conversation_id") WHERE "agent_conversation_turns"."status" IN ('queued', 'running');--> statement-breakpoint
CREATE INDEX "agent_conversation_turns_conversation_created_idx" ON "agent_conversation_turns" USING btree ("conversation_id","created_at");