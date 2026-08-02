ALTER TABLE "workflows" ADD COLUMN "mutation_idempotency_key" varchar(191);--> statement-breakpoint
ALTER TABLE "workflow_versions" ADD COLUMN "mutation_idempotency_key" varchar(191);--> statement-breakpoint
ALTER TABLE "operator_turns" ADD COLUMN "actor_roles" jsonb DEFAULT '["MEMBER"]'::jsonb NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "workflows_mutation_idempotency_key_uidx" ON "workflows" USING btree ("mutation_idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_versions_mutation_idempotency_key_uidx" ON "workflow_versions" USING btree ("mutation_idempotency_key");