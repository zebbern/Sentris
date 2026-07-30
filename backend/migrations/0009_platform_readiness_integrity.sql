DROP INDEX "integration_tokens_user_idx";--> statement-breakpoint
DROP INDEX "integration_tokens_user_provider_uidx";--> statement-breakpoint
ALTER TABLE "integration_provider_configs" DROP CONSTRAINT "integration_provider_configs_pkey";--> statement-breakpoint
ALTER TABLE "audit_logs" ADD COLUMN "correlation_id" varchar(191);--> statement-breakpoint
ALTER TABLE "integration_oauth_states" ADD COLUMN "organization_id" varchar(191);--> statement-breakpoint
ALTER TABLE "integration_provider_configs" ADD COLUMN "organization_id" varchar(191);--> statement-breakpoint
ALTER TABLE "integration_tokens" ADD COLUMN "organization_id" varchar(191);--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD COLUMN "sending_started_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "integration_tokens_org_user_idx" ON "integration_tokens" USING btree ("organization_id","user_id");--> statement-breakpoint
CREATE INDEX "notification_deliveries_resolved_retention_idx" ON "notification_deliveries" USING btree ("created_at","id") WHERE "notification_deliveries"."status" IN ('sent', 'failed');--> statement-breakpoint
CREATE INDEX "outbox_events_telemetry_retention_idx" ON "outbox_events" USING btree ("event_type","created_at","id") WHERE "outbox_events"."status" = 'completed' AND "outbox_events"."event_type" IN ('telemetry.kafka.ingested.v1', 'telemetry.kafka.publish.v1');--> statement-breakpoint
ALTER TABLE "integration_provider_configs" ADD CONSTRAINT "integration_provider_configs_org_provider_uidx" UNIQUE NULLS NOT DISTINCT("organization_id","provider");--> statement-breakpoint
ALTER TABLE "integration_tokens" ADD CONSTRAINT "integration_tokens_org_user_provider_uidx" UNIQUE NULLS NOT DISTINCT("organization_id","user_id","provider");
