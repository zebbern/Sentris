import { describe, expect, it } from 'bun:test';
import { resolve } from 'node:path';

import { loadMigrationPlan } from '../../../src/database/migrations/checked-migrations';

const migrationsDir = resolve(__dirname, '../../../migrations');

describe('platform readiness integrity migration', () => {
  it('seals the audit, notification, OAuth ownership, and telemetry retention schema', () => {
    const plan = loadMigrationPlan(migrationsDir);
    const migration = plan.migrations.find(
      (candidate) => candidate.tag === '0009_platform_readiness_integrity',
    );

    expect(migration?.sql).toContain(
      'ALTER TABLE "integration_provider_configs" DROP CONSTRAINT "integration_provider_configs_pkey"',
    );
    expect(migration?.sql).not.toContain('<constraint_name>');
    expect(migration?.sql).toContain(
      'ALTER TABLE "audit_logs" ADD COLUMN "correlation_id" varchar(191)',
    );
    expect(migration?.sql).toContain(
      'ALTER TABLE "integration_oauth_states" ADD COLUMN "organization_id" varchar(191)',
    );
    expect(migration?.sql).toContain(
      'ALTER TABLE "integration_provider_configs" ADD COLUMN "organization_id" varchar(191)',
    );
    expect(migration?.sql).toContain(
      'ALTER TABLE "integration_tokens" ADD COLUMN "organization_id" varchar(191)',
    );
    expect(migration?.sql).toContain(
      'ALTER TABLE "notification_deliveries" ADD COLUMN "sending_started_at" timestamp with time zone',
    );
    expect(migration?.sql).toContain('UNIQUE NULLS NOT DISTINCT("organization_id","provider")');
    expect(migration?.sql).toContain(
      'UNIQUE NULLS NOT DISTINCT("organization_id","user_id","provider")',
    );
  });

  it('adds bounded cleanup indexes without rewriting legacy tenant ownership', () => {
    const plan = loadMigrationPlan(migrationsDir);
    const migration = plan.migrations.find(
      (candidate) => candidate.tag === '0009_platform_readiness_integrity',
    );

    expect(migration?.sql).toContain(
      'CREATE INDEX "notification_deliveries_resolved_retention_idx" ON "notification_deliveries" USING btree ("created_at","id") WHERE "notification_deliveries"."status" IN (\'sent\', \'failed\')',
    );
    expect(migration?.sql).toContain(
      'CREATE INDEX "outbox_events_telemetry_retention_idx" ON "outbox_events" USING btree ("event_type","created_at","id") WHERE "outbox_events"."status" = \'completed\' AND "outbox_events"."event_type" IN (\'telemetry.kafka.ingested.v1\', \'telemetry.kafka.publish.v1\')',
    );
    expect(migration?.sql).not.toMatch(
      /UPDATE\s+"?(integration_tokens|integration_oauth_states|integration_provider_configs)"?/i,
    );
    expect(migration?.schema.indexes).toContainEqual(
      expect.objectContaining({
        tableName: 'notification_deliveries',
        name: 'notification_deliveries_resolved_retention_idx',
      }),
    );
    expect(migration?.schema.indexes).toContainEqual(
      expect.objectContaining({
        tableName: 'outbox_events',
        name: 'outbox_events_telemetry_retention_idx',
      }),
    );
  });
});
