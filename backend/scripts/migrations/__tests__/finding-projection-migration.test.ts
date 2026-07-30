import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { loadMigrationPlan } from '../../../src/database/migrations/checked-migrations';

const migrationsDir = resolve(__dirname, '../../../migrations');

describe('finding projection reconciliation checked migration', () => {
  it('seals the tenant-scoped state table into the authoritative migration plan', () => {
    const plan = loadMigrationPlan(migrationsDir);
    const migration = plan.migrations.find(
      (candidate) => candidate.tag === '0003_finding_projection_reconciliation',
    );

    expect(migration?.tag).toBe('0003_finding_projection_reconciliation');
    expect(migration?.sql).toContain('CREATE TABLE "finding_projection_reconciliation"');
    expect(migration?.sql).toContain('"organization_id" varchar(191) PRIMARY KEY NOT NULL');
    expect(migration?.sql).toContain('"reconciled_through" timestamp with time zone');
    expect(migration?.schema.tables).toContain('public.finding_projection_reconciliation');
  });

  it('keeps SQL, snapshot, canonical contract, and manifest hashes checked', () => {
    const manifest = JSON.parse(readFileSync(resolve(migrationsDir, 'manifest.json'), 'utf8')) as {
      entries: {
        tag: string;
        sqlSha256: string;
        snapshotSha256: string;
        contractSha256: string;
      }[];
    };
    const entry = manifest.entries.find(
      (candidate) => candidate.tag === '0003_finding_projection_reconciliation',
    );

    expect(entry?.tag).toBe('0003_finding_projection_reconciliation');
    expect(entry?.sqlSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(entry?.snapshotSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(entry?.contractSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(() => loadMigrationPlan(migrationsDir)).not.toThrow();
  });
});
