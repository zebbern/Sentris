import { describe, expect, it } from 'bun:test';
import type { ScriptDatabaseTarget } from '@sentris/local-runtime';
import {
  executeBrowserTargetFixtureMaintenance,
  resolveBrowserTargetFixtureDatabaseTarget,
  type BrowserTargetFixturePayload,
} from '../browser-target-fixture-maintenance';

const target: ScriptDatabaseTarget = {
  connectionString: 'postgresql://sentris:secret@postgres:5432/sentris',
  redactedConnectionString: 'postgresql://sentris:***@postgres:5432/sentris',
  databaseName: 'sentris',
  source: 'env:BROWSER_TARGET_FIXTURE_DATABASE_URL',
  ignoredDatabaseUrl: true,
};

const seedPayload: BrowserTargetFixturePayload = {
  action: 'seed',
  organizationId: 'local-dev',
  workflowId: '00000000-0000-4000-8000-000000000010',
  workflowVersionId: '00000000-0000-4000-8000-000000000011',
  workflowVersion: 1,
  scopeId: '00000000-0000-4000-8000-000000000012',
  runs: Array.from({ length: 51 }, (_, index) => ({
    runId: `sentris-browser-history-${index}`,
    createdAt: new Date(Date.UTC(2026, 6, 29, 12, index)).toISOString(),
  })),
  assets: [
    {
      id: '00000000-0000-4000-8000-000000000013',
      assetType: 'subdomain',
      assetValue: 'browser-fixture.example.com',
      sourceRunId: 'sentris-browser-history-50',
    },
    {
      id: '00000000-0000-4000-8000-000000000014',
      assetType: 'http-probe',
      assetValue: 'https://browser-fixture.example.com',
      sourceRunId: 'sentris-browser-history-49',
    },
  ],
};

function createRecordingDatabase(failOn?: string) {
  const calls: { text: string; values?: unknown[] }[] = [];
  const client = {
    async query(text: string, values?: unknown[]) {
      calls.push({ text, values });
      if (failOn && text.includes(failOn)) throw new Error('fixture query failed');
      return { rowCount: 1, rows: [] };
    },
    release() {},
  };
  let ended = false;
  return {
    calls,
    client,
    get ended() {
      return ended;
    },
    pool: {
      async connect() {
        return client;
      },
      async end() {
        ended = true;
      },
    },
  };
}

describe('browser target fixture database maintenance', () => {
  it('requires its script-specific database override and never falls back to an active instance', () => {
    expect(() =>
      resolveBrowserTargetFixtureDatabaseTarget({
        SENTRIS_INSTANCE: '7',
        DATABASE_URL: 'postgresql://ignored/active-app',
        SENTRIS_SCRIPT_DATABASE_URL: 'postgresql://ignored/generic-script',
      }),
    ).toThrow('BROWSER_TARGET_FIXTURE_DATABASE_URL must be set explicitly');

    expect(
      resolveBrowserTargetFixtureDatabaseTarget({
        SENTRIS_INSTANCE: '7',
        DATABASE_URL: 'postgresql://ignored/active-app',
        BROWSER_TARGET_FIXTURE_DATABASE_URL:
          'postgresql://sentris:secret@postgres:5432/browser_release',
      }),
    ).toMatchObject({
      databaseName: 'browser_release',
      source: 'env:BROWSER_TARGET_FIXTURE_DATABASE_URL',
      ignoredDatabaseUrl: true,
    });
  });

  it('prints the resolved target before parameterized seed mutations', async () => {
    const database = createRecordingDatabase();
    const events: string[] = [];

    await executeBrowserTargetFixtureMaintenance({
      payload: seedPayload,
      env: {
        DATABASE_URL: 'postgresql://ignored/active-app',
        BROWSER_TARGET_FIXTURE_DATABASE_URL: target.connectionString,
      },
      resolveTarget: () => target,
      log: (message) => events.push(`log:${message}`),
      createPool: () => database.pool,
      onQuery: (text) => events.push(`query:${text}`),
    });

    expect(events[0]).toBe(
      'log:Target database: sentris via env:BROWSER_TARGET_FIXTURE_DATABASE_URL (DATABASE_URL ignored; use a script-specific override to target another DB)',
    );
    expect(events[1]).toBe('log:Connection: postgresql://sentris:***@postgres:5432/sentris');
    expect(events[2]).toBe('query:BEGIN');
    expect(database.calls[0]).toEqual({ text: 'BEGIN', values: undefined });
    expect(database.calls.at(-1)).toEqual({ text: 'COMMIT', values: undefined });

    const runInserts = database.calls.filter((call) =>
      call.text.startsWith('INSERT INTO workflow_runs'),
    );
    const assetInserts = database.calls.filter((call) =>
      call.text.startsWith('INSERT INTO asset_inventory'),
    );
    expect(runInserts).toHaveLength(51);
    expect(assetInserts).toHaveLength(2);
    expect(runInserts[0].text).toContain('$1');
    expect(runInserts[0].text).not.toContain('sentris-browser-history-0');
    expect(runInserts[0].values).toContain('sentris-browser-history-0');
    expect(assetInserts[0].text).toContain('$4::asset_type');
    expect(assetInserts[0].text).not.toContain('browser-fixture.example.com');
    expect(assetInserts[0].values).toContain('browser-fixture.example.com');
    expect(database.ended).toBe(true);
  });

  it('deletes only supplied organization-bound identities with array parameters', async () => {
    const database = createRecordingDatabase();
    const findingId = `fo_v1_${'a'.repeat(64)}`;

    await executeBrowserTargetFixtureMaintenance({
      payload: {
        action: 'cleanup',
        organizationId: 'local-dev',
        runIds: ['seed-run-1', 'browser-run-1'],
        assetIds: ['00000000-0000-4000-8000-000000000020'],
        findingIds: [findingId],
      },
      env: { BROWSER_TARGET_FIXTURE_DATABASE_URL: target.connectionString },
      resolveTarget: () => target,
      log: () => {},
      createPool: () => database.pool,
    });

    const mutations = database.calls.slice(1, -1);
    expect(mutations.map((call) => call.text)).toEqual([
      expect.stringContaining(
        'DELETE FROM finding_triage WHERE organization_id = $1 AND finding_opensearch_id = ANY($2::text[])',
      ),
      expect.stringContaining(
        'DELETE FROM asset_inventory WHERE organization_id = $1 AND id = ANY($2::uuid[])',
      ),
      expect.stringContaining(
        'DELETE FROM workflow_runs WHERE organization_id = $1 AND run_id = ANY($2::text[])',
      ),
    ]);
    expect(mutations[0].values).toEqual(['local-dev', [findingId]]);
    expect(mutations[1].values).toEqual(['local-dev', ['00000000-0000-4000-8000-000000000020']]);
    expect(mutations[2].values).toEqual(['local-dev', ['seed-run-1', 'browser-run-1']]);
    expect(mutations.every((call) => !call.text.includes('local-dev'))).toBe(true);
  });

  it('rolls back and closes the pool when a mutation fails', async () => {
    const database = createRecordingDatabase('INSERT INTO asset_inventory');

    await expect(
      executeBrowserTargetFixtureMaintenance({
        payload: seedPayload,
        env: { BROWSER_TARGET_FIXTURE_DATABASE_URL: target.connectionString },
        resolveTarget: () => target,
        log: () => {},
        createPool: () => database.pool,
      }),
    ).rejects.toThrow('fixture query failed');

    expect(database.calls.at(-1)).toEqual({ text: 'ROLLBACK', values: undefined });
    expect(database.ended).toBe(true);
  });
});
