import { describe, expect, it } from 'bun:test';
import {
  buildMigrationPlan,
  canonicalSnapshotHash,
  compareSchemaFingerprint,
  createMigrationArtifactManifest,
  emptySchemaFingerprint,
  runCheckedMigrations,
  validateMigrationManifestImmutablePrefix,
  validateLedgerPrefix,
  type AppliedMigration,
  type CheckedMigrationDatabase,
  type MigrationPlan,
  type SchemaFingerprint,
} from '../../../src/database/migrations/checked-migrations';

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
          type: 'bigserial',
          primaryKey: true,
          notNull: true,
        },
        email: {
          name: 'email',
          type: 'varchar(191)',
          primaryKey: false,
          notNull: true,
        },
        last_seen_at: {
          name: 'last_seen_at',
          type: 'timestamp',
          primaryKey: false,
          notNull: false,
        },
      },
    },
  },
};

const currentSnapshot = {
  ...baselineSnapshot,
  id: '22222222-2222-4222-8222-222222222222',
  prevId: baselineSnapshot.id,
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

function validInput() {
  const input = {
    journal: {
      version: '7',
      dialect: 'postgresql',
      entries: [
        {
          idx: 0,
          version: '7',
          when: 1,
          tag: '0000_v1_0_0',
          breakpoints: true,
        },
        {
          idx: 1,
          version: '7',
          when: 2,
          tag: '0001_current_schema',
          breakpoints: true,
        },
      ],
    },
    sqlFiles: new Map<string, string>([
      ['0000_v1_0_0.sql', 'create table users();--> statement-breakpoint\nselect 1;'],
      ['0001_current_schema.sql', 'create table audit_events();'],
    ]),
    snapshots: new Map<string, unknown>([
      ['0000_snapshot.json', baselineSnapshot],
      ['0001_snapshot.json', currentSnapshot],
    ]),
  };
  return {
    ...input,
    manifest: createMigrationArtifactManifest(input),
  };
}

function createPlan(): MigrationPlan {
  return buildMigrationPlan(validInput());
}

class FakeDatabase implements CheckedMigrationDatabase {
  readonly events: string[] = [];
  ledgerExists = false;
  ledger: AppliedMigration[] = [];
  schema: SchemaFingerprint = emptySchemaFingerprint();
  failStatement?: string;

  async acquireLock(): Promise<void> {
    this.events.push('lock');
  }

  async releaseLock(): Promise<void> {
    this.events.push('unlock');
  }

  async hasLedger(): Promise<boolean> {
    this.events.push('has-ledger');
    return this.ledgerExists;
  }

  async readLedger(): Promise<AppliedMigration[]> {
    this.events.push('read-ledger');
    return this.ledger;
  }

  async inspectPublicSchema(): Promise<SchemaFingerprint> {
    this.events.push('inspect-schema');
    return this.schema;
  }

  async begin(): Promise<void> {
    this.events.push('begin');
  }

  async createLedger(): Promise<void> {
    this.events.push('create-ledger');
  }

  async executeStatement(statement: string): Promise<void> {
    this.events.push(`execute:${statement}`);
    if (statement === this.failStatement) {
      throw new Error('statement failed');
    }
  }

  async recordMigration(migration: AppliedMigration): Promise<void> {
    this.events.push(`record:${migration.tag}`);
  }

  async commit(): Promise<void> {
    this.events.push('commit');
  }

  async rollback(): Promise<void> {
    this.events.push('rollback');
  }
}

describe('checked migration manifest', () => {
  it('requires an immutable artifact manifest rather than trusting files alone', () => {
    const { manifest: _manifest, ...input } = validInput();
    expect(() => buildMigrationPlan(input)).toThrow('Missing checked migration artifact manifest');
  });

  it('rejects SQL, snapshot, and canonical contract hash drift against the manifest', () => {
    const input = validInput();
    const manifest = createMigrationArtifactManifest(input);
    const hashFields = ['sqlSha256', 'snapshotSha256', 'contractSha256'] as const;

    for (const hashField of hashFields) {
      const driftedManifest = structuredClone(manifest);
      driftedManifest.entries[0]![hashField] = '0'.repeat(64);
      expect(
        () =>
          buildMigrationPlan({
            ...input,
            manifest: driftedManifest,
          }),
        hashField,
      ).toThrow(`Migration artifact manifest ${hashField} mismatch at idx 0`);
    }
  });

  it('hashes snapshot JSON canonically instead of depending on formatting or key order', () => {
    expect(canonicalSnapshotHash({ z: 1, a: { b: 2 } })).toBe(
      '13bf451a28599eb77ebb813c6b754a9cb470a7dc848ccf246254095682b78894',
    );
    expect(canonicalSnapshotHash({ a: { b: 2 }, z: 1 })).toBe(
      '13bf451a28599eb77ebb813c6b754a9cb470a7dc848ccf246254095682b78894',
    );
  });

  it('allows generation to append a sealed suffix but rejects any mutation of the sealed prefix', () => {
    const input = validInput();
    const fullManifest = createMigrationArtifactManifest(input);
    const previousManifest = {
      ...fullManifest,
      entries: fullManifest.entries.slice(0, 1),
    };

    expect(() =>
      validateMigrationManifestImmutablePrefix(previousManifest, fullManifest),
    ).not.toThrow();

    const rewrittenPrefix = structuredClone(fullManifest);
    rewrittenPrefix.entries[0]!.snapshotSha256 = 'f'.repeat(64);
    expect(() =>
      validateMigrationManifestImmutablePrefix(previousManifest, rewrittenPrefix),
    ).toThrow('Generated migrations rewrote sealed manifest entry at idx 0');
  });

  it('builds contiguous migrations with deterministic checksums and statements', () => {
    const input = validInput();
    input.sqlFiles.set('0000_v1_0_0.sql', 'abc');
    input.manifest = createMigrationArtifactManifest(input);

    const plan = buildMigrationPlan(input);

    expect(plan.migrations.map(({ idx, tag }) => ({ idx, tag }))).toEqual([
      { idx: 0, tag: '0000_v1_0_0' },
      { idx: 1, tag: '0001_current_schema' },
    ]);
    expect(plan.migrations[0]?.checksum).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
    expect(plan.migrations[0]?.statements).toEqual(['abc']);
  });

  it('canonicalizes line endings before checksumming across operating systems', () => {
    const lfInput = validInput();
    lfInput.sqlFiles.set('0000_v1_0_0.sql', 'select 1;\nselect 2;\n');
    lfInput.manifest = createMigrationArtifactManifest(lfInput);
    const crlfInput = validInput();
    crlfInput.sqlFiles.set('0000_v1_0_0.sql', 'select 1;\r\nselect 2;\r\n');
    crlfInput.manifest = createMigrationArtifactManifest(crlfInput);

    const lfMigration = buildMigrationPlan(lfInput).migrations[0]!;
    const crlfMigration = buildMigrationPlan(crlfInput).migrations[0]!;

    expect(crlfMigration.checksum).toBe(lfMigration.checksum);
    expect(crlfMigration.sql).toBe(lfMigration.sql);
  });

  it('rejects non-contiguous journal indexes', () => {
    const input = validInput();
    input.journal.entries[1]!.idx = 2;

    expect(() => buildMigrationPlan(input)).toThrow(
      'Migration journal must be contiguous: expected idx 1, received 2',
    );
  });

  it('rejects duplicate migration tags', () => {
    const input = validInput();
    input.journal.entries[1]!.tag = '0000_v1_0_0';

    expect(() => buildMigrationPlan(input)).toThrow('Duplicate migration tag: 0000_v1_0_0');
  });

  it('rejects referenced migrations with no SQL file', () => {
    const input = validInput();
    input.sqlFiles.delete('0001_current_schema.sql');

    expect(() => buildMigrationPlan(input)).toThrow(
      'Migration journal references missing SQL file: 0001_current_schema.sql',
    );
  });

  it('rejects SQL files that are absent from the journal', () => {
    const input = validInput();
    input.sqlFiles.set('0002_untracked.sql', 'select 2;');

    expect(() => buildMigrationPlan(input)).toThrow(
      'Unreferenced migration SQL file: 0002_untracked.sql',
    );
  });

  it('rejects snapshot files that are absent from the journal', () => {
    const input = validInput();
    input.snapshots.set('0002_snapshot.json', currentSnapshot);

    expect(() => buildMigrationPlan(input)).toThrow(
      'Unreferenced migration snapshot: meta/0002_snapshot.json',
    );
  });

  it('rejects a snapshot that forks from the sealed snapshot chain', () => {
    const input = validInput();
    input.snapshots.set('0001_snapshot.json', {
      ...currentSnapshot,
      prevId: '33333333-3333-4333-8333-333333333333',
    });

    expect(() => createMigrationArtifactManifest(input)).toThrow(
      'Migration snapshot chain mismatch at idx 1',
    );
  });
});

describe('migration ledger validation', () => {
  it('accepts only an exact applied prefix and returns the next index', () => {
    const plan = createPlan();

    expect(validateLedgerPrefix(plan, [])).toBe(0);
    expect(
      validateLedgerPrefix(plan, [
        {
          idx: 0,
          tag: plan.migrations[0]!.tag,
          checksum: plan.migrations[0]!.checksum,
        },
      ]),
    ).toBe(1);
  });

  it.each([
    {
      name: 'gapped',
      rows: [{ idx: 1, tag: '0001_current_schema', checksum: 'irrelevant' }],
      message: 'Migration ledger is gapped: expected idx 0, received 1',
    },
    {
      name: 'unknown',
      rows: [{ idx: 0, tag: '0000_unknown', checksum: 'irrelevant' }],
      message: 'Migration ledger tag mismatch at idx 0',
    },
    {
      name: 'checksum-drifted',
      rows: [{ idx: 0, tag: '0000_v1_0_0', checksum: 'changed' }],
      message: 'Migration checksum drift at idx 0 (0000_v1_0_0)',
    },
    {
      name: 'ahead of code',
      rows: [
        { idx: 0, tag: '0000_v1_0_0', checksum: 'irrelevant' },
        { idx: 1, tag: '0001_current_schema', checksum: 'irrelevant' },
        { idx: 2, tag: '0002_unknown', checksum: 'irrelevant' },
      ],
      message: 'Migration ledger contains unknown idx 2',
    },
  ])('rejects $name history', ({ rows, message }) => {
    const plan = createPlan();
    if (rows[0]?.tag === plan.migrations[0]?.tag && rows[0]?.checksum === 'irrelevant') {
      rows[0].checksum = plan.migrations[0].checksum;
    }
    if (rows[1]?.tag === plan.migrations[1]?.tag && rows[1]?.checksum === 'irrelevant') {
      rows[1].checksum = plan.migrations[1].checksum;
    }

    expect(() => validateLedgerPrefix(plan, rows)).toThrow(message);
  });
});

describe('snapshot schema fingerprints', () => {
  it('normalizes snapshot types and reports exact differences', () => {
    const plan = createPlan();
    const expected = plan.migrations[0]!.schema;

    expect(expected).toEqual({
      tables: ['public.users'],
      columns: [
        {
          schemaName: 'public',
          tableName: 'users',
          columnName: 'email',
          dataType: 'character varying(191)',
          dataTypeSchema: null,
          notNull: true,
          defaultExpression: null,
          generatedExpression: null,
          identity: null,
          serial: false,
        },
        {
          schemaName: 'public',
          tableName: 'users',
          columnName: 'id',
          dataType: 'bigint',
          dataTypeSchema: null,
          notNull: true,
          defaultExpression: null,
          generatedExpression: null,
          identity: null,
          serial: true,
        },
        {
          schemaName: 'public',
          tableName: 'users',
          columnName: 'last_seen_at',
          dataType: 'timestamp without time zone',
          dataTypeSchema: null,
          notNull: false,
          defaultExpression: null,
          generatedExpression: null,
          identity: null,
          serial: false,
        },
      ],
      constraints: [
        {
          schemaName: 'public',
          tableName: 'users',
          name: 'users_pkey',
          type: 'primaryKey',
          columns: ['id'],
          nullsNotDistinct: null,
          expression: null,
          referencedSchemaName: null,
          referencedTableName: null,
          referencedColumns: [],
          onUpdate: null,
          onDelete: null,
        },
      ],
      indexes: [],
      enums: [],
      sequences: [],
      schemas: [],
      views: [],
      policies: [],
      roles: [],
      rlsEnabledTables: [],
    });
    expect(compareSchemaFingerprint(expected, expected)).toEqual([]);
    expect(
      compareSchemaFingerprint(expected, {
        ...expected,
        columns: expected.columns.slice(1),
      }),
    ).toEqual(['missing public.users.email character varying(191) NOT NULL']);
    expect(
      compareSchemaFingerprint(expected, {
        ...expected,
        tables: [...expected.tables, 'public.empty_table'],
        columns: [
          ...expected.columns,
          {
            schemaName: 'public',
            tableName: 'users',
            columnName: 'display_name',
            dataType: 'text',
            dataTypeSchema: null,
            notNull: false,
            defaultExpression: null,
            generatedExpression: null,
            identity: null,
            serial: false,
          },
        ],
      }),
    ).toEqual([
      'unexpected public.users.display_name text NULL',
      'unexpected table public.empty_table',
    ]);
    expect(
      compareSchemaFingerprint(expected, {
        ...expected,
        tables: [],
      }),
    ).toEqual(['missing table public.users']);
  });
});

describe('checked migration orchestration', () => {
  it('applies every migration to an empty database in its own transaction', async () => {
    const database = new FakeDatabase();
    const plan = createPlan();

    const result = await runCheckedMigrations({ database, plan });

    expect(result).toEqual({ adopted: false, applied: ['0000_v1_0_0', '0001_current_schema'] });
    expect(database.events).toEqual([
      'lock',
      'has-ledger',
      'inspect-schema',
      'begin',
      'create-ledger',
      'execute:create table users();',
      'execute:select 1;',
      'record:0000_v1_0_0',
      'commit',
      'begin',
      'create-ledger',
      'execute:create table audit_events();',
      'record:0001_current_schema',
      'commit',
      'unlock',
    ]);
  });

  it('adopts only an exact v1.0.0 schema, records the baseline, then applies the delta', async () => {
    const database = new FakeDatabase();
    const plan = createPlan();
    database.schema = plan.migrations[0]!.schema;

    const result = await runCheckedMigrations({
      database,
      plan,
      adoptVersion: 'v1.0.0',
    });

    expect(result).toEqual({ adopted: true, applied: ['0001_current_schema'] });
    expect(database.events).toEqual([
      'lock',
      'has-ledger',
      'inspect-schema',
      'begin',
      'create-ledger',
      'record:0000_v1_0_0',
      'commit',
      'begin',
      'create-ledger',
      'execute:create table audit_events();',
      'record:0001_current_schema',
      'commit',
      'unlock',
    ]);
  });

  it('refuses a non-empty database unless explicit adoption is requested', async () => {
    const database = new FakeDatabase();
    database.schema = createPlan().migrations[0]!.schema;

    await expect(runCheckedMigrations({ database, plan: createPlan() })).rejects.toThrow(
      'Database has no checked migration ledger and is not empty',
    );
    expect(database.events.at(-1)).toBe('unlock');
  });

  it.each([
    {
      name: 'empty',
      schema: emptySchemaFingerprint(),
      message: 'Cannot adopt v1.0.0 into an empty database',
    },
    {
      name: 'current',
      schemaPlanIndex: 1,
      message: 'Database schema does not exactly match v1.0.0',
    },
    {
      name: 'arbitrary',
      schema: {
        ...emptySchemaFingerprint(),
        tables: ['public.other'],
        columns: [
          {
            schemaName: 'public',
            tableName: 'other',
            columnName: 'id',
            dataType: 'uuid',
            dataTypeSchema: null,
            notNull: true,
            defaultExpression: null,
            generatedExpression: null,
            identity: null,
            serial: false,
          },
        ],
      },
      message: 'Database schema does not exactly match v1.0.0',
    },
  ])('refuses $name schema adoption', async ({ schema, schemaPlanIndex, message }) => {
    const plan = createPlan();
    const database = new FakeDatabase();
    database.schema = schema ?? plan.migrations[schemaPlanIndex!]!.schema;

    await expect(runCheckedMigrations({ database, plan, adoptVersion: 'v1.0.0' })).rejects.toThrow(
      message,
    );
    expect(database.events.at(-1)).toBe('unlock');
  });

  it('rejects adoption when a ledger already exists', async () => {
    const plan = createPlan();
    const database = new FakeDatabase();
    database.ledgerExists = true;
    database.ledger = [
      {
        idx: 0,
        tag: plan.migrations[0]!.tag,
        checksum: plan.migrations[0]!.checksum,
      },
    ];

    await expect(runCheckedMigrations({ database, plan, adoptVersion: 'v1.0.0' })).rejects.toThrow(
      '--adopt v1.0.0 is valid only when no migration ledger exists',
    );
    expect(database.events.at(-1)).toBe('unlock');
  });

  it('rolls back only the failing migration and always releases the lock', async () => {
    const database = new FakeDatabase();
    database.failStatement = 'create table audit_events();';

    await expect(runCheckedMigrations({ database, plan: createPlan() })).rejects.toThrow(
      'statement failed',
    );

    expect(database.events.slice(-4)).toEqual([
      'create-ledger',
      'execute:create table audit_events();',
      'rollback',
      'unlock',
    ]);
    expect(database.events.filter((event) => event === 'commit')).toHaveLength(1);
  });
});
