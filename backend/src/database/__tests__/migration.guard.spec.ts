import { describe, expect, it } from 'bun:test';
import { assertDatabaseMigrationsCurrent } from '../migration.guard';
import {
  buildMigrationPlan,
  createMigrationArtifactManifest,
  type AppliedMigration,
  type MigrationPlan,
} from '../migrations/checked-migrations';

function createPlan(): MigrationPlan {
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
  const input = {
    journal: {
      dialect: 'postgresql',
      entries: [
        { idx: 0, tag: '0000_v1_0_0' },
        { idx: 1, tag: '0001_current_schema' },
      ],
    },
    sqlFiles: new Map([
      ['0000_v1_0_0.sql', 'select 1;'],
      ['0001_current_schema.sql', 'select 2;'],
    ]),
    snapshots: new Map([
      ['0000_snapshot.json', snapshot],
      [
        '0001_snapshot.json',
        {
          ...snapshot,
          id: '22222222-2222-4222-8222-222222222222',
          prevId: snapshot.id,
        },
      ],
    ]),
  };
  return buildMigrationPlan({
    ...input,
    manifest: createMigrationArtifactManifest(input),
  });
}

function reader(ledger: AppliedMigration[] | null, plan = createPlan()) {
  return {
    async hasLedger() {
      return ledger !== null;
    },
    async readLedger() {
      return ledger ?? [];
    },
    async inspectPublicSchema() {
      return plan.migrations.at(-1)!.schema;
    },
  };
}

describe('database migration startup guard', () => {
  it('rejects a database with no checked migration ledger', async () => {
    await expect(assertDatabaseMigrationsCurrent(reader(null), createPlan())).rejects.toThrow(
      'Database has no checked migration ledger. Run `bun run migrate`',
    );
  });

  it('accepts a complete checksum-verified ledger', async () => {
    const plan = createPlan();
    const ledger = plan.migrations.map(({ idx, tag, checksum }) => ({ idx, tag, checksum }));

    await expect(assertDatabaseMigrationsCurrent(reader(ledger), plan)).resolves.toBe(2);
  });

  it('rejects an incomplete exact prefix', async () => {
    const plan = createPlan();
    const first = plan.migrations[0]!;

    await expect(
      assertDatabaseMigrationsCurrent(
        reader([{ idx: first.idx, tag: first.tag, checksum: first.checksum }]),
        plan,
      ),
    ).rejects.toThrow(
      'Database migration ledger is behind: 1 of 2 migrations applied. Run `bun run migrate`',
    );
  });

  it('rejects checksum drift instead of trusting a matching tag', async () => {
    const plan = createPlan();
    const ledger = plan.migrations.map(({ idx, tag, checksum }) => ({ idx, tag, checksum }));
    ledger[0]!.checksum = 'changed';

    await expect(assertDatabaseMigrationsCurrent(reader(ledger), plan)).rejects.toThrow(
      'Migration checksum drift at idx 0 (0000_v1_0_0)',
    );
  });

  it('rejects live schema drift even when the checksum ledger is current', async () => {
    const plan = createPlan();
    const ledger = plan.migrations.map(({ idx, tag, checksum }) => ({ idx, tag, checksum }));
    const schema = structuredClone(plan.migrations.at(-1)!.schema);
    schema.columns[0]!.dataType = 'text';
    const database = {
      ...reader(ledger, plan),
      async inspectPublicSchema() {
        return schema;
      },
    };

    await expect(assertDatabaseMigrationsCurrent(database, plan)).rejects.toThrow(
      'Database schema drift detected',
    );
  });
});
