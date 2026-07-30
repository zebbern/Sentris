import { describe, expect, it } from 'bun:test';
import {
  assertExplicitMigrationSmokeTarget,
  parseMigrationSmokeMode,
  runConcurrentMigrationSmoke,
  runMigrationSmoke,
} from '../../migration-smoke';
import {
  buildMigrationPlan,
  createMigrationArtifactManifest,
  emptySchemaFingerprint,
  type AppliedMigration,
  type CheckedMigrationDatabase,
  type MigrationPlan,
  type SchemaFingerprint,
} from '../../../src/database/migrations/checked-migrations';

function createPlan(): MigrationPlan {
  const baselineSnapshot = {
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
  const currentSnapshot = {
    id: '22222222-2222-4222-8222-222222222222',
    prevId: baselineSnapshot.id,
    version: '7',
    dialect: 'postgresql',
    tables: {
      ...baselineSnapshot.tables,
      'public.audit_events': {
        name: 'audit_events',
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
      ['0000_v1_0_0.sql', 'baseline'],
      ['0001_current_schema.sql', 'delta'],
    ]),
    snapshots: new Map([
      ['0000_snapshot.json', baselineSnapshot],
      ['0001_snapshot.json', currentSnapshot],
    ]),
  };
  return buildMigrationPlan({
    ...input,
    manifest: createMigrationArtifactManifest(input),
  });
}

class StatefulFakeDatabase implements CheckedMigrationDatabase {
  readonly events: string[] = [];
  ledgerExists = false;
  ledger: AppliedMigration[] = [];
  schema: SchemaFingerprint = emptySchemaFingerprint();

  constructor(private readonly plan: MigrationPlan) {}

  async acquireLock() {
    this.events.push('lock');
  }
  async releaseLock() {
    this.events.push('unlock');
  }
  async hasLedger() {
    this.events.push('has-ledger');
    return this.ledgerExists;
  }
  async readLedger() {
    this.events.push('read-ledger');
    return this.ledger;
  }
  async inspectPublicSchema() {
    this.events.push('inspect-schema');
    return this.schema;
  }
  async begin() {
    this.events.push('begin');
  }
  async createLedger() {
    this.events.push('create-ledger');
    this.ledgerExists = true;
  }
  async executeStatement(statement: string) {
    this.events.push(`execute:${statement}`);
    if (statement === 'baseline') {
      this.schema = this.plan.migrations[0]!.schema;
    }
    if (statement === 'delta') {
      this.schema = this.plan.migrations[1]!.schema;
    }
  }
  async recordMigration(migration: AppliedMigration) {
    this.events.push(`record:${migration.tag}`);
    this.ledger.push(migration);
  }
  async commit() {
    this.events.push('commit');
  }
  async rollback() {
    this.events.push('rollback');
  }
}

interface SharedMigrationState {
  ledgerExists: boolean;
  ledger: AppliedMigration[];
  schema: SchemaFingerprint;
  lockTail: Promise<void>;
}

class ConcurrentFakeDatabase implements CheckedMigrationDatabase {
  private releaseCurrentLock: (() => void) | undefined;

  constructor(
    private readonly plan: MigrationPlan,
    private readonly state: SharedMigrationState,
  ) {}

  async acquireLock() {
    const predecessor = this.state.lockTail;
    this.state.lockTail = new Promise<void>((resolve) => {
      this.releaseCurrentLock = resolve;
    });
    await predecessor;
  }

  async releaseLock() {
    this.releaseCurrentLock?.();
    this.releaseCurrentLock = undefined;
  }

  async hasLedger() {
    return this.state.ledgerExists;
  }

  async readLedger() {
    return this.state.ledger;
  }

  async inspectPublicSchema() {
    return this.state.schema;
  }

  async begin() {}

  async createLedger() {
    this.state.ledgerExists = true;
  }

  async executeStatement(statement: string) {
    if (statement === 'baseline') {
      this.state.schema = this.plan.migrations[0]!.schema;
    }
    if (statement === 'delta') {
      this.state.schema = this.plan.migrations[1]!.schema;
    }
  }

  async recordMigration(migration: AppliedMigration) {
    this.state.ledger.push(migration);
  }

  async commit() {}

  async rollback() {}
}

describe('migration smoke command safety', () => {
  it('accepts only the four named modes', () => {
    expect(parseMigrationSmokeMode(['fresh'])).toBe('fresh');
    expect(parseMigrationSmokeMode(['upgrade'])).toBe('upgrade');
    expect(parseMigrationSmokeMode(['parity'])).toBe('parity');
    expect(parseMigrationSmokeMode(['concurrent'])).toBe('concurrent');
    expect(() => parseMigrationSmokeMode([])).toThrow(
      'Usage: bun run migration:smoke:<fresh|upgrade|parity|concurrent>',
    );
  });

  it('requires an explicitly selected instance or smoke database URL', () => {
    expect(() => assertExplicitMigrationSmokeTarget({})).toThrow(
      'Set SENTRIS_INSTANCE or MIGRATION_SMOKE_DATABASE_URL explicitly',
    );
    expect(() => assertExplicitMigrationSmokeTarget({ SENTRIS_INSTANCE: '4' })).not.toThrow();
    expect(() =>
      assertExplicitMigrationSmokeTarget({
        MIGRATION_SMOKE_DATABASE_URL: 'postgresql://example.invalid/smoke',
      }),
    ).not.toThrow();
  });
});

describe('live migration smoke orchestration', () => {
  it('serializes two startup runners and reaches parity exactly once', async () => {
    const plan = createPlan();
    const state: SharedMigrationState = {
      ledgerExists: false,
      ledger: [],
      schema: emptySchemaFingerprint(),
      lockTail: Promise.resolve(),
    };
    const databases = [
      new ConcurrentFakeDatabase(plan, state),
      new ConcurrentFakeDatabase(plan, state),
    ] as const;

    const results = await runConcurrentMigrationSmoke({ databases, plan });

    expect(results.map((result) => result.applied.length).sort()).toEqual([
      0,
      plan.migrations.length,
    ]);
    expect(state.ledger).toEqual(
      plan.migrations.map(({ idx, tag, checksum }) => ({ idx, tag, checksum })),
    );
    expect(state.schema).toEqual(plan.migrations.at(-1)!.schema);
  });

  it('keeps parity mode read-only while checking ledger and current schema', async () => {
    const plan = createPlan();
    const database = new StatefulFakeDatabase(plan);
    database.ledgerExists = true;
    database.ledger = plan.migrations.map(({ idx, tag, checksum }) => ({
      idx,
      tag,
      checksum,
    }));
    database.schema = plan.migrations.at(-1)!.schema;

    await runMigrationSmoke({ mode: 'parity', database, plan });

    expect(database.events).toEqual(['has-ledger', 'read-ledger', 'inspect-schema']);
  });

  it('requires a genuinely empty database for fresh mode', async () => {
    const plan = createPlan();
    const database = new StatefulFakeDatabase(plan);
    database.schema = plan.migrations[0]!.schema;

    await expect(runMigrationSmoke({ mode: 'fresh', database, plan })).rejects.toThrow(
      'Fresh migration smoke requires an empty public schema with no ledger',
    );
    expect(database.events).toEqual(['has-ledger', 'inspect-schema']);
  });

  it('seeds v1 without a ledger, adopts it explicitly, applies the delta, and verifies parity', async () => {
    const plan = createPlan();
    const database = new StatefulFakeDatabase(plan);

    await runMigrationSmoke({ mode: 'upgrade', database, plan });

    expect(database.ledger).toEqual(
      plan.migrations.map(({ idx, tag, checksum }) => ({ idx, tag, checksum })),
    );
    expect(database.schema).toEqual(plan.migrations.at(-1)!.schema);
    expect(database.events).toContain('execute:baseline');
    expect(database.events).toContain('execute:delta');
    expect(database.events.at(-3)).toBe('has-ledger');
    expect(database.events.at(-2)).toBe('read-ledger');
    expect(database.events.at(-1)).toBe('inspect-schema');
  });
});
