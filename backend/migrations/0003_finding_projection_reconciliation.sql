CREATE TABLE "finding_projection_reconciliation" (
	"organization_id" varchar(191) PRIMARY KEY NOT NULL,
	"cursor" varchar(512),
	"cycle_started_at" timestamp with time zone,
	"cycle_cutoff" timestamp with time zone,
	"checked" integer DEFAULT 0 NOT NULL,
	"repaired" integer DEFAULT 0 NOT NULL,
	"failed" integer DEFAULT 0 NOT NULL,
	"last_completed_at" timestamp with time zone,
	"reconciled_through" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "finding_projection_reconciliation_counters_check" CHECK ("finding_projection_reconciliation"."checked" >= 0 AND "finding_projection_reconciliation"."repaired" >= 0 AND "finding_projection_reconciliation"."failed" >= 0)
);
