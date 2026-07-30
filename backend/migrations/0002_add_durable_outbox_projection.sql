CREATE TABLE "outbox_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_type" varchar(128) NOT NULL,
	"organization_id" varchar(191),
	"aggregate_type" varchar(64) NOT NULL,
	"aggregate_id" varchar(512) NOT NULL,
	"dedupe_key" varchar(512) NOT NULL,
	"payload" jsonb NOT NULL,
	"status" varchar(16) DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 8 NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_at" timestamp with time zone,
	"locked_by" varchar(191),
	"last_error" text,
	"processed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "outbox_events_status_check" CHECK ("outbox_events"."status" IN ('pending', 'processing', 'completed', 'dead')),
	CONSTRAINT "outbox_events_attempts_check" CHECK ("outbox_events"."attempts" >= 0 AND "outbox_events"."max_attempts" > 0)
);
--> statement-breakpoint
ALTER TABLE "finding_triage" ADD COLUMN "projection_version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD COLUMN "outbox_event_id" uuid;--> statement-breakpoint
CREATE UNIQUE INDEX "outbox_events_dedupe_key_idx" ON "outbox_events" USING btree ("dedupe_key");--> statement-breakpoint
CREATE INDEX "outbox_events_claim_idx" ON "outbox_events" USING btree ("status","available_at","created_at");--> statement-breakpoint
CREATE INDEX "outbox_events_lease_idx" ON "outbox_events" USING btree ("status","locked_at");--> statement-breakpoint
CREATE INDEX "outbox_events_org_dead_idx" ON "outbox_events" USING btree ("organization_id","status","created_at");--> statement-breakpoint
CREATE INDEX "outbox_events_org_event_status_idx" ON "outbox_events" USING btree ("organization_id","event_type","status");--> statement-breakpoint
CREATE UNIQUE INDEX "notification_deliveries_channel_outbox_event_idx" ON "notification_deliveries" USING btree ("channel_id","outbox_event_id");