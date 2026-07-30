import { describe, expect, it } from 'bun:test';
import { PostgresMigrationDatabase } from '../../../src/database/migrations/postgres-migration-database';

interface CapturedQuery {
  text: string;
  values: readonly unknown[] | undefined;
}

function createClient(responseFor: (text: string) => { rows: unknown[] } = () => ({ rows: [] })) {
  const queries: CapturedQuery[] = [];
  return {
    queries,
    client: {
      async query(text: string, values?: readonly unknown[]) {
        queries.push({ text, values });
        return responseFor(text);
      },
    },
  };
}

describe('PostgresMigrationDatabase', () => {
  it('uses a session advisory lock with a stable parameterized namespace', async () => {
    const { client, queries } = createClient();
    const database = new PostgresMigrationDatabase(client);

    await database.acquireLock();
    await database.releaseLock();

    expect(queries).toEqual([
      {
        text: 'select pg_advisory_lock(hashtext($1), hashtext($2))',
        values: ['sentris', 'checked-schema-migrations'],
      },
      {
        text: 'select pg_advisory_unlock(hashtext($1), hashtext($2))',
        values: ['sentris', 'checked-schema-migrations'],
      },
    ]);
  });

  it('checks ledger existence and reads ordered checksum history', async () => {
    const { client, queries } = createClient((text) => {
      if (text.includes('to_regclass')) {
        return { rows: [{ exists: true }] };
      }
      return {
        rows: [
          {
            idx: 0,
            tag: '0000_v1_0_0',
            checksum: 'abc',
          },
        ],
      };
    });
    const database = new PostgresMigrationDatabase(client);

    expect(await database.hasLedger()).toBe(true);
    expect(await database.readLedger()).toEqual([{ idx: 0, tag: '0000_v1_0_0', checksum: 'abc' }]);
    expect(queries[0]?.values).toEqual(['public.sentris_schema_migrations']);
    expect(queries[1]?.text).toContain('order by idx asc');
  });

  it('keeps ledger creation and recording inside caller-controlled transactions', async () => {
    const { client, queries } = createClient();
    const database = new PostgresMigrationDatabase(client);

    await database.begin();
    await database.createLedger();
    await database.executeStatement('create table example(id uuid);');
    await database.recordMigration({
      idx: 0,
      tag: '0000_v1_0_0',
      checksum: 'abc',
    });
    await database.commit();
    await database.rollback();

    expect(queries.map(({ text }) => text)).toEqual([
      'BEGIN',
      expect.stringContaining('create table if not exists public.sentris_schema_migrations'),
      'create table example(id uuid);',
      expect.stringContaining('insert into public.sentris_schema_migrations'),
      'COMMIT',
      'ROLLBACK',
    ]);
    expect(queries[3]?.values).toEqual([0, '0000_v1_0_0', 'abc']);
  });

  it('introspects the complete migration-owned PostgreSQL contract and excludes the ledger', async () => {
    const responseByQuery = (text: string) => {
      if (text.includes('sentris:schema-tables')) {
        return {
          rows: [
            {
              schemaName: 'app',
              tableName: 'users',
              rlsEnabled: true,
            },
          ],
        };
      }
      if (text.includes('sentris:schema-columns')) {
        return {
          rows: [
            {
              schemaName: 'app',
              tableName: 'users',
              columnName: 'id',
              dataType: 'bigint',
              dataTypeSchema: null,
              notNull: true,
              defaultExpression: null,
              generatedExpression: null,
              identityType: null,
              sequenceName: 'users_id_seq',
              sequenceSchemaName: 'app',
              sequenceIncrement: '1',
              sequenceMinValue: '1',
              sequenceMaxValue: '9223372036854775807',
              sequenceStartWith: '1',
              sequenceCache: '1',
              sequenceCycle: false,
              serial: true,
            },
          ],
        };
      }
      if (text.includes('sentris:schema-constraints')) {
        const arraysUsePortableJson = text.includes('jsonb_agg(attribute.attname::text');
        return {
          rows: [
            {
              schemaName: 'app',
              tableName: 'users',
              name: 'users_pkey',
              type: 'primaryKey',
              columns: arraysUsePortableJson ? ['id'] : '{id}',
              nullsNotDistinct: null,
              expression: null,
              referencedSchemaName: null,
              referencedTableName: null,
              referencedColumns: arraysUsePortableJson ? [] : '{}',
              onUpdate: null,
              onDelete: null,
            },
          ],
        };
      }
      if (text.includes('sentris:schema-indexes')) {
        return {
          rows: [
            {
              schemaName: 'app',
              tableName: 'users',
              name: 'users_email_idx',
              isUnique: false,
              method: 'btree',
              expression: 'lower(email)',
              isExpression: true,
              asc: true,
              nulls: 'last',
              opclass: null,
              position: 1,
              where: 'email IS NOT NULL',
              with: ['fillfactor=90'],
            },
          ],
        };
      }
      if (text.includes('sentris:schema-enums')) {
        const arraysUsePortableJson = text.includes('jsonb_agg(enum_row.enumlabel::text');
        return {
          rows: [
            {
              schemaName: 'app',
              name: 'user_state',
              values: arraysUsePortableJson ? ['active', 'disabled'] : '{active,disabled}',
            },
          ],
        };
      }
      if (text.includes('sentris:schema-sequences')) {
        return {
          rows: [
            {
              schemaName: 'app',
              name: 'ticket_number',
              increment: '1',
              minValue: '1',
              maxValue: '9223372036854775807',
              startWith: '1',
              cache: '1',
              cycle: false,
            },
          ],
        };
      }
      if (text.includes('sentris:schema-namespaces')) {
        return { rows: [{ name: 'app' }] };
      }
      if (text.includes('sentris:schema-views')) {
        return {
          rows: [
            {
              schemaName: 'app',
              name: 'active_users',
              materialized: true,
              definition: 'select state, id from app.users',
              columnName: 'state',
              dataType: 'app.user_state',
              dataTypeSchema: 'app',
              notNull: false,
              position: 1,
              options: ['autovacuum_enabled=false', 'fillfactor=80'],
              accessMethod: 'zheap',
              tablespace: 'fastspace',
            },
            {
              schemaName: 'app',
              name: 'active_users',
              materialized: true,
              definition: 'select state, id from app.users',
              columnName: 'id',
              dataType: 'bigint',
              dataTypeSchema: null,
              notNull: false,
              position: 2,
              options: ['autovacuum_enabled=false', 'fillfactor=80'],
              accessMethod: 'zheap',
              tablespace: 'fastspace',
            },
          ],
        };
      }
      if (text.includes('sentris:schema-policies')) {
        const arraysUsePortableJson = text.includes('jsonb_agg(role_name');
        return {
          rows: [
            {
              schemaName: 'app',
              tableName: 'users',
              name: 'users_select',
              permissive: 'PERMISSIVE',
              command: 'SELECT',
              roles: arraysUsePortableJson ? ['app_reader'] : '{app_reader}',
              using: 'true',
              withCheck: null,
            },
          ],
        };
      }
      if (text.includes('sentris:schema-roles')) {
        return {
          rows: [
            {
              name: 'app_reader',
              createDb: false,
              createRole: false,
              inherit: true,
            },
          ],
        };
      }
      return { rows: [] };
    };
    const { client, queries } = createClient(responseByQuery);
    const database = new PostgresMigrationDatabase(client);

    expect(
      await database.inspectPublicSchema({
        tables: [],
        columns: [],
        constraints: [],
        indexes: [],
        enums: [],
        sequences: [],
        schemas: [],
        views: [],
        policies: [],
        roles: [
          {
            name: 'app_reader',
            createDb: false,
            createRole: false,
            inherit: true,
          },
        ],
        rlsEnabledTables: [],
      }),
    ).toEqual({
      tables: ['app.users'],
      columns: [
        {
          schemaName: 'app',
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
      ],
      constraints: [
        {
          schemaName: 'app',
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
      indexes: [
        {
          schemaName: 'app',
          tableName: 'users',
          name: 'users_email_idx',
          isUnique: false,
          method: 'btree',
          columns: [
            {
              expression: 'lower(email)',
              isExpression: true,
              asc: true,
              nulls: 'last',
              opclass: null,
            },
          ],
          where: 'email IS NOT NULL',
          with: { fillfactor: '90' },
        },
      ],
      enums: [
        {
          schemaName: 'app',
          name: 'user_state',
          values: ['active', 'disabled'],
        },
      ],
      sequences: [
        {
          schemaName: 'app',
          name: 'ticket_number',
          increment: '1',
          minValue: '1',
          maxValue: '9223372036854775807',
          startWith: '1',
          cache: '1',
          cycle: false,
        },
      ],
      schemas: ['app'],
      views: [
        {
          schemaName: 'app',
          name: 'active_users',
          materialized: true,
          definition: 'select state, id from app.users',
          columns: [
            {
              name: 'state',
              dataType: 'user_state',
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
      ],
      policies: [
        {
          schemaName: 'app',
          tableName: 'users',
          name: 'users_select',
          permissive: true,
          command: 'SELECT',
          roles: ['app_reader'],
          using: 'true',
          withCheck: null,
        },
      ],
      roles: [
        {
          name: 'app_reader',
          createDb: false,
          createRole: false,
          inherit: true,
        },
      ],
      rlsEnabledTables: ['app.users'],
    });
    expect(queries).toHaveLength(10);
    expect(queries[0]?.text).toContain("c.relkind in ('r', 'p')");
    expect(queries[1]?.text).toContain('pg_catalog.format_type');
    expect(queries[1]?.text).toContain('column_type_namespace');
    expect(queries[1]?.text).toContain("sequence_candidate.relkind = 'S'");
    expect(queries[1]?.text).toMatch(
      /sequence_class\.oid is not null\s+and sequence_dependency\.deptype = 'a'/,
    );
    expect(queries[1]?.text).toContain("~ '^nextval\\([^()]+::regclass\\)$'");
    expect(queries[2]?.text).toContain('pg_catalog.pg_constraint');
    expect(queries[3]?.text).toContain('pg_catalog.pg_index');
    expect(queries[4]?.text).toContain('pg_catalog.pg_enum');
    expect(queries[5]?.text).toContain('pg_catalog.pg_sequence');
    expect(queries[7]?.text).toContain("c.relkind in ('v', 'm')");
    expect(queries[7]?.text).toContain('view_access_method');
    expect(queries[7]?.text).toContain('view_tablespace');
    expect(queries[8]?.text).toContain('pg_catalog.pg_policy');
    expect(queries[9]?.values).toEqual([['app_reader']]);
    for (const query of queries.slice(0, 4)) {
      expect(query.values).toEqual(['sentris_schema_migrations']);
    }
    for (const query of queries.slice(4, 9)) {
      expect(query.values).toBeUndefined();
    }
  });
});
