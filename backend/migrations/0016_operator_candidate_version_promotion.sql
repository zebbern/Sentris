ALTER TABLE "workflows" ADD COLUMN "current_version_id" uuid;--> statement-breakpoint
UPDATE "workflows" AS "workflow"
SET "current_version_id" = "latest_version"."id"
FROM (
	SELECT DISTINCT ON ("workflow_id") "id", "workflow_id"
	FROM "workflow_versions"
	ORDER BY "workflow_id", "version" DESC
) AS "latest_version"
WHERE "latest_version"."workflow_id" = "workflow"."id";--> statement-breakpoint
CREATE INDEX "workflows_current_version_id_idx" ON "workflows" USING btree ("current_version_id");
