import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  getNodeIoWarningSignals,
  renderTemplateAuditMarkdown,
  summarizeNodeIoNode,
  waitForNodeIoEvidence,
} from './template-library-live-audit-utils';

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

const DEFAULT_INSTANCE = Number.parseInt(
  process.env.SENTRIS_INSTANCE ?? process.env.E2E_INSTANCE ?? '0',
  10,
);
const API_BASE =
  process.env.SENTRIS_API_BASE_URL ??
  process.env.API_BASE ??
  `http://127.0.0.1:${3211 + (Number.isFinite(DEFAULT_INSTANCE) ? DEFAULT_INSTANCE : 0) * 100}/api/v1`;
const INTERNAL_TOKEN = process.env.SENTRIS_INTERNAL_TOKEN ?? 'local-internal-token';
const ORG_ID = process.env.SENTRIS_ORG_ID ?? 'org_dev';
const RUN_TIMEOUT_MS = Number.parseInt(process.env.TEMPLATE_AUDIT_TIMEOUT_MS ?? '420000', 10);
const NODE_IO_CAPTURE_TIMEOUT_MS = Number.parseInt(
  process.env.TEMPLATE_AUDIT_NODE_IO_TIMEOUT_MS ?? '30000',
  10,
);
const NODE_IO_CAPTURE_POLL_MS = Number.parseInt(
  process.env.TEMPLATE_AUDIT_NODE_IO_POLL_MS ?? '1000',
  10,
);
const KEEP_WORKFLOWS = process.env.KEEP_AUDIT_WORKFLOWS === 'true';
const OUTPUT_ROOT =
  process.env.TEMPLATE_AUDIT_OUTPUT_DIR ??
  join(tmpdir(), `sentris-template-live-audit-${new Date().toISOString().replace(/[:.]/g, '-')}`);
const AUDIT_TEMPLATE_NAMES = new Set(
  (process.env.TEMPLATE_AUDIT_NAMES ?? '')
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean),
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

const LIVE_INPUTS: Record<string, JsonObject> = {
  'Bug Bounty Recon Triage': {
    domains: ['example.com'],
    authorizationNotes: 'Live audit fixture: public example domain, passive/bounded recon.',
  },
  'CVE Impact Research Brief': {
    cveId: 'CVE-2024-3094',
    product: 'xz utils',
    version: '5.6.1',
    deploymentNotes: 'Live audit fixture for known public CVE research.',
  },
  'Exposed Service CVE Mapper': {
    targets: ['scanme.nmap.org'],
    authorizationNotes: 'Live audit fixture: Nmap-provided scan target for bounded service checks.',
  },
  'NPM Dependency CVE Hunt': {
    packageSpecs: ['lodash@4.17.20', 'minimist@0.0.8', 'axios@0.21.1'],
    researchNotes: 'Live audit fixture using public npm packages with known historical advisories.',
  },
  'Web Attack Surface Quick Win Hunt': {
    liveUrls: ['https://host.docker.internal:18443/api/health'],
    outOfScopePaths: ['/logout', '/admin/delete'],
    scanIntensity: 'safe',
  },
};

function ensureOutputDir() {
  mkdirSync(OUTPUT_ROOT, { recursive: true });
}

function sanitizeFileName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 90);
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
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
    throw new Error(`${response.status} ${response.statusText}: ${message}`);
  }

  return body as T;
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
  if (LIVE_INPUTS[template.name] && requiredSecrets.length === 0) return 'live-run';
  if (requiredSecrets.length > 0 && runtimeInputs.length > 0) return 'credential-gated';
  if (requiredSecrets.length > 0 && runtimeInputs.length === 0) return 'run-start-probe';
  return 'run-start-probe';
}

function analyzeRecommendation(
  template: ApiTemplate,
  seed: SeedTemplate | undefined,
  result: Partial<AuditResult>,
): Pick<AuditResult, 'recommendation' | 'rationale'> {
  const source = seed ?? template;
  const runtimeState = getEntryRuntimeInputState(source);
  const requiredSecrets = getRequiredSecretNames(source);
  const components = getComponents(source);
  const unmappedSlack = hasUnmappedSlackNode(source);
  const nodeWarningSignals = getNodeIoWarningSignals(result.nodeIo ?? []);

  if (result.terminalStatus === 'COMPLETED' && (result.artifactsCount ?? 0) > 0) {
    if (nodeWarningSignals.length > 0) {
      return {
        recommendation: 'review',
        rationale: `Live execution completed with artifact but emitted warnings: ${nodeWarningSignals
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

  if (runtimeState === 'missing') {
    return {
      recommendation: 'delete',
      rationale:
        'Entry point has no runtimeInputs configuration, so a user-created workflow cannot compile/run from the template.',
    };
  }

  if (unmappedSlack) {
    return {
      recommendation: 'fix',
      rationale:
        'Template has a Slack node with no connected/mapped Slack token or webhook input; remove optional notification or add real secret plumbing.',
    };
  }

  if (requiredSecrets.length > 0) {
    return {
      recommendation: 'review',
      rationale: `Credential-gated template requires: ${requiredSecrets.join(', ')}.`,
    };
  }

  if (
    components.includes('sentris.trivy.run') ||
    components.includes('sentris.semgrep.run') ||
    components.includes('sentris.ffuf.run') ||
    components.includes('sentris.checkov.run')
  ) {
    return {
      recommendation: 'fix',
      rationale:
        'Scanner template needs user-facing runtime inputs for target code, repo, image, URL, wordlist, or IaC content.',
    };
  }

  if (result.runStartError) {
    return {
      recommendation: 'fix',
      rationale: result.runStartError.split('\n')[0].slice(0, 240),
    };
  }

  return {
    recommendation: 'review',
    rationale: 'No terminal live result; review trace and template shape before retaining.',
  };
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
): Promise<AuditResult> {
  const seed = seedRecord?.template;
  const source = seed ?? template;
  const classification = classifyTemplate(template, seed);
  const components = getComponents(source);
  const requiredSecrets = getRequiredSecretNames(source);
  const runtimeInputs = getRuntimeInputs(source);
  const prefix = `${sanitizeFileName(template.name)}-${template.id.slice(0, 8)}`;

  const base: AuditResult = {
    templateId: template.id,
    templateName: template.name,
    seedFile: seedRecord?.file ?? null,
    category: template.category ?? seed?._metadata?.category ?? null,
    components,
    requiredSecrets,
    runtimeInputs,
    classification,
    createOk: false,
    runAttempted: false,
    recommendation: 'review',
    rationale: 'Audit did not reach recommendation step.',
  };

  let workflowId: string | undefined;

  try {
    const created = await apiFetch<CreatedWorkflowResponse>(`/templates/${template.id}/use`, {
      method: 'POST',
      body: JSON.stringify({
        workflowName: `Template Live Audit - ${template.name} - ${new Date().toISOString()}`,
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
  return { ...base, ...recommendation };
}

async function main() {
  ensureOutputDir();
  await maybeUseExistingHttpsFixture();

  console.log(`Template audit output: ${OUTPUT_ROOT}`);
  console.log(`API base: ${API_BASE}`);

  await apiFetch('/health');
  await apiFetch('/health/ready');

  const seedTemplates = readSeedTemplates();
  const templates = await apiFetch<ApiTemplate[]>('/templates');
  const selectedTemplates =
    AUDIT_TEMPLATE_NAMES.size > 0
      ? templates.filter((template) => AUDIT_TEMPLATE_NAMES.has(template.name))
      : templates;
  const missingTemplateNames = Array.from(AUDIT_TEMPLATE_NAMES).filter(
    (name) => !selectedTemplates.some((template) => template.name === name),
  );
  if (missingTemplateNames.length > 0) {
    throw new Error(`Requested template(s) not found: ${missingTemplateNames.join(', ')}`);
  }

  const results: AuditResult[] = [];

  for (const template of selectedTemplates.sort((a, b) => a.name.localeCompare(b.name))) {
    console.log(`\nAuditing: ${template.name}`);
    const seedRecord = seedTemplates.get(template.name);
    const result = await auditTemplate(template, seedRecord);
    results.push(result);
    console.log(
      `  ${result.recommendation.toUpperCase()} ${result.terminalStatus ?? result.runStartError ?? result.createError ?? 'created'}`,
    );
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

  const failingLiveRuns = results.filter(
    (result) => result.classification === 'live-run' && result.terminalStatus !== 'COMPLETED',
  );
  if (failingLiveRuns.length > 0) {
    process.exitCode = 1;
    console.error(
      `Live-run templates failed: ${failingLiveRuns.map((result) => result.templateName).join(', ')}`,
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
