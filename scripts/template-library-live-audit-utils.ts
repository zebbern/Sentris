import {
  createTemplateLiveAuditInputs,
  createTemplateValidationFingerprint,
  getTemplateComponentIds,
  getTemplateComponentValidationFingerprints,
  getTemplateComponentValidationVerifiedAt,
  type TemplateLiveAuditInputs,
  type TemplateValidationClassification,
} from '../packages/shared/src/template-validation-fingerprint';
import { readActiveInstance } from './lib/local-script-runtime';

export {
  createTemplateLiveAuditInputs,
  createTemplateValidationFingerprint,
  getTemplateComponentIds,
  getTemplateComponentValidationFingerprints,
  getTemplateComponentValidationVerifiedAt,
};
export type { TemplateLiveAuditInputs, TemplateValidationClassification };

export interface NodeIoEvidenceResponse {
  runId?: string;
  nodes?: Record<string, unknown>[];
  [key: string]: unknown;
}

export interface NodeIoNodeSummary {
  nodeRef: string;
  componentId?: string;
  status?: string;
  durationMs?: number | null;
  errorMessage?: string | null;
  inputKeys: string[];
  outputKeys: string[];
  warnings: string[];
  inputsSpilled: boolean;
  inputsTruncated: boolean;
  outputsSpilled: boolean;
  outputsTruncated: boolean;
}

export interface TemplateAuditMarkdownResult {
  templateId: string;
  templateName: string;
  seedFile: string | null;
  category: string | null;
  components: string[];
  outputHandles?: string[];
  requiredSecrets: string[];
  runtimeInputs: unknown[];
  classification: string;
  createOk: boolean;
  createError?: string;
  runAttempted: boolean;
  runStartOk?: boolean;
  runStartError?: string;
  terminalStatus?: string;
  statusError?: string;
  artifactsCount?: number;
  nodeIo?: NodeIoNodeSummary[];
  recommendation: string;
  rationale: string;
}

export type TemplateAuditRecommendation = 'keep' | 'fix' | 'consolidate' | 'delete' | 'review';

export interface TemplateAuditRecommendationInput {
  result: Pick<
    TemplateAuditMarkdownResult,
    | 'runAttempted'
    | 'runStartError'
    | 'terminalStatus'
    | 'statusError'
    | 'artifactsCount'
    | 'nodeIo'
  >;
  runtimeInputState: 'missing' | 'empty' | 'present';
  runtimeInputs: Array<{ id?: unknown; label?: unknown; description?: unknown }>;
  requiredSecrets: string[];
  missingSecretNames: string[];
  components: string[];
  hasUnmappedSlackNode: boolean;
}

export interface TemplateAuditRecommendationResult {
  recommendation: TemplateAuditRecommendation;
  rationale: string;
}

export interface RenderTemplateAuditMarkdownOptions {
  apiBase: string;
  outputRoot: string;
  generatedAt: string;
  results: TemplateAuditMarkdownResult[];
}

export interface WaitForNodeIoEvidenceOptions {
  runId: string;
  expectedNodeCount?: number;
  timeoutMs: number;
  pollIntervalMs: number;
  fetchNodeIo: () => Promise<NodeIoEvidenceResponse>;
  sleep?: (ms: number) => Promise<void>;
}

export interface RetryTransientAuditRequestOptions {
  delaysMs?: number[];
  sleep?: (ms: number) => Promise<void>;
  maxRetryAfterMs?: number;
}

export interface TemplateAuditRequestRetryPolicyInput {
  method?: string;
  path: string;
}

export interface TemplateAuditRuntimeProcessSnapshot {
  name: string;
  pid?: number | null;
  restartCount?: number | null;
  status?: string | null;
}

export interface TemplateAuditRuntimeSnapshot {
  available: boolean;
  processes: TemplateAuditRuntimeProcessSnapshot[];
  unavailableReason?: string;
}

export interface TemplateAuditRuntimeRestart {
  name: string;
  beforePid?: number | null;
  afterPid?: number | null;
  beforeRestartCount?: number | null;
  afterRestartCount?: number | null;
  beforeStatus?: string | null;
  afterStatus?: string | null;
}

export interface TemplateAuditRuntimeRestartDecisionInput {
  result: Pick<
    TemplateAuditMarkdownResult,
    | 'classification'
    | 'runAttempted'
    | 'terminalStatus'
    | 'runStartError'
    | 'statusError'
    | 'recommendation'
  >;
  before?: TemplateAuditRuntimeSnapshot | null;
  after?: TemplateAuditRuntimeSnapshot | null;
}

export interface TemplateAuditRuntimeRestartDecision {
  retryable: boolean;
  restarts: TemplateAuditRuntimeRestart[];
  rationale?: string;
}

export interface TemplateAuditRuntimeStabilityDecisionInput {
  before?: TemplateAuditRuntimeSnapshot | null;
  after?: TemplateAuditRuntimeSnapshot | null;
  requiredStatus?: string;
}

export interface TemplateAuditRuntimeStabilityDecision {
  stable: boolean;
  restarts: TemplateAuditRuntimeRestart[];
  unhealthyProcesses: TemplateAuditRuntimeProcessSnapshot[];
  rationale?: string;
}

const TRANSIENT_AUDIT_REQUEST_ERROR_PATTERN =
  /\b(fetch failed|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EAI_AGAIN|UND_ERR_CONNECT_TIMEOUT|UND_ERR_SOCKET|ConnectionRefused)\b/i;
const TRANSIENT_AUDIT_HTTP_STATUSES = new Set([408, 429, 502, 503, 504]);
const TEMPLATE_AUDIT_DEFAULT_READ_RETRY_DELAYS_MS = [250, 1000, 3000];
const TEMPLATE_AUDIT_RUN_STATUS_RETRY_DELAYS_MS = [1500, 3000, 5000, 10000, 15000, 30000];
const TEMPLATE_AUDIT_HEALTH_RETRY_DELAYS_MS = [
  250,
  1000,
  3000,
  5000,
  10000,
  15000,
  30000,
];
const TEMPLATE_AUDIT_MAX_RETRY_AFTER_MS = 60000;

export function getTemplateAuditRequestRetryDelays({
  method = 'GET',
  path,
}: TemplateAuditRequestRetryPolicyInput): number[] {
  const normalizedMethod = method.toUpperCase();
  if (normalizedMethod !== 'GET' && normalizedMethod !== 'HEAD') {
    return [];
  }

  const normalizedPath = path.split('?')[0]?.replace(/\/+$/, '') || '/';
  if (normalizedPath === '/health' || normalizedPath === '/health/ready') {
    return TEMPLATE_AUDIT_HEALTH_RETRY_DELAYS_MS;
  }

  if (/^\/workflows\/runs\/[^/]+\/status$/.test(normalizedPath)) {
    return TEMPLATE_AUDIT_RUN_STATUS_RETRY_DELAYS_MS;
  }

  return TEMPLATE_AUDIT_DEFAULT_READ_RETRY_DELAYS_MS;
}

function runtimeProcessChanged(
  before: TemplateAuditRuntimeProcessSnapshot,
  after: TemplateAuditRuntimeProcessSnapshot,
): boolean {
  if (before.pid !== undefined && after.pid !== undefined && before.pid !== after.pid) {
    return true;
  }

  if (
    before.restartCount !== undefined &&
    after.restartCount !== undefined &&
    before.restartCount !== after.restartCount
  ) {
    return true;
  }

  return before.status !== undefined && after.status !== undefined && before.status !== after.status;
}

export function getTemplateAuditRuntimeRestarts(
  before?: TemplateAuditRuntimeSnapshot | null,
  after?: TemplateAuditRuntimeSnapshot | null,
): TemplateAuditRuntimeRestart[] {
  if (!before?.available || !after?.available) return [];

  const beforeByName = new Map(before.processes.map((process) => [process.name, process]));
  const restarts: TemplateAuditRuntimeRestart[] = [];

  for (const nextProcess of after.processes) {
    const previousProcess = beforeByName.get(nextProcess.name);
    if (!previousProcess || !runtimeProcessChanged(previousProcess, nextProcess)) {
      continue;
    }

    restarts.push({
      name: nextProcess.name,
      beforePid: previousProcess.pid,
      afterPid: nextProcess.pid,
      beforeRestartCount: previousProcess.restartCount,
      afterRestartCount: nextProcess.restartCount,
      beforeStatus: previousProcess.status,
      afterStatus: nextProcess.status,
    });
  }

  return restarts;
}

function isFailedLiveRunResult(
  result: TemplateAuditRuntimeRestartDecisionInput['result'],
): boolean {
  if (result.classification !== 'live-run' || !result.runAttempted) {
    return false;
  }

  if (result.runStartError || result.statusError) {
    return true;
  }

  if (!result.terminalStatus) {
    return result.recommendation === 'fix';
  }

  return result.terminalStatus !== 'COMPLETED' && result.terminalStatus !== 'SKIPPED';
}

export function getTemplateAuditRuntimeRestartDecision({
  result,
  before,
  after,
}: TemplateAuditRuntimeRestartDecisionInput): TemplateAuditRuntimeRestartDecision {
  const restarts = getTemplateAuditRuntimeRestarts(before, after);
  if (!isFailedLiveRunResult(result) || restarts.length === 0) {
    return { retryable: false, restarts };
  }

  const labels = restarts.map((restart) => restart.name).join(', ');
  return {
    retryable: true,
    restarts,
    rationale: `${labels} restarted during the audit run; retry after runtime health recovers before treating this as a template failure.`,
  };
}

function getUnhealthyRuntimeProcesses(
  snapshot?: TemplateAuditRuntimeSnapshot | null,
  requiredStatus = 'online',
): TemplateAuditRuntimeProcessSnapshot[] {
  if (!snapshot?.available) return [];
  return snapshot.processes.filter((process) => process.status !== requiredStatus);
}

function formatRuntimeProcessState(process: TemplateAuditRuntimeProcessSnapshot): string {
  return `${process.name} is ${process.status ?? 'unknown'}`;
}

export function getTemplateAuditRuntimeStabilityDecision({
  before,
  after,
  requiredStatus = 'online',
}: TemplateAuditRuntimeStabilityDecisionInput): TemplateAuditRuntimeStabilityDecision {
  if (!before?.available || !after?.available) {
    return { stable: true, restarts: [], unhealthyProcesses: [] };
  }

  const restarts = getTemplateAuditRuntimeRestarts(before, after);
  const unhealthyProcesses = getUnhealthyRuntimeProcesses(after, requiredStatus);

  if (restarts.length === 0 && unhealthyProcesses.length === 0) {
    return { stable: true, restarts, unhealthyProcesses };
  }

  const rationaleParts: string[] = [];
  if (restarts.length > 0) {
    rationaleParts.push(
      `${restarts.map((restart) => restart.name).join(', ')} changed during the stability window`,
    );
  }
  if (unhealthyProcesses.length > 0) {
    rationaleParts.push(unhealthyProcesses.map(formatRuntimeProcessState).join(', '));
  }

  return {
    stable: false,
    restarts,
    unhealthyProcesses,
    rationale: `${rationaleParts.join('; ')}.`,
  };
}

function getAuditRequestHttpStatus(error: unknown): number | null {
  if (!error || typeof error !== 'object') return null;
  const status = (error as { status?: unknown }).status;
  return typeof status === 'number' ? status : null;
}

function getAuditRequestErrorSignals(error: unknown): string[] {
  const signals: string[] = [];

  if (error instanceof Error) {
    signals.push(error.message);
  } else if (typeof error === 'string') {
    signals.push(error);
  }

  if (error && typeof error === 'object') {
    const { code, cause } = error as { code?: unknown; cause?: unknown };
    if (typeof code === 'string') {
      signals.push(code);
    }
    if (cause instanceof Error) {
      signals.push(cause.message);
    } else if (cause && typeof cause === 'object') {
      const causeCode = (cause as { code?: unknown }).code;
      if (typeof causeCode === 'string') {
        signals.push(causeCode);
      }
    }
  }

  return signals;
}

export function isTransientAuditRequestError(error: unknown): boolean {
  const status = getAuditRequestHttpStatus(error);
  if (status !== null) {
    return TRANSIENT_AUDIT_HTTP_STATUSES.has(status);
  }

  return getAuditRequestErrorSignals(error).some((signal) =>
    TRANSIENT_AUDIT_REQUEST_ERROR_PATTERN.test(signal),
  );
}

function readRetryAfterHeaderValue(error: Record<string, unknown>): string | null {
  const explicit = error.retryAfter;
  if (typeof explicit === 'string' && explicit.trim().length > 0) {
    return explicit.trim();
  }

  const headers = error.headers;
  if (!headers || typeof headers !== 'object') {
    return null;
  }

  const get = (headers as { get?: unknown }).get;
  if (typeof get === 'function') {
    const value = get.call(headers, 'retry-after') ?? get.call(headers, 'Retry-After');
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
  }

  const record = headers as Record<string, unknown>;
  for (const [key, value] of Object.entries(record)) {
    if (key.toLowerCase() === 'retry-after' && typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }

  return null;
}

function parseRetryAfterMs(value: string): number | null {
  const numericSeconds = Number(value);
  if (Number.isFinite(numericSeconds) && numericSeconds >= 0) {
    return Math.ceil(numericSeconds * 1000);
  }

  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    return null;
  }

  return Math.max(0, timestamp - Date.now());
}

function getAuditRequestRetryAfterMs(error: unknown, maxRetryAfterMs: number): number | null {
  if (!error || typeof error !== 'object') return null;
  const retryAfterMs = (error as { retryAfterMs?: unknown }).retryAfterMs;
  if (typeof retryAfterMs === 'number' && Number.isFinite(retryAfterMs) && retryAfterMs >= 0) {
    return Math.min(retryAfterMs, maxRetryAfterMs);
  }

  const retryAfter = readRetryAfterHeaderValue(error as Record<string, unknown>);
  if (!retryAfter) return null;

  const parsed = parseRetryAfterMs(retryAfter);
  return parsed === null ? null : Math.min(parsed, maxRetryAfterMs);
}

export interface TemplateValidationLedgerEntry {
  templateName: string;
  seedFile: string | null;
  fingerprint: string;
  liveInputs?: Record<string, unknown>;
  classification?: TemplateValidationClassification;
  terminalStatus?: string;
  recommendation: string;
  rationale: string;
  artifactsCount?: number;
  verifiedAt: string;
  outputRoot?: string;
}

export interface TemplateValidationLedger {
  version: 1;
  entries: Record<string, TemplateValidationLedgerEntry>;
}

export interface TemplateValidationLedgerInput {
  templateName: string;
  seedFile: string | null;
  fingerprint: string;
  liveInputs?: Record<string, unknown>;
  classification?: TemplateValidationClassification;
  terminalStatus?: string;
  recommendation: string;
  rationale: string;
  artifactsCount?: number;
  outputRoot?: string;
}

export interface TemplateValidationSkipOptions {
  ledger: TemplateValidationLedger | undefined;
  templateName: string;
  classification: string;
  fingerprint: string;
  legacyFingerprint?: string;
  componentValidationVerifiedAt?: Record<string, string>;
  force: boolean;
}

export interface TemplateValidationSkipResult {
  terminalStatus: 'SKIPPED';
  recommendation: 'keep';
  rationale: string;
  artifactsCount?: number;
}

export interface TemplateAuditCliOptions {
  force: boolean;
  ledgerCheckOnly: boolean;
  organizationId?: string;
  templateNames: Set<string>;
}

export interface TemplateAuditSecretResolution {
  secretMappings: Record<string, string>;
  providedSecretNames: string[];
  missingSecretNames: string[];
}

export interface TemplateAuditApiBaseResolutionOptions {
  env?: Record<string, string | undefined>;
  repoRoot?: string;
}

export interface TemplateAuditApiBaseResolution {
  apiBase: string;
  source: string;
}

export type TemplateValidationFreshnessStatus =
  | 'current'
  | 'missing'
  | 'stale'
  | 'degraded'
  | 'not-live-run';

export interface TemplateValidationFreshnessInput {
  templateName: string;
  seedFile: string | null;
  fingerprint: string;
  legacyFingerprint?: string;
  componentValidationVerifiedAt?: Record<string, string>;
  classification: string;
}

export interface TemplateValidationFreshnessItem extends TemplateValidationFreshnessInput {
  status: TemplateValidationFreshnessStatus;
  rationale: string;
  verifiedAt?: string;
}

export interface TemplateValidationFreshnessCounts {
  current: number;
  missing: number;
  stale: number;
  degraded: number;
  notLiveRun: number;
}

export interface TemplateValidationFreshnessSummary {
  allLiveRunsCurrent: boolean;
  counts: TemplateValidationFreshnessCounts;
  items: TemplateValidationFreshnessItem[];
}

export interface TemplateCatalogDuplicateNameGroup {
  key: string;
  labels: string[];
}

export interface TemplateCatalogDuplicateFunctionalityGroup {
  key: string;
  labels: string[];
}

export interface TemplateCatalogLowValueCandidate {
  label: string;
  reason: string;
}

export interface TemplateCatalogRuntimeInputDefaultFailure {
  label: string;
  inputId: string;
  inputType: string;
  reason: string;
}

export interface TemplateSeedCatalogEntry {
  name: string;
  file: string;
}

export interface TemplateComponentCoverageSummary {
  componentTemplateCounts: Record<string, number>;
  unusedComponents: string[];
}

export interface TemplateOutputHandleRequirement {
  componentId: string;
  outputHandle: string;
  reason: string;
}

export interface TemplateOutputHandleCoverageSummary {
  outputHandleTemplateCounts: Record<string, number>;
  unusedOutputHandles: TemplateOutputHandleRequirement[];
}

export interface TemplateCatalogQualitySummary {
  duplicateNames: TemplateCatalogDuplicateNameGroup[];
  duplicateFunctionalities: TemplateCatalogDuplicateFunctionalityGroup[];
  lowValueCandidates: TemplateCatalogLowValueCandidate[];
  runtimeInputDefaultFailures: TemplateCatalogRuntimeInputDefaultFailure[];
}

export interface TemplateCatalogQualityCheckOptions {
  componentCoverageIds?: string[];
  requiredOutputHandles?: TemplateOutputHandleRequirement[];
  seedCatalogCoverageFailures?: string[];
}

const TEMPLATE_COVERAGE_EXCLUDED_COMPONENT_IDS = new Set(['sentris.security.terminal-demo']);

export function getTemplateCoverageComponentIds(componentIds: string[]): string[] {
  return [...new Set(componentIds)]
    .filter((componentId) => !TEMPLATE_COVERAGE_EXCLUDED_COMPONENT_IDS.has(componentId))
    .sort();
}

function normalizeAuditSecretEnvName(secretName: string): string {
  return `TEMPLATE_AUDIT_SECRET_${secretName.replace(/[^a-zA-Z0-9]+/g, '_').toUpperCase()}`;
}

function parseSecretMappingsJson(value: string | undefined): Record<string, string> {
  if (!value?.trim()) return {};

  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('not-object');
    }

    const mappings: Record<string, string> = {};
    for (const [key, rawValue] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof rawValue === 'string' && rawValue.trim().length > 0) {
        mappings[key] = rawValue;
      }
    }
    return mappings;
  } catch {
    throw new Error('TEMPLATE_AUDIT_SECRET_MAPPINGS must be a JSON object');
  }
}

function normalizeManagedSecretLookup(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function toManagedSecretSnakeCase(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_+/g, '_');
}

function uniqueNonEmpty(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

export function getTemplateAuditManagedSecretCandidates(secretName: string): string[] {
  const trimmed = secretName.trim();
  const snake = toManagedSecretSnakeCase(trimmed);
  const candidates = [trimmed, snake, snake.toUpperCase()];

  if (snake.endsWith('_webhook_url')) {
    const provider = snake.slice(0, -'_webhook_url'.length);
    candidates.push(
      `${provider}_webhook`,
      `webhook_${provider}`,
      `${provider}-webhook`,
      `webhook-${provider}`,
    );
  }

  if (snake.endsWith('_bot_token')) {
    const provider = snake.slice(0, -'_bot_token'.length);
    candidates.push(`${provider}_bot_token`, `bot_token_${provider}`);
  }

  return uniqueNonEmpty(candidates);
}

export function resolveTemplateAuditManagedSecretMappings(
  requiredSecretNames: string[],
  availableManagedSecretNames: string[],
  baseResolution: TemplateAuditSecretResolution = resolveTemplateAuditSecretMappings(
    requiredSecretNames,
  ),
): TemplateAuditSecretResolution {
  const secretMappings = { ...baseResolution.secretMappings };
  const availableByNormalized = new Map<string, string>();

  for (const availableName of availableManagedSecretNames) {
    const normalized = normalizeManagedSecretLookup(availableName);
    if (normalized && !availableByNormalized.has(normalized)) {
      availableByNormalized.set(normalized, availableName);
    }
  }

  const uniqueRequiredNames = Array.from(
    new Set(requiredSecretNames.map((name) => name.trim()).filter(Boolean)),
  );

  for (const secretName of uniqueRequiredNames) {
    if (secretMappings[secretName]) continue;

    for (const candidate of getTemplateAuditManagedSecretCandidates(secretName)) {
      const managedName = availableByNormalized.get(normalizeManagedSecretLookup(candidate));
      if (managedName) {
        secretMappings[secretName] = managedName;
        break;
      }
    }
  }

  return {
    secretMappings,
    providedSecretNames: uniqueRequiredNames.filter((name) => Boolean(secretMappings[name])),
    missingSecretNames: uniqueRequiredNames.filter((name) => !secretMappings[name]),
  };
}

export function resolveTemplateAuditSecretMappings(
  requiredSecretNames: string[],
  env: Record<string, string | undefined> = process.env,
): TemplateAuditSecretResolution {
  const jsonMappings = parseSecretMappingsJson(env.TEMPLATE_AUDIT_SECRET_MAPPINGS);
  const uniqueRequiredNames = Array.from(
    new Set(requiredSecretNames.map((name) => name.trim()).filter(Boolean)),
  );
  const secretMappings: Record<string, string> = {};

  for (const secretName of uniqueRequiredNames) {
    const jsonValue = jsonMappings[secretName];
    const envValue = env[normalizeAuditSecretEnvName(secretName)];
    const value =
      typeof jsonValue === 'string' && jsonValue.trim().length > 0 ? jsonValue : envValue;
    if (typeof value === 'string' && value.trim().length > 0) {
      secretMappings[secretName] = value;
    }
  }

  return {
    secretMappings,
    providedSecretNames: uniqueRequiredNames.filter((name) => Boolean(secretMappings[name])),
    missingSecretNames: uniqueRequiredNames.filter((name) => !secretMappings[name]),
  };
}

function splitTemplateNameList(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean);
}

function readFlagValue(argv: string[], index: number, flagName: string): string | undefined {
  const current = argv[index];
  const prefix = `${flagName}=`;
  if (current.startsWith(prefix)) {
    return current.slice(prefix.length).trim();
  }

  const next = argv[index + 1];
  if (current === flagName && next && !next.startsWith('--')) {
    return next.trim();
  }

  return undefined;
}

function readRequiredFlagValue(
  argv: string[],
  index: number,
  flagName: string,
  valueLabel: string,
): string {
  const value = readFlagValue(argv, index, flagName);
  if (!value) {
    throw new Error(`${flagName} requires ${valueLabel}`);
  }

  return value;
}

export function parseTemplateAuditCliOptions(
  argv: string[],
  env: Record<string, string | undefined> = process.env,
): TemplateAuditCliOptions {
  const templateNames = new Set(splitTemplateNameList(env.TEMPLATE_AUDIT_NAMES));
  let organizationId = env.SENTRIS_ORG_ID;
  let force = env.TEMPLATE_AUDIT_FORCE === 'true';
  let ledgerCheckOnly = env.TEMPLATE_AUDIT_LEDGER_CHECK === 'true';

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--force') {
      force = true;
      continue;
    }
    if (arg === '--ledger-check') {
      ledgerCheckOnly = true;
      continue;
    }
    if (arg === '--name' || arg.startsWith('--name=')) {
      const templateName = readRequiredFlagValue(argv, index, '--name', 'a template name');
      for (const name of splitTemplateNameList(templateName)) {
        templateNames.add(name);
      }
      if (arg === '--name') index += 1;
      continue;
    }
    if (arg === '--org-id' || arg.startsWith('--org-id=')) {
      organizationId = readRequiredFlagValue(argv, index, '--org-id', 'an organization id');
      if (arg === '--org-id') index += 1;
      continue;
    }
    if (arg.startsWith('--')) {
      throw new Error(`Unknown template audit option: ${arg}`);
    }
    throw new Error(`Unknown template audit argument: ${arg}`);
  }

  return {
    force,
    ledgerCheckOnly,
    ...(organizationId ? { organizationId } : {}),
    templateNames,
  };
}

export function resolveTemplateAuditApiBase({
  env = process.env,
  repoRoot,
}: TemplateAuditApiBaseResolutionOptions = {}): TemplateAuditApiBaseResolution {
  const explicitApiBase = env.SENTRIS_API_BASE_URL?.trim();
  if (explicitApiBase) {
    return { apiBase: explicitApiBase, source: 'env:SENTRIS_API_BASE_URL' };
  }

  const legacyApiBase = env.API_BASE?.trim();
  if (legacyApiBase) {
    return { apiBase: legacyApiBase, source: 'env:API_BASE' };
  }

  const activeInstance = readActiveInstance({ env, repoRoot });
  const port = 3211 + Number(activeInstance.instance) * 100;
  return {
    apiBase: `http://127.0.0.1:${port}/api/v1`,
    source: activeInstance.source,
  };
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function retryTransientAuditRequest<T>(
  request: () => Promise<T>,
  options: RetryTransientAuditRequestOptions = {},
): Promise<T> {
  const delaysMs = options.delaysMs ?? [];
  const sleep = options.sleep ?? defaultSleep;
  const maxRetryAfterMs = options.maxRetryAfterMs ?? TEMPLATE_AUDIT_MAX_RETRY_AFTER_MS;
  let lastError: unknown;

  for (let attempt = 0; attempt <= delaysMs.length; attempt += 1) {
    try {
      return await request();
    } catch (error) {
      lastError = error;
      if (!isTransientAuditRequestError(error) || attempt >= delaysMs.length) {
        throw error;
      }
      await sleep(getAuditRequestRetryAfterMs(error, maxRetryAfterMs) ?? delaysMs[attempt]);
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

export function upsertTemplateValidationLedger(
  ledger: TemplateValidationLedger | undefined,
  entry: TemplateValidationLedgerInput,
  verifiedAt = new Date().toISOString(),
): TemplateValidationLedger {
  const next: TemplateValidationLedger = {
    version: 1,
    entries: { ...(ledger?.entries ?? {}) },
  };
  next.entries[entry.templateName] = {
    ...entry,
    verifiedAt,
  };
  return next;
}

export function pruneTemplateValidationLedger(
  ledger: TemplateValidationLedger | undefined,
  activeTemplateNames: Iterable<string>,
): TemplateValidationLedger | undefined {
  if (!ledger) return undefined;

  const activeNames = new Set(activeTemplateNames);
  const entries = Object.fromEntries(
    Object.entries(ledger.entries).filter(([templateName]) => activeNames.has(templateName)),
  );

  return {
    version: 1,
    entries,
  };
}

function parseValidationTime(value: string | undefined): number | null {
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function legacyTemplateFingerprintStillCoversComponents(
  entry: TemplateValidationLedgerEntry,
  legacyFingerprint: string | undefined,
  componentValidationVerifiedAt: Record<string, string> | undefined,
): boolean {
  if (!legacyFingerprint || entry.fingerprint !== legacyFingerprint) return false;

  const componentTimes = Object.values(componentValidationVerifiedAt ?? {});
  if (componentTimes.length === 0) return true;

  const templateVerifiedAt = parseValidationTime(entry.verifiedAt);
  if (templateVerifiedAt === null) return false;

  return componentTimes.every((value) => {
    const componentVerifiedAt = parseValidationTime(value);
    return componentVerifiedAt !== null && componentVerifiedAt <= templateVerifiedAt;
  });
}

function isTemplateValidationFingerprintCurrent(
  entry: TemplateValidationLedgerEntry,
  template: {
    fingerprint: string;
    legacyFingerprint?: string;
    componentValidationVerifiedAt?: Record<string, string>;
  },
): boolean {
  return (
    entry.fingerprint === template.fingerprint ||
    legacyTemplateFingerprintStillCoversComponents(
      entry,
      template.legacyFingerprint,
      template.componentValidationVerifiedAt,
    )
  );
}

export function shouldSkipTemplateValidation({
  ledger,
  templateName,
  classification,
  fingerprint,
  legacyFingerprint,
  componentValidationVerifiedAt,
  force,
}: TemplateValidationSkipOptions): TemplateValidationSkipResult | null {
  if (force || classification !== 'live-run') return null;

  const entry = ledger?.entries?.[templateName];
  if (!entry) return null;
  if (entry.terminalStatus !== 'COMPLETED' || entry.recommendation !== 'keep') return null;
  if (
    !isTemplateValidationFingerprintCurrent(entry, {
      fingerprint,
      legacyFingerprint,
      componentValidationVerifiedAt,
    })
  ) {
    return null;
  }

  return {
    terminalStatus: 'SKIPPED',
    recommendation: 'keep',
    rationale: `Skipped unchanged template; last live validation passed at ${entry.verifiedAt}.`,
    artifactsCount: entry.artifactsCount,
  };
}

export function summarizeTemplateValidationLedgerFreshness(
  ledger: TemplateValidationLedger | undefined,
  templates: TemplateValidationFreshnessInput[],
): TemplateValidationFreshnessSummary {
  const counts: TemplateValidationFreshnessCounts = {
    current: 0,
    missing: 0,
    stale: 0,
    degraded: 0,
    notLiveRun: 0,
  };
  const items = templates.map<TemplateValidationFreshnessItem>((template) => {
    if (template.classification !== 'live-run') {
      counts.notLiveRun += 1;
      return {
        ...template,
        status: 'not-live-run',
        rationale: `${template.classification} templates are not eligible for cached live-run validation.`,
      };
    }

    const entry = ledger?.entries?.[template.templateName];
    if (!entry) {
      counts.missing += 1;
      return {
        ...template,
        status: 'missing',
        rationale: 'No successful live-validation ledger entry exists for this template.',
      };
    }

    if (!isTemplateValidationFingerprintCurrent(entry, template)) {
      counts.stale += 1;
      return {
        ...template,
        status: 'stale',
        verifiedAt: entry.verifiedAt,
        rationale: 'Template, live input, or classification changed after the last validation.',
      };
    }

    if (entry.terminalStatus !== 'COMPLETED' || entry.recommendation !== 'keep') {
      counts.degraded += 1;
      return {
        ...template,
        status: 'degraded',
        verifiedAt: entry.verifiedAt,
        rationale: `Last validation was ${entry.terminalStatus ?? 'unknown'} / ${entry.recommendation}.`,
      };
    }

    counts.current += 1;
    return {
      ...template,
      status: 'current',
      verifiedAt: entry.verifiedAt,
      rationale: `Current live validation passed at ${entry.verifiedAt}.`,
    };
  });

  return {
    allLiveRunsCurrent: counts.missing === 0 && counts.stale === 0 && counts.degraded === 0,
    counts,
    items,
  };
}

function renderFreshnessProblemLines(
  summary: TemplateValidationFreshnessSummary,
  status: 'missing' | 'stale' | 'degraded',
): string[] {
  return summary.items
    .filter((item) => item.status === status)
    .map((item) => `- ${item.seedFile ?? item.templateName}: ${item.rationale}`);
}

export function renderTemplateValidationLedgerFreshness(
  summary: TemplateValidationFreshnessSummary,
): string {
  const liveRunTotal =
    summary.counts.current +
    summary.counts.missing +
    summary.counts.stale +
    summary.counts.degraded;
  const lines = [
    '# Template Validation Ledger Check',
    '',
    `Live-run validation current: ${summary.counts.current}/${liveRunTotal}`,
    `Missing: ${summary.counts.missing}`,
    `Stale: ${summary.counts.stale}`,
    `Degraded: ${summary.counts.degraded}`,
    `Non-live-run templates: ${summary.counts.notLiveRun}`,
  ];

  const missing = renderFreshnessProblemLines(summary, 'missing');
  if (missing.length > 0) {
    lines.push('', '## Missing Live Validation', '', ...missing);
  }

  const stale = renderFreshnessProblemLines(summary, 'stale');
  if (stale.length > 0) {
    lines.push('', '## Stale Live Validation', '', ...stale);
  }

  const degraded = renderFreshnessProblemLines(summary, 'degraded');
  if (degraded.length > 0) {
    lines.push('', '## Degraded Live Validation', '', ...degraded);
  }

  return `${lines.join('\n')}\n`;
}

function hasEnoughNodeEvidence(
  response: NodeIoEvidenceResponse,
  expectedNodeCount: number,
): boolean {
  return Array.isArray(response.nodes) && response.nodes.length >= expectedNodeCount;
}

function parseRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  if (typeof value !== 'string') return null;

  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function getBoolean(value: unknown): boolean {
  return value === true;
}

function getStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map(String)
    .map((item) => item.trim())
    .filter(Boolean);
}

function addWarnings(target: Set<string>, value: unknown): void {
  for (const warning of getStringArray(value)) {
    target.add(warning);
  }
}

function collectNodeWarnings(outputs: Record<string, unknown> | null): string[] {
  if (!outputs) return [];

  const warnings = new Set<string>();
  addWarnings(warnings, outputs.warnings);

  const report = parseRecord(outputs.report);
  addWarnings(warnings, report?.warnings);

  const summary = parseRecord(outputs.summary);
  addWarnings(warnings, summary?.warnings);

  return Array.from(warnings);
}

export function summarizeNodeIoNode(node: Record<string, unknown>): NodeIoNodeSummary {
  const inputs = parseRecord(node.inputs);
  const outputs = parseRecord(node.outputs);

  return {
    nodeRef: String(node.nodeRef ?? ''),
    componentId: typeof node.componentId === 'string' ? node.componentId : undefined,
    status: typeof node.status === 'string' ? node.status : undefined,
    durationMs: typeof node.durationMs === 'number' ? node.durationMs : null,
    errorMessage: typeof node.errorMessage === 'string' ? node.errorMessage : null,
    inputKeys: inputs ? Object.keys(inputs) : [],
    outputKeys: outputs ? Object.keys(outputs) : [],
    warnings: collectNodeWarnings(outputs),
    inputsSpilled: getBoolean(node.inputsSpilled),
    inputsTruncated: getBoolean(node.inputsTruncated),
    outputsSpilled: getBoolean(node.outputsSpilled),
    outputsTruncated: getBoolean(node.outputsTruncated),
  };
}

export function getNodeIoWarningSignals(nodes: NodeIoNodeSummary[]): string[] {
  const signals = new Set<string>();
  for (const node of nodes) {
    const nodeLabel = node.nodeRef || node.componentId || 'node';
    for (const warning of node.warnings) {
      signals.add(`${nodeLabel}: ${warning}`);
    }
  }
  return Array.from(signals);
}

function getWarningMessage(signal: string): string {
  const separator = signal.indexOf(': ');
  return separator >= 0 ? signal.slice(separator + 2) : signal;
}

function isNonblockingPublicSourceWarning(signal: string): boolean {
  const message = getWarningMessage(signal);
  return /^(NVD (?:CVE query|candidate lookup|detail lookup|enrichment) unavailable|CISA KEV enrichment unavailable|KEV catalog unavailable):/i.test(
    message,
  );
}

function hasScannerRuntimeTarget(
  runtimeInputs: TemplateAuditRecommendationInput['runtimeInputs'],
): boolean {
  const targetTerms = [
    'code',
    'cpe',
    'domain',
    'domains',
    'iac',
    'image',
    'package',
    'repo',
    'repository',
    'repositoryurl',
    'target',
    'url',
    'urls',
    'website',
    'wordlist',
  ];

  return runtimeInputs.some((input) => {
    const haystack = [input.id, input.label, input.description]
      .filter((value): value is string => typeof value === 'string')
      .join(' ')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '');

    return targetTerms.some((term) => haystack.includes(term));
  });
}

export function analyzeTemplateAuditRecommendation({
  result,
  runtimeInputState,
  runtimeInputs,
  requiredSecrets,
  missingSecretNames,
  components,
  hasUnmappedSlackNode,
}: TemplateAuditRecommendationInput): TemplateAuditRecommendationResult {
  const nodeWarningSignals = getNodeIoWarningSignals(result.nodeIo ?? []);

  if (result.terminalStatus === 'COMPLETED' && (result.artifactsCount ?? 0) > 0) {
    if (nodeWarningSignals.length > 0) {
      const blockingWarningSignals = nodeWarningSignals.filter(
        (signal) => !isNonblockingPublicSourceWarning(signal),
      );
      if (blockingWarningSignals.length === 0) {
        return {
          recommendation: 'keep',
          rationale: `Live execution completed with artifact and only nonblocking public data source warnings: ${nodeWarningSignals
            .slice(0, 3)
            .join('; ')
            .slice(0, 240)}`,
        };
      }

      return {
        recommendation: 'review',
        rationale: `Live execution completed with artifact but emitted warnings: ${blockingWarningSignals
          .slice(0, 3)
          .join('; ')
          .slice(0, 240)}`,
      };
    }

    return {
      recommendation: 'keep',
      rationale: 'Live execution completed and produced at least one artifact.',
    };
  }

  if (runtimeInputState === 'missing') {
    return {
      recommendation: 'delete',
      rationale:
        'Entry point has no runtimeInputs configuration, so a user-created workflow cannot compile/run from the template.',
    };
  }

  if (hasUnmappedSlackNode) {
    return {
      recommendation: 'fix',
      rationale:
        'Template has a Slack node with no connected/mapped Slack token or webhook input; remove optional notification or add real secret plumbing.',
    };
  }

  if (result.runAttempted && result.runStartError) {
    return {
      recommendation: 'fix',
      rationale: result.runStartError.split('\n')[0].slice(0, 240),
    };
  }

  if (result.runAttempted && result.statusError) {
    return {
      recommendation: 'fix',
      rationale: result.statusError.split('\n')[0].slice(0, 240),
    };
  }

  if (
    result.runAttempted &&
    result.terminalStatus === 'COMPLETED' &&
    (result.artifactsCount ?? 0) === 0
  ) {
    return {
      recommendation: 'fix',
      rationale: 'Live execution completed but produced no artifacts.',
    };
  }

  if (result.runAttempted && result.terminalStatus && result.terminalStatus !== 'COMPLETED') {
    return {
      recommendation: 'fix',
      rationale: `Live execution ended with status ${result.terminalStatus}.`,
    };
  }

  if (
    !hasScannerRuntimeTarget(runtimeInputs) &&
    (components.includes('sentris.trivy.run') ||
      components.includes('sentris.semgrep.run') ||
      components.includes('sentris.ffuf.run') ||
      components.includes('sentris.checkov.run'))
  ) {
    return {
      recommendation: 'fix',
      rationale:
        'Scanner template needs user-facing runtime inputs for target code, repo, image, URL, wordlist, or IaC content.',
    };
  }

  if (requiredSecrets.length > 0) {
    return {
      recommendation: 'review',
      rationale:
        missingSecretNames.length > 0
          ? `Credential-gated template requires explicit audit secret mappings for: ${missingSecretNames.join(', ')}.`
          : `Credential-gated template requires: ${requiredSecrets.join(', ')}.`,
    };
  }

  return {
    recommendation: 'review',
    rationale: 'No terminal live result; review trace and template shape before retaining.',
  };
}

export function getLiveRunAuditFailures(
  results: TemplateAuditMarkdownResult[],
): TemplateAuditMarkdownResult[] {
  return results.filter(
    (result) =>
      result.classification === 'live-run' &&
      (!['COMPLETED', 'SKIPPED'].includes(result.terminalStatus ?? '') ||
        result.recommendation !== 'keep'),
  );
}

function normalizeCatalogName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function getTemplateCatalogLabel(result: TemplateAuditMarkdownResult): string {
  return result.seedFile ?? result.templateName;
}

function getRuntimeInputSignature(value: unknown): string {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return normalizeCatalogName(String(value ?? ''));
  }

  const input = value as Record<string, unknown>;
  const required =
    input.required === false || input.optional === true || input.isRequired === false
      ? 'optional'
      : 'required';

  return [
    normalizeCatalogName(String(input.id ?? input.name ?? input.key ?? '')),
    normalizeCatalogName(String(input.type ?? input.inputType ?? '')),
    required,
  ].join(':');
}

function getRuntimeInputRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function isOptionalRuntimeInput(input: Record<string, unknown>): boolean {
  return input.required === false || input.optional === true || input.isRequired === false;
}

function getRuntimeInputId(input: Record<string, unknown>, index: number): string {
  const id = input.id ?? input.name ?? input.key;
  return typeof id === 'string' && id.trim().length > 0 ? id.trim() : `input-${index + 1}`;
}

function getRuntimeInputType(input: Record<string, unknown>): string {
  const rawType = input.type ?? input.inputType;
  return typeof rawType === 'string' && rawType.trim().length > 0
    ? rawType.trim().toLowerCase()
    : 'unknown';
}

function getOptionalRuntimeInputDefaultReason(
  inputType: string,
  defaultValue: unknown,
): string | null {
  const type = inputType.toLowerCase();
  if (['text', 'string', 'textarea', 'url'].includes(type)) {
    return typeof defaultValue === 'string' ? null : 'must define defaultValue as a string.';
  }

  if (['array', 'list', 'multiselect', 'multi-select', 'tags'].includes(type)) {
    return Array.isArray(defaultValue) ? null : 'must define defaultValue as an array.';
  }

  if (type === 'boolean' || type === 'checkbox') {
    return typeof defaultValue === 'boolean' ? null : 'must define defaultValue as a boolean.';
  }

  if (type === 'number' || type === 'integer') {
    return typeof defaultValue === 'number' && Number.isFinite(defaultValue)
      ? null
      : 'must define defaultValue as a number.';
  }

  return defaultValue === undefined ? 'must define defaultValue.' : null;
}

function getRuntimeInputDefaultFailures(
  result: TemplateAuditMarkdownResult,
): TemplateCatalogRuntimeInputDefaultFailure[] {
  return result.runtimeInputs.flatMap((rawInput, index) => {
    const input = getRuntimeInputRecord(rawInput);
    if (!input || !isOptionalRuntimeInput(input)) return [];

    const inputType = getRuntimeInputType(input);
    const inputId = getRuntimeInputId(input, index);
    const reason = getOptionalRuntimeInputDefaultReason(inputType, input.defaultValue);
    if (!reason) return [];

    return [
      {
        label: getTemplateCatalogLabel(result),
        inputId,
        inputType,
        reason,
      },
    ];
  });
}

function shouldCheckTemplateFunctionality(result: TemplateAuditMarkdownResult): boolean {
  return (
    result.classification === 'live-run' &&
    result.components.length > 0 &&
    (result.runtimeInputs.length > 0 || result.requiredSecrets.length > 0)
  );
}

function isDeliveryOnlyComponent(componentId: string): boolean {
  return normalizeCatalogName(componentId).startsWith('core notification ');
}

function hasDeliveryOnlyComponent(result: TemplateAuditMarkdownResult): boolean {
  return result.components.some(isDeliveryOnlyComponent);
}

function isDeliveryOnlySecretName(secretName: string): boolean {
  const normalized = normalizeCatalogName(secretName);
  return (
    normalized === 'discord webhook url' ||
    normalized === 'slack webhook url' ||
    normalized === 'teams webhook url' ||
    normalized === 'webhook discord' ||
    normalized === 'webhook slack' ||
    normalized === 'webhook teams'
  );
}

function getFunctionalComponents(result: TemplateAuditMarkdownResult): string[] {
  return result.components.filter((componentId) => !isDeliveryOnlyComponent(componentId));
}

function getFunctionalRequiredSecrets(result: TemplateAuditMarkdownResult): string[] {
  if (!hasDeliveryOnlyComponent(result)) return result.requiredSecrets;
  return result.requiredSecrets.filter((secretName) => !isDeliveryOnlySecretName(secretName));
}

function createTemplateFunctionalityKey(result: TemplateAuditMarkdownResult): string {
  const category = normalizeCatalogName(result.category ?? '');
  const classification = normalizeCatalogName(result.classification);
  const components = [...getFunctionalComponents(result)].sort().join(',');
  const runtimeInputs = result.runtimeInputs.map(getRuntimeInputSignature).sort().join(',');
  const requiredSecrets = getFunctionalRequiredSecrets(result)
    .map(normalizeCatalogName)
    .sort()
    .join(',');

  return [category, classification, components, runtimeInputs, requiredSecrets].join('|');
}

export function summarizeTemplateCatalogQuality(
  results: TemplateAuditMarkdownResult[],
): TemplateCatalogQualitySummary {
  const byName = new Map<string, TemplateAuditMarkdownResult[]>();
  const byFunctionality = new Map<string, TemplateAuditMarkdownResult[]>();
  for (const result of results) {
    const key = normalizeCatalogName(result.templateName);
    if (key) {
      byName.set(key, [...(byName.get(key) ?? []), result]);
    }

    if (shouldCheckTemplateFunctionality(result)) {
      const functionalityKey = createTemplateFunctionalityKey(result);
      byFunctionality.set(functionalityKey, [
        ...(byFunctionality.get(functionalityKey) ?? []),
        result,
      ]);
    }
  }

  const duplicateNames = Array.from(byName.entries())
    .filter(([, group]) => group.length > 1)
    .map(([key, group]) => ({
      key,
      labels: group.map(getTemplateCatalogLabel),
    }));

  const duplicateFunctionalities = Array.from(byFunctionality.entries())
    .filter(([, group]) => group.length > 1)
    .map(([key, group]) => ({
      key,
      labels: group.map(getTemplateCatalogLabel),
    }));

  const lowValueCandidates = results
    .filter((result) => result.runtimeInputs.length === 0 && result.requiredSecrets.length === 0)
    .map((result) => ({
      label: getTemplateCatalogLabel(result),
      reason: 'has no runtime inputs or required secrets.',
    }));
  const runtimeInputDefaultFailures = results.flatMap(getRuntimeInputDefaultFailures);

  return {
    duplicateNames,
    duplicateFunctionalities,
    lowValueCandidates,
    runtimeInputDefaultFailures,
  };
}

export function summarizeTemplateComponentCoverage(
  results: TemplateAuditMarkdownResult[],
  componentIds: string[],
): TemplateComponentCoverageSummary {
  const componentTemplateCounts = Object.fromEntries(
    [...new Set(componentIds)].sort().map((componentId) => [componentId, 0]),
  );

  for (const result of results) {
    const uniqueComponents = new Set(result.components);
    for (const componentId of Object.keys(componentTemplateCounts)) {
      if (uniqueComponents.has(componentId)) {
        componentTemplateCounts[componentId] += 1;
      }
    }
  }

  return {
    componentTemplateCounts,
    unusedComponents: Object.entries(componentTemplateCounts)
      .filter(([, count]) => count === 0)
      .map(([componentId]) => componentId),
  };
}

function outputHandleRequirementKey(requirement: TemplateOutputHandleRequirement): string {
  return `${requirement.componentId}:${requirement.outputHandle}`;
}

function outputHandleRequirementLabel(requirement: TemplateOutputHandleRequirement): string {
  return `${requirement.componentId}.${requirement.outputHandle}`;
}

function resultCoversOutputHandle(
  result: TemplateAuditMarkdownResult,
  requirement: TemplateOutputHandleRequirement,
): boolean {
  if (result.classification !== 'live-run') return false;
  if (!result.components.includes(requirement.componentId)) return false;

  const requiredKey = outputHandleRequirementKey(requirement);
  if (result.outputHandles?.includes(requiredKey)) {
    return true;
  }

  return (result.nodeIo ?? []).some(
    (node) =>
      node.componentId !== requirement.componentId &&
      node.inputKeys.includes(requirement.outputHandle),
  );
}

export function summarizeTemplateOutputHandleCoverage(
  results: TemplateAuditMarkdownResult[],
  requirements: TemplateOutputHandleRequirement[],
): TemplateOutputHandleCoverageSummary {
  const uniqueRequirements = Array.from(
    new Map(requirements.map((requirement) => [outputHandleRequirementKey(requirement), requirement]))
      .values(),
  ).sort((a, b) =>
    outputHandleRequirementLabel(a).localeCompare(outputHandleRequirementLabel(b)),
  );

  const outputHandleTemplateCounts = Object.fromEntries(
    uniqueRequirements.map((requirement) => [outputHandleRequirementKey(requirement), 0]),
  );

  for (const result of results) {
    for (const requirement of uniqueRequirements) {
      if (resultCoversOutputHandle(result, requirement)) {
        outputHandleTemplateCounts[outputHandleRequirementKey(requirement)] += 1;
      }
    }
  }

  return {
    outputHandleTemplateCounts,
    unusedOutputHandles: uniqueRequirements.filter(
      (requirement) => outputHandleTemplateCounts[outputHandleRequirementKey(requirement)] === 0,
    ),
  };
}

export function getTemplateOutputHandleCoverageFailures(
  results: TemplateAuditMarkdownResult[],
  requirements: TemplateOutputHandleRequirement[],
): string[] {
  const coverage = summarizeTemplateOutputHandleCoverage(results, requirements);
  return coverage.unusedOutputHandles.map(
    (requirement) =>
      `Output handle coverage gap: ${outputHandleRequirementLabel(
        requirement,
      )} is not observed in any live-validated template. ${requirement.reason}`,
  );
}

export function getTemplateCatalogQualityFailures(
  results: TemplateAuditMarkdownResult[],
): string[] {
  const summary = summarizeTemplateCatalogQuality(results);
  const failures: string[] = [];

  for (const group of summary.duplicateNames) {
    failures.push(`Duplicate template name: ${group.labels.join(', ')}`);
  }

  for (const group of summary.duplicateFunctionalities) {
    failures.push(`Duplicate template functionality: ${group.labels.join(', ')}`);
  }

  for (const candidate of summary.lowValueCandidates) {
    failures.push(`Low-value/static template: ${candidate.label} ${candidate.reason}`);
  }

  for (const failure of summary.runtimeInputDefaultFailures) {
    failures.push(
      `Runtime input default issue: ${failure.label} optional ${failure.inputType} input ${failure.inputId} ${failure.reason}`,
    );
  }

  return failures;
}

export function getTemplateSeedCatalogCoverageFailures({
  apiTemplateNames,
  seedTemplates,
}: {
  apiTemplateNames: string[];
  seedTemplates: TemplateSeedCatalogEntry[];
}): string[] {
  const apiNames = new Set(apiTemplateNames.map((name) => normalizeCatalogName(name)));

  return seedTemplates
    .filter((seed) => !apiNames.has(normalizeCatalogName(seed.name)))
    .sort((a, b) => a.file.localeCompare(b.file))
    .map(
      (seed) =>
        `Seed template missing from API catalog: ${seed.file} (${seed.name}). Run the seed step before validation.`,
    );
}

export function renderTemplateCatalogQualityCheck(
  results: TemplateAuditMarkdownResult[],
  options: TemplateCatalogQualityCheckOptions = {},
): string {
  const summary = summarizeTemplateCatalogQuality(results);
  const seedCatalogCoverageFailures = options.seedCatalogCoverageFailures ?? [];
  const outputHandleCoverage =
    options.requiredOutputHandles && options.requiredOutputHandles.length > 0
      ? summarizeTemplateOutputHandleCoverage(results, options.requiredOutputHandles)
      : null;
  const outputHandleCoverageFailures = options.requiredOutputHandles
    ? getTemplateOutputHandleCoverageFailures(results, options.requiredOutputHandles)
    : [];
  const failures = [
    ...getTemplateCatalogQualityFailures(results),
    ...outputHandleCoverageFailures,
    ...seedCatalogCoverageFailures,
  ];
  const componentCoverage =
    options.componentCoverageIds && options.componentCoverageIds.length > 0
      ? summarizeTemplateComponentCoverage(results, options.componentCoverageIds)
      : null;
  const lines = [
    '# Template Catalog Quality Check',
    '',
    `Duplicate names: ${summary.duplicateNames.length}`,
    `Duplicate functionality: ${summary.duplicateFunctionalities.length}`,
    `Low-value/static candidates: ${summary.lowValueCandidates.length}`,
    `Runtime input default issues: ${summary.runtimeInputDefaultFailures.length}`,
    `Output handle coverage gaps: ${outputHandleCoverage?.unusedOutputHandles.length ?? 0}`,
    `Seed/API catalog gaps: ${seedCatalogCoverageFailures.length}`,
  ];

  if (componentCoverage) {
    lines.push(`Component coverage gaps: ${componentCoverage.unusedComponents.length}`);
  }

  if (failures.length > 0) {
    lines.push('', '## Catalog Quality Failures', '', ...failures.map((failure) => `- ${failure}`));
  }

  if (componentCoverage && componentCoverage.unusedComponents.length > 0) {
    lines.push(
      '',
      '## Component Coverage Gaps',
      '',
      ...componentCoverage.unusedComponents.map(
        (componentId) =>
          `- ${componentId}: no live-validated template currently uses this component.`,
      ),
    );
  }

  if (outputHandleCoverage && outputHandleCoverage.unusedOutputHandles.length > 0) {
    lines.push(
      '',
      '## Output Handle Coverage Gaps',
      '',
      ...outputHandleCoverage.unusedOutputHandles.map(
        (requirement) =>
          `- ${outputHandleRequirementLabel(requirement)}: ${requirement.reason}`,
      ),
    );
  }

  return `${lines.join('\n')}\n`;
}

function escapeMarkdownTable(value: unknown): string {
  return String(value ?? '').replace(/\|/g, '\\|');
}

function renderNodeFlags(node: NodeIoNodeSummary): string {
  const flags: string[] = [];
  if (node.inputsSpilled) flags.push('inputs spilled');
  if (node.inputsTruncated) flags.push('inputs truncated');
  if (node.outputsSpilled) flags.push('outputs spilled');
  if (node.outputsTruncated) flags.push('outputs truncated');
  return flags.join(', ') || '-';
}

function renderKeyList(keys: string[]): string {
  return keys.length > 0 ? keys.join(', ') : '-';
}

function renderWarnings(warnings: string[]): string {
  return warnings.length > 0 ? warnings.join('; ') : '-';
}

export function renderTemplateAuditMarkdown({
  apiBase,
  outputRoot,
  generatedAt,
  results,
}: RenderTemplateAuditMarkdownOptions): string {
  const counts = results.reduce<Record<string, number>>((acc, result) => {
    acc[result.recommendation] = (acc[result.recommendation] ?? 0) + 1;
    return acc;
  }, {});
  const catalogQuality = summarizeTemplateCatalogQuality(results);

  const lines: string[] = [
    '# Template Library Live Audit',
    '',
    `API base: \`${apiBase}\``,
    `Generated: ${generatedAt}`,
    `Output directory: \`${outputRoot}\``,
    '',
    '## Summary',
    '',
    `- Templates audited: ${results.length}`,
    `- Keep: ${counts.keep ?? 0}`,
    `- Fix: ${counts.fix ?? 0}`,
    `- Consolidate: ${counts.consolidate ?? 0}`,
    `- Delete: ${counts.delete ?? 0}`,
    `- Review: ${counts.review ?? 0}`,
    '',
    '## Catalog Quality',
    '',
  ];

  if (catalogQuality.duplicateNames.length === 0) {
    lines.push('- Duplicate names: none');
  } else {
    for (const group of catalogQuality.duplicateNames) {
      lines.push(`- Duplicate name: ${group.labels.join(', ')}`);
    }
  }

  if (catalogQuality.duplicateFunctionalities.length === 0) {
    lines.push('- Duplicate functionality: none');
  } else {
    for (const group of catalogQuality.duplicateFunctionalities) {
      lines.push(`- Duplicate functionality: ${group.labels.join(', ')}`);
    }
  }

  if (catalogQuality.lowValueCandidates.length === 0) {
    lines.push('- Low-value/static candidates: none');
  } else {
    for (const candidate of catalogQuality.lowValueCandidates) {
      lines.push(`- Low-value/static candidate: ${candidate.label} ${candidate.reason}`);
    }
  }

  if (catalogQuality.runtimeInputDefaultFailures.length === 0) {
    lines.push('- Runtime input default issues: none');
  } else {
    for (const failure of catalogQuality.runtimeInputDefaultFailures) {
      lines.push(
        `- Runtime input default issue: ${failure.label} optional ${failure.inputType} input ${failure.inputId} ${failure.reason}`,
      );
    }
  }

  lines.push(
    '',
    '## Results',
    '',
    '| Template | Class | Run | Artifacts | Recommendation | Rationale |',
    '| --- | --- | --- | ---: | --- | --- |',
  );

  for (const result of results) {
    const run =
      result.terminalStatus ??
      (result.runStartError ? 'run failed to start' : result.runAttempted ? 'started' : 'not run');
    lines.push(
      `| ${escapeMarkdownTable(result.templateName)} | ${escapeMarkdownTable(
        result.classification,
      )} | ${escapeMarkdownTable(run)} | ${result.artifactsCount ?? 0} | ${escapeMarkdownTable(
        result.recommendation,
      )} | ${escapeMarkdownTable(result.rationale)} |`,
    );
  }

  lines.push('', '## Node I/O Evidence', '');
  for (const result of results) {
    lines.push(`### ${result.templateName}`, '');
    const nodes = result.nodeIo ?? [];
    if (nodes.length === 0) {
      lines.push('No node I/O evidence captured.', '');
      continue;
    }

    lines.push(
      '| Node | Component | Status | Duration | Input Keys | Output Keys | Flags | Warnings | Error |',
      '| --- | --- | --- | ---: | --- | --- | --- | --- | --- |',
    );
    for (const node of nodes) {
      lines.push(
        `| ${escapeMarkdownTable(node.nodeRef)} | ${escapeMarkdownTable(
          node.componentId ?? '-',
        )} | ${escapeMarkdownTable(node.status ?? '-')} | ${node.durationMs ?? '-'} | ${escapeMarkdownTable(
          renderKeyList(node.inputKeys),
        )} | ${escapeMarkdownTable(renderKeyList(node.outputKeys))} | ${escapeMarkdownTable(
          renderNodeFlags(node),
        )} | ${escapeMarkdownTable(renderWarnings(node.warnings))} | ${escapeMarkdownTable(
          node.errorMessage ?? '-',
        )} |`,
      );
    }
    lines.push('');
  }

  lines.push('## Credential-Gated Templates', '');
  for (const result of results.filter((item) => item.requiredSecrets.length > 0)) {
    lines.push(`- ${result.templateName}: ${result.requiredSecrets.join(', ')}`);
  }

  lines.push('', '## Delete Candidates', '');
  for (const result of results.filter((item) => item.recommendation === 'delete')) {
    lines.push(`- ${result.seedFile ?? result.templateName}: ${result.rationale}`);
  }

  lines.push('', '## Fix Candidates', '');
  for (const result of results.filter((item) => item.recommendation === 'fix')) {
    lines.push(`- ${result.seedFile ?? result.templateName}: ${result.rationale}`);
  }

  lines.push('', '## Review Candidates', '');
  for (const result of results.filter((item) => item.recommendation === 'review')) {
    lines.push(`- ${result.seedFile ?? result.templateName}: ${result.rationale}`);
  }

  return `${lines.join('\n')}\n`;
}

export async function waitForNodeIoEvidence({
  runId,
  expectedNodeCount,
  timeoutMs,
  pollIntervalMs,
  fetchNodeIo,
  sleep = defaultSleep,
}: WaitForNodeIoEvidenceOptions): Promise<NodeIoEvidenceResponse> {
  const targetNodeCount = Math.max(1, expectedNodeCount ?? 1);
  const interval = Math.max(1, pollIntervalMs);
  const maxAttempts = Math.max(1, Math.ceil(Math.max(0, timeoutMs) / interval) + 1);
  let latest: NodeIoEvidenceResponse = { runId, nodes: [] };

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    latest = await fetchNodeIo();
    if (hasEnoughNodeEvidence(latest, targetNodeCount)) {
      return latest;
    }
    if (attempt < maxAttempts - 1) {
      await sleep(interval);
    }
  }

  return latest;
}
