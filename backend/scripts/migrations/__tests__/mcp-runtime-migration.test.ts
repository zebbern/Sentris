import { describe, expect, it } from 'bun:test';
import { resolve } from 'node:path';

import { loadMigrationPlan } from '../../../src/database/migrations/checked-migrations';

const migrationsDir = resolve(__dirname, '../../../migrations');

describe('MCP runtime persistence migration', () => {
  const plan = loadMigrationPlan(migrationsDir);
  const migration = plan.migrations.find(
    (candidate) => candidate.tag === '0010_mcp_runtime_persistence',
  );

  it('is a checked, additive artifact containing only the four MCP runtime tables', () => {
    expect(migration).toEqual(
      expect.objectContaining({
        idx: 10,
        fileName: '0010_mcp_runtime_persistence.sql',
        checksum: expect.stringMatching(/^[a-f0-9]{64}$/),
        snapshotChecksum: expect.stringMatching(/^[a-f0-9]{64}$/),
        contractChecksum: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    );

    const createdTables = [...(migration?.sql.matchAll(/CREATE TABLE "([^"]+)"/g) ?? [])]
      .map((match) => match[1])
      .sort();
    expect(createdTables).toEqual([
      'mcp_capability_grants',
      'mcp_capability_snapshots',
      'mcp_invocation_attempts',
      'mcp_invocations',
    ]);
    expect(migration?.sql).not.toMatch(/^(?:DROP|TRUNCATE|DELETE\s+FROM|UPDATE)\b/im);
  });

  it('keeps one immutable snapshot per grant and unique numbered attempts', () => {
    expect(migration?.schema.constraints).toContainEqual(
      expect.objectContaining({
        tableName: 'mcp_capability_snapshots',
        type: 'unique',
        columns: ['capability_grant_id'],
      }),
    );
    expect(migration?.schema.indexes).toContainEqual(
      expect.objectContaining({
        tableName: 'mcp_invocation_attempts',
        name: 'mcp_invocation_attempts_invocation_attempt_idx',
        isUnique: true,
        columns: [
          expect.objectContaining({ expression: 'invocation_id' }),
          expect.objectContaining({ expression: 'attempt_number' }),
        ],
      }),
    );
  });

  it('restricts every runtime foreign key and records required query indexes', () => {
    const runtimeForeignKeys = migration?.schema.constraints.filter(
      (constraint) =>
        constraint.type === 'foreignKey' &&
        constraint.tableName.startsWith('mcp_') &&
        ['mcp_capability_grants', 'mcp_capability_snapshots', 'mcp_invocations'].includes(
          constraint.referencedTableName ?? '',
        ),
    );
    expect(runtimeForeignKeys).toHaveLength(4);
    expect(runtimeForeignKeys?.every((constraint) => constraint.onDelete === 'restrict')).toBe(
      true,
    );

    expect(migration?.schema.indexes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'mcp_invocations_run_created_at_idx' }),
        expect.objectContaining({ name: 'mcp_invocations_organization_created_at_idx' }),
        expect.objectContaining({ name: 'mcp_invocations_status_updated_at_idx' }),
        expect.objectContaining({ name: 'mcp_invocation_attempts_status_idx' }),
      ]),
    );
  });

  it('enforces lowercase hashes and the invocation state-machine domains', () => {
    const checks = migration?.schema.constraints.filter(
      (constraint) => constraint.type === 'check',
    );
    expect(checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'mcp_capability_grants_authority_key_check',
        }),
        expect.objectContaining({
          name: 'mcp_capability_snapshots_config_fingerprint_check',
        }),
        expect.objectContaining({
          name: 'mcp_invocations_request_hash_check',
        }),
        expect.objectContaining({ name: 'mcp_invocations_status_check' }),
        expect.objectContaining({ name: 'mcp_invocations_current_attempt_number_check' }),
        expect.objectContaining({ name: 'mcp_invocation_attempts_status_check' }),
        expect.objectContaining({ name: 'mcp_invocation_attempts_attempt_number_check' }),
        expect.objectContaining({ name: 'mcp_invocation_attempts_destination_check' }),
        expect.objectContaining({ name: 'mcp_invocation_attempts_retry_policy_check' }),
      ]),
    );
    expect(migration?.sql.match(/~ '\^\[a-f0-9\]\{64\}\$'/g)).toHaveLength(3);

    const invocationStatus = checks?.find(
      (constraint) => constraint.name === 'mcp_invocations_status_check',
    )?.expression;
    const attemptStatus = checks?.find(
      (constraint) => constraint.name === 'mcp_invocation_attempts_status_check',
    )?.expression;
    for (const status of [
      'planned',
      'prepared',
      'dispatched',
      'completed',
      'failed',
      'ambiguous',
      'cancelled',
    ]) {
      expect(invocationStatus).toContain(`'${status}'`);
      expect(attemptStatus).toContain(`'${status}'`);
    }
  });
});
