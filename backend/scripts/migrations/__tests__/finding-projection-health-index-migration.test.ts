import { describe, expect, it } from 'bun:test';
import { resolve } from 'node:path';

import { loadMigrationPlan } from '../../../src/database/migrations/checked-migrations';

const migrationsDir = resolve(__dirname, '../../../migrations');

describe('finding projection health index migration', () => {
  it('seals the tenant and update-time index into the authoritative migration plan', () => {
    const plan = loadMigrationPlan(migrationsDir);
    const migration = plan.migrations.find(
      (candidate) => candidate.tag === '0006_finding_projection_health_index',
    );

    expect(migration?.sql).toContain(
      'CREATE INDEX "finding_triage_org_updated_at_idx" ON "finding_triage" USING btree ("organization_id","updated_at")',
    );
    expect(migration?.schema.indexes).toContainEqual(
      expect.objectContaining({
        schemaName: 'public',
        tableName: 'finding_triage',
        name: 'finding_triage_org_updated_at_idx',
        isUnique: false,
        method: 'btree',
        columns: [
          expect.objectContaining({ expression: 'organization_id', asc: true }),
          expect.objectContaining({ expression: 'updated_at', asc: true }),
        ],
      }),
    );
    expect(() => loadMigrationPlan(migrationsDir)).not.toThrow();
  });
});
