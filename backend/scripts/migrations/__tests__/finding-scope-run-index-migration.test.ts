import { describe, expect, it } from 'bun:test';
import { resolve } from 'node:path';

import { loadMigrationPlan } from '../../../src/database/migrations/checked-migrations';

const migrationsDir = resolve(__dirname, '../../../migrations');

describe('finding scope run ownership keyset index migration', () => {
  it('seals the tenant, scope, and run ID index into the authoritative migration plan', () => {
    const plan = loadMigrationPlan(migrationsDir);
    const migration = plan.migrations.find(
      (candidate) => candidate.tag === '0005_finding_scope_run_keyset_index',
    );

    expect(migration?.sql).toContain(
      'CREATE INDEX "workflow_runs_org_scope_run_id_idx" ON "workflow_runs" USING btree ("organization_id","scope_id","run_id")',
    );
    expect(migration?.schema.indexes).toContainEqual(
      expect.objectContaining({
        schemaName: 'public',
        tableName: 'workflow_runs',
        name: 'workflow_runs_org_scope_run_id_idx',
        isUnique: false,
        method: 'btree',
        columns: [
          expect.objectContaining({ expression: 'organization_id', asc: true }),
          expect.objectContaining({ expression: 'scope_id', asc: true }),
          expect.objectContaining({ expression: 'run_id', asc: true }),
        ],
      }),
    );
  });
});
