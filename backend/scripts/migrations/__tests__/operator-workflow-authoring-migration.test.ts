import { describe, expect, it } from 'bun:test';
import { resolve } from 'node:path';

import { loadMigrationPlan } from '../../../src/database/migrations/checked-migrations';

const migrationsDir = resolve(__dirname, '../../../migrations');

describe('Operator workflow authoring migration', () => {
  const migration = loadMigrationPlan(migrationsDir).migrations.find(
    (candidate) => candidate.tag === '0015_operator_workflow_authoring',
  );

  it('is a checked additive artifact with the authority and idempotency columns', () => {
    expect(migration).toEqual(
      expect.objectContaining({
        idx: 15,
        fileName: '0015_operator_workflow_authoring.sql',
        checksum: expect.stringMatching(/^[a-f0-9]{64}$/),
        snapshotChecksum: expect.stringMatching(/^[a-f0-9]{64}$/),
        contractChecksum: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    );
    expect(migration?.sql).not.toMatch(/^(?:DROP|TRUNCATE|DELETE\s+FROM|UPDATE)\b/im);
    expect(migration?.schema.columns).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          tableName: 'operator_turns',
          columnName: 'actor_roles',
          notNull: true,
        }),
        expect.objectContaining({
          tableName: 'workflows',
          columnName: 'mutation_idempotency_key',
          notNull: false,
        }),
        expect.objectContaining({
          tableName: 'workflow_versions',
          columnName: 'mutation_idempotency_key',
          notNull: false,
        }),
      ]),
    );
  });

  it('enforces one workflow mutation per idempotency key', () => {
    expect(migration?.schema.indexes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          tableName: 'workflows',
          name: 'workflows_mutation_idempotency_key_uidx',
          isUnique: true,
        }),
        expect.objectContaining({
          tableName: 'workflow_versions',
          name: 'workflow_versions_mutation_idempotency_key_uidx',
          isUnique: true,
        }),
      ]),
    );
    expect(migration?.sql).toContain(`DEFAULT '["MEMBER"]'::jsonb NOT NULL`);
  });
});
