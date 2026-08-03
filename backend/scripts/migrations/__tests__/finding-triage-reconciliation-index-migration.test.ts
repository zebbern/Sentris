import { describe, expect, it } from 'bun:test';
import { resolve } from 'node:path';

import { loadMigrationPlan } from '../../../src/database/migrations/checked-migrations';

const migrationsDir = resolve(__dirname, '../../../migrations');

describe('finding triage reconciliation keyset index migration', () => {
  it('seals the tenant and id keyset index into the authoritative migration plan', () => {
    const plan = loadMigrationPlan(migrationsDir);
    const migration = plan.migrations.find(
      (candidate) => candidate.tag === '0004_finding_triage_reconciliation_keyset_index',
    );

    expect(migration?.sql).toContain(
      'CREATE INDEX "finding_triage_org_id_idx" ON "finding_triage" USING btree ("organization_id","id")',
    );
    expect(migration?.schema.indexes).toContainEqual(
      expect.objectContaining({
        schemaName: 'public',
        tableName: 'finding_triage',
        name: 'finding_triage_org_id_idx',
        isUnique: false,
        method: 'btree',
        columns: [
          expect.objectContaining({ expression: 'organization_id', asc: true }),
          expect.objectContaining({ expression: 'id', asc: true }),
        ],
      }),
    );
  });
});
