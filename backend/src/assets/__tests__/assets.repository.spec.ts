import { describe, it, expect } from 'bun:test';

import { AssetInventoryRepository } from '../assets.repository';
import type { NewAssetRecord } from '../../database/schema';

function makeDb() {
  const calls: { values: Record<string, unknown>; set: Record<string, unknown> }[] = [];
  const db = {
    insert: () => ({
      values: (v: Record<string, unknown>) => ({
        onConflictDoUpdate: (opts: { target: unknown; set: Record<string, unknown> }) => {
          calls.push({ values: v, set: opts.set });
          return Promise.resolve();
        },
      }),
    }),
  };
  return { db, calls };
}

const base: NewAssetRecord = {
  organizationId: 'org-1',
  scopeId: 'scope-1',
  assetType: 'subdomain',
  assetValue: 'a.example.com',
  firstSeenRunId: 'sentris-run-1',
  lastSeenRunId: 'sentris-run-1',
  sourceComponentId: 'sentris.subfinder.run',
  metadata: {},
};

describe('AssetInventoryRepository.upsertMany', () => {
  it('inserts each record and bumps ONLY last-seen fields on conflict', async () => {
    const { db, calls } = makeDb();
    const repo = new AssetInventoryRepository(db as never);

    await repo.upsertMany([base, { ...base, assetValue: 'b.example.com' }]);

    expect(calls).toHaveLength(2);
    // Insert carries firstSeen* (run id); the conflict `set` must NEVER touch firstSeen*.
    expect(calls[0]?.values.firstSeenRunId).toBe('sentris-run-1');
    expect('firstSeenAt' in (calls[0]?.set ?? {})).toBe(false);
    expect('firstSeenRunId' in (calls[0]?.set ?? {})).toBe(false);
    // Conflict `set` bumps last-seen + provenance + updatedAt only.
    expect(calls[0]?.set.lastSeenRunId).toBe('sentris-run-1');
    expect('lastSeenAt' in (calls[0]?.set ?? {})).toBe(true);
    expect(calls[0]?.set.sourceComponentId).toBe('sentris.subfinder.run');
    expect('updatedAt' in (calls[0]?.set ?? {})).toBe(true);
  });

  it('no-ops on an empty batch', async () => {
    const { db, calls } = makeDb();
    const repo = new AssetInventoryRepository(db as never);

    await repo.upsertMany([]);

    expect(calls).toHaveLength(0);
  });
});
