import { createHash } from 'node:crypto';

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

export interface TemplateValidationLedgerEntry {
  templateName: string;
  seedFile: string | null;
  fingerprint: string;
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

export type TemplateLiveAuditInputs = Record<string, Record<string, unknown>>;

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

export interface TemplateCatalogLowValueCandidate {
  label: string;
  reason: string;
}

export interface TemplateCatalogQualitySummary {
  duplicateNames: TemplateCatalogDuplicateNameGroup[];
  lowValueCandidates: TemplateCatalogLowValueCandidate[];
}

export function createTemplateLiveAuditInputs(): TemplateLiveAuditInputs {
  return {
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
    'Container Image CVE Triage': {
      imageRef: 'alpine:3.18',
      deploymentContext: 'Live audit fixture: small public Linux base image for bounded CVE triage.',
      authorizationNotes: 'Live audit fixture using a public container image.',
    },
    'Exposed Service CVE Mapper': {
      targets: ['scanme.nmap.org'],
      authorizationNotes: 'Live audit fixture: Nmap-provided scan target for bounded service checks.',
    },
    'GitHub Repo Dependency CVE Triage': {
      repositoryUrl: 'https://github.com/OWASP/NodeGoat',
      ref: '',
      includeDevDependencies: false,
      researchNotes: 'Live audit fixture: intentionally vulnerable public Node.js training app.',
    },
    'NPM Dependency CVE Hunt': {
      packageSpecs: ['lodash@4.17.20', 'minimist@0.0.8', 'axios@0.21.1'],
      researchNotes: 'Live audit fixture using public npm packages with known historical advisories.',
    },
    'Passive OSINT Subdomain Expansion': {
      domain: 'example.com',
      knownSubdomains: ['www.example.com'],
      wordlist: ['www', 'api'],
      scanIntensity: 'safe',
      authorizationNotes:
        'Live audit fixture: bounded public example.com passive recon and DNS validation.',
    },
    'Public Repo Secret Exposure Triage': {
      repositoryUrl: 'https://github.com/octocat/Hello-World',
      authorizationNotes:
        'Live audit fixture: small public GitHub repository for non-destructive verified-secret scan.',
    },
    'Public Repo Code & IaC Risk Triage': {
      repositoryUrl: 'https://github.com/OWASP/NodeGoat',
      ref: '',
      authorizationNotes:
        'Live audit fixture: intentionally vulnerable public Node.js training app with source and Dockerfile signals.',
    },
    'API Surface Exposure Triage': {
      seedUrls: ['https://petstore.swagger.io/'],
      knownApiPaths: ['/v2/swagger.json', '/swagger.json', '/'],
      scanIntensity: 'safe',
      authorizationNotes:
        'Live audit fixture: public Swagger sample application for safe API surface exposure checks.',
    },
    'Web/API Fuzz Triage': {
      targetUrl: 'https://host.docker.internal:18443/FUZZ',
      wordlist: ['api/health', 'robots.txt', 'definitely-not-present'],
      scanIntensity: 'safe',
      authorizationNotes:
        'Live audit fixture: local HTTPS fixture with a tiny ffuf wordlist for bounded path discovery.',
    },
    'Subdomain Takeover Triage': {
      domains: ['example.com'],
      knownSubdomains: ['www.example.com'],
      authorizationNotes:
        'Live audit fixture: bounded public example domain with imported known subdomain.',
    },
    'Web Attack Surface Quick Win Hunt': {
      liveUrls: ['https://host.docker.internal:18443/api/health'],
      outOfScopePaths: ['/logout', '/admin/delete'],
      scanIntensity: 'safe',
    },
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

export function parseTemplateAuditCliOptions(
  argv: string[],
  env: Record<string, string | undefined> = process.env,
): TemplateAuditCliOptions {
  const templateNames = new Set(splitTemplateNameList(env.TEMPLATE_AUDIT_NAMES));
  let organizationId = env.SENTRIS_ORG_ID;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const templateName = readFlagValue(argv, index, '--name');
    if (templateName) {
      for (const name of splitTemplateNameList(templateName)) {
        templateNames.add(name);
      }
      if (arg === '--name') index += 1;
      continue;
    }

    const orgId = readFlagValue(argv, index, '--org-id');
    if (orgId) {
      organizationId = orgId;
      if (arg === '--org-id') index += 1;
    }
  }

  return {
    force: env.TEMPLATE_AUDIT_FORCE === 'true' || argv.includes('--force'),
    ledgerCheckOnly: env.TEMPLATE_AUDIT_LEDGER_CHECK === 'true' || argv.includes('--ledger-check'),
    ...(organizationId ? { organizationId } : {}),
    templateNames,
  };
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }

  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const entries = Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`);
    return `{${entries.join(',')}}`;
  }

  return JSON.stringify(value);
}

export function createTemplateValidationFingerprint(value: unknown): string {
  return `sha256:${createHash('sha256').update(stableStringify(value)).digest('hex')}`;
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

export function shouldSkipTemplateValidation({
  ledger,
  templateName,
  classification,
  fingerprint,
  force,
}: TemplateValidationSkipOptions): TemplateValidationSkipResult | null {
  if (force || classification !== 'live-run') return null;

  const entry = ledger?.entries?.[templateName];
  if (!entry) return null;
  if (entry.fingerprint !== fingerprint) return null;
  if (entry.terminalStatus !== 'COMPLETED' || entry.recommendation !== 'keep') return null;

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

    if (entry.fingerprint !== template.fingerprint) {
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

export function summarizeTemplateCatalogQuality(
  results: TemplateAuditMarkdownResult[],
): TemplateCatalogQualitySummary {
  const byName = new Map<string, TemplateAuditMarkdownResult[]>();
  for (const result of results) {
    const key = normalizeCatalogName(result.templateName);
    if (!key) continue;
    byName.set(key, [...(byName.get(key) ?? []), result]);
  }

  const duplicateNames = Array.from(byName.entries())
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

  return {
    duplicateNames,
    lowValueCandidates,
  };
}

export function getTemplateCatalogQualityFailures(
  results: TemplateAuditMarkdownResult[],
): string[] {
  const summary = summarizeTemplateCatalogQuality(results);
  const failures: string[] = [];

  for (const group of summary.duplicateNames) {
    failures.push(`Duplicate template name: ${group.labels.join(', ')}`);
  }

  for (const candidate of summary.lowValueCandidates) {
    failures.push(`Low-value/static template: ${candidate.label} ${candidate.reason}`);
  }

  return failures;
}

export function renderTemplateCatalogQualityCheck(results: TemplateAuditMarkdownResult[]): string {
  const summary = summarizeTemplateCatalogQuality(results);
  const failures = getTemplateCatalogQualityFailures(results);
  const lines = [
    '# Template Catalog Quality Check',
    '',
    `Duplicate names: ${summary.duplicateNames.length}`,
    `Low-value/static candidates: ${summary.lowValueCandidates.length}`,
  ];

  if (failures.length > 0) {
    lines.push('', '## Catalog Quality Failures', '', ...failures.map((failure) => `- ${failure}`));
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

  if (catalogQuality.lowValueCandidates.length === 0) {
    lines.push('- Low-value/static candidates: none');
  } else {
    for (const candidate of catalogQuality.lowValueCandidates) {
      lines.push(`- Low-value/static candidate: ${candidate.label} ${candidate.reason}`);
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
