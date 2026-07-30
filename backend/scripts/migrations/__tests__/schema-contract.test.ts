import { describe, expect, it } from 'bun:test';
import {
  compareSchemaFingerprint,
  normalizeSchemaExpression,
  schemaFingerprintFromSnapshot,
} from '../../../src/database/migrations/checked-migrations';

const completeSnapshot = {
  version: '7',
  dialect: 'postgresql',
  schemas: { app: 'app' },
  tables: {
    'app.parents': {
      name: 'parents',
      schema: 'app',
      columns: {
        id: {
          name: 'id',
          type: 'bigserial',
          primaryKey: true,
          notNull: true,
        },
        code: {
          name: 'code',
          type: 'text',
          primaryKey: false,
          notNull: true,
          default: "'new'::text",
          isUnique: true,
          uniqueName: 'parents_code_unique',
          nullsNotDistinct: false,
        },
        slug: {
          name: 'slug',
          type: 'text',
          primaryKey: false,
          notNull: true,
          generated: { type: 'stored', as: 'lower(code)' },
        },
        aliases: {
          name: 'aliases',
          type: 'varchar(32)[]',
          primaryKey: false,
          notNull: true,
        },
        sequence_number: {
          name: 'sequence_number',
          type: 'integer',
          primaryKey: false,
          notNull: true,
          identity: {
            type: 'byDefault',
            name: 'parents_sequence_number_seq',
            schema: 'app',
            increment: '2',
            minValue: '2',
            maxValue: '2147483647',
            startWith: '2',
            cache: '1',
            cycle: false,
          },
        },
      },
      indexes: {
        parents_code_lower_idx: {
          name: 'parents_code_lower_idx',
          columns: [
            {
              expression: 'lower(code)',
              isExpression: true,
              asc: false,
              nulls: 'first',
            },
          ],
          isUnique: false,
          method: 'btree',
          concurrently: false,
          where: 'code IS NOT NULL',
          with: {},
        },
      },
      foreignKeys: {},
      compositePrimaryKeys: {},
      uniqueConstraints: {},
      policies: {
        parents_select: {
          name: 'parents_select',
          as: 'PERMISSIVE',
          for: 'SELECT',
          to: ['app_reader'],
          using: 'code <> current_user',
        },
      },
      checkConstraints: {
        parents_code_check: {
          name: 'parents_code_check',
          value: 'length(code) > 0',
        },
      },
      isRLSEnabled: true,
    },
    'app.children': {
      name: 'children',
      schema: 'app',
      columns: {
        parent_id: {
          name: 'parent_id',
          type: 'bigint',
          primaryKey: false,
          notNull: true,
        },
        label: {
          name: 'label',
          type: 'state',
          typeSchema: 'app',
          primaryKey: false,
          notNull: true,
        },
      },
      indexes: {},
      foreignKeys: {
        children_parent_fk: {
          name: 'children_parent_fk',
          tableFrom: 'children',
          tableTo: 'parents',
          schemaTo: 'app',
          columnsFrom: ['parent_id'],
          columnsTo: ['id'],
          onUpdate: 'cascade',
          onDelete: 'restrict',
        },
      },
      compositePrimaryKeys: {
        children_pk: {
          name: 'children_pk',
          columns: ['parent_id', 'label'],
        },
      },
      uniqueConstraints: {
        children_label_unique: {
          name: 'children_label_unique',
          columns: ['label'],
          nullsNotDistinct: true,
        },
      },
      policies: {},
      checkConstraints: {},
      isRLSEnabled: false,
    },
  },
  enums: {
    'app.state': {
      name: 'state',
      schema: 'app',
      values: ['new', 'done'],
    },
  },
  sequences: {
    'app.job_number': {
      name: 'job_number',
      schema: 'app',
      increment: '5',
      minValue: '5',
      maxValue: '9223372036854775807',
      startWith: '10',
      cache: '2',
      cycle: true,
    },
    'app.reverse_job_number': {
      name: 'reverse_job_number',
      schema: 'app',
      increment: '-1',
    },
  },
  roles: {
    app_reader: {
      name: 'app_reader',
      createDb: false,
      createRole: false,
      inherit: true,
    },
  },
  policies: {
    existing_table_policy: {
      name: 'existing_table_policy',
      schema: 'app',
      on: 'existing_table',
      as: 'RESTRICTIVE',
      for: 'ALL',
      to: ['app_reader'],
      withCheck: 'true',
    },
  },
  views: {
    'app.parent_codes': {
      name: 'parent_codes',
      schema: 'app',
      columns: {
        state: {
          name: 'state',
          type: 'state',
          typeSchema: 'app',
          primaryKey: false,
          notNull: false,
        },
        id: {
          name: 'id',
          type: 'bigint',
          primaryKey: false,
          notNull: false,
        },
      },
      definition: 'select state, id from app.parents',
      materialized: true,
      isExisting: false,
      with: {
        autovacuumEnabled: false,
        fillfactor: 80,
      },
      using: 'zheap',
      tablespace: 'fastspace',
      withNoData: true,
    },
  },
};

describe('complete PostgreSQL schema contract', () => {
  it('normalizes PostgreSQL casts without changing the default value', () => {
    expect(normalizeSchemaExpression("'free'::character varying")).toBe("'free'");
    expect(normalizeSchemaExpression("'2026-01-01 00:00:00+00'::timestamp with time zone")).toBe(
      "'2026-01-01 00:00:00+00'",
    );
    expect(normalizeSchemaExpression("'hello   ::text world'::text")).toBe(
      "'hello   ::text world'",
    );
    expect(normalizeSchemaExpression("email::text = 'user@example.com'::text")).toBe(
      "email::text = 'user@example.com'",
    );
    expect(normalizeSchemaExpression('"CaseSensitive" = "lowercase"')).toBe(
      '"CaseSensitive" = lowercase',
    );
  });

  it('captures every supported object represented by a Drizzle snapshot', () => {
    const fingerprint = schemaFingerprintFromSnapshot(completeSnapshot);

    expect(fingerprint.schemas).toEqual(['app']);
    expect(fingerprint.rlsEnabledTables).toEqual(['app.parents']);
    expect(fingerprint.columns.find((column) => column.columnName === 'id')).toMatchObject({
      dataType: 'bigint',
      serial: true,
      defaultExpression: null,
    });
    expect(fingerprint.columns.find((column) => column.columnName === 'code')).toMatchObject({
      defaultExpression: "'new'",
      serial: false,
    });
    expect(fingerprint.columns.find((column) => column.columnName === 'label')).toMatchObject({
      dataType: 'state',
      dataTypeSchema: 'app',
    });
    expect(fingerprint.columns.find((column) => column.columnName === 'slug')).toMatchObject({
      generatedExpression: 'lower(code)',
    });
    expect(fingerprint.columns.find((column) => column.columnName === 'aliases')).toMatchObject({
      dataType: 'character varying(32)[]',
    });
    expect(
      fingerprint.columns.find((column) => column.columnName === 'sequence_number')?.identity,
    ).toEqual({
      type: 'byDefault',
      name: 'parents_sequence_number_seq',
      schemaName: 'app',
      increment: '2',
      minValue: '2',
      maxValue: '2147483647',
      startWith: '2',
      cache: '1',
      cycle: false,
    });
    expect(fingerprint.constraints.map(({ type, name }) => `${type}:${name}`)).toEqual([
      'foreignKey:children_parent_fk',
      'primaryKey:children_pk',
      'unique:children_label_unique',
      'check:parents_code_check',
      'primaryKey:parents_pkey',
      'unique:parents_code_unique',
    ]);
    expect(fingerprint.indexes).toHaveLength(1);
    expect(fingerprint.enums).toEqual([
      {
        schemaName: 'app',
        name: 'state',
        values: ['new', 'done'],
      },
    ]);
    expect(fingerprint.sequences).toHaveLength(2);
    expect(fingerprint.sequences.find(({ name }) => name === 'reverse_job_number')).toMatchObject({
      increment: '-1',
      minValue: '-9223372036854775808',
      maxValue: '-1',
      startWith: '-1',
    });
    expect(fingerprint.policies).toHaveLength(2);
    expect(fingerprint.policies.find(({ name }) => name === 'existing_table_policy')).toMatchObject(
      {
        schemaName: 'app',
        tableName: 'existing_table',
      },
    );
    expect(fingerprint.roles).toHaveLength(1);
    expect(fingerprint.views).toEqual([
      {
        schemaName: 'app',
        name: 'parent_codes',
        materialized: true,
        definition: 'select state, id from app.parents',
        columns: [
          {
            name: 'state',
            dataType: 'state',
            dataTypeSchema: 'app',
            notNull: false,
          },
          {
            name: 'id',
            dataType: 'bigint',
            dataTypeSchema: null,
            notNull: false,
          },
        ],
        options: {
          autovacuumEnabled: 'false',
          fillfactor: '80',
          tablespace: 'fastspace',
          using: 'zheap',
        },
      },
    ]);
  });

  it('compares PostgreSQL-canonical predicates and JSONB defaults by meaning', () => {
    const expected = schemaFingerprintFromSnapshot({
      version: '7',
      dialect: 'postgresql',
      schemas: {},
      tables: {
        'public.events': {
          name: 'events',
          schema: '',
          columns: {
            id: {
              name: 'id',
              type: 'uuid',
              primaryKey: true,
              notNull: true,
            },
            status: {
              name: 'status',
              type: 'varchar(16)',
              primaryKey: false,
              notNull: true,
            },
            payload: {
              name: 'payload',
              type: 'jsonb',
              primaryKey: false,
              notNull: true,
              default: `'{"runtimeInputs":{},"nodeOverrides":{}}'::jsonb`,
            },
          },
          indexes: {
            events_status_idx: {
              name: 'events_status_idx',
              columns: [
                {
                  expression: 'status',
                  isExpression: false,
                  asc: true,
                  nulls: 'last',
                },
              ],
              isUnique: false,
              method: 'btree',
              concurrently: false,
              where: `events.status IN ('pending', 'completed')`,
              with: {},
            },
          },
          foreignKeys: {},
          compositePrimaryKeys: {},
          uniqueConstraints: {},
          policies: {},
          checkConstraints: {
            events_status_check: {
              name: 'events_status_check',
              value: `events.status IN ('pending', 'completed')`,
            },
          },
          isRLSEnabled: false,
        },
      },
      enums: {},
      sequences: {},
      roles: {},
      policies: {},
      views: {},
    });
    const actual = structuredClone(expected);
    actual.columns.find(({ columnName }) => columnName === 'payload')!.defaultExpression =
      `'{"nodeOverrides": {}, "runtimeInputs": {}}'`;
    actual.constraints.find(({ name }) => name === 'events_status_check')!.expression =
      `status::text = ANY (ARRAY['pending', 'completed']::text[])`;
    actual.constraints.find(({ name }) => name === 'events_status_check')!.columns = ['status'];
    actual.indexes.find(({ name }) => name === 'events_status_idx')!.where =
      `status::text = ANY (ARRAY['pending', 'completed']::text[])`;

    expect(compareSchemaFingerprint(expected, actual)).toEqual([]);
  });

  it('still detects a semantically meaningful cast change on a non-text column', () => {
    const expected = schemaFingerprintFromSnapshot({
      version: '7',
      dialect: 'postgresql',
      schemas: {},
      tables: {
        'public.counters': {
          name: 'counters',
          schema: '',
          columns: {
            count: {
              name: 'count',
              type: 'integer',
              primaryKey: false,
              notNull: true,
            },
          },
          indexes: {},
          foreignKeys: {},
          compositePrimaryKeys: {},
          uniqueConstraints: {},
          policies: {},
          checkConstraints: {
            counters_count_check: {
              name: 'counters_count_check',
              value: 'counters.count = 1',
            },
          },
          isRLSEnabled: false,
        },
      },
      enums: {},
      sequences: {},
      roles: {},
      policies: {},
      views: {},
    });
    const actual = structuredClone(expected);
    actual.constraints[0]!.expression = `count::text = '1'`;

    expect(compareSchemaFingerprint(expected, actual)).not.toEqual([]);
  });

  it('detects drift in every represented schema-contract category', () => {
    const expected = schemaFingerprintFromSnapshot(completeSnapshot);
    const categories = [
      'columns',
      'constraints',
      'indexes',
      'enums',
      'sequences',
      'schemas',
      'views',
      'policies',
      'roles',
      'rlsEnabledTables',
    ] as const;

    for (const category of categories) {
      const actual = structuredClone(expected);
      if (category === 'columns') {
        actual.columns[0]!.defaultExpression = "'drifted'";
      } else if (category === 'schemas' || category === 'rlsEnabledTables') {
        actual[category].push('drifted');
      } else {
        const entry = structuredClone(actual[category][0]!);
        entry.name = `${entry.name}_drifted`;
        (actual[category] as (typeof entry)[]).push(entry);
      }
      expect(compareSchemaFingerprint(expected, actual), category).not.toEqual([]);
    }
  });
});
