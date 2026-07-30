WITH "eligible_connections" AS (
	UPDATE "ticketing_connections"
	SET
		"webhook_registration_status" = 'pending',
		"webhook_registration_version" = 1,
		"webhook_registered_at" = NULL,
		"updated_at" = now()
	WHERE
		"provider" = 'jira'
		AND "cloud_id" IS NOT NULL
		AND "webhook_secret" IS NOT NULL
		AND "webhook_registration_status" = 'unregistered'
		AND "webhook_registration_version" = 0
	RETURNING "id", "organization_id", "webhook_registration_version"
)
INSERT INTO "outbox_events" (
	"event_type",
	"organization_id",
	"aggregate_type",
	"aggregate_id",
	"dedupe_key",
	"payload",
	"max_attempts"
)
SELECT
	'ticketing.jira.webhook.register.v1',
	"organization_id",
	'ticketing_connection_webhook',
	"id"::text || ':' || "webhook_registration_version"::text,
	'ticketing.jira.webhook.register:' || "id"::text || ':' || "webhook_registration_version"::text,
	jsonb_build_object(
		'organizationId', "organization_id",
		'connectionId', "id"::text,
		'registrationVersion', "webhook_registration_version"
	),
	8
FROM "eligible_connections"
ON CONFLICT ("dedupe_key") DO NOTHING;
