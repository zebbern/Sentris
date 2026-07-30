import { describe, expect, it } from 'bun:test';
import { resolve } from 'node:path';

import { loadMigrationPlan } from '../../../src/database/migrations/checked-migrations';

const migrationsDir = resolve(__dirname, '../../../migrations');

describe('Jira webhook registration durability migrations', () => {
  it('seals the registration state and shared issue lookup index into the schema migration', () => {
    const plan = loadMigrationPlan(migrationsDir);
    const migration = plan.migrations.find(
      (candidate) => candidate.tag === '0007_jira_webhook_registration_durability',
    );

    expect(migration?.sql).toContain(
      'ADD COLUMN "webhook_registration_status" varchar(16) DEFAULT \'unregistered\' NOT NULL',
    );
    expect(migration?.sql).toContain(
      'ADD COLUMN "webhook_registration_version" integer DEFAULT 0 NOT NULL',
    );
    expect(migration?.sql).toContain('CREATE INDEX "ticket_links_org_provider_external_id_idx"');
    expect(migration?.schema.indexes).toContainEqual(
      expect.objectContaining({
        tableName: 'ticket_links',
        name: 'ticket_links_org_provider_external_id_idx',
      }),
    );
  });

  it('atomically backfills eligible Jira connections and one deduped registration event', () => {
    const plan = loadMigrationPlan(migrationsDir);
    const migration = plan.migrations.find(
      (candidate) => candidate.tag === '0008_backfill_jira_webhook_registration',
    );

    expect(migration?.sql).toContain('UPDATE "ticketing_connections"');
    expect(migration?.sql).toContain('"webhook_registration_status" = \'pending\'');
    expect(migration?.sql).toContain('"webhook_registration_version" = 1');
    expect(migration?.sql).toContain('INSERT INTO "outbox_events"');
    expect(migration?.sql).toContain("'ticketing.jira.webhook.register.v1'");
    expect(migration?.sql).toContain(
      '\'ticketing.jira.webhook.register:\' || "id"::text || \':\' || "webhook_registration_version"::text',
    );
    expect(migration?.sql).toContain('ON CONFLICT ("dedupe_key") DO NOTHING');
  });
});
