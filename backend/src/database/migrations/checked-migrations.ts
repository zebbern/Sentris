import { createHash } from 'crypto';
import { readFileSync, readdirSync } from 'fs';
import { join, relative } from 'path';

// Shared by the startup guard and the migration command.
export const MIGRATION_LEDGER_TABLE = 'sentris_schema_migrations';
export const SUPPORTED_ADOPTION_VERSION = 'v1.0.0';
const BASELINE_TAG = '0000_v1_0_0';
const STATEMENT_BREAKPOINT = '--> statement-breakpoint';
const SNAPSHOT_ROOT_ID = '00000000-0000-0000-0000-000000000000';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const POSTGRES_IDENTIFIER_MAX_BYTES = 63;

export interface SchemaColumn {
  schemaName: string;
  tableName: string;
  columnName: string;
  dataType: string;
  dataTypeSchema: string | null;
  notNull: boolean;
  defaultExpression: string | null;
  generatedExpression: string | null;
  identity: SchemaIdentity | null;
  serial: boolean;
}

export interface SchemaIdentity {
  type: 'always' | 'byDefault';
  name: string;
  schemaName: string;
  increment: string;
  minValue: string;
  maxValue: string;
  startWith: string;
  cache: string;
  cycle: boolean;
}

export interface SchemaConstraint {
  schemaName: string;
  tableName: string;
  name: string;
  type: 'primaryKey' | 'unique' | 'check' | 'foreignKey';
  columns: string[];
  nullsNotDistinct: boolean | null;
  expression: string | null;
  referencedSchemaName: string | null;
  referencedTableName: string | null;
  referencedColumns: string[];
  onUpdate: string | null;
  onDelete: string | null;
}

export interface SchemaIndexColumn {
  expression: string;
  isExpression: boolean;
  asc: boolean;
  nulls: string;
  opclass: string | null;
}

export interface SchemaIndex {
  schemaName: string;
  tableName: string;
  name: string;
  isUnique: boolean;
  method: string;
  columns: SchemaIndexColumn[];
  where: string | null;
  with: Record<string, string>;
}

export interface SchemaEnum {
  schemaName: string;
  name: string;
  values: string[];
}

export interface SchemaSequence {
  schemaName: string;
  name: string;
  increment: string;
  minValue: string;
  maxValue: string;
  startWith: string;
  cache: string;
  cycle: boolean;
}

export interface SchemaViewColumn {
  name: string;
  dataType: string;
  dataTypeSchema: string | null;
  notNull: boolean;
}

export interface SchemaView {
  schemaName: string;
  name: string;
  materialized: boolean;
  definition: string | null;
  columns: SchemaViewColumn[];
  options: Record<string, string>;
}

export interface SchemaPolicy {
  schemaName: string;
  tableName: string;
  name: string;
  permissive: boolean;
  command: string;
  roles: string[];
  using: string | null;
  withCheck: string | null;
}

export interface SchemaRole {
  name: string;
  createDb: boolean;
  createRole: boolean;
  inherit: boolean;
}

export interface SchemaFingerprint {
  tables: string[];
  columns: SchemaColumn[];
  constraints: SchemaConstraint[];
  indexes: SchemaIndex[];
  enums: SchemaEnum[];
  sequences: SchemaSequence[];
  schemas: string[];
  views: SchemaView[];
  policies: SchemaPolicy[];
  roles: SchemaRole[];
  rlsEnabledTables: string[];
}

export interface CheckedMigration {
  idx: number;
  tag: string;
  fileName: string;
  checksum: string;
  snapshotChecksum: string;
  contractChecksum: string;
  sql: string;
  statements: string[];
  schema: SchemaFingerprint;
}

export interface MigrationPlan {
  migrations: CheckedMigration[];
}

export interface AppliedMigration {
  idx: number;
  tag: string;
  checksum: string;
}

export interface CheckedMigrationDatabase {
  acquireLock(): Promise<void>;
  releaseLock(): Promise<void>;
  hasLedger(): Promise<boolean>;
  readLedger(): Promise<AppliedMigration[]>;
  inspectPublicSchema(expected?: SchemaFingerprint): Promise<SchemaFingerprint>;
  begin(): Promise<void>;
  createLedger(): Promise<void>;
  executeStatement(statement: string): Promise<void>;
  recordMigration(migration: AppliedMigration): Promise<void>;
  commit(): Promise<void>;
  rollback(): Promise<void>;
}

interface JournalEntry {
  idx: number;
  tag: string;
}

interface BuildMigrationPlanInput {
  journal: unknown;
  sqlFiles: ReadonlyMap<string, string | Uint8Array>;
  snapshots: ReadonlyMap<string, unknown>;
  manifest?: unknown;
}

export interface MigrationArtifactManifestEntry {
  idx: number;
  tag: string;
  sqlSha256: string;
  snapshotSha256: string;
  contractSha256: string;
}

export interface MigrationArtifactManifest {
  version: 1;
  entries: MigrationArtifactManifestEntry[];
}

export interface RunCheckedMigrationsOptions {
  database: CheckedMigrationDatabase;
  plan: MigrationPlan;
  adoptVersion?: string;
  onStatus?: (message: string) => void;
}

export interface RunCheckedMigrationsResult {
  adopted: boolean;
  applied: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseJournal(journal: unknown): JournalEntry[] {
  if (!isRecord(journal) || journal.dialect !== 'postgresql' || !Array.isArray(journal.entries)) {
    throw new Error('Invalid PostgreSQL migration journal');
  }
  if (journal.entries.length === 0) {
    throw new Error('Migration journal must contain at least one entry');
  }

  const tags = new Set<string>();
  const indexes = new Set<number>();

  return journal.entries.map((rawEntry, position) => {
    if (
      !isRecord(rawEntry) ||
      !Number.isInteger(rawEntry.idx) ||
      typeof rawEntry.tag !== 'string'
    ) {
      throw new Error(`Invalid migration journal entry at position ${position}`);
    }

    const idx = rawEntry.idx as number;
    const tag = rawEntry.tag;
    if (tags.has(tag)) {
      throw new Error(`Duplicate migration tag: ${tag}`);
    }
    if (indexes.has(idx)) {
      throw new Error(`Duplicate migration index: ${idx}`);
    }
    tags.add(tag);
    indexes.add(idx);

    if (idx !== position) {
      throw new Error(
        `Migration journal must be contiguous: expected idx ${position}, received ${idx}`,
      );
    }
    const expectedPrefix = `${String(idx).padStart(4, '0')}_`;
    if (!tag.startsWith(expectedPrefix) || !/^\d{4}_[a-z0-9_]+$/.test(tag)) {
      throw new Error(`Migration tag must match its zero-padded index: ${tag}`);
    }

    return { idx, tag };
  });
}

function validateSnapshotChain(
  journalEntries: readonly JournalEntry[],
  snapshots: ReadonlyMap<string, unknown>,
): void {
  let expectedPreviousId = SNAPSHOT_ROOT_ID;
  const snapshotIds = new Set<string>();

  for (const { idx } of journalEntries) {
    const snapshotName = `${String(idx).padStart(4, '0')}_snapshot.json`;
    const snapshot = snapshots.get(snapshotName);
    if (
      !isRecord(snapshot) ||
      snapshot.version !== '7' ||
      snapshot.dialect !== 'postgresql' ||
      typeof snapshot.id !== 'string' ||
      !UUID_PATTERN.test(snapshot.id) ||
      typeof snapshot.prevId !== 'string'
    ) {
      throw new Error(`Invalid Drizzle PostgreSQL v7 migration snapshot at idx ${idx}`);
    }
    if (snapshot.prevId !== expectedPreviousId) {
      throw new Error(
        `Migration snapshot chain mismatch at idx ${idx}: expected prevId ${expectedPreviousId}, received ${snapshot.prevId}`,
      );
    }
    if (snapshotIds.has(snapshot.id)) {
      throw new Error(`Duplicate migration snapshot id at idx ${idx}: ${snapshot.id}`);
    }
    snapshotIds.add(snapshot.id);
    expectedPreviousId = snapshot.id;
  }
}

function normalizeSnapshotType(type: string): string {
  const arraySuffix = /(?:\[\])+$/.exec(type)?.[0];
  if (arraySuffix) {
    return `${normalizeSnapshotType(type.slice(0, -arraySuffix.length))}${arraySuffix}`;
  }

  const varcharMatch = /^varchar\((\d+)\)$/.exec(type);
  if (varcharMatch) {
    return `character varying(${varcharMatch[1]})`;
  }

  switch (type) {
    case 'varchar':
      return 'character varying';
    case 'bigserial':
      return 'bigint';
    case 'serial':
      return 'integer';
    case 'smallserial':
      return 'smallint';
    case 'timestamp':
      return 'timestamp without time zone';
    case 'time':
      return 'time without time zone';
    default:
      return type;
  }
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(',')}]`;
  }
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function canonicalSnapshotHash(snapshot: unknown): string {
  return sha256(canonicalJson(snapshot));
}

export function schemaContractHash(fingerprint: SchemaFingerprint): string {
  return sha256(canonicalJson(normalizeSchemaFingerprint(fingerprint)));
}

export function createMigrationArtifactManifest(
  input: Omit<BuildMigrationPlanInput, 'manifest'>,
): MigrationArtifactManifest {
  const journalEntries = parseJournal(input.journal);
  const referencedSqlFiles = new Set(journalEntries.map((entry) => `${entry.tag}.sql`));
  const referencedSnapshots = new Set(
    journalEntries.map(({ idx }) => `${String(idx).padStart(4, '0')}_snapshot.json`),
  );

  for (const fileName of referencedSqlFiles) {
    if (!input.sqlFiles.has(fileName)) {
      throw new Error(`Migration journal references missing SQL file: ${fileName}`);
    }
  }
  for (const fileName of [...input.sqlFiles.keys()].sort()) {
    if (!referencedSqlFiles.has(fileName)) {
      throw new Error(`Unreferenced migration SQL file: ${fileName}`);
    }
  }
  for (const fileName of [...input.snapshots.keys()].sort()) {
    if (!referencedSnapshots.has(fileName)) {
      throw new Error(`Unreferenced migration snapshot: meta/${fileName}`);
    }
  }
  validateSnapshotChain(journalEntries, input.snapshots);

  return {
    version: 1,
    entries: journalEntries.map(({ idx, tag }) => {
      const rawSql = input.sqlFiles.get(`${tag}.sql`)!;
      const sql = (
        typeof rawSql === 'string' ? rawSql : Buffer.from(rawSql).toString('utf8')
      ).replace(/\r\n?/g, '\n');
      const snapshotName = `${String(idx).padStart(4, '0')}_snapshot.json`;
      const snapshot = input.snapshots.get(snapshotName);
      if (snapshot === undefined) {
        throw new Error(`Missing migration snapshot: meta/${snapshotName}`);
      }
      const fingerprint = schemaFingerprintFromSnapshot(snapshot);
      return {
        idx,
        tag,
        sqlSha256: sha256(sql),
        snapshotSha256: canonicalSnapshotHash(snapshot),
        contractSha256: schemaContractHash(fingerprint),
      };
    }),
  };
}

export function validateMigrationManifestImmutablePrefix(
  previous: MigrationArtifactManifest,
  next: MigrationArtifactManifest,
): void {
  if (next.entries.length < previous.entries.length) {
    throw new Error('Generated migrations removed a sealed manifest entry');
  }
  for (let idx = 0; idx < previous.entries.length; idx += 1) {
    if (canonicalJson(previous.entries[idx]) !== canonicalJson(next.entries[idx])) {
      throw new Error(`Generated migrations rewrote sealed manifest entry at idx ${idx}`);
    }
  }
}

function stripRedundantOuterParentheses(value: string): string {
  let result = value;
  while (result.startsWith('(') && result.endsWith(')')) {
    let depth = 0;
    let enclosesEntireExpression = true;
    let quoted = false;
    for (let index = 0; index < result.length; index += 1) {
      const character = result[index]!;
      if (character === "'" && result[index - 1] !== '\\') {
        quoted = !quoted;
      }
      if (quoted) continue;
      if (character === '(') depth += 1;
      if (character === ')') depth -= 1;
      if (depth === 0 && index < result.length - 1) {
        enclosesEntireExpression = false;
        break;
      }
    }
    if (!enclosesEntireExpression) break;
    result = result.slice(1, -1).trim();
  }
  return result;
}

function escapeRegularExpression(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function protectSchemaExpressionTokens(value: string): {
  masked: string;
  literalMarkers: string[];
  tokens: { marker: string; value: string }[];
} {
  let masked = '';
  const literalMarkers: string[] = [];
  const tokens: { marker: string; value: string }[] = [];

  const protect = (token: string, literal: boolean): void => {
    const marker = `\u{e000}${tokens.length}\u{e001}`;
    tokens.push({ marker, value: token });
    if (literal) literalMarkers.push(marker);
    masked += marker;
  };

  for (let index = 0; index < value.length; ) {
    const character = value[index]!;
    if (character === "'") {
      const start = index;
      index += 1;
      while (index < value.length) {
        if (value[index] === '\\') {
          index += 2;
          continue;
        }
        if (value[index] === "'" && value[index + 1] === "'") {
          index += 2;
          continue;
        }
        if (value[index] === "'") {
          index += 1;
          break;
        }
        index += 1;
      }
      protect(value.slice(start, index), true);
      continue;
    }

    if (character === '"') {
      const start = index;
      let identifier = '';
      index += 1;
      while (index < value.length) {
        if (value[index] === '"' && value[index + 1] === '"') {
          identifier += '"';
          index += 2;
          continue;
        }
        if (value[index] === '"') {
          index += 1;
          break;
        }
        identifier += value[index]!;
        index += 1;
      }
      if (/^[a-z_][a-z0-9_$]*$/.test(identifier) && value[index - 1] === '"') {
        masked += identifier;
      } else {
        protect(value.slice(start, index), false);
      }
      continue;
    }

    if (character === '$') {
      const delimiter = /^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/.exec(value.slice(index))?.[0];
      if (delimiter) {
        const closingIndex = value.indexOf(delimiter, index + delimiter.length);
        if (closingIndex !== -1) {
          const end = closingIndex + delimiter.length;
          protect(value.slice(index, end), true);
          index = end;
          continue;
        }
      }
    }

    masked += character;
    index += 1;
  }

  return { masked, literalMarkers, tokens };
}

export function normalizeSchemaExpression(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const { masked, literalMarkers, tokens } = protectSchemaExpressionTokens(String(value));
  let result = masked.trim().replace(/\s+/g, ' ');

  if (literalMarkers.length > 0) {
    const literalPattern = literalMarkers.map(escapeRegularExpression).join('|');
    const identifier = `(?:"[^"]+"|[A-Za-z_][A-Za-z0-9_$]*)`;
    const numericModifier = `\\(\\s*\\d+(?:\\s*,\\s*\\d+)?\\s*\\)`;
    const builtInType =
      `(?:character varying(?:${numericModifier})?` +
      `|timestamp(?:${numericModifier})? (?:with|without) time zone` +
      `|time(?:${numericModifier})? (?:with|without) time zone` +
      `|double precision)`;
    const namedType = `(?:${identifier}(?:\\.${identifier})?)(?:${numericModifier})?`;
    const literalCast = new RegExp(
      `(${literalPattern})::(?:${builtInType}|${namedType})(?:\\[\\])*`,
      'gi',
    );
    let previous: string;
    do {
      previous = result;
      result = result.replace(literalCast, '$1');
    } while (result !== previous);
  }

  result = stripRedundantOuterParentheses(result);
  for (const token of tokens) {
    result = result.replaceAll(token.marker, token.value);
  }
  return result;
}

function normalizeJsonColumnDefault(value: unknown, dataType: string): string | null {
  const normalized = normalizeSchemaExpression(value);
  if ((dataType !== 'json' && dataType !== 'jsonb') || normalized === null) {
    return normalized;
  }
  if (!/^'(?:[^']|'')*'$/.test(normalized)) {
    return normalized;
  }

  try {
    const parsed = JSON.parse(normalized.slice(1, -1).replaceAll("''", "'")) as unknown;
    return `'${canonicalJson(parsed).replaceAll("'", "''")}'`;
  } catch {
    return normalized;
  }
}

function isTextColumnType(dataType: string): boolean {
  return (
    dataType === 'text' ||
    dataType === 'varchar' ||
    /^character varying(?:\(\d+\))?$/.test(dataType) ||
    /^character(?:\(\d+\))?$/.test(dataType)
  );
}

function normalizeSchemaPredicateExpression(
  value: unknown,
  tableName: string,
  textColumns: ReadonlySet<string>,
): string | null {
  const normalized = normalizeSchemaExpression(value);
  if (normalized === null) return null;

  const { masked, tokens } = protectSchemaExpressionTokens(normalized);
  const tablePattern = escapeRegularExpression(tableName);
  let result = masked.replace(new RegExp(`\\b${tablePattern}\\.`, 'g'), '');

  for (const columnName of textColumns) {
    const columnPattern = escapeRegularExpression(columnName);
    result = result.replace(new RegExp(`\\b${columnPattern}\\b\\s*::\\s*text\\b`, 'g'), columnName);
  }

  result = result.replace(
    /\b([A-Za-z_][A-Za-z0-9_$]*)\b\s*=\s*ANY\s*\(\s*ARRAY\[(.*?)\](?:\s*::\s*text\[\])?\s*\)/gi,
    '$1 IN ($2)',
  );
  result = result.replace(/\(\s*([A-Za-z_][A-Za-z0-9_$]*\s+IN\s+\([^()]*\))\s*\)/gi, '$1');

  for (const token of tokens) {
    result = result.replaceAll(token.marker, token.value);
  }
  return stripRedundantOuterParentheses(result.trim().replace(/\s+/g, ' '));
}

function normalizeStringRecord(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {};
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, String(entry)]),
  );
}

function serialType(type: string): boolean {
  return type === 'serial' || type === 'bigserial' || type === 'smallserial';
}

function integerTypeMaximum(type: string): string {
  if (type === 'smallint' || type === 'smallserial') return '32767';
  if (type === 'integer' || type === 'serial') return '2147483647';
  return '9223372036854775807';
}

function integerTypeMinimum(type: string): string {
  if (type === 'smallint' || type === 'smallserial') return '-32768';
  if (type === 'integer' || type === 'serial') return '-2147483648';
  return '-9223372036854775808';
}

function normalizeSequence(
  rawSequence: Record<string, unknown>,
  fallbackSchemaName: string,
  dataType = 'bigint',
): SchemaSequence {
  if (typeof rawSequence.name !== 'string') {
    throw new Error('Invalid PostgreSQL sequence in migration snapshot');
  }
  const increment = String(rawSequence.increment ?? '1');
  const descending = Number(increment) < 0;
  const minValue = String(
    rawSequence.minValue ?? (descending ? integerTypeMinimum(dataType) : '1'),
  );
  const maxValue = String(
    rawSequence.maxValue ?? (descending ? '-1' : integerTypeMaximum(dataType)),
  );
  return {
    schemaName:
      typeof rawSequence.schema === 'string' && rawSequence.schema.length > 0
        ? rawSequence.schema
        : fallbackSchemaName,
    name: rawSequence.name,
    increment,
    minValue,
    maxValue,
    startWith: String(rawSequence.startWith ?? (descending ? maxValue : minValue)),
    cache: String(rawSequence.cache ?? '1'),
    cycle: rawSequence.cycle === true,
  };
}

function normalizeIdentity(
  rawIdentity: unknown,
  schemaName: string,
  dataType: string,
): SchemaIdentity | null {
  if (!isRecord(rawIdentity)) return null;
  if (
    (rawIdentity.type !== 'always' && rawIdentity.type !== 'byDefault') ||
    typeof rawIdentity.name !== 'string'
  ) {
    throw new Error('Invalid PostgreSQL identity column in migration snapshot');
  }
  const sequence = normalizeSequence(rawIdentity, schemaName, dataType);
  return {
    type: rawIdentity.type,
    name: sequence.name,
    schemaName: sequence.schemaName,
    increment: sequence.increment,
    minValue: sequence.minValue,
    maxValue: sequence.maxValue,
    startWith: sequence.startWith,
    cache: sequence.cache,
    cycle: sequence.cycle,
  };
}

function schemaColumnKey(column: SchemaColumn): string {
  return canonicalJson({
    schemaName: column.schemaName,
    tableName: column.tableName,
    columnName: column.columnName,
    dataType: column.dataType,
    dataTypeSchema: column.dataTypeSchema ?? null,
    notNull: column.notNull,
    defaultExpression: column.defaultExpression ?? null,
    generatedExpression: column.generatedExpression ?? null,
    identity: column.identity ?? null,
    serial: column.serial === true,
  });
}

function describeColumn(column: SchemaColumn): string {
  const defaultDescription =
    column.defaultExpression === null || column.defaultExpression === undefined
      ? ''
      : ` DEFAULT ${column.defaultExpression}`;
  const dataType = column.dataTypeSchema
    ? `${column.dataTypeSchema}.${column.dataType}`
    : column.dataType;
  return `${column.schemaName}.${column.tableName}.${column.columnName} ${dataType} ${
    column.notNull ? 'NOT NULL' : 'NULL'
  }${defaultDescription}`;
}

function objectIdentity(
  value:
    | SchemaConstraint
    | SchemaIndex
    | SchemaEnum
    | SchemaSequence
    | SchemaView
    | SchemaPolicy
    | SchemaRole,
): string {
  if ('tableName' in value) {
    if ('type' in value) {
      return `${value.schemaName}.${value.tableName}.${value.type}.${value.name}`;
    }
    return `${value.schemaName}.${value.tableName}.${value.name}`;
  }
  if ('schemaName' in value) {
    return `${value.schemaName}.${value.name}`;
  }
  return value.name;
}

function sortObjects<T extends Parameters<typeof objectIdentity>[0]>(values: T[]): T[] {
  return values.sort((left, right) => {
    const identityOrder = objectIdentity(left).localeCompare(objectIdentity(right));
    if (identityOrder !== 0) return identityOrder;
    return canonicalJson(left).localeCompare(canonicalJson(right));
  });
}

function parseQualifiedObjectName(
  rawName: unknown,
  fallbackSchemaName: string,
): { schemaName: string; objectName: string } {
  if (typeof rawName !== 'string' || rawName.trim().length === 0) {
    throw new Error('Invalid qualified PostgreSQL object name in migration snapshot');
  }
  const parts = rawName
    .replaceAll('"', '')
    .split('.')
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length === 1) {
    return { schemaName: fallbackSchemaName, objectName: parts[0]! };
  }
  return { schemaName: parts.at(-2)!, objectName: parts.at(-1)! };
}

function snapshotPolicy(
  rawPolicy: Record<string, unknown>,
  fallbackSchemaName: string,
  fallbackTableName?: string,
): SchemaPolicy {
  if (typeof rawPolicy.name !== 'string') {
    throw new Error('Invalid PostgreSQL policy in migration snapshot');
  }
  const target =
    fallbackTableName === undefined
      ? parseQualifiedObjectName(rawPolicy.on, fallbackSchemaName)
      : { schemaName: fallbackSchemaName, objectName: fallbackTableName };
  return {
    schemaName: target.schemaName,
    tableName: target.objectName,
    name: rawPolicy.name,
    permissive: rawPolicy.as !== 'RESTRICTIVE',
    command: typeof rawPolicy.for === 'string' ? rawPolicy.for.toUpperCase() : 'ALL',
    roles: Array.isArray(rawPolicy.to) ? rawPolicy.to.map(String).sort() : ['public'],
    using: normalizeSchemaExpression(rawPolicy.using),
    withCheck: normalizeSchemaExpression(rawPolicy.withCheck),
  };
}

export function normalizeSchemaFingerprint(fingerprint: SchemaFingerprint): SchemaFingerprint {
  return {
    tables: [...(fingerprint.tables ?? [])].sort(),
    columns: [...(fingerprint.columns ?? [])].sort((left, right) =>
      schemaColumnKey(left).localeCompare(schemaColumnKey(right)),
    ),
    constraints: sortObjects([...(fingerprint.constraints ?? [])]),
    indexes: sortObjects([...(fingerprint.indexes ?? [])]),
    enums: sortObjects([...(fingerprint.enums ?? [])]),
    sequences: sortObjects([...(fingerprint.sequences ?? [])]),
    schemas: [...(fingerprint.schemas ?? [])].sort(),
    views: sortObjects([...(fingerprint.views ?? [])]),
    policies: sortObjects([...(fingerprint.policies ?? [])]),
    roles: sortObjects([...(fingerprint.roles ?? [])]),
    rlsEnabledTables: [...(fingerprint.rlsEnabledTables ?? [])].sort(),
  };
}

export function normalizePostgresIdentifier(identifier: string): string {
  if (Buffer.byteLength(identifier, 'utf8') <= POSTGRES_IDENTIFIER_MAX_BYTES) {
    return identifier;
  }

  let normalized = '';
  let byteLength = 0;
  for (const character of identifier) {
    const characterByteLength = Buffer.byteLength(character, 'utf8');
    if (byteLength + characterByteLength > POSTGRES_IDENTIFIER_MAX_BYTES) break;
    normalized += character;
    byteLength += characterByteLength;
  }
  return normalized;
}

function normalizePostgresNamedObjectsForComparison(
  fingerprint: SchemaFingerprint,
): SchemaFingerprint {
  const normalizedConstraintNames = new Map<string, string>();
  const constraints = fingerprint.constraints.map((constraint) => {
    const normalizedName = normalizePostgresIdentifier(constraint.name);
    const key = `${constraint.schemaName}\u0000${constraint.tableName}\u0000${normalizedName}`;
    const existingName = normalizedConstraintNames.get(key);
    if (existingName !== undefined && existingName !== constraint.name) {
      throw new Error(
        `PostgreSQL identifier collision after 63-byte normalization: constraint ${constraint.schemaName}.${constraint.tableName}.${normalizedName} (${existingName}, ${constraint.name})`,
      );
    }
    normalizedConstraintNames.set(key, constraint.name);
    return { ...constraint, name: normalizedName };
  });

  const normalizedIndexNames = new Map<string, string>();
  const indexes = fingerprint.indexes.map((index) => {
    const normalizedName = normalizePostgresIdentifier(index.name);
    const key = `${index.schemaName}\u0000${normalizedName}`;
    const existingName = normalizedIndexNames.get(key);
    if (existingName !== undefined && existingName !== index.name) {
      throw new Error(
        `PostgreSQL identifier collision after 63-byte normalization: index ${index.schemaName}.${normalizedName} (${existingName}, ${index.name})`,
      );
    }
    normalizedIndexNames.set(key, index.name);
    return { ...index, name: normalizedName };
  });

  return {
    ...fingerprint,
    constraints,
    indexes,
  };
}

function normalizeSchemaFingerprintForComparison(
  fingerprint: SchemaFingerprint,
): SchemaFingerprint {
  const normalized = normalizePostgresNamedObjectsForComparison(
    normalizeSchemaFingerprint(fingerprint),
  );
  const textColumnsByTable = new Map<string, Set<string>>();
  for (const column of normalized.columns) {
    if (!isTextColumnType(column.dataType)) continue;
    const key = `${column.schemaName}\u0000${column.tableName}`;
    const columns = textColumnsByTable.get(key) ?? new Set<string>();
    columns.add(column.columnName);
    textColumnsByTable.set(key, columns);
  }
  const textColumnsFor = (schemaName: string, tableName: string): ReadonlySet<string> =>
    textColumnsByTable.get(`${schemaName}\u0000${tableName}`) ?? new Set<string>();

  return normalizeSchemaFingerprint({
    ...normalized,
    columns: normalized.columns.map((column) => ({
      ...column,
      defaultExpression: normalizeJsonColumnDefault(column.defaultExpression, column.dataType),
    })),
    constraints: normalized.constraints.map((constraint) => ({
      ...constraint,
      columns: constraint.type === 'check' ? [] : constraint.columns,
      expression: normalizeSchemaPredicateExpression(
        constraint.expression,
        constraint.tableName,
        textColumnsFor(constraint.schemaName, constraint.tableName),
      ),
    })),
    indexes: normalized.indexes.map((index) => ({
      ...index,
      where: normalizeSchemaPredicateExpression(
        index.where,
        index.tableName,
        textColumnsFor(index.schemaName, index.tableName),
      ),
    })),
    policies: normalized.policies.map((policy) => ({
      ...policy,
      using: normalizeSchemaPredicateExpression(
        policy.using,
        policy.tableName,
        textColumnsFor(policy.schemaName, policy.tableName),
      ),
      withCheck: normalizeSchemaPredicateExpression(
        policy.withCheck,
        policy.tableName,
        textColumnsFor(policy.schemaName, policy.tableName),
      ),
    })),
  });
}

export function emptySchemaFingerprint(): SchemaFingerprint {
  return {
    tables: [],
    columns: [],
    constraints: [],
    indexes: [],
    enums: [],
    sequences: [],
    schemas: [],
    views: [],
    policies: [],
    roles: [],
    rlsEnabledTables: [],
  };
}

export function isSchemaFingerprintEmpty(fingerprint: SchemaFingerprint): boolean {
  const normalized = normalizeSchemaFingerprint(fingerprint);
  return (
    normalized.tables.length === 0 &&
    normalized.columns.length === 0 &&
    normalized.constraints.length === 0 &&
    normalized.indexes.length === 0 &&
    normalized.enums.length === 0 &&
    normalized.sequences.length === 0 &&
    normalized.schemas.length === 0 &&
    normalized.views.length === 0 &&
    normalized.policies.length === 0 &&
    normalized.roles.length === 0 &&
    normalized.rlsEnabledTables.length === 0
  );
}

export function schemaFingerprintFromSnapshot(snapshot: unknown): SchemaFingerprint {
  if (!isRecord(snapshot) || snapshot.dialect !== 'postgresql' || !isRecord(snapshot.tables)) {
    throw new Error('Invalid PostgreSQL migration snapshot');
  }

  const fingerprint = emptySchemaFingerprint();
  for (const [qualifiedTableName, rawTable] of Object.entries(snapshot.tables)) {
    if (!isRecord(rawTable) || typeof rawTable.name !== 'string' || !isRecord(rawTable.columns)) {
      throw new Error(`Invalid table in migration snapshot: ${qualifiedTableName}`);
    }

    const qualifiedParts = qualifiedTableName.split('.');
    const schemaName =
      typeof rawTable.schema === 'string' && rawTable.schema.length > 0
        ? rawTable.schema
        : qualifiedParts.length > 1
          ? qualifiedParts[0]!
          : 'public';
    fingerprint.tables.push(`${schemaName}.${rawTable.name}`);
    if (rawTable.isRLSEnabled === true) {
      fingerprint.rlsEnabledTables.push(`${schemaName}.${rawTable.name}`);
    }

    const inlinePrimaryKeyColumns: string[] = [];
    for (const [columnKey, rawColumn] of Object.entries(rawTable.columns)) {
      if (
        !isRecord(rawColumn) ||
        typeof rawColumn.name !== 'string' ||
        typeof rawColumn.type !== 'string' ||
        typeof rawColumn.notNull !== 'boolean'
      ) {
        throw new Error(
          `Invalid column in migration snapshot: ${schemaName}.${rawTable.name}.${columnKey}`,
        );
      }
      const serial = serialType(rawColumn.type);
      const generated = isRecord(rawColumn.generated)
        ? normalizeSchemaExpression(rawColumn.generated.as)
        : null;
      const identity = normalizeIdentity(rawColumn.identity, schemaName, rawColumn.type);
      fingerprint.columns.push({
        schemaName,
        tableName: rawTable.name,
        columnName: rawColumn.name,
        dataType: normalizeSnapshotType(rawColumn.type),
        dataTypeSchema:
          typeof rawColumn.typeSchema === 'string' && rawColumn.typeSchema.length > 0
            ? rawColumn.typeSchema
            : null,
        notNull: rawColumn.notNull,
        defaultExpression:
          serial || generated !== null || identity !== null
            ? null
            : normalizeSchemaExpression(rawColumn.default),
        generatedExpression: generated,
        identity,
        serial,
      });
      if (rawColumn.primaryKey === true) {
        inlinePrimaryKeyColumns.push(rawColumn.name);
      }
      if (rawColumn.isUnique === true) {
        fingerprint.constraints.push({
          schemaName,
          tableName: rawTable.name,
          name:
            typeof rawColumn.uniqueName === 'string'
              ? rawColumn.uniqueName
              : `${rawTable.name}_${rawColumn.name}_unique`,
          type: 'unique',
          columns: [rawColumn.name],
          nullsNotDistinct: rawColumn.nullsNotDistinct === true,
          expression: null,
          referencedSchemaName: null,
          referencedTableName: null,
          referencedColumns: [],
          onUpdate: null,
          onDelete: null,
        });
      }
    }

    const compositePrimaryKeys = isRecord(rawTable.compositePrimaryKeys)
      ? rawTable.compositePrimaryKeys
      : {};
    if (Object.keys(compositePrimaryKeys).length === 0 && inlinePrimaryKeyColumns.length > 0) {
      fingerprint.constraints.push({
        schemaName,
        tableName: rawTable.name,
        name: `${rawTable.name}_pkey`,
        type: 'primaryKey',
        columns: inlinePrimaryKeyColumns,
        nullsNotDistinct: null,
        expression: null,
        referencedSchemaName: null,
        referencedTableName: null,
        referencedColumns: [],
        onUpdate: null,
        onDelete: null,
      });
    }
    for (const rawConstraint of Object.values(compositePrimaryKeys)) {
      if (
        !isRecord(rawConstraint) ||
        typeof rawConstraint.name !== 'string' ||
        !Array.isArray(rawConstraint.columns)
      ) {
        throw new Error(`Invalid primary key in migration snapshot: ${qualifiedTableName}`);
      }
      fingerprint.constraints.push({
        schemaName,
        tableName: rawTable.name,
        name: rawConstraint.name,
        type: 'primaryKey',
        columns: rawConstraint.columns.map(String),
        nullsNotDistinct: null,
        expression: null,
        referencedSchemaName: null,
        referencedTableName: null,
        referencedColumns: [],
        onUpdate: null,
        onDelete: null,
      });
    }

    const uniqueConstraints = isRecord(rawTable.uniqueConstraints)
      ? rawTable.uniqueConstraints
      : {};
    for (const rawConstraint of Object.values(uniqueConstraints)) {
      if (
        !isRecord(rawConstraint) ||
        typeof rawConstraint.name !== 'string' ||
        !Array.isArray(rawConstraint.columns)
      ) {
        throw new Error(`Invalid unique constraint in migration snapshot: ${qualifiedTableName}`);
      }
      fingerprint.constraints.push({
        schemaName,
        tableName: rawTable.name,
        name: rawConstraint.name,
        type: 'unique',
        columns: rawConstraint.columns.map(String),
        nullsNotDistinct: rawConstraint.nullsNotDistinct === true,
        expression: null,
        referencedSchemaName: null,
        referencedTableName: null,
        referencedColumns: [],
        onUpdate: null,
        onDelete: null,
      });
    }

    const checkConstraints = isRecord(rawTable.checkConstraints) ? rawTable.checkConstraints : {};
    for (const rawConstraint of Object.values(checkConstraints)) {
      if (!isRecord(rawConstraint) || typeof rawConstraint.name !== 'string') {
        throw new Error(`Invalid check constraint in migration snapshot: ${qualifiedTableName}`);
      }
      fingerprint.constraints.push({
        schemaName,
        tableName: rawTable.name,
        name: rawConstraint.name,
        type: 'check',
        columns: [],
        nullsNotDistinct: null,
        expression: normalizeSchemaExpression(rawConstraint.value),
        referencedSchemaName: null,
        referencedTableName: null,
        referencedColumns: [],
        onUpdate: null,
        onDelete: null,
      });
    }

    const foreignKeys = isRecord(rawTable.foreignKeys) ? rawTable.foreignKeys : {};
    for (const rawConstraint of Object.values(foreignKeys)) {
      if (
        !isRecord(rawConstraint) ||
        typeof rawConstraint.name !== 'string' ||
        typeof rawConstraint.tableTo !== 'string' ||
        !Array.isArray(rawConstraint.columnsFrom) ||
        !Array.isArray(rawConstraint.columnsTo)
      ) {
        throw new Error(`Invalid foreign key in migration snapshot: ${qualifiedTableName}`);
      }
      fingerprint.constraints.push({
        schemaName,
        tableName: rawTable.name,
        name: rawConstraint.name,
        type: 'foreignKey',
        columns: rawConstraint.columnsFrom.map(String),
        nullsNotDistinct: null,
        expression: null,
        referencedSchemaName:
          typeof rawConstraint.schemaTo === 'string' ? rawConstraint.schemaTo : schemaName,
        referencedTableName: rawConstraint.tableTo,
        referencedColumns: rawConstraint.columnsTo.map(String),
        onUpdate:
          typeof rawConstraint.onUpdate === 'string'
            ? rawConstraint.onUpdate.toLowerCase()
            : 'no action',
        onDelete:
          typeof rawConstraint.onDelete === 'string'
            ? rawConstraint.onDelete.toLowerCase()
            : 'no action',
      });
    }

    const indexes = isRecord(rawTable.indexes) ? rawTable.indexes : {};
    for (const rawIndex of Object.values(indexes)) {
      if (
        !isRecord(rawIndex) ||
        typeof rawIndex.name !== 'string' ||
        !Array.isArray(rawIndex.columns)
      ) {
        throw new Error(`Invalid index in migration snapshot: ${qualifiedTableName}`);
      }
      const indexColumns = rawIndex.columns.map((rawColumn): SchemaIndexColumn => {
        if (
          !isRecord(rawColumn) ||
          typeof rawColumn.expression !== 'string' ||
          typeof rawColumn.isExpression !== 'boolean'
        ) {
          throw new Error(`Invalid index column in migration snapshot: ${rawIndex.name}`);
        }
        const asc = rawColumn.asc !== false;
        return {
          expression: normalizeSchemaExpression(rawColumn.expression)!,
          isExpression: rawColumn.isExpression,
          asc,
          nulls: typeof rawColumn.nulls === 'string' ? rawColumn.nulls : asc ? 'last' : 'first',
          opclass: typeof rawColumn.opclass === 'string' ? rawColumn.opclass : null,
        };
      });
      fingerprint.indexes.push({
        schemaName,
        tableName: rawTable.name,
        name: rawIndex.name,
        isUnique: rawIndex.isUnique === true,
        method: typeof rawIndex.method === 'string' ? rawIndex.method : 'btree',
        columns: indexColumns,
        where: normalizeSchemaExpression(rawIndex.where),
        with: normalizeStringRecord(rawIndex.with),
      });
    }

    const policies = isRecord(rawTable.policies) ? rawTable.policies : {};
    for (const rawPolicy of Object.values(policies)) {
      if (!isRecord(rawPolicy)) {
        throw new Error(`Invalid policy in migration snapshot: ${qualifiedTableName}`);
      }
      fingerprint.policies.push(snapshotPolicy(rawPolicy, schemaName, rawTable.name));
    }
  }

  const enums = isRecord(snapshot.enums) ? snapshot.enums : {};
  for (const rawEnum of Object.values(enums)) {
    if (
      !isRecord(rawEnum) ||
      typeof rawEnum.name !== 'string' ||
      typeof rawEnum.schema !== 'string' ||
      !Array.isArray(rawEnum.values)
    ) {
      throw new Error('Invalid PostgreSQL enum in migration snapshot');
    }
    fingerprint.enums.push({
      schemaName: rawEnum.schema || 'public',
      name: rawEnum.name,
      values: rawEnum.values.map(String),
    });
  }

  const sequences = isRecord(snapshot.sequences) ? snapshot.sequences : {};
  for (const rawSequence of Object.values(sequences)) {
    if (!isRecord(rawSequence)) {
      throw new Error('Invalid PostgreSQL sequence in migration snapshot');
    }
    fingerprint.sequences.push(normalizeSequence(rawSequence, 'public'));
  }

  const schemas = isRecord(snapshot.schemas) ? snapshot.schemas : {};
  fingerprint.schemas.push(
    ...Object.values(schemas)
      .filter((value): value is string => typeof value === 'string')
      .filter((value) => value !== 'public'),
  );

  const views = isRecord(snapshot.views) ? snapshot.views : {};
  for (const rawView of Object.values(views)) {
    if (
      !isRecord(rawView) ||
      rawView.isExisting === true ||
      typeof rawView.name !== 'string' ||
      typeof rawView.schema !== 'string' ||
      !isRecord(rawView.columns)
    ) {
      if (isRecord(rawView) && rawView.isExisting === true) continue;
      throw new Error('Invalid PostgreSQL view in migration snapshot');
    }
    const options: Record<string, string> = normalizeStringRecord(rawView.with);
    if (rawView.materialized === true) {
      options.using = typeof rawView.using === 'string' ? rawView.using : 'heap';
    }
    if (
      typeof rawView.tablespace === 'string' &&
      rawView.tablespace.length > 0 &&
      rawView.tablespace !== 'pg_default'
    ) {
      options.tablespace = rawView.tablespace;
    }
    fingerprint.views.push({
      schemaName: rawView.schema || 'public',
      name: rawView.name,
      materialized: rawView.materialized === true,
      definition: normalizeSchemaExpression(rawView.definition),
      columns: Object.values(rawView.columns).map((rawColumn): SchemaViewColumn => {
        if (
          !isRecord(rawColumn) ||
          typeof rawColumn.name !== 'string' ||
          typeof rawColumn.type !== 'string' ||
          typeof rawColumn.notNull !== 'boolean'
        ) {
          throw new Error(`Invalid column in PostgreSQL view: ${rawView.name}`);
        }
        return {
          name: rawColumn.name,
          dataType: normalizeSnapshotType(rawColumn.type),
          dataTypeSchema:
            typeof rawColumn.typeSchema === 'string' && rawColumn.typeSchema.length > 0
              ? rawColumn.typeSchema
              : null,
          notNull: rawColumn.notNull,
        };
      }),
      options: normalizeStringRecord(options),
    });
  }

  const policies = isRecord(snapshot.policies) ? snapshot.policies : {};
  for (const rawPolicy of Object.values(policies)) {
    if (!isRecord(rawPolicy)) {
      throw new Error('Invalid PostgreSQL policy in migration snapshot');
    }
    const schemaName =
      typeof rawPolicy.schema === 'string' && rawPolicy.schema.length > 0
        ? rawPolicy.schema
        : 'public';
    fingerprint.policies.push(snapshotPolicy(rawPolicy, schemaName));
  }

  const roles = isRecord(snapshot.roles) ? snapshot.roles : {};
  for (const rawRole of Object.values(roles)) {
    if (!isRecord(rawRole) || typeof rawRole.name !== 'string') {
      throw new Error('Invalid PostgreSQL role in migration snapshot');
    }
    fingerprint.roles.push({
      name: rawRole.name,
      createDb: rawRole.createDb === true,
      createRole: rawRole.createRole === true,
      inherit: rawRole.inherit !== false,
    });
  }

  return normalizeSchemaFingerprint(fingerprint);
}

function compareStringSet(
  kind: string,
  expectedValues: readonly string[],
  actualValues: readonly string[],
  differences: string[],
): void {
  const expectedSet = new Set(expectedValues);
  const actualSet = new Set(actualValues);
  for (const value of expectedSet) {
    if (!actualSet.has(value)) differences.push(`missing ${kind} ${value}`);
  }
  for (const value of actualSet) {
    if (!expectedSet.has(value)) differences.push(`unexpected ${kind} ${value}`);
  }
}

function compareObjectSet<T extends Parameters<typeof objectIdentity>[0]>(
  kind: string,
  expectedValues: readonly T[],
  actualValues: readonly T[],
  differences: string[],
): void {
  const expectedByValue = new Map(
    expectedValues.map((value) => [canonicalJson(value), objectIdentity(value)]),
  );
  const actualByValue = new Map(
    actualValues.map((value) => [canonicalJson(value), objectIdentity(value)]),
  );
  for (const [value, identity] of expectedByValue) {
    if (!actualByValue.has(value)) differences.push(`missing ${kind} ${identity}`);
  }
  for (const [value, identity] of actualByValue) {
    if (!expectedByValue.has(value)) differences.push(`unexpected ${kind} ${identity}`);
  }
}

export function compareSchemaFingerprint(
  expected: SchemaFingerprint,
  actual: SchemaFingerprint,
): string[] {
  const normalizedExpected = normalizeSchemaFingerprintForComparison(expected);
  const normalizedActual = normalizeSchemaFingerprintForComparison(actual);
  const differences: string[] = [];

  compareStringSet('table', normalizedExpected.tables, normalizedActual.tables, differences);
  compareStringSet('schema', normalizedExpected.schemas, normalizedActual.schemas, differences);
  compareStringSet(
    'RLS-enabled table',
    normalizedExpected.rlsEnabledTables,
    normalizedActual.rlsEnabledTables,
    differences,
  );

  const expectedColumns = new Map(
    normalizedExpected.columns.map((column) => [schemaColumnKey(column), column]),
  );
  const actualColumns = new Map(
    normalizedActual.columns.map((column) => [schemaColumnKey(column), column]),
  );
  for (const [key, column] of expectedColumns) {
    if (!actualColumns.has(key)) differences.push(`missing ${describeColumn(column)}`);
  }
  for (const [key, column] of actualColumns) {
    if (!expectedColumns.has(key)) differences.push(`unexpected ${describeColumn(column)}`);
  }

  compareObjectSet(
    'constraint',
    normalizedExpected.constraints,
    normalizedActual.constraints,
    differences,
  );
  compareObjectSet('index', normalizedExpected.indexes, normalizedActual.indexes, differences);
  compareObjectSet('enum', normalizedExpected.enums, normalizedActual.enums, differences);
  compareObjectSet(
    'sequence',
    normalizedExpected.sequences,
    normalizedActual.sequences,
    differences,
  );
  compareObjectSet('view', normalizedExpected.views, normalizedActual.views, differences);
  compareObjectSet('policy', normalizedExpected.policies, normalizedActual.policies, differences);
  compareObjectSet('role', normalizedExpected.roles, normalizedActual.roles, differences);

  return differences.sort();
}

export function splitMigrationStatements(sql: string): string[] {
  return sql
    .split(STATEMENT_BREAKPOINT)
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);
}

function parseMigrationArtifactManifest(manifest: unknown): MigrationArtifactManifest {
  if (!isRecord(manifest)) {
    throw new Error('Missing checked migration artifact manifest');
  }
  if (manifest.version !== 1 || !Array.isArray(manifest.entries)) {
    throw new Error('Invalid checked migration artifact manifest');
  }
  const entries = manifest.entries.map((rawEntry, position): MigrationArtifactManifestEntry => {
    if (
      !isRecord(rawEntry) ||
      rawEntry.idx !== position ||
      typeof rawEntry.tag !== 'string' ||
      typeof rawEntry.sqlSha256 !== 'string' ||
      typeof rawEntry.snapshotSha256 !== 'string' ||
      typeof rawEntry.contractSha256 !== 'string' ||
      !/^[a-f0-9]{64}$/.test(rawEntry.sqlSha256) ||
      !/^[a-f0-9]{64}$/.test(rawEntry.snapshotSha256) ||
      !/^[a-f0-9]{64}$/.test(rawEntry.contractSha256)
    ) {
      throw new Error(`Invalid checked migration artifact manifest entry at idx ${position}`);
    }
    return {
      idx: rawEntry.idx,
      tag: rawEntry.tag,
      sqlSha256: rawEntry.sqlSha256,
      snapshotSha256: rawEntry.snapshotSha256,
      contractSha256: rawEntry.contractSha256,
    };
  });
  return { version: 1, entries };
}

function validateMigrationArtifactManifest(
  expected: MigrationArtifactManifest,
  actual: MigrationArtifactManifest,
): void {
  if (actual.entries.length !== expected.entries.length) {
    throw new Error(
      `Migration artifact manifest entry count mismatch: expected ${expected.entries.length}, received ${actual.entries.length}`,
    );
  }
  for (const expectedEntry of expected.entries) {
    const actualEntry = actual.entries[expectedEntry.idx];
    if (actualEntry?.idx !== expectedEntry.idx || actualEntry?.tag !== expectedEntry.tag) {
      throw new Error(`Migration artifact manifest identity mismatch at idx ${expectedEntry.idx}`);
    }
    for (const hashField of ['sqlSha256', 'snapshotSha256', 'contractSha256'] as const) {
      if (actualEntry[hashField] !== expectedEntry[hashField]) {
        throw new Error(
          `Migration artifact manifest ${hashField} mismatch at idx ${expectedEntry.idx} (${expectedEntry.tag})`,
        );
      }
    }
  }
}

export function buildMigrationPlan(input: BuildMigrationPlanInput): MigrationPlan {
  const expectedManifest = createMigrationArtifactManifest(input);
  const manifest = parseMigrationArtifactManifest(input.manifest);
  validateMigrationArtifactManifest(expectedManifest, manifest);
  const journalEntries = parseJournal(input.journal);
  const referencedSqlFiles = new Set(journalEntries.map((entry) => `${entry.tag}.sql`));

  for (const fileName of referencedSqlFiles) {
    if (!input.sqlFiles.has(fileName)) {
      throw new Error(`Migration journal references missing SQL file: ${fileName}`);
    }
  }

  for (const fileName of [...input.sqlFiles.keys()].sort()) {
    if (!referencedSqlFiles.has(fileName)) {
      throw new Error(`Unreferenced migration SQL file: ${fileName}`);
    }
  }

  const migrations = journalEntries.map(({ idx, tag }) => {
    const fileName = `${tag}.sql`;
    const rawSql = input.sqlFiles.get(fileName)!;
    const bytes = typeof rawSql === 'string' ? Buffer.from(rawSql, 'utf8') : Buffer.from(rawSql);
    const sql = bytes.toString('utf8').replace(/\r\n?/g, '\n');
    const snapshotName = `${String(idx).padStart(4, '0')}_snapshot.json`;
    if (!input.snapshots.has(snapshotName)) {
      throw new Error(`Missing migration snapshot: meta/${snapshotName}`);
    }

    return {
      idx,
      tag,
      fileName,
      checksum: createHash('sha256').update(sql, 'utf8').digest('hex'),
      snapshotChecksum: expectedManifest.entries[idx]!.snapshotSha256,
      contractChecksum: expectedManifest.entries[idx]!.contractSha256,
      sql,
      statements: splitMigrationStatements(sql),
      schema: schemaFingerprintFromSnapshot(input.snapshots.get(snapshotName)),
    };
  });

  if (migrations[0]?.tag !== BASELINE_TAG) {
    throw new Error(`Migration idx 0 must be the ${BASELINE_TAG} adoption baseline`);
  }

  return { migrations };
}

export function loadMigrationPlan(migrationsDir: string): MigrationPlan {
  const journal = JSON.parse(
    readFileSync(join(migrationsDir, 'meta', '_journal.json'), 'utf8'),
  ) as unknown;
  const sqlFiles = new Map<string, Uint8Array>();
  for (const entry of readdirSync(migrationsDir, {
    recursive: true,
    withFileTypes: true,
  })) {
    if (entry.isFile() && entry.name.endsWith('.sql')) {
      const absolutePath = join(entry.parentPath, entry.name);
      const fileName = relative(migrationsDir, absolutePath).replaceAll('\\', '/');
      sqlFiles.set(fileName, readFileSync(absolutePath));
    }
  }

  const snapshots = new Map<string, unknown>();
  const metaDir = join(migrationsDir, 'meta');
  for (const entry of readdirSync(metaDir, { withFileTypes: true })) {
    if (entry.isFile() && /^\d{4}_snapshot\.json$/.test(entry.name)) {
      snapshots.set(
        entry.name,
        JSON.parse(readFileSync(join(metaDir, entry.name), 'utf8')) as unknown,
      );
    }
  }

  // Keep the Sentris seal outside meta/: Drizzle treats every JSON file there as a snapshot.
  const manifestPath = join(migrationsDir, 'manifest.json');
  let manifest: unknown;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as unknown;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error('Missing checked migration artifact manifest: manifest.json');
    }
    throw error;
  }

  return buildMigrationPlan({ journal, sqlFiles, snapshots, manifest });
}

export function validateLedgerPrefix(
  plan: MigrationPlan,
  ledger: readonly AppliedMigration[],
): number {
  for (let position = 0; position < ledger.length; position += 1) {
    const row = ledger[position]!;
    if (row.idx !== position) {
      throw new Error(`Migration ledger is gapped: expected idx ${position}, received ${row.idx}`);
    }

    const expected = plan.migrations[position];
    if (!expected) {
      throw new Error(`Migration ledger contains unknown idx ${row.idx} (${row.tag})`);
    }
    if (row.tag !== expected.tag) {
      throw new Error(
        `Migration ledger tag mismatch at idx ${row.idx}: expected ${expected.tag}, received ${row.tag}`,
      );
    }
    if (row.checksum !== expected.checksum) {
      throw new Error(`Migration checksum drift at idx ${row.idx} (${row.tag})`);
    }
  }

  return ledger.length;
}

async function inTransaction(
  database: CheckedMigrationDatabase,
  operation: () => Promise<void>,
): Promise<void> {
  await database.begin();
  try {
    await database.createLedger();
    await operation();
    await database.commit();
  } catch (error) {
    await database.rollback();
    throw error;
  }
}

function assertSupportedAdoptionVersion(adoptVersion: string | undefined): void {
  if (adoptVersion !== undefined && adoptVersion !== SUPPORTED_ADOPTION_VERSION) {
    throw new Error(
      `Unsupported adoption version: ${adoptVersion}. Expected ${SUPPORTED_ADOPTION_VERSION}`,
    );
  }
}

export async function runCheckedMigrations({
  database,
  plan,
  adoptVersion,
  onStatus,
}: RunCheckedMigrationsOptions): Promise<RunCheckedMigrationsResult> {
  assertSupportedAdoptionVersion(adoptVersion);
  let lockAcquired = false;

  try {
    await database.acquireLock();
    lockAcquired = true;

    const ledgerExists = await database.hasLedger();
    let nextMigration = 0;
    let adopted = false;

    if (ledgerExists) {
      if (adoptVersion !== undefined) {
        throw new Error(
          `--adopt ${SUPPORTED_ADOPTION_VERSION} is valid only when no migration ledger exists`,
        );
      }
      nextMigration = validateLedgerPrefix(plan, await database.readLedger());
      if (nextMigration === 0) {
        const schema = await database.inspectPublicSchema(plan.migrations[0]!.schema);
        if (!isSchemaFingerprintEmpty(schema)) {
          throw new Error('Migration ledger is empty but the public schema is not empty');
        }
      }
    } else {
      const baseline = plan.migrations[0]!;
      const schema = await database.inspectPublicSchema(baseline.schema);
      if (isSchemaFingerprintEmpty(schema)) {
        if (adoptVersion !== undefined) {
          throw new Error(`Cannot adopt ${SUPPORTED_ADOPTION_VERSION} into an empty database`);
        }
      } else {
        if (adoptVersion === undefined) {
          throw new Error(
            'Database has no checked migration ledger and is not empty; refuse to infer migration history. Use --adopt v1.0.0 only for an exact previous-release database.',
          );
        }

        const differences = compareSchemaFingerprint(baseline.schema, schema);
        if (differences.length > 0) {
          throw new Error(
            `Database schema does not exactly match ${SUPPORTED_ADOPTION_VERSION}: ${differences
              .slice(0, 10)
              .join('; ')}`,
          );
        }

        await inTransaction(database, async () => {
          await database.recordMigration({
            idx: baseline.idx,
            tag: baseline.tag,
            checksum: baseline.checksum,
          });
        });
        adopted = true;
        nextMigration = 1;
        onStatus?.(`Adopted ${SUPPORTED_ADOPTION_VERSION} as ${baseline.tag}`);
      }
    }

    const applied: string[] = [];
    for (const migration of plan.migrations.slice(nextMigration)) {
      onStatus?.(`Applying ${migration.tag}`);
      await inTransaction(database, async () => {
        for (const statement of migration.statements) {
          await database.executeStatement(statement);
        }
        await database.recordMigration({
          idx: migration.idx,
          tag: migration.tag,
          checksum: migration.checksum,
        });
      });
      applied.push(migration.tag);
      onStatus?.(`Applied ${migration.tag}`);
    }

    return { adopted, applied };
  } finally {
    if (lockAcquired) {
      await database.releaseLock();
    }
  }
}
