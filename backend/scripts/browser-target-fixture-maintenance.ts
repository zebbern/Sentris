/* eslint-disable no-console -- This guarded maintenance command reports its resolved target. */
import { Pool } from 'pg';
import {
  formatDatabaseTarget,
  getScriptDatabaseTarget,
  type ScriptDatabaseTarget,
} from '@sentris/local-runtime';

const DATABASE_OVERRIDE_ENV = 'BROWSER_TARGET_FIXTURE_DATABASE_URL';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RUN_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,255}$/;
const FINDING_ID_PATTERN = /^fo_v1_[a-f0-9]{64}$/;
const ASSET_TYPES = new Set([
  'subdomain',
  'host',
  'ip-address',
  'open-port',
  'http-probe',
  'dns-record',
  'crawled-url',
  'url',
]);

type ScriptEnvironment = Record<string, string | undefined>;

interface FixtureRun {
  runId: string;
  createdAt: string;
}

interface FixtureAsset {
  id: string;
  assetType: string;
  assetValue: string;
  sourceRunId: string;
}

export interface BrowserTargetFixtureSeedPayload {
  action: 'seed';
  organizationId: string;
  workflowId: string;
  workflowVersionId: string;
  workflowVersion: number;
  scopeId: string;
  runs: FixtureRun[];
  assets: FixtureAsset[];
}

export interface BrowserTargetFixtureCleanupPayload {
  action: 'cleanup';
  organizationId: string;
  runIds: string[];
  assetIds: string[];
  findingIds: string[];
}

export type BrowserTargetFixturePayload =
  | BrowserTargetFixtureSeedPayload
  | BrowserTargetFixtureCleanupPayload;

interface FixtureDatabaseClient {
  query(text: string, values?: unknown[]): Promise<unknown>;
  release(): void;
}

interface FixtureDatabasePool {
  connect(): Promise<FixtureDatabaseClient>;
  end(): Promise<void>;
}

interface ExecuteBrowserTargetFixtureMaintenanceOptions {
  payload: BrowserTargetFixturePayload;
  env?: ScriptEnvironment;
  resolveTarget?: () => ScriptDatabaseTarget;
  log?: (message: string) => void;
  createPool?: (connectionString: string) => FixtureDatabasePool;
  onQuery?: (text: string, values?: unknown[]) => void;
}

function assertString(value: unknown, name: string): asserts value is string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${name} is required`);
  }
}

function assertUuid(value: unknown, name: string): asserts value is string {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
    throw new Error(`${name} must be a UUID`);
  }
}

function assertRunId(value: unknown, name = 'runId'): asserts value is string {
  if (typeof value !== 'string' || !RUN_ID_PATTERN.test(value)) {
    throw new Error(`${name} contains unsupported characters`);
  }
}

function assertOrganizationId(value: unknown): asserts value is string {
  const hasControlCharacter =
    typeof value === 'string' &&
    [...value].some((character) => {
      const codePoint = character.codePointAt(0);
      return codePoint !== undefined && (codePoint <= 0x1f || codePoint === 0x7f);
    });
  if (typeof value !== 'string' || value.length < 1 || value.length > 191 || hasControlCharacter) {
    throw new Error('organizationId contains unsupported characters');
  }
}

function assertUnique(values: string[], name: string): void {
  if (new Set(values).size !== values.length) {
    throw new Error(`${name} must not contain duplicate identities`);
  }
}

function validateSeedPayload(
  payload: BrowserTargetFixtureSeedPayload,
): BrowserTargetFixtureSeedPayload {
  assertOrganizationId(payload.organizationId);
  assertUuid(payload.workflowId, 'workflowId');
  assertUuid(payload.workflowVersionId, 'workflowVersionId');
  assertUuid(payload.scopeId, 'scopeId');
  if (!Number.isInteger(payload.workflowVersion) || payload.workflowVersion < 1) {
    throw new Error('workflowVersion must be a positive integer');
  }
  if (!Array.isArray(payload.runs) || payload.runs.length < 51) {
    throw new Error('At least 51 history fixture runs are required');
  }
  if (!Array.isArray(payload.assets)) {
    throw new Error('assets must be an array');
  }

  const runIds = payload.runs.map((run, index) => {
    if (!run || typeof run !== 'object') throw new Error(`runs[${index}] is invalid`);
    assertRunId(run.runId, `runs[${index}].runId`);
    const createdAt = new Date(run.createdAt);
    if (Number.isNaN(createdAt.getTime())) {
      throw new Error(`runs[${index}].createdAt must be an ISO timestamp`);
    }
    return run.runId;
  });
  assertUnique(runIds, 'runs');
  const runIdSet = new Set(runIds);

  const assetIds = payload.assets.map((asset, index) => {
    if (!asset || typeof asset !== 'object') throw new Error(`assets[${index}] is invalid`);
    assertUuid(asset.id, `assets[${index}].id`);
    if (!ASSET_TYPES.has(asset.assetType)) {
      throw new Error(`Unsupported asset type ${asset.assetType}`);
    }
    assertString(asset.assetValue, `assets[${index}].assetValue`);
    assertRunId(asset.sourceRunId, `assets[${index}].sourceRunId`);
    if (!runIdSet.has(asset.sourceRunId)) {
      throw new Error(`Asset sourceRunId ${asset.sourceRunId} is not a fixture run`);
    }
    return asset.id;
  });
  assertUnique(assetIds, 'assets');
  return payload;
}

function validateCleanupPayload(
  payload: BrowserTargetFixtureCleanupPayload,
): BrowserTargetFixtureCleanupPayload {
  assertOrganizationId(payload.organizationId);
  if (!Array.isArray(payload.runIds)) throw new Error('runIds must be an array');
  if (!Array.isArray(payload.assetIds)) throw new Error('assetIds must be an array');
  if (!Array.isArray(payload.findingIds)) throw new Error('findingIds must be an array');

  for (const runId of payload.runIds) assertRunId(runId);
  for (const assetId of payload.assetIds) assertUuid(assetId, 'assetId');
  for (const findingId of payload.findingIds) {
    if (typeof findingId !== 'string' || !FINDING_ID_PATTERN.test(findingId)) {
      throw new Error('findingId is not a canonical finding observation ID');
    }
  }
  assertUnique(payload.runIds, 'runIds');
  assertUnique(payload.assetIds, 'assetIds');
  assertUnique(payload.findingIds, 'findingIds');
  return payload;
}

function validatePayload(payload: BrowserTargetFixturePayload): BrowserTargetFixturePayload {
  if (!payload || typeof payload !== 'object') {
    throw new Error('Fixture maintenance payload must be an object');
  }
  if (payload.action === 'seed') return validateSeedPayload(payload);
  if (payload.action === 'cleanup') return validateCleanupPayload(payload);
  throw new Error('Fixture maintenance action must be seed or cleanup');
}

export function resolveBrowserTargetFixtureDatabaseTarget(
  env: ScriptEnvironment = process.env,
): ScriptDatabaseTarget {
  if (!env[DATABASE_OVERRIDE_ENV]?.trim()) {
    throw new Error(
      `${DATABASE_OVERRIDE_ENV} must be set explicitly; active-instance database inference is disabled for the production browser journey`,
    );
  }
  return getScriptDatabaseTarget({
    env,
    overrideEnvVar: DATABASE_OVERRIDE_ENV,
  });
}

function createPostgresPool(connectionString: string): FixtureDatabasePool {
  return new Pool({ connectionString });
}

async function seedFixtures(
  payload: BrowserTargetFixtureSeedPayload,
  query: (text: string, values?: unknown[]) => Promise<unknown>,
): Promise<void> {
  for (const run of payload.runs) {
    const createdAt = new Date(run.createdAt);
    const closedAt = new Date(createdAt.getTime() + 5_000);
    await query(
      `INSERT INTO workflow_runs (
        run_id, workflow_id, workflow_version_id, workflow_version, scope_id,
        total_actions, inputs, trigger_type, trigger_label, input_preview,
        organization_id, status, close_time, created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5,
        $6, $7::jsonb, $8, $9, $10::jsonb,
        $11, $12, $13, $14, $15
      )`,
      [
        run.runId,
        payload.workflowId,
        payload.workflowVersionId,
        payload.workflowVersion,
        payload.scopeId,
        2,
        JSON.stringify({}),
        'api',
        'Browser release fixture',
        JSON.stringify({ runtimeInputs: {}, nodeOverrides: {} }),
        payload.organizationId,
        'COMPLETED',
        closedAt,
        createdAt,
        createdAt,
      ],
    );
  }

  for (const asset of payload.assets) {
    await query(
      `INSERT INTO asset_inventory (
        id, organization_id, scope_id, asset_type, asset_value,
        first_seen_run_id, last_seen_run_id, source_component_id, metadata
      ) VALUES (
        $1, $2, $3, $4::asset_type, $5,
        $6, $7, $8, $9::jsonb
      )`,
      [
        asset.id,
        payload.organizationId,
        payload.scopeId,
        asset.assetType,
        asset.assetValue.trim(),
        asset.sourceRunId,
        asset.sourceRunId,
        'browser.fixture',
        JSON.stringify({}),
      ],
    );
  }
}

async function cleanupFixtures(
  payload: BrowserTargetFixtureCleanupPayload,
  query: (text: string, values?: unknown[]) => Promise<unknown>,
): Promise<void> {
  if (payload.findingIds.length > 0) {
    await query(
      'DELETE FROM finding_triage WHERE organization_id = $1 AND finding_opensearch_id = ANY($2::text[])',
      [payload.organizationId, payload.findingIds],
    );
  }
  if (payload.assetIds.length > 0) {
    await query('DELETE FROM asset_inventory WHERE organization_id = $1 AND id = ANY($2::uuid[])', [
      payload.organizationId,
      payload.assetIds,
    ]);
  }
  if (payload.runIds.length > 0) {
    await query(
      'DELETE FROM workflow_runs WHERE organization_id = $1 AND run_id = ANY($2::text[])',
      [payload.organizationId, payload.runIds],
    );
  }
}

export async function executeBrowserTargetFixtureMaintenance({
  payload: unsafePayload,
  env = process.env,
  resolveTarget = () => resolveBrowserTargetFixtureDatabaseTarget(env),
  log = console.log,
  createPool = createPostgresPool,
  onQuery = () => {},
}: ExecuteBrowserTargetFixtureMaintenanceOptions): Promise<void> {
  if (!env[DATABASE_OVERRIDE_ENV]?.trim()) {
    throw new Error(`${DATABASE_OVERRIDE_ENV} must be set explicitly`);
  }
  const payload = validatePayload(unsafePayload);
  const target = resolveTarget();
  log(formatDatabaseTarget(target));
  log(`Connection: ${target.redactedConnectionString}`);

  const pool = createPool(target.connectionString);
  let client: FixtureDatabaseClient | undefined;
  let transactionStarted = false;
  try {
    client = await pool.connect();
    const query = async (text: string, values?: unknown[]) => {
      onQuery(text, values);
      return client!.query(text, values);
    };
    await query('BEGIN');
    transactionStarted = true;
    if (payload.action === 'seed') await seedFixtures(payload, query);
    else await cleanupFixtures(payload, query);
    await query('COMMIT');
    transactionStarted = false;
  } catch (error) {
    if (client && transactionStarted) {
      try {
        onQuery('ROLLBACK');
        await client.query('ROLLBACK');
      } catch {
        // Preserve the mutation failure; the caller still receives a non-zero exit.
      }
    }
    throw error;
  } finally {
    client?.release();
    await pool.end();
  }
}

async function readStandardInput(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
}

export async function runBrowserTargetFixtureMaintenanceCli(
  argv = process.argv.slice(2),
  env: ScriptEnvironment = process.env,
): Promise<void> {
  const action = argv[0];
  if ((action !== 'seed' && action !== 'cleanup') || argv.length !== 1) {
    throw new Error(
      'Usage: bun scripts/browser-target-fixture-maintenance.ts <seed|cleanup> < payload.json',
    );
  }
  const input = await readStandardInput();
  if (!input.trim()) throw new Error('Fixture maintenance payload is required on stdin');
  let parsed: unknown;
  try {
    parsed = JSON.parse(input);
  } catch {
    throw new Error('Fixture maintenance payload must be valid JSON');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Fixture maintenance payload must be a JSON object');
  }
  const suppliedAction = (parsed as { action?: unknown }).action;
  if (suppliedAction !== undefined && suppliedAction !== action) {
    throw new Error('Fixture maintenance payload action does not match the CLI action');
  }
  await executeBrowserTargetFixtureMaintenance({
    payload: { ...parsed, action } as BrowserTargetFixturePayload,
    env,
  });
}

if (import.meta.main) {
  runBrowserTargetFixtureMaintenanceCli().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
