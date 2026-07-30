import type { QueryResultRow } from 'pg';
import {
  MIGRATION_LEDGER_TABLE,
  type AppliedMigration,
  type CheckedMigrationDatabase,
  normalizeSchemaExpression,
  normalizeSchemaFingerprint,
  type SchemaConstraint,
  type SchemaIndex,
  type SchemaIndexColumn,
  type SchemaFingerprint,
  type SchemaPolicy,
  type SchemaRole,
  type SchemaSequence,
  type SchemaView,
} from './checked-migrations';

const LOCK_NAMESPACE = ['sentris', 'checked-schema-migrations'];

function unqualifyDataType(dataType: string, schemaName: string | null): string {
  if (!schemaName) return dataType;
  const quotedSchemaName = `"${schemaName.replaceAll('"', '""')}"`;
  for (const prefix of [`${schemaName}.`, `${quotedSchemaName}.`]) {
    if (dataType.startsWith(prefix)) {
      return dataType.slice(prefix.length);
    }
  }
  return dataType;
}

// Deliberately smaller than PoolClient so orchestration stays unit-testable.
export interface MigrationQueryClient {
  query<Row extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: Row[] }>;
}

export class PostgresMigrationDatabase implements CheckedMigrationDatabase {
  constructor(private readonly client: MigrationQueryClient) {}

  async acquireLock(): Promise<void> {
    await this.client.query('select pg_advisory_lock(hashtext($1), hashtext($2))', LOCK_NAMESPACE);
  }

  async releaseLock(): Promise<void> {
    await this.client.query(
      'select pg_advisory_unlock(hashtext($1), hashtext($2))',
      LOCK_NAMESPACE,
    );
  }

  async hasLedger(): Promise<boolean> {
    const { rows } = await this.client.query<{ exists: boolean }>(
      'select to_regclass($1) is not null as "exists"',
      [`public.${MIGRATION_LEDGER_TABLE}`],
    );
    return rows[0]?.exists === true;
  }

  async readLedger(): Promise<AppliedMigration[]> {
    const { rows } = await this.client.query<AppliedMigration>(
      `select idx, tag, checksum
         from public.${MIGRATION_LEDGER_TABLE}
        order by idx asc`,
    );
    return rows;
  }

  async inspectPublicSchema(expected?: SchemaFingerprint): Promise<SchemaFingerprint> {
    const roleNames = (expected?.roles ?? []).map(({ name }) => name);
    const [
      tableResult,
      columnResult,
      constraintResult,
      indexResult,
      enumResult,
      sequenceResult,
      schemaResult,
      viewResult,
      policyResult,
      roleResult,
    ] = await Promise.all([
      this.client.query<{
        schemaName: string;
        tableName: string;
        rlsEnabled: boolean;
      }>(
        `/* sentris:schema-tables */
         select n.nspname as "schemaName",
                c.relname as "tableName",
                c.relrowsecurity as "rlsEnabled"
           from pg_catalog.pg_class c
           join pg_catalog.pg_namespace n on n.oid = c.relnamespace
          where n.nspname <> 'information_schema'
            and n.nspname !~ '^pg_'
            and c.relkind in ('r', 'p')
            and not (n.nspname = 'public' and c.relname = $1)
          order by n.nspname, c.relname`,
        [MIGRATION_LEDGER_TABLE],
      ),
      this.client.query<{
        schemaName: string;
        tableName: string;
        columnName: string;
        dataType: string;
        dataTypeSchema: string | null;
        notNull: boolean;
        defaultExpression: string | null;
        generatedExpression: string | null;
        identityType: 'always' | 'byDefault' | null;
        sequenceName: string | null;
        sequenceSchemaName: string | null;
        sequenceIncrement: string | null;
        sequenceMinValue: string | null;
        sequenceMaxValue: string | null;
        sequenceStartWith: string | null;
        sequenceCache: string | null;
        sequenceCycle: boolean | null;
        serial: boolean;
      }>(
        `/* sentris:schema-columns */
         select n.nspname as "schemaName",
                c.relname as "tableName",
                a.attname as "columnName",
                 case
                   when column_type.typtype = 'e' then column_type.typname
                   else pg_catalog.format_type(a.atttypid, a.atttypmod)
                 end as "dataType",
                 case
                   when column_type_namespace.nspname = 'pg_catalog' then null
                   else column_type_namespace.nspname
                 end as "dataTypeSchema",
                a.attnotnull as "notNull",
                case
                  when a.attgenerated <> ''
                    or a.attidentity <> ''
                    or (
                      sequence_class.oid is not null
                      and sequence_dependency.deptype = 'a'
                      and pg_catalog.pg_get_expr(
                        column_default.adbin,
                        column_default.adrelid,
                        true
                      ) ~ '^nextval\\([^()]+::regclass\\)$'
                    )
                    then null
                  else pg_catalog.pg_get_expr(column_default.adbin, column_default.adrelid, true)
                end as "defaultExpression",
                case
                  when a.attgenerated <> ''
                    then pg_catalog.pg_get_expr(column_default.adbin, column_default.adrelid, true)
                  else null
                end as "generatedExpression",
                case a.attidentity
                  when 'a' then 'always'
                  when 'd' then 'byDefault'
                  else null
                end as "identityType",
                sequence_class.relname as "sequenceName",
                sequence_namespace.nspname as "sequenceSchemaName",
                sequence.seqincrement::text as "sequenceIncrement",
                sequence.seqmin::text as "sequenceMinValue",
                sequence.seqmax::text as "sequenceMaxValue",
                sequence.seqstart::text as "sequenceStartWith",
                sequence.seqcache::text as "sequenceCache",
                sequence.seqcycle as "sequenceCycle",
                (
                  sequence_class.oid is not null
                  and sequence_dependency.deptype = 'a'
                  and pg_catalog.pg_get_expr(
                    column_default.adbin,
                    column_default.adrelid,
                    true
                  ) ~ '^nextval\\([^()]+::regclass\\)$'
                ) as "serial"
           from pg_catalog.pg_attribute a
           join pg_catalog.pg_class c on c.oid = a.attrelid
           join pg_catalog.pg_namespace n on n.oid = c.relnamespace
           join pg_catalog.pg_type column_type on column_type.oid = a.atttypid
           join pg_catalog.pg_type contract_column_type
             on contract_column_type.oid = case
               when column_type.typelem <> 0 then column_type.typelem
               else column_type.oid
             end
           join pg_catalog.pg_namespace column_type_namespace
             on column_type_namespace.oid = contract_column_type.typnamespace
           left join pg_catalog.pg_attrdef column_default
             on column_default.adrelid = a.attrelid
            and column_default.adnum = a.attnum
           left join pg_catalog.pg_depend sequence_dependency
             on sequence_dependency.refclassid = 'pg_catalog.pg_class'::pg_catalog.regclass
            and sequence_dependency.refobjid = c.oid
            and sequence_dependency.refobjsubid = a.attnum
            and sequence_dependency.classid = 'pg_catalog.pg_class'::pg_catalog.regclass
            and sequence_dependency.deptype in ('a', 'i')
            and exists (
              select 1
                from pg_catalog.pg_class sequence_candidate
               where sequence_candidate.oid = sequence_dependency.objid
                 and sequence_candidate.relkind = 'S'
            )
           left join pg_catalog.pg_class sequence_class
             on sequence_class.oid = sequence_dependency.objid
            and sequence_class.relkind = 'S'
           left join pg_catalog.pg_namespace sequence_namespace
             on sequence_namespace.oid = sequence_class.relnamespace
           left join pg_catalog.pg_sequence sequence on sequence.seqrelid = sequence_class.oid
          where n.nspname <> 'information_schema'
            and n.nspname !~ '^pg_'
            and c.relkind in ('r', 'p')
            and not (n.nspname = 'public' and c.relname = $1)
            and a.attnum > 0
            and not a.attisdropped
          order by n.nspname, c.relname, a.attnum`,
        [MIGRATION_LEDGER_TABLE],
      ),
      this.client.query<SchemaConstraint>(
        `/* sentris:schema-constraints */
         select n.nspname as "schemaName",
                table_class.relname as "tableName",
                constraint_row.conname as "name",
                case constraint_row.contype
                  when 'p' then 'primaryKey'
                  when 'u' then 'unique'
                  when 'c' then 'check'
                  when 'f' then 'foreignKey'
                end as "type",
                coalesce((
                  select jsonb_agg(attribute.attname::text order by key_column.ordinality)
                    from unnest(constraint_row.conkey) with ordinality
                      as key_column(attnum, ordinality)
                    join pg_catalog.pg_attribute attribute
                      on attribute.attrelid = constraint_row.conrelid
                     and attribute.attnum = key_column.attnum
                ), '[]'::jsonb) as "columns",
                case when constraint_row.contype = 'u'
                  then coalesce(index_row.indnullsnotdistinct, false)
                  else null
                end as "nullsNotDistinct",
                case when constraint_row.contype = 'c'
                  then pg_catalog.pg_get_expr(
                    constraint_row.conbin,
                    constraint_row.conrelid,
                    true
                  )
                  else null
                end as "expression",
                referenced_namespace.nspname as "referencedSchemaName",
                referenced_class.relname as "referencedTableName",
                coalesce((
                  select jsonb_agg(attribute.attname::text order by key_column.ordinality)
                    from unnest(constraint_row.confkey) with ordinality
                      as key_column(attnum, ordinality)
                    join pg_catalog.pg_attribute attribute
                      on attribute.attrelid = constraint_row.confrelid
                     and attribute.attnum = key_column.attnum
                ), '[]'::jsonb) as "referencedColumns",
                case constraint_row.confupdtype
                  when 'a' then 'no action'
                  when 'r' then 'restrict'
                  when 'c' then 'cascade'
                  when 'n' then 'set null'
                  when 'd' then 'set default'
                  else null
                end as "onUpdate",
                case constraint_row.confdeltype
                  when 'a' then 'no action'
                  when 'r' then 'restrict'
                  when 'c' then 'cascade'
                  when 'n' then 'set null'
                  when 'd' then 'set default'
                  else null
                end as "onDelete"
           from pg_catalog.pg_constraint constraint_row
           join pg_catalog.pg_class table_class on table_class.oid = constraint_row.conrelid
           join pg_catalog.pg_namespace n on n.oid = table_class.relnamespace
           left join pg_catalog.pg_index index_row
             on index_row.indexrelid = constraint_row.conindid
           left join pg_catalog.pg_class referenced_class
             on referenced_class.oid = constraint_row.confrelid
           left join pg_catalog.pg_namespace referenced_namespace
             on referenced_namespace.oid = referenced_class.relnamespace
          where n.nspname <> 'information_schema'
            and n.nspname !~ '^pg_'
            and table_class.relkind in ('r', 'p')
            and constraint_row.contype in ('p', 'u', 'c', 'f')
            and not (n.nspname = 'public' and table_class.relname = $1)
          order by n.nspname, table_class.relname, constraint_row.conname`,
        [MIGRATION_LEDGER_TABLE],
      ),
      this.client.query<{
        schemaName: string;
        tableName: string;
        name: string;
        isUnique: boolean;
        method: string;
        expression: string;
        isExpression: boolean;
        asc: boolean;
        nulls: string;
        opclass: string | null;
        position: number;
        where: string | null;
        with: string[] | null;
      }>(
        `/* sentris:schema-indexes */
         select n.nspname as "schemaName",
                table_class.relname as "tableName",
                index_class.relname as "name",
                index_row.indisunique as "isUnique",
                access_method.amname as "method",
                case
                  when attribute.attname is not null then attribute.attname
                  else pg_catalog.pg_get_indexdef(index_row.indexrelid, key_position, true)
                end as "expression",
                attribute.attname is null as "isExpression",
                (index_row.indoption[key_position - 1] & 1) = 0 as "asc",
                case
                  when (index_row.indoption[key_position - 1] & 2) = 0 then 'last'
                  else 'first'
                end as "nulls",
                case when operator_class.opcdefault then null else operator_class.opcname end
                  as "opclass",
                key_position as "position",
                pg_catalog.pg_get_expr(index_row.indpred, index_row.indrelid, true) as "where",
                index_class.reloptions as "with"
           from pg_catalog.pg_index index_row
           join pg_catalog.pg_class index_class on index_class.oid = index_row.indexrelid
           join pg_catalog.pg_class table_class on table_class.oid = index_row.indrelid
           join pg_catalog.pg_namespace n on n.oid = table_class.relnamespace
           join pg_catalog.pg_am access_method on access_method.oid = index_class.relam
           cross join lateral generate_series(1, index_row.indnkeyatts) as key_position
           left join pg_catalog.pg_attribute attribute
             on attribute.attrelid = index_row.indrelid
            and attribute.attnum = index_row.indkey[key_position - 1]
           left join pg_catalog.pg_opclass operator_class
             on operator_class.oid = index_row.indclass[key_position - 1]
           left join pg_catalog.pg_constraint constraint_row
             on constraint_row.conindid = index_row.indexrelid
          where n.nspname <> 'information_schema'
            and n.nspname !~ '^pg_'
            and table_class.relkind in ('r', 'p')
            and constraint_row.oid is null
            and not (n.nspname = 'public' and table_class.relname = $1)
          order by n.nspname, table_class.relname, index_class.relname, key_position`,
        [MIGRATION_LEDGER_TABLE],
      ),
      this.client.query<{
        schemaName: string;
        name: string;
        values: string[];
      }>(
        `/* sentris:schema-enums */
         select n.nspname as "schemaName",
                type_row.typname as "name",
                jsonb_agg(enum_row.enumlabel::text order by enum_row.enumsortorder) as "values"
           from pg_catalog.pg_type type_row
           join pg_catalog.pg_namespace n on n.oid = type_row.typnamespace
           join pg_catalog.pg_enum enum_row on enum_row.enumtypid = type_row.oid
          where n.nspname <> 'information_schema'
            and n.nspname !~ '^pg_'
          group by n.nspname, type_row.typname
          order by n.nspname, type_row.typname`,
      ),
      this.client.query<SchemaSequence>(
        `/* sentris:schema-sequences */
         select n.nspname as "schemaName",
                sequence_class.relname as "name",
                sequence_row.seqincrement::text as "increment",
                sequence_row.seqmin::text as "minValue",
                sequence_row.seqmax::text as "maxValue",
                sequence_row.seqstart::text as "startWith",
                sequence_row.seqcache::text as "cache",
                sequence_row.seqcycle as "cycle"
           from pg_catalog.pg_class sequence_class
           join pg_catalog.pg_namespace n on n.oid = sequence_class.relnamespace
           join pg_catalog.pg_sequence sequence_row
             on sequence_row.seqrelid = sequence_class.oid
          where sequence_class.relkind = 'S'
            and n.nspname <> 'information_schema'
            and n.nspname !~ '^pg_'
            and not exists (
              select 1
                from pg_catalog.pg_depend dependency
               where dependency.classid = 'pg_catalog.pg_class'::pg_catalog.regclass
                 and dependency.objid = sequence_class.oid
                 and dependency.refclassid = 'pg_catalog.pg_class'::pg_catalog.regclass
                 and dependency.deptype in ('a', 'i')
            )
          order by n.nspname, sequence_class.relname`,
      ),
      this.client.query<{ name: string }>(
        `/* sentris:schema-namespaces */
         select nspname as "name"
           from pg_catalog.pg_namespace
          where nspname <> 'public'
            and nspname <> 'information_schema'
            and nspname !~ '^pg_'
          order by nspname`,
      ),
      this.client.query<{
        schemaName: string;
        name: string;
        materialized: boolean;
        definition: string;
        columnName: string;
        dataType: string;
        dataTypeSchema: string | null;
        notNull: boolean;
        position: number;
        options: string[] | null;
        accessMethod: string | null;
        tablespace: string | null;
      }>(
        `/* sentris:schema-views */
         select n.nspname as "schemaName",
                c.relname as "name",
                c.relkind = 'm' as "materialized",
                pg_catalog.pg_get_viewdef(c.oid, true) as "definition",
                 attribute.attname as "columnName",
                 pg_catalog.format_type(attribute.atttypid, attribute.atttypmod) as "dataType",
                 case
                   when column_type_namespace.nspname = 'pg_catalog' then null
                   else column_type_namespace.nspname
                 end as "dataTypeSchema",
                 attribute.attnotnull as "notNull",
                 attribute.attnum as "position",
                 c.reloptions as "options",
                 view_access_method.amname as "accessMethod",
                 view_tablespace.spcname as "tablespace"
           from pg_catalog.pg_class c
           join pg_catalog.pg_namespace n on n.oid = c.relnamespace
           join pg_catalog.pg_attribute attribute on attribute.attrelid = c.oid
           join pg_catalog.pg_type column_type on column_type.oid = attribute.atttypid
           join pg_catalog.pg_type contract_column_type
             on contract_column_type.oid = case
               when column_type.typelem <> 0 then column_type.typelem
               else column_type.oid
             end
           join pg_catalog.pg_namespace column_type_namespace
             on column_type_namespace.oid = contract_column_type.typnamespace
           left join pg_catalog.pg_am view_access_method
             on view_access_method.oid = c.relam
           left join pg_catalog.pg_tablespace view_tablespace
             on view_tablespace.oid = c.reltablespace
          where n.nspname <> 'information_schema'
            and n.nspname !~ '^pg_'
            and c.relkind in ('v', 'm')
            and attribute.attnum > 0
            and not attribute.attisdropped
          order by n.nspname, c.relname, attribute.attnum`,
      ),
      this.client.query<{
        schemaName: string;
        tableName: string;
        name: string;
        permissive: string;
        command: string;
        roles: string[];
        using: string | null;
        withCheck: string | null;
      }>(
        `/* sentris:schema-policies */
         select namespace.nspname as "schemaName",
                table_class.relname as "tableName",
                policy.polname as "name",
                case when policy.polpermissive then 'PERMISSIVE' else 'RESTRICTIVE' end
                  as "permissive",
                case policy.polcmd
                  when '*' then 'ALL'
                  when 'r' then 'SELECT'
                  when 'a' then 'INSERT'
                  when 'w' then 'UPDATE'
                  when 'd' then 'DELETE'
                end as "command",
                coalesce((
                  select jsonb_agg(role_name order by role_name)
                    from (
                      select case when role_oid = 0 then 'public' else role.rolname::text end
                        as role_name
                        from unnest(policy.polroles) role_oid
                        left join pg_catalog.pg_roles role on role.oid = role_oid
                    ) policy_roles
                ), '["public"]'::jsonb) as "roles",
                pg_catalog.pg_get_expr(policy.polqual, policy.polrelid, true) as "using",
                pg_catalog.pg_get_expr(policy.polwithcheck, policy.polrelid, true) as "withCheck"
           from pg_catalog.pg_policy policy
           join pg_catalog.pg_class table_class on table_class.oid = policy.polrelid
           join pg_catalog.pg_namespace namespace on namespace.oid = table_class.relnamespace
          where namespace.nspname <> 'information_schema'
            and namespace.nspname !~ '^pg_'
          order by namespace.nspname, table_class.relname, policy.polname`,
      ),
      roleNames.length === 0
        ? Promise.resolve({ rows: [] as SchemaRole[] })
        : this.client.query<SchemaRole>(
            `/* sentris:schema-roles */
             select rolname as "name",
                    rolcreatedb as "createDb",
                    rolcreaterole as "createRole",
                    rolinherit as "inherit"
               from pg_catalog.pg_roles
              where rolname = any($1::text[])
              order by rolname`,
            [roleNames],
          ),
    ]);

    const indexesByName = new Map<string, SchemaIndex>();
    for (const row of indexResult.rows) {
      const key = `${row.schemaName}\u0000${row.tableName}\u0000${row.name}`;
      const existing = indexesByName.get(key);
      const column: SchemaIndexColumn = {
        expression: normalizeSchemaExpression(row.expression)!,
        isExpression: row.isExpression,
        asc: row.asc,
        nulls: row.nulls,
        opclass: row.opclass,
      };
      if (existing) {
        existing.columns.push(column);
      } else {
        indexesByName.set(key, {
          schemaName: row.schemaName,
          tableName: row.tableName,
          name: row.name,
          isUnique: row.isUnique,
          method: row.method,
          columns: [column],
          where: normalizeSchemaExpression(row.where),
          with: this.parseRelOptions(row.with),
        });
      }
    }

    const viewsByName = new Map<string, SchemaView>();
    for (const row of viewResult.rows) {
      const key = `${row.schemaName}\u0000${row.name}`;
      const existing = viewsByName.get(key);
      if (existing) {
        existing.columns.push({
          name: row.columnName,
          dataType: unqualifyDataType(row.dataType, row.dataTypeSchema),
          dataTypeSchema: row.dataTypeSchema,
          notNull: row.notNull,
        });
      } else {
        viewsByName.set(key, {
          schemaName: row.schemaName,
          name: row.name,
          materialized: row.materialized,
          definition: normalizeSchemaExpression(row.definition),
          columns: [
            {
              name: row.columnName,
              dataType: unqualifyDataType(row.dataType, row.dataTypeSchema),
              dataTypeSchema: row.dataTypeSchema,
              notNull: row.notNull,
            },
          ],
          options: this.createViewOptions(row),
        });
      }
    }

    const constraints = constraintResult.rows.map(
      (row): SchemaConstraint => ({
        ...row,
        columns: row.columns ?? [],
        nullsNotDistinct: row.nullsNotDistinct ?? null,
        expression: normalizeSchemaExpression(row.expression),
        referencedSchemaName: row.referencedSchemaName ?? null,
        referencedTableName: row.referencedTableName ?? null,
        referencedColumns: row.referencedColumns ?? [],
        onUpdate: row.type === 'foreignKey' ? (row.onUpdate ?? 'no action') : null,
        onDelete: row.type === 'foreignKey' ? (row.onDelete ?? 'no action') : null,
      }),
    );
    const policies = policyResult.rows.map(
      (row): SchemaPolicy => ({
        schemaName: row.schemaName,
        tableName: row.tableName,
        name: row.name,
        permissive: row.permissive === 'PERMISSIVE',
        command: row.command,
        roles: [...(row.roles ?? ['public'])].sort(),
        using: normalizeSchemaExpression(row.using),
        withCheck: normalizeSchemaExpression(row.withCheck),
      }),
    );

    return normalizeSchemaFingerprint({
      tables: tableResult.rows.map(({ schemaName, tableName }) => `${schemaName}.${tableName}`),
      columns: columnResult.rows.map((row) => ({
        schemaName: row.schemaName,
        tableName: row.tableName,
        columnName: row.columnName,
        dataType: unqualifyDataType(row.dataType, row.dataTypeSchema),
        dataTypeSchema: row.dataTypeSchema,
        notNull: row.notNull,
        defaultExpression: normalizeSchemaExpression(row.defaultExpression),
        generatedExpression: normalizeSchemaExpression(row.generatedExpression),
        identity:
          row.identityType === null
            ? null
            : {
                type: row.identityType,
                name: row.sequenceName!,
                schemaName: row.sequenceSchemaName!,
                increment: row.sequenceIncrement!,
                minValue: row.sequenceMinValue!,
                maxValue: row.sequenceMaxValue!,
                startWith: row.sequenceStartWith!,
                cache: row.sequenceCache!,
                cycle: row.sequenceCycle === true,
              },
        serial: row.serial === true,
      })),
      constraints,
      indexes: [...indexesByName.values()],
      enums: enumResult.rows,
      sequences: sequenceResult.rows,
      schemas: schemaResult.rows.map(({ name }) => name),
      views: [...viewsByName.values()],
      policies,
      roles: roleResult.rows,
      rlsEnabledTables: tableResult.rows
        .filter(({ rlsEnabled }) => rlsEnabled)
        .map(({ schemaName, tableName }) => `${schemaName}.${tableName}`),
    });
  }

  private parseRelOptions(options: readonly string[] | null): Record<string, string> {
    return Object.fromEntries(
      (options ?? []).map((option) => {
        const separator = option.indexOf('=');
        return separator === -1
          ? [option, 'true']
          : [option.slice(0, separator), option.slice(separator + 1)];
      }),
    );
  }

  private parseViewOptions(options: readonly string[] | null): Record<string, string> {
    const nameMap: Record<string, string> = {
      security_barrier: 'securityBarrier',
      security_invoker: 'securityInvoker',
      check_option: 'checkOption',
      toast_tuple_target: 'toastTupleTarget',
      parallel_workers: 'parallelWorkers',
      autovacuum_enabled: 'autovacuumEnabled',
      vacuum_index_cleanup: 'vacuumIndexCleanup',
      vacuum_truncate: 'vacuumTruncate',
      autovacuum_vacuum_threshold: 'autovacuumVacuumThreshold',
      autovacuum_vacuum_scale_factor: 'autovacuumVacuumScaleFactor',
      autovacuum_vacuum_cost_delay: 'autovacuumVacuumCostDelay',
      autovacuum_vacuum_cost_limit: 'autovacuumVacuumCostLimit',
      autovacuum_freeze_min_age: 'autovacuumFreezeMinAge',
      autovacuum_freeze_max_age: 'autovacuumFreezeMaxAge',
      autovacuum_freeze_table_age: 'autovacuumFreezeTableAge',
      autovacuum_multixact_freeze_min_age: 'autovacuumMultixactFreezeMinAge',
      autovacuum_multixact_freeze_max_age: 'autovacuumMultixactFreezeMaxAge',
      autovacuum_multixact_freeze_table_age: 'autovacuumMultixactFreezeTableAge',
      log_autovacuum_min_duration: 'logAutovacuumMinDuration',
      user_catalog_table: 'userCatalogTable',
    };
    return Object.fromEntries(
      Object.entries(this.parseRelOptions(options)).map(([name, value]) => [
        nameMap[name] ?? name,
        value,
      ]),
    );
  }

  private createViewOptions(row: {
    materialized: boolean;
    options: readonly string[] | null;
    accessMethod: string | null;
    tablespace: string | null;
  }): Record<string, string> {
    const options = this.parseViewOptions(row.options);
    if (row.materialized && row.accessMethod) {
      options.using = row.accessMethod;
    }
    if (row.tablespace) {
      options.tablespace = row.tablespace;
    }
    return options;
  }

  async begin(): Promise<void> {
    await this.client.query('BEGIN');
  }

  async createLedger(): Promise<void> {
    await this.client.query(
      `create table if not exists public.${MIGRATION_LEDGER_TABLE} (
         idx integer primary key,
         tag text not null unique,
         checksum text not null check (length(checksum) = 64),
         applied_at timestamp with time zone not null default now()
       )`,
    );
  }

  async executeStatement(statement: string): Promise<void> {
    await this.client.query(statement);
  }

  async recordMigration(migration: AppliedMigration): Promise<void> {
    await this.client.query(
      `insert into public.${MIGRATION_LEDGER_TABLE} (idx, tag, checksum)
       values ($1, $2, $3)`,
      [migration.idx, migration.tag, migration.checksum],
    );
  }

  async commit(): Promise<void> {
    await this.client.query('COMMIT');
  }

  async rollback(): Promise<void> {
    await this.client.query('ROLLBACK');
  }
}
