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

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
  return value.map(String).map((item) => item.trim()).filter(Boolean);
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
    '## Results',
    '',
    '| Template | Class | Run | Artifacts | Recommendation | Rationale |',
    '| --- | --- | --- | ---: | --- | --- |',
  ];

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
