import { describe, expect, it } from 'bun:test';
import {
  executeMigrationCommand,
  parseMigrationCliArgs,
  type MigrationCommandConnection,
} from '../../run-migrations';
import {
  buildMigrationPlan,
  createMigrationArtifactManifest,
} from '../../../src/database/migrations/checked-migrations';

const snapshot = {
  id: '11111111-1111-4111-8111-111111111111',
  prevId: '00000000-0000-0000-0000-000000000000',
  version: '7',
  dialect: 'postgresql',
  tables: {
    'public.users': {
      name: 'users',
      schema: '',
      columns: {
        id: {
          name: 'id',
          type: 'uuid',
          primaryKey: true,
          notNull: true,
        },
      },
    },
  },
};

function createSingleMigrationPlan() {
  const input = {
    journal: {
      dialect: 'postgresql',
      entries: [{ idx: 0, tag: '0000_v1_0_0' }],
    },
    sqlFiles: new Map([['0000_v1_0_0.sql', 'select 1;']]),
    snapshots: new Map([['0000_snapshot.json', snapshot]]),
  };
  return buildMigrationPlan({
    ...input,
    manifest: createMigrationArtifactManifest(input),
  });
}

describe('migration CLI arguments', () => {
  it('accepts no arguments or the one explicit adoption form', () => {
    expect(parseMigrationCliArgs([])).toEqual({});
    expect(parseMigrationCliArgs(['--adopt', 'v1.0.0'])).toEqual({
      adoptVersion: 'v1.0.0',
    });
  });

  it.each([['--adopt'], ['--adopt', 'v2.0.0'], ['--force'], ['--adopt', 'v1.0.0', '--force']])(
    'rejects unsupported arguments: %p',
    (...args) => {
      expect(() => parseMigrationCliArgs(args)).toThrow(
        'Usage: bun run migration:run [--adopt v1.0.0]',
      );
    },
  );
});

describe('migration CLI execution', () => {
  it('prints the redacted resolved target before opening a database connection', async () => {
    const events: string[] = [];
    const plan = createSingleMigrationPlan();
    const connection: MigrationCommandConnection = {
      client: {
        async query(text: string) {
          events.push(`query:${text.split(/\s+/)[1]}`);
          if (text.includes('to_regclass')) {
            return { rows: [{ exists: true }] };
          }
          if (text.includes('select idx')) {
            return {
              rows: [
                {
                  idx: 0,
                  tag: plan.migrations[0]!.tag,
                  checksum: plan.migrations[0]!.checksum,
                },
              ],
            };
          }
          return { rows: [] };
        },
      },
      async close() {
        events.push('close');
      },
    };

    const result = await executeMigrationCommand({
      args: [],
      loadPlan: () => plan,
      resolveTarget: () => ({
        connectionString: 'postgresql://sentris:secret@localhost:5433/sentris_instance_4',
        redactedConnectionString: 'postgresql://sentris:***@localhost:5433/sentris_instance_4',
        databaseName: 'sentris_instance_4',
        source: 'env:SENTRIS_INSTANCE',
        ignoredDatabaseUrl: false,
      }),
      log(message) {
        events.push(`log:${message}`);
      },
      async openConnection() {
        events.push('open');
        return connection;
      },
    });

    expect(result).toEqual({ adopted: false, applied: [] });
    expect(events.slice(0, 3)).toEqual([
      'log:Target database: sentris_instance_4 via env:SENTRIS_INSTANCE',
      'log:Connection: postgresql://sentris:***@localhost:5433/sentris_instance_4',
      'open',
    ]);
    expect(events.at(-1)).toBe('close');
  });
});
