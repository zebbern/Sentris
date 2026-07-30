ALTER TABLE "ticketing_connections" ADD COLUMN "webhook_id" varchar(128);--> statement-breakpoint
ALTER TABLE "ticketing_connections" ADD COLUMN "webhook_cloud_id" varchar(128);--> statement-breakpoint
ALTER TABLE "ticketing_connections" ADD COLUMN "webhook_registration_status" varchar(16) DEFAULT 'unregistered' NOT NULL;--> statement-breakpoint
ALTER TABLE "ticketing_connections" ADD COLUMN "webhook_registration_version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "ticketing_connections" ADD COLUMN "webhook_registered_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "ticket_links_org_provider_external_id_idx" ON "ticket_links" USING btree ("organization_id","provider","external_id");--> statement-breakpoint
ALTER TABLE "ticketing_connections" ADD CONSTRAINT "ticketing_connections_webhook_registration_status_check" CHECK ("ticketing_connections"."webhook_registration_status" IN ('unregistered', 'pending', 'registered'));--> statement-breakpoint
ALTER TABLE "ticketing_connections" ADD CONSTRAINT "ticketing_connections_webhook_registration_version_check" CHECK ("ticketing_connections"."webhook_registration_version" >= 0);