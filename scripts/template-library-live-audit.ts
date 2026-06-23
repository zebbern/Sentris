import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  createTemplateValidationFingerprint,
  createTemplateLiveAuditInputs,
  analyzeTemplateAuditRecommendation,
  getTemplateComponentValidationFingerprints,
  getTemplateComponentValidationVerifiedAt,
  getTemplateAuditRequestRetryDelays,
  getTemplateAuditRuntimeRestartDecision,
  getTemplateAuditRuntimeStabilityDecision,
  getLiveRunAuditFailures,
  getTemplateCatalogQualityFailures,
  getTemplateCoverageComponentIds,
  getTemplateOutputHandleCoverageFailures,
  getTemplateSeedCatalogCoverageFailures,
  renderTemplateCatalogQualityCheck,
  renderTemplateValidationLedgerFreshness,
  renderTemplateAuditMarkdown,
  parseTemplateAuditCliOptions,
  pruneTemplateValidationLedger,
  resolveTemplateAuditApiBase,
  retryTransientAuditRequest,
  resolveTemplateAuditManagedSecretMappings,
  resolveTemplateAuditSecretMappings,
  shouldSkipTemplateValidation,
  summarizeTemplateValidationLedgerFreshness,
  summarizeNodeIoNode,
  upsertTemplateValidationLedger,
  waitForNodeIoEvidence,
  type TemplateAuditRuntimeSnapshot,
  type TemplateAuditMarkdownResult,
  type TemplateValidationLedger,
  type TemplateValidationFreshnessInput,
} from './template-library-live-audit-utils';
import {
  readSecurityComponentLedger,
  summarizeSecurityComponentLedgerFreshness,
} from './security-component-audit-utils';
import { readActiveInstance } from './lib/local-script-runtime';

const require = createRequire(import.meta.url);
const { createPm2AppNames, resolvePm2Command } = require('./lib/dev-instance-runtime.js') as {
  createPm2AppNames: (instance: string | number) => string[];
  resolvePm2Command: () => { command: string; argsPrefix: string[]; displayName: string };
};

type JsonObject = Record<string, unknown>;

interface RuntimeInput {
  id: string;
  label?: string;
  type?: string;
  required?: boolean;
  description?: string;
}

interface RequiredSecret {
  name: string;
  type: string;
  description?: string;
}

interface GraphNode {
  id: string;
  type?: string;
  data?: {
    label?: string;
    config?: {
      params?: JsonObject;
      inputOverrides?: JsonObject;
    };
  };
}

interface SeedTemplate {
  _metadata?: {
    name?: string;
    description?: string;
    category?: string;
    tags?: string[];
    author?: string;
    version?: string;
  };
  manifest?: {
    name?: string;
    category?: string;
    tags?: string[];
  };
  graph?: {
    name?: string;
    nodes?: GraphNode[];
    edges?: unknown[];
  };
  requiredSecrets?: RequiredSecret[];
}

interface ApiTemplate {
  id: string;
  name: string;
  description?: string | null;
  category?: string | null;
  tags?: string[] | null;
  graph?: SeedTemplate['graph'] | null;
  requiredSecrets?: RequiredSecret[] | null;
  path?: string | null;
  repository?: string | null;
}

interface CreatedWorkflowResponse {
  workflow?: {
    id?: string;
  };
  templateId?: string;
  templateName?: string;
}

interface RunStartResponse {
  runId: string;
  workflowId: string;
  temporalRunId?: string;
  status?: string;
}

interface RunStatusResponse {
  status: string;
  [key: string]: unknown;
}

interface NodeIoSummary {
  nodeRef: string;
  componentId?: string;
  status?: string;
  durationMs?: number | null;
  errorMessage?: string | null;
  inputKeys?: string[];
  outputKeys?: string[];
  warnings?: string[];
  inputsSpilled?: boolean;
  inputsTruncated?: boolean;
  outputsSpilled?: boolean;
  outputsTruncated?: boolean;
}

interface AuditResult {
  templateId: string;
  templateName: string;
  seedFile: string | null;
  category: string | null;
  components: string[];
  requiredSecrets: string[];
  runtimeInputs: RuntimeInput[];
  classification: 'live-run' | 'credential-gated' | 'run-start-probe' | 'create-only';
  workflowId?: string;
  createOk: boolean;
  createError?: string;
  runAttempted: boolean;
  runStartOk?: boolean;
  runStartError?: string;
  runId?: string;
  terminalStatus?: string;
  statusError?: string;
  artifactsCount?: number;
  nodeIo?: NodeIoSummary[];
  recommendation: 'keep' | 'fix' | 'consolidate' | 'delete' | 'review';
  rationale: string;
}

const CLI_OPTIONS = parseTemplateAuditCliOptions(process.argv.slice(2));
const API_BASE_RESOLUTION = resolveTemplateAuditApiBase();
const API_BASE = API_BASE_RESOLUTION.apiBase;
const INTERNAL_TOKEN = process.env.SENTRIS_INTERNAL_TOKEN ?? 'local-internal-token';
const ORG_ID = CLI_OPTIONS.organizationId ?? 'local-dev';
// Nuclei-heavy templates (KEV, Web Logic) can run ~8–10 min including zip bootstrap + 600s docker cap.
const RUN_TIMEOUT_MS = Number.parseInt(process.env.TEMPLATE_AUDIT_TIMEOUT_MS ?? '900000', 10);
const NODE_IO_CAPTURE_TIMEOUT_MS = Number.parseInt(
  process.env.TEMPLATE_AUDIT_NODE_IO_TIMEOUT_MS ?? '30000',
  10,
);
const NODE_IO_CAPTURE_POLL_MS = Number.parseInt(
  process.env.TEMPLATE_AUDIT_NODE_IO_POLL_MS ?? '1000',
  10,
);
const KEEP_WORKFLOWS = process.env.KEEP_AUDIT_WORKFLOWS === 'true';
const FORCE_AUDIT = CLI_OPTIONS.force;
const LEDGER_CHECK_ONLY = CLI_OPTIONS.ledgerCheckOnly;
const OUTPUT_ROOT =
  process.env.TEMPLATE_AUDIT_OUTPUT_DIR ??
  join(tmpdir(), `sentris-template-live-audit-${new Date().toISOString().replace(/[:.]/g, '-')}`);
const LEDGER_PATH =
  process.env.TEMPLATE_AUDIT_LEDGER_PATH ??
  join(process.cwd(), '.cache', 'template-live-audit-ledger.json');
const AUDIT_TEMPLATE_NAMES = CLI_OPTIONS.templateNames;
const DISABLE_MANAGED_SECRET_LOOKUP =
  process.env.TEMPLATE_AUDIT_DISABLE_MANAGED_SECRET_LOOKUP === 'true';
const REQUIRED_TEMPLATE_OUTPUT_HANDLES = [
  {
    componentId: 'sentris.repository.files.extract',
    outputHandle: 'githubActionsBundle',
    reason: 'GitHub Actions supply-chain templates need the workflow YAML bundle.',
  },
];
const AUDIT_ACTIVE_INSTANCE = readActiveInstance();
const AUDIT_INSTANCE = AUDIT_ACTIVE_INSTANCE.instance;
const DISABLE_RUNTIME_RESTART_DETECTION =
  process.env.TEMPLATE_AUDIT_DISABLE_RUNTIME_RESTART_DETECTION === 'true';
const RUNTIME_RESTART_RETRY_LIMIT = Number.parseInt(
  process.env.TEMPLATE_AUDIT_RUNTIME_RESTART_RETRIES ?? '2',
  10,
);
const RUNTIME_STABILITY_ATTEMPTS = Number.parseInt(
  process.env.TEMPLATE_AUDIT_RUNTIME_STABILITY_ATTEMPTS ?? '4',
  10,
);
const RUNTIME_STABILITY_SETTLE_MS = Number.parseInt(
  process.env.TEMPLATE_AUDIT_RUNTIME_STABILITY_MS ?? '2500',
  10,
);

const HEADERS = {
  'Content-Type': 'application/json',
  'x-internal-token': INTERNAL_TOKEN,
  'x-organization-id': ORG_ID,
};

const TERMINAL_STATUSES = new Set([
  'COMPLETED',
  'FAILED',
  'CANCELLED',
  'TERMINATED',
  'TIMED_OUT',
  'CONTINUED_AS_NEW',
  'UNKNOWN',
]);

const LIVE_INPUTS = createTemplateLiveAuditInputs();
let managedAuditSecretNames: string[] = [];

function ensureOutputDir() {
  mkdirSync(OUTPUT_ROOT, { recursive: true });
}

function readValidationLedger(): TemplateValidationLedger | undefined {
  if (!existsSync(LEDGER_PATH)) return undefined;

  try {
    const parsed = JSON.parse(readFileSync(LEDGER_PATH, 'utf8')) as TemplateValidationLedger;
    if (parsed?.version === 1 && parsed.entries && typeof parsed.entries === 'object') {
      return parsed;
    }
  } catch (error) {
    console.warn(
      `Ignoring unreadable template audit ledger ${LEDGER_PATH}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  return undefined;
}

function readCurrentSecurityComponentIds(): string[] {
  const securityComponentLedger = readSecurityComponentLedger();
  if (!securityComponentLedger) return [];

  return summarizeSecurityComponentLedgerFreshness(securityComponentLedger)
    .items.filter((item) => item.status === 'current')
    .map((item) => item.componentId)
    .sort();
}

function writeValidationLedger(ledger: TemplateValidationLedger): void {
  mkdirSync(dirname(LEDGER_PATH), { recursive: true });
  writeFileSync(LEDGER_PATH, `${JSON.stringify(ledger, null, 2)}\n`);
}

function sanitizeFileName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 90);
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const method = String(init?.method ?? 'GET').toUpperCase();

  return retryTransientAuditRequest(
    async () => {
      const response = await fetch(`${API_BASE}${path}`, {
        ...init,
        headers: {
          ...HEADERS,
          ...(init?.headers ?? {}),
        },
      });

      const text = await response.text();
      let body: unknown = null;
      if (text.trim().length > 0) {
        try {
          body = JSON.parse(text);
        } catch {
          body = text;
        }
      }

      if (!response.ok) {
        const message = typeof body === 'string' ? body : JSON.stringify(body);
        throw Object.assign(new Error(`${response.status} ${response.statusText}: ${message}`), {
          status: response.status,
          statusText: response.statusText,
          retryAfter: response.headers.get('retry-after') ?? undefined,
        });
      }

      return body as T;
    },
    {
      delaysMs: getTemplateAuditRequestRetryDelays({ method, path }),
      sleep: (ms) => Bun.sleep(ms),
    },
  );
}

function parseOptionalNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function parseOptionalString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function captureAuditRuntimeSnapshot(): TemplateAuditRuntimeSnapshot | null {
  if (DISABLE_RUNTIME_RESTART_DETECTION) {
    return null;
  }

  const expectedAppNames = createPm2AppNames(AUDIT_INSTANCE).filter(
    (name) => name.includes('-backend-') || name.includes('-worker-'),
  );
  const pm2Command = resolvePm2Command();

  try {
    const result = spawnSync(pm2Command.command, [...pm2Command.argsPrefix, 'jlist'], {
      cwd: process.cwd(),
      encoding: 'utf8',
      timeout: 10000,
    });

    if (result.status !== 0) {
      return {
        available: false,
        processes: [],
        unavailableReason: (result.stderr || result.stdout || 'pm2 jlist failed').trim(),
      };
    }

    const rawApps = JSON.parse(result.stdout || '[]') as Array<{
      name?: unknown;
      pid?: unknown;
      pm2_env?: {
        restart_time?: unknown;
        status?: unknown;
      };
    }>;
    const appsByName = new Map(
      rawApps
        .filter((app) => typeof app.name === 'string')
        .map((app) => [String(app.name), app]),
    );

    return {
      available: true,
      processes: expectedAppNames.map((name) => {
        const app = appsByName.get(name);
        if (!app) {
          return { name, pid: null, restartCount: null, status: 'missing' };
        }

        return {
          name,
          pid: parseOptionalNumber(app.pid),
          restartCount: parseOptionalNumber(app.pm2_env?.restart_time),
          status: parseOptionalString(app.pm2_env?.status),
        };
      }),
    };
  } catch (error) {
    return {
      available: false,
      processes: [],
      unavailableReason: error instanceof Error ? error.message : String(error),
    };
  }
}

async function waitForUrlHealth(url: string): Promise<void> {
  await retryTransientAuditRequest(
    async () => {
      const response = await fetch(url, { signal: AbortSignal.timeout(2500) });
      if (!response.ok) {
        throw Object.assign(new Error(`${response.status} ${response.statusText}`), {
          status: response.status,
          statusText: response.statusText,
          retryAfter: response.headers.get('retry-after') ?? undefined,
        });
      }
    },
    {
      delaysMs: getTemplateAuditRequestRetryDelays({ method: 'GET', path: '/health' }),
      sleep: (ms) => Bun.sleep(ms),
    },
  );
}

async function waitForAuditRuntimeHealth(): Promise<void> {
  await apiFetch('/health');
  await apiFetch('/health/ready');

  const workerHealthPort = 9100 + Number(AUDIT_INSTANCE) * 100;
  await waitForUrlHealth(`http://127.0.0.1:${workerHealthPort}/health`);
}

async function waitForAuditRuntimeStability(label: string): Promise<void> {
  if (DISABLE_RUNTIME_RESTART_DETECTION) {
    return;
  }

  const attempts = Math.max(1, RUNTIME_STABILITY_ATTEMPTS);
  let lastRationale = 'runtime stability could not be confirmed';

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    await waitForAuditRuntimeHealth();
    const before = captureAuditRuntimeSnapshot();
    await Bun.sleep(Math.max(0, RUNTIME_STABILITY_SETTLE_MS));
    await waitForAuditRuntimeHealth();
    const after = captureAuditRuntimeSnapshot();
    const decision = getTemplateAuditRuntimeStabilityDecision({ before, after });

    if (decision.stable) {
      return;
    }

    lastRationale = decision.rationale ?? lastRationale;
    console.warn(
      `  Waiting for stable backend/worker before auditing ${label}: ${lastRationale} (${attempt}/${attempts})`,
    );
  }

  throw new Error(
    `Local audit runtime did not stay stable before auditing ${label}: ${lastRationale}`,
  );
}

function readSeedTemplates(): Map<string, { file: string; template: SeedTemplate }> {
  const seedDir = join(process.cwd(), 'backend', 'scripts', 'seed-templates');
  const result = new Map<string, { file: string; template: SeedTemplate }>();
  const entries = Array.from(new Bun.Glob('*.json').scanSync(seedDir)).sort();

  for (const file of entries) {
    const template = JSON.parse(readFileSync(join(seedDir, file), 'utf8')) as SeedTemplate;
    const name = template._metadata?.name ?? template.manifest?.name;
    if (name) {
      result.set(name, { file, template });
    }
  }

  return result;
}

function getComponents(template: SeedTemplate | ApiTemplate): string[] {
  const graph = template.graph;
  const nodes = graph?.nodes ?? [];
  return Array.from(new Set(nodes.map((node) => node.type).filter(Boolean) as string[])).sort();
}

function getOutputHandleUsages(template: SeedTemplate | ApiTemplate): string[] {
  const graph = template.graph;
  const nodesById = new Map((graph?.nodes ?? []).map((node) => [node.id, node.type]));
  const usages = new Set<string>();

  for (const rawEdge of graph?.edges ?? []) {
    if (!rawEdge || typeof rawEdge !== 'object') continue;
    const edge = rawEdge as { source?: unknown; sourceHandle?: unknown };
    if (typeof edge.source !== 'string' || typeof edge.sourceHandle !== 'string') continue;

    const sourceType = nodesById.get(edge.source);
    if (typeof sourceType === 'string' && sourceType.trim().length > 0) {
      usages.add(`${sourceType}:${edge.sourceHandle}`);
    }
  }

  return Array.from(usages).sort();
}

function getRuntimeInputs(template: SeedTemplate | ApiTemplate): RuntimeInput[] {
  const entry = template.graph?.nodes?.find((node) => node.type === 'core.workflow.entrypoint');
  const raw = entry?.data?.config?.params?.runtimeInputs;
  return Array.isArray(raw) ? (raw as RuntimeInput[]) : [];
}

function getEntryRuntimeInputState(
  template: SeedTemplate | ApiTemplate,
): 'missing' | 'empty' | 'present' {
  const entry = template.graph?.nodes?.find((node) => node.type === 'core.workflow.entrypoint');
  const raw = entry?.data?.config?.params?.runtimeInputs;
  if (!Array.isArray(raw)) return 'missing';
  return raw.length === 0 ? 'empty' : 'present';
}

function getRequiredSecretNames(template: SeedTemplate | ApiTemplate): string[] {
  return (template.requiredSecrets ?? []).map((secret) => secret.name).filter(Boolean);
}

function resolveAuditSecretMappings(requiredSecrets: string[]) {
  const envResolution = resolveTemplateAuditSecretMappings(requiredSecrets);
  return resolveTemplateAuditManagedSecretMappings(
    requiredSecrets,
    managedAuditSecretNames,
    envResolution,
  );
}

function hasUnmappedSlackNode(template: SeedTemplate | ApiTemplate): boolean {
  return (template.graph?.nodes ?? []).some((node) => {
    if (node.type !== 'core.notification.slack') return false;
    const params = node.data?.config?.params ?? {};
    const inputOverrides = node.data?.config?.inputOverrides ?? {};
    const authType = params.authType ?? 'bot_token';
    if (authType === 'webhook') return !inputOverrides.webhookUrl;
    return !inputOverrides.slackToken;
  });
}

function classifyTemplate(
  template: ApiTemplate,
  seed: SeedTemplate | undefined,
): AuditResult['classification'] {
  const runtimeInputs = getRuntimeInputs(seed ?? template);
  const requiredSecrets = getRequiredSecretNames(seed ?? template);
  const secretResolution = resolveAuditSecretMappings(requiredSecrets);
  const hasAllAuditSecrets =
    requiredSecrets.length > 0 && secretResolution.missingSecretNames.length === 0;
  const hasLiveInputs = Boolean(LIVE_INPUTS[template.name]);
  if (hasLiveInputs && (requiredSecrets.length === 0 || hasAllAuditSecrets)) return 'live-run';
  if (hasAllAuditSecrets && runtimeInputs.length === 0) return 'live-run';
  if (requiredSecrets.length > 0 && runtimeInputs.length > 0) return 'credential-gated';
  if (requiredSecrets.length > 0 && runtimeInputs.length === 0) return 'run-start-probe';
  return 'run-start-probe';
}

function createValidationFingerprint(
  template: ApiTemplate,
  seed: SeedTemplate | undefined,
  classification: AuditResult['classification'],
  options: { includeComponentValidationFingerprints?: boolean } = {},
): string {
  const source = seed ?? template;
  const securityComponentLedger = readSecurityComponentLedger();
  const includeComponentValidationFingerprints =
    options.includeComponentValidationFingerprints ?? true;

  return createTemplateValidationFingerprint({
    apiTemplate: {
      name: template.name,
      category: template.category,
      graph: template.graph,
      requiredSecrets: template.requiredSecrets,
    },
    seedTemplate: seed ?? null,
    liveInputs: LIVE_INPUTS[template.name] ?? {},
    classification,
    ...(includeComponentValidationFingerprints
      ? {
          componentValidationFingerprints: getTemplateComponentValidationFingerprints(
            source,
            securityComponentLedger,
          ),
        }
      : {}),
  });
}

function createValidationComponentVerifiedAt(
  template: ApiTemplate,
  seed: SeedTemplate | undefined,
): Record<string, string> {
  return getTemplateComponentValidationVerifiedAt(seed ?? template, readSecurityComponentLedger());
}

function createValidationFreshnessInput(
  template: ApiTemplate,
  seedRecord: { file: string; template: SeedTemplate } | undefined,
): TemplateValidationFreshnessInput {
  const classification = classifyTemplate(template, seedRecord?.template);
  const seed = seedRecord?.template;
  return {
    templateName: template.name,
    seedFile: seedRecord?.file ?? null,
    fingerprint: createValidationFingerprint(template, seed, classification),
    legacyFingerprint: createValidationFingerprint(template, seed, classification, {
      includeComponentValidationFingerprints: false,
    }),
    componentValidationVerifiedAt: createValidationComponentVerifiedAt(template, seed),
    classification,
  };
}

function createCatalogQualityInput(
  template: ApiTemplate,
  seedRecord: { file: string; template: SeedTemplate } | undefined,
): TemplateAuditMarkdownResult {
  const source = seedRecord?.template ?? template;
  return {
    templateId: template.id,
    templateName: template.name,
    seedFile: seedRecord?.file ?? null,
    category: template.category ?? source.manifest?.category ?? source._metadata?.category ?? null,
    components: getComponents(source),
    outputHandles: getOutputHandleUsages(source),
    requiredSecrets: getRequiredSecretNames(source),
    runtimeInputs: getRuntimeInputs(source),
    classification: classifyTemplate(template, seedRecord?.template),
    createOk: true,
    runAttempted: false,
    recommendation: 'keep',
    rationale: 'Catalog quality preflight input.',
  };
}

function analyzeRecommendation(
  template: ApiTemplate,
  seed: SeedTemplate | undefined,
  result: Partial<AuditResult>,
): Pick<AuditResult, 'recommendation' | 'rationale'> {
  const source = seed ?? template;
  const runtimeState = getEntryRuntimeInputState(source);
  const runtimeInputs = getRuntimeInputs(source);
  const requiredSecrets = getRequiredSecretNames(source);
  const components = getComponents(source);
  const unmappedSlack = hasUnmappedSlackNode(source);

  return analyzeTemplateAuditRecommendation({
    result,
    runtimeInputState: runtimeState,
    runtimeInputs,
    requiredSecrets,
    missingSecretNames: resolveAuditSecretMappings(requiredSecrets).missingSecretNames,
    components,
    hasUnmappedSlackNode: unmappedSlack,
  });
}

async function maybeUseExistingHttpsFixture(): Promise<void> {
  // The previous live workflow harness leaves a local fixture on 18443 in some sessions.
  // If it is absent, public HTTPS targets are still used by CVE/service flows.
  const localFixture = 'https://localhost:18443/api/health';
  try {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
    const response = await fetch(localFixture, { signal: AbortSignal.timeout(2000) });
    if (response.ok) {
      console.log(`Detected HTTPS fixture: ${localFixture}`);
      return;
    }
  } catch {
    LIVE_INPUTS['Web Attack Surface Quick Win Hunt'] = {
      liveUrls: ['https://example.com'],
      outOfScopePaths: ['/logout', '/admin/delete'],
      scanIntensity: 'safe',
    };
    LIVE_INPUTS['Web/API Fuzz Triage'] = {
      targetUrl: 'https://httpbin.org/FUZZ',
      wordlist: ['status/200', 'status/403', 'status/500', 'definitely-not-present'],
      scanIntensity: 'safe',
      authorizationNotes:
        'Live audit fallback: public httpbin status endpoints with a tiny ffuf wordlist.',
    };
    console.log(
      'No local HTTPS fixture detected; Web quick-win audit will use https://example.com.',
    );
  }
}

async function pollRun(runId: string, timeoutMs: number): Promise<RunStatusResponse> {
  const started = Date.now();
  let last: RunStatusResponse | null = null;

  while (Date.now() - started < timeoutMs) {
    last = await apiFetch<RunStatusResponse>(`/workflows/runs/${runId}/status`);
    if (TERMINAL_STATUSES.has(last.status)) return last;
    await Bun.sleep(1500);
  }

  throw new Error(
    `Run ${runId} did not reach a terminal state in ${timeoutMs}ms; last status ${last?.status ?? 'unknown'}`,
  );
}

async function cancelRun(runId: string): Promise<void> {
  try {
    await apiFetch(`/workflows/runs/${runId}/cancel`, { method: 'POST' });
  } catch (error) {
    console.warn(`Failed to cancel ${runId}: ${error instanceof Error ? error.message : error}`);
  }
}

async function deleteWorkflow(workflowId: string): Promise<void> {
  if (KEEP_WORKFLOWS) return;
  try {
    await apiFetch(`/workflows/${workflowId}`, { method: 'DELETE' });
  } catch (error) {
    console.warn(
      `Failed to delete audit workflow ${workflowId}: ${error instanceof Error ? error.message : error}`,
    );
  }
}

async function captureRunEvidence(
  runId: string,
  prefix: string,
  expectedNodeCount?: number,
): Promise<{
  artifactsCount: number;
  nodeIo: NodeIoSummary[];
}> {
  const [artifacts, nodeIo, trace] = await Promise.all([
    apiFetch<{ artifacts?: unknown[] }>(`/workflows/runs/${runId}/artifacts`).catch((error) => ({
      error: error instanceof Error ? error.message : String(error),
    })),
    waitForNodeIoEvidence({
      runId,
      expectedNodeCount,
      timeoutMs: NODE_IO_CAPTURE_TIMEOUT_MS,
      pollIntervalMs: NODE_IO_CAPTURE_POLL_MS,
      fetchNodeIo: () =>
        apiFetch<{ nodes?: Record<string, unknown>[] }>(`/workflows/runs/${runId}/node-io`).catch(
          (error) => ({
            runId,
            nodes: [],
            error: error instanceof Error ? error.message : String(error),
          }),
        ),
    }),
    apiFetch(`/workflows/runs/${runId}/trace`).catch((error) => ({
      error: error instanceof Error ? error.message : String(error),
    })),
  ]);

  writeFileSync(join(OUTPUT_ROOT, `${prefix}.artifacts.json`), JSON.stringify(artifacts, null, 2));
  writeFileSync(join(OUTPUT_ROOT, `${prefix}.node-io.json`), JSON.stringify(nodeIo, null, 2));
  writeFileSync(join(OUTPUT_ROOT, `${prefix}.trace.json`), JSON.stringify(trace, null, 2));

  const artifactList = Array.isArray((artifacts as { artifacts?: unknown[] }).artifacts)
    ? (artifacts as { artifacts: unknown[] }).artifacts
    : Array.isArray(artifacts)
      ? (artifacts as unknown[])
      : [];

  const nodes = Array.isArray((nodeIo as { nodes?: unknown[] }).nodes)
    ? (nodeIo as { nodes: Array<Record<string, unknown>> }).nodes
    : [];

  return {
    artifactsCount: artifactList.length,
    nodeIo: nodes.map((node) => summarizeNodeIoNode(node)),
  };
}

async function auditTemplate(
  template: ApiTemplate,
  seedRecord: { file: string; template: SeedTemplate } | undefined,
  ledger: TemplateValidationLedger | undefined,
): Promise<AuditResult> {
  const seed = seedRecord?.template;
  const source = seed ?? template;
  const classification = classifyTemplate(template, seed);
  const components = getComponents(source);
  const requiredSecrets = getRequiredSecretNames(source);
  const secretResolution = resolveAuditSecretMappings(requiredSecrets);
  const runtimeInputs = getRuntimeInputs(source);
  const validationFingerprint = createValidationFingerprint(template, seed, classification);
  const legacyValidationFingerprint = createValidationFingerprint(template, seed, classification, {
    includeComponentValidationFingerprints: false,
  });
  const componentValidationVerifiedAt = createValidationComponentVerifiedAt(template, seed);
  const prefix = `${sanitizeFileName(template.name)}-${template.id.slice(0, 8)}`;

  const base: AuditResult = {
    templateId: template.id,
    templateName: template.name,
    seedFile: seedRecord?.file ?? null,
    category: template.category ?? seed?._metadata?.category ?? null,
    components,
    outputHandles: getOutputHandleUsages(source),
    requiredSecrets,
    runtimeInputs,
    classification,
    createOk: false,
    runAttempted: false,
    recommendation: 'review',
    rationale: 'Audit did not reach recommendation step.',
  };

  const cachedSkip = shouldSkipTemplateValidation({
    ledger,
    templateName: template.name,
    classification,
    fingerprint: validationFingerprint,
    legacyFingerprint: legacyValidationFingerprint,
    componentValidationVerifiedAt,
    force: FORCE_AUDIT,
  });
  if (cachedSkip) {
    return {
      ...base,
      terminalStatus: cachedSkip.terminalStatus,
      artifactsCount: cachedSkip.artifactsCount,
      recommendation: cachedSkip.recommendation,
      rationale: cachedSkip.rationale,
    };
  }

  await waitForAuditRuntimeStability(template.name);

  let workflowId: string | undefined;

  try {
    const created = await apiFetch<CreatedWorkflowResponse>(`/templates/${template.id}/use`, {
      method: 'POST',
      body: JSON.stringify({
        workflowName: `Template Live Audit - ${template.name} - ${new Date().toISOString()}`,
        ...(requiredSecrets.length > 0 && secretResolution.missingSecretNames.length === 0
          ? { secretMappings: secretResolution.secretMappings }
          : {}),
      }),
    });
    workflowId = created.workflow?.id;
    base.workflowId = workflowId;
    base.createOk = Boolean(workflowId);
    if (!workflowId) {
      base.createError = `Use-template response had no workflow id: ${JSON.stringify(created)}`;
      const recommendation = analyzeRecommendation(template, seed, base);
      return { ...base, ...recommendation };
    }
  } catch (error) {
    base.createError = error instanceof Error ? error.message : String(error);
    const recommendation = analyzeRecommendation(template, seed, base);
    return { ...base, ...recommendation };
  }

  const shouldRun =
    classification === 'live-run' ||
    (classification === 'run-start-probe' && requiredSecrets.length === 0) ||
    (classification === 'run-start-probe' && runtimeInputs.length === 0);

  if (!shouldRun) {
    await deleteWorkflow(workflowId);
    const recommendation = analyzeRecommendation(template, seed, base);
    return { ...base, ...recommendation };
  }

  const inputs = LIVE_INPUTS[template.name] ?? {};
  base.runAttempted = true;

  try {
    const started = await apiFetch<RunStartResponse>(`/workflows/${workflowId}/run`, {
      method: 'POST',
      body: JSON.stringify({ inputs }),
    });
    base.runStartOk = true;
    base.runId = started.runId;

    if (requiredSecrets.length > 0 && classification !== 'live-run') {
      await cancelRun(started.runId);
      base.terminalStatus = 'CANCELLED';
      base.statusError =
        'Run unexpectedly started for a credential-gated template; cancelled to avoid external side effects.';
    } else {
      const status = await pollRun(started.runId, RUN_TIMEOUT_MS);
      base.terminalStatus = status.status;
    }

    const expectedNodeCount = template.graph?.nodes?.length ?? seed?.graph?.nodes?.length;
    const evidence = await captureRunEvidence(started.runId, prefix, expectedNodeCount);
    base.artifactsCount = evidence.artifactsCount;
    base.nodeIo = evidence.nodeIo;
  } catch (error) {
    base.runStartOk = false;
    base.runStartError = error instanceof Error ? error.message : String(error);
  } finally {
    if (workflowId) {
      await deleteWorkflow(workflowId);
    }
  }

  const recommendation = analyzeRecommendation(template, seed, base);
  const result = { ...base, ...recommendation };
  if (classification === 'live-run' && result.terminalStatus === 'COMPLETED') {
    validationLedger = upsertTemplateValidationLedger(validationLedger, {
      templateName: result.templateName,
      seedFile: result.seedFile,
      fingerprint: validationFingerprint,
      liveInputs: inputs,
      classification,
      terminalStatus: result.terminalStatus,
      recommendation: result.recommendation,
      rationale: result.rationale,
      artifactsCount: result.artifactsCount,
      outputRoot: OUTPUT_ROOT,
    });
  }
  return result;
}

async function auditTemplateWithRuntimeRestartRetries(
  template: ApiTemplate,
  seedRecord: { file: string; template: SeedTemplate } | undefined,
  ledger: TemplateValidationLedger | undefined,
): Promise<AuditResult> {
  const maxRetries = Math.max(0, RUNTIME_RESTART_RETRY_LIMIT);

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const beforeRuntime = captureAuditRuntimeSnapshot();
    const result = await auditTemplate(template, seedRecord, ledger);
    const afterRuntime = captureAuditRuntimeSnapshot();
    const restartDecision = getTemplateAuditRuntimeRestartDecision({
      result,
      before: beforeRuntime,
      after: afterRuntime,
    });

    if (!restartDecision.retryable || attempt >= maxRetries) {
      return result;
    }

    console.warn(
      `  Runtime restart detected while auditing ${template.name}: ${restartDecision.rationale}`,
    );
    console.warn(`  Retrying ${template.name} after runtime health recovers (${attempt + 1}/${maxRetries}).`);
    await waitForAuditRuntimeHealth();
  }

  throw new Error('unreachable audit retry state');
}

let validationLedger: TemplateValidationLedger | undefined;

async function readManagedAuditSecretNames(): Promise<string[]> {
  if (DISABLE_MANAGED_SECRET_LOOKUP) {
    console.log(
      'Managed audit secret lookup disabled by TEMPLATE_AUDIT_DISABLE_MANAGED_SECRET_LOOKUP.',
    );
    return [];
  }

  try {
    const secrets = await apiFetch<{ name?: string }[]>('/secrets');
    const names = secrets.map((secret) => secret.name).filter(Boolean) as string[];
    console.log(`Managed audit secrets visible for ${ORG_ID}: ${names.length}`);
    return names;
  } catch (error) {
    console.warn(
      `Managed audit secret lookup unavailable: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return [];
  }
}

async function main() {
  await maybeUseExistingHttpsFixture();

  console.log(`API base: ${API_BASE} (${API_BASE_RESOLUTION.source})`);

  await apiFetch('/health');
  await apiFetch('/health/ready');
  managedAuditSecretNames = await readManagedAuditSecretNames();

  validationLedger = readValidationLedger();
  const seedTemplates = readSeedTemplates();
  const templates = await apiFetch<ApiTemplate[]>('/templates');
  const selectedTemplates =
    AUDIT_TEMPLATE_NAMES.size > 0
      ? templates.filter((template) => AUDIT_TEMPLATE_NAMES.has(template.name))
      : templates;
  if (AUDIT_TEMPLATE_NAMES.size === 0) {
    validationLedger = pruneTemplateValidationLedger(
      validationLedger,
      templates.map((template) => template.name),
    );
  }
  const missingTemplateNames = Array.from(AUDIT_TEMPLATE_NAMES).filter(
    (name) => !selectedTemplates.some((template) => template.name === name),
  );
  if (missingTemplateNames.length > 0) {
    throw new Error(`Requested template(s) not found: ${missingTemplateNames.join(', ')}`);
  }
  const seedCatalogCoverageFailures =
    AUDIT_TEMPLATE_NAMES.size === 0
      ? getTemplateSeedCatalogCoverageFailures({
          apiTemplateNames: templates.map((template) => template.name),
          seedTemplates: Array.from(seedTemplates.values()).map((seedRecord) => ({
            name:
              seedRecord.template._metadata?.name ??
              seedRecord.template.manifest?.name ??
              seedRecord.file,
            file: seedRecord.file,
          })),
        })
      : [];
  if (seedCatalogCoverageFailures.length > 0 && !LEDGER_CHECK_ONLY) {
    throw new Error(`Template catalog seed/API mismatch:\n- ${seedCatalogCoverageFailures.join('\n- ')}`);
  }

  if (LEDGER_CHECK_ONLY) {
    const catalogQualityInputs = selectedTemplates
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((template) => createCatalogQualityInput(template, seedTemplates.get(template.name)));
    const requiredOutputHandles =
      AUDIT_TEMPLATE_NAMES.size === 0 ? REQUIRED_TEMPLATE_OUTPUT_HANDLES : [];
    const catalogQualityFailures = [
      ...getTemplateCatalogQualityFailures(catalogQualityInputs),
      ...getTemplateOutputHandleCoverageFailures(catalogQualityInputs, requiredOutputHandles),
      ...seedCatalogCoverageFailures,
    ];
    const componentCoverageIds = getTemplateCoverageComponentIds(readCurrentSecurityComponentIds());
    const summary = summarizeTemplateValidationLedgerFreshness(
      validationLedger,
      selectedTemplates
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((template) =>
          createValidationFreshnessInput(template, seedTemplates.get(template.name)),
        ),
    );
    console.log(renderTemplateValidationLedgerFreshness(summary));
    console.log(
      renderTemplateCatalogQualityCheck(catalogQualityInputs, {
        componentCoverageIds,
        requiredOutputHandles,
        seedCatalogCoverageFailures,
      }),
    );
    if (catalogQualityFailures.length > 0) {
      console.error(`Template catalog quality failed:\n- ${catalogQualityFailures.join('\n- ')}`);
    }
    if (!summary.allLiveRunsCurrent || catalogQualityFailures.length > 0) {
      process.exitCode = 1;
    }
    return;
  }

  ensureOutputDir();
  console.log(`Template audit output: ${OUTPUT_ROOT}`);

  const results: AuditResult[] = [];

  for (const template of selectedTemplates.sort((a, b) => a.name.localeCompare(b.name))) {
    console.log(`\nAuditing: ${template.name}`);
    const seedRecord = seedTemplates.get(template.name);
    const result = await auditTemplateWithRuntimeRestartRetries(
      template,
      seedRecord,
      validationLedger,
    );
    results.push(result);
    console.log(
      `  ${result.recommendation.toUpperCase()} ${result.terminalStatus ?? result.runStartError ?? result.createError ?? 'created'}`,
    );
  }

  if (validationLedger) {
    writeValidationLedger(validationLedger);
  }

  const jsonPath = join(OUTPUT_ROOT, 'template-live-audit.json');
  const mdPath = join(OUTPUT_ROOT, 'template-live-audit.md');
  writeFileSync(
    jsonPath,
    JSON.stringify({ apiBase: API_BASE, generatedAt: new Date().toISOString(), results }, null, 2),
  );
  writeFileSync(
    mdPath,
    renderTemplateAuditMarkdown({
      apiBase: API_BASE,
      outputRoot: OUTPUT_ROOT,
      generatedAt: new Date().toISOString(),
      results,
    }),
  );

  console.log(`\nAudit complete.`);
  console.log(`JSON: ${jsonPath}`);
  console.log(`Markdown: ${mdPath}`);

  const failingLiveRuns = getLiveRunAuditFailures(results);
  if (failingLiveRuns.length > 0) {
    process.exitCode = 1;
    console.error(
      `Live-run templates failed validation: ${failingLiveRuns
        .map((result) => `${result.templateName} (${result.recommendation}: ${result.rationale})`)
        .join(', ')}`,
    );
  }

  const requiredOutputHandles =
    AUDIT_TEMPLATE_NAMES.size === 0 ? REQUIRED_TEMPLATE_OUTPUT_HANDLES : [];
  const catalogQualityFailures = [
    ...getTemplateCatalogQualityFailures(results),
    ...getTemplateOutputHandleCoverageFailures(results, requiredOutputHandles),
  ];
  if (catalogQualityFailures.length > 0) {
    process.exitCode = 1;
    console.error(`Template catalog quality failed:\n- ${catalogQualityFailures.join('\n- ')}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
