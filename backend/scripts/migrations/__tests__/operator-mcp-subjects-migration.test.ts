import { describe, expect, it } from 'bun:test';
import { resolve } from 'node:path';

import { loadMigrationPlan } from '../../../src/database/migrations/checked-migrations';

const migrationsDir = resolve(__dirname, '../../../migrations');

describe('Operator MCP subject migration', () => {
  const migration = loadMigrationPlan(migrationsDir).migrations.find(
    (candidate) => candidate.tag === '0014_operator_mcp_subjects',
  );

  it('backfills existing run rows before enforcing the generalized subject columns', () => {
    expect(migration).toEqual(
      expect.objectContaining({
        idx: 14,
        fileName: '0014_operator_mcp_subjects.sql',
        checksum: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    );
    const sql = migration?.sql ?? '';
    const backfill = sql.indexOf(
      `UPDATE "mcp_invocations"\nSET "subject_kind" = 'run', "subject_id" = "run_id"`,
    );
    const enforceNotNull = sql.indexOf(
      'ALTER TABLE "mcp_invocations" ALTER COLUMN "subject_kind" SET NOT NULL',
    );
    const dropRunNotNull = sql.indexOf(
      'ALTER TABLE "mcp_invocations" ALTER COLUMN "run_id" DROP NOT NULL',
    );
    expect(backfill).toBeGreaterThan(-1);
    expect(enforceNotNull).toBeGreaterThan(backfill);
    expect(dropRunNotNull).toBeGreaterThan(enforceNotNull);
  });

  it('keeps run projection integrity while allowing null run IDs for Operator rows', () => {
    expect(migration?.schema.columns).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          tableName: 'mcp_invocations',
          columnName: 'subject_kind',
          notNull: true,
        }),
        expect.objectContaining({
          tableName: 'mcp_invocations',
          columnName: 'subject_id',
          notNull: true,
        }),
        expect.objectContaining({
          tableName: 'mcp_invocations',
          columnName: 'run_id',
          notNull: false,
        }),
      ]),
    );
    expect(migration?.schema.constraints).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'mcp_invocations_subject_kind_check' }),
        expect.objectContaining({ name: 'mcp_invocations_run_projection_check' }),
      ]),
    );
  });
});
