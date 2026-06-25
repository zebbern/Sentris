import { z } from 'zod';
import {
  componentRegistry,
  runComponentWithRunner,
  ContainerError,
  ComponentRetryPolicy,
  defineComponent,
  inputs,
  outputs,
  parameters,
  port,
  param,
  generateFindingHash,
  analyticsResultSchema,
  type AnalyticsResult,
} from '@sentris/component-sdk';
import { IsolatedContainerVolume } from '../../utils/isolated-volume';
import {
  mergeSecurityDockerRunner,
  securityDockerResourceParameterShape,
  SECURITY_DOCKER_RESOURCE_HEAVY,
} from './security-docker-resources';
import { materializeFileBundle } from './bundle-files';

const CODEQL_IMAGE = 'node:22-trixie-slim';
const CODEQL_BUNDLE_VERSION = '2.25.6';
const CODEQL_BUNDLE_URL = `https://github.com/github/codeql-action/releases/download/codeql-bundle-v${CODEQL_BUNDLE_VERSION}/codeql-bundle-linux64.tar.gz`;
const CODEQL_CACHE_VOLUME = 'sentris-codeql-bundle-cache';
const CODEQL_CACHE_MOUNT = '/codeql-cache';
const CODEQL_DEFAULT_TIMEOUT_SECONDS = 3600;
const CODEQL_VOLUME_MOUNT = '/repo';
const CODEQL_OUTPUT_MOUNT = '/codeql-output';
const CODEQL_RESULTS_FILE = 'codeql-results.sarif';
const CODEQL_SARIF_BEGIN_MARKER = '__SENTRIS_CODEQL_SARIF_BEGIN__';
const CODEQL_SARIF_END_MARKER = '__SENTRIS_CODEQL_SARIF_END__';

const inputSchema = inputs({
  target: port(z.string().optional().describe('Source code content to scan'), {
    label: 'Target Code',
    description:
      'Source code content or FILE marker bundle to scan. Optional when volumeName is provided.',
    connectionType: { kind: 'primitive', name: 'text' },
  }),
  volumeName: port(
    z.string().trim().min(1).optional().describe('Existing Docker volume containing source files.'),
    {
      label: 'Volume Name',
      description: 'Mount an existing workflow volume instead of writing inline source content.',
      connectionType: { kind: 'primitive', name: 'text' },
    },
  ),
  scanPath: port(
    z.string().trim().default(CODEQL_VOLUME_MOUNT).describe('Directory inside the mounted volume.'),
    {
      label: 'Scan Path',
      description: 'Directory path inside the mounted volume, for example /repo.',
      connectionType: { kind: 'primitive', name: 'text' },
    },
  ),
});

const parameterSchema = parameters({
  ...securityDockerResourceParameterShape(),
  language: param(
    z
      .enum(['javascript-typescript'])
      .default('javascript-typescript')
      .describe('CodeQL language database to create.'),
    {
      label: 'Language',
      editor: 'select',
      options: [{ label: 'JavaScript / TypeScript', value: 'javascript-typescript' }],
      description: 'NPM CVE Hunt v1 supports JavaScript and TypeScript CodeQL analysis.',
    },
  ),
  querySuite: param(
    z
      .enum(['security-extended', 'security-and-quality', 'code-scanning'])
      .default('security-extended')
      .describe('CodeQL query suite to run.'),
    {
      label: 'Query Suite',
      editor: 'select',
      options: [
        { label: 'Security extended', value: 'security-extended' },
        { label: 'Security and quality', value: 'security-and-quality' },
        { label: 'Code scanning default', value: 'code-scanning' },
      ],
      description:
        'Security-extended prioritizes deeper security and data-flow queries for research runs.',
    },
  ),
  timeoutSeconds: param(
    z
      .number()
      .int()
      .min(60)
      .max(14400)
      .default(CODEQL_DEFAULT_TIMEOUT_SECONDS)
      .describe('Maximum CodeQL container runtime in seconds.'),
    {
      label: 'Timeout (seconds)',
      editor: 'number',
      min: 60,
      max: 14400,
      description: 'Increase for large packages or dependency-heavy repositories.',
    },
  ),
});

const codeqlFindingSchema = z.object({
  ruleId: z.string(),
  path: z.string(),
  startLine: z.number(),
  endLine: z.number(),
  message: z.string(),
  severity: z.string(),
  cwe: z.array(z.string()).optional(),
  securitySeverity: z.string().optional(),
  helpUri: z.string().optional(),
});

type CodeqlFinding = z.infer<typeof codeqlFindingSchema>;

const outputSchema = outputs({
  findings: port(z.array(codeqlFindingSchema), {
    label: 'CodeQL Findings',
    description: 'CodeQL SARIF findings normalized for downstream review.',
    connectionType: { kind: 'list', element: { kind: 'primitive', name: 'json' } },
  }),
  sarif: port(z.string(), {
    label: 'SARIF',
    description: 'Raw SARIF produced by CodeQL.',
  }),
  rawOutput: port(z.string(), {
    label: 'Raw Output',
    description: 'Raw CodeQL output for debugging.',
  }),
  findingCount: port(z.number(), {
    label: 'Finding Count',
    description: 'Number of CodeQL findings detected.',
  }),
  scanStatus: port(z.enum(['completed', 'failed', 'skipped']), {
    label: 'Scan Status',
    description: 'Whether CodeQL completed, failed non-blockingly, or skipped.',
  }),
  caveats: port(z.array(z.string()), {
    label: 'Caveats',
    description: 'Non-blocking CodeQL setup, execution, or parsing caveats.',
  }),
  results: port(z.array(analyticsResultSchema()), {
    label: 'Results',
    description: 'Analytics-ready CodeQL findings.',
  }),
});

const codeqlRetryPolicy: ComponentRetryPolicy = {
  maxAttempts: 1,
  nonRetryableErrorTypes: ['ContainerError', 'ValidationError', 'ConfigurationError'],
};

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\"'\"'")}'`;
}

function normalizeContainerPath(value: unknown, fallback: string): string {
  const raw = typeof value === 'string' && value.trim().length > 0 ? value.trim() : fallback;
  const normalized = raw.replace(/\/+$/, '') || fallback;
  if (!normalized.startsWith('/') || !/^\/[a-zA-Z0-9._/-]+$/.test(normalized)) {
    return fallback;
  }
  return normalized;
}

function getRunnerOutputText(result: unknown): string {
  if (typeof result === 'string') return result;
  if (!result || typeof result !== 'object') return '';
  const record = result as Record<string, unknown>;
  const stdout = typeof record.stdout === 'string' ? record.stdout : '';
  const stderr = typeof record.stderr === 'string' ? record.stderr : '';
  const rawOutput = typeof record.rawOutput === 'string' ? record.rawOutput : '';
  return rawOutput || [stdout, stderr].filter(Boolean).join('\n');
}

function extractSarifJson(rawOutput: string): string {
  const trimmed = rawOutput.trim();
  if (trimmed.length === 0) return '';
  const markerStart = trimmed.indexOf(CODEQL_SARIF_BEGIN_MARKER);
  const markerEnd = trimmed.indexOf(
    CODEQL_SARIF_END_MARKER,
    markerStart + CODEQL_SARIF_BEGIN_MARKER.length,
  );
  if (markerStart >= 0 && markerEnd > markerStart) {
    const marked = trimmed.slice(markerStart + CODEQL_SARIF_BEGIN_MARKER.length, markerEnd).trim();
    try {
      JSON.parse(marked);
      return marked;
    } catch {
      return '';
    }
  }
  try {
    JSON.parse(trimmed);
    return trimmed;
  } catch {
    const firstBrace = trimmed.indexOf('{');
    const lastBrace = trimmed.lastIndexOf('}');
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      const candidate = trimmed.slice(firstBrace, lastBrace + 1);
      try {
        JSON.parse(candidate);
        return candidate;
      } catch {
        return '';
      }
    }
  }
  return '';
}

function codeqlSuiteFile(language: string, suite: string): string {
  if (suite.endsWith('.qls') || suite.includes('/')) {
    return suite;
  }
  if (language === 'javascript-typescript') {
    return `javascript-${suite}.qls`;
  }
  return suite;
}

function codeqlCliLanguage(language: string): string {
  if (language === 'javascript-typescript') {
    return 'javascript';
  }
  return language;
}

function buildCodeqlToolBootstrapScript(): string[] {
  return [
    `CODEQL_CACHE=${shellQuote(CODEQL_CACHE_MOUNT)}`,
    'CODEQL_HOME="$CODEQL_CACHE/codeql"',
    'CODEQL_BIN="$CODEQL_HOME/codeql"',
    'if [ ! -x "$CODEQL_BIN" ]; then',
    '  apt-get update >/dev/null',
    '  DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends curl ca-certificates >/dev/null',
    '  rm -rf "$CODEQL_HOME" "$CODEQL_CACHE/codeql-bundle-linux64.tar.gz"',
    `  curl -fL --retry 3 --connect-timeout 30 --max-time 1800 ${shellQuote(CODEQL_BUNDLE_URL)} -o "$CODEQL_CACHE/codeql-bundle-linux64.tar.gz"`,
    '  tar -xzf "$CODEQL_CACHE/codeql-bundle-linux64.tar.gz" -C "$CODEQL_CACHE"',
    '  rm -f "$CODEQL_CACHE/codeql-bundle-linux64.tar.gz"',
    'fi',
    'export PATH="$CODEQL_HOME:$PATH"',
    'codeql version',
    'node --version',
  ];
}

function extractCwes(rule: Record<string, unknown> | undefined): string[] | undefined {
  const properties = rule?.properties as Record<string, unknown> | undefined;
  const tags = Array.isArray(properties?.tags) ? properties.tags : [];
  const cwes = tags
    .map((tag) => String(tag))
    .map((tag) => {
      const match = tag.match(/cwe[-/](\d+)/i);
      return match ? `CWE-${match[1]}` : null;
    })
    .filter((value): value is string => Boolean(value));
  return cwes.length > 0 ? Array.from(new Set(cwes)) : undefined;
}

export function parseCodeqlSarif(rawOutput: string): CodeqlFinding[] {
  const sarif = extractSarifJson(rawOutput);
  if (!sarif) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(sarif);
  } catch {
    return [];
  }

  const runs = Array.isArray((parsed as Record<string, unknown>).runs)
    ? ((parsed as Record<string, unknown>).runs as unknown[])
    : [];
  const findings: CodeqlFinding[] = [];

  for (const run of runs) {
    const runRecord = run as Record<string, unknown>;
    const driver = ((runRecord.tool as Record<string, unknown> | undefined)?.driver ??
      {}) as Record<string, unknown>;
    const rules = Array.isArray(driver.rules) ? driver.rules : [];
    const ruleById = new Map<string, Record<string, unknown>>();
    for (const rule of rules) {
      const record = rule as Record<string, unknown>;
      const id = typeof record.id === 'string' ? record.id : '';
      if (id) ruleById.set(id, record);
    }

    const results = Array.isArray(runRecord.results) ? runRecord.results : [];
    for (const result of results) {
      const record = result as Record<string, unknown>;
      const resultRule = record.rule as Record<string, unknown> | undefined;
      const ruleId = String(record.ruleId ?? resultRule?.id ?? '');
      if (!ruleId) continue;

      const rule = ruleById.get(ruleId);
      const firstLocation = Array.isArray(record.locations) ? record.locations[0] : undefined;
      const physicalLocation = (firstLocation as Record<string, unknown> | undefined)
        ?.physicalLocation as Record<string, unknown> | undefined;
      const artifactLocation = physicalLocation?.artifactLocation as
        | Record<string, unknown>
        | undefined;
      const region = physicalLocation?.region as Record<string, unknown> | undefined;
      const messageObject = record.message as Record<string, unknown> | undefined;
      const properties = rule?.properties as Record<string, unknown> | undefined;
      const helpUri = typeof rule?.helpUri === 'string' ? rule.helpUri : undefined;
      const severity = String(
        record.level ??
          (rule?.defaultConfiguration as Record<string, unknown> | undefined)?.level ??
          'note',
      );
      const candidate: CodeqlFinding = {
        ruleId,
        path: String(artifactLocation?.uri ?? ''),
        startLine: Number(region?.startLine ?? 0),
        endLine: Number(region?.endLine ?? region?.startLine ?? 0),
        message: String(messageObject?.text ?? rule?.name ?? ruleId),
        severity,
        cwe: extractCwes(rule),
        securitySeverity:
          typeof properties?.['security-severity'] === 'string'
            ? properties['security-severity']
            : undefined,
        helpUri,
      };

      const validated = codeqlFindingSchema.safeParse(candidate);
      if (validated.success) {
        findings.push(validated.data);
      }
    }
  }

  return findings;
}

function mapCodeqlSeverity(
  finding: CodeqlFinding,
): 'critical' | 'high' | 'medium' | 'low' | 'info' {
  const score = finding.securitySeverity ? Number.parseFloat(finding.securitySeverity) : NaN;
  if (Number.isFinite(score)) {
    if (score >= 9) return 'critical';
    if (score >= 7) return 'high';
    if (score >= 4) return 'medium';
    return 'low';
  }

  const severity = finding.severity.toLowerCase();
  if (severity === 'error') return 'high';
  if (severity === 'warning') return 'medium';
  if (severity === 'note') return 'info';
  return 'info';
}

function buildCodeqlScript(
  language: string,
  suite: string,
  scanPath: string,
  sarifPath: string,
): string {
  const dbPath = '/tmp/codeql-db';
  const suiteFile = codeqlSuiteFile(language, suite);
  return [
    'set -eu',
    ...buildCodeqlToolBootstrapScript(),
    `rm -rf ${shellQuote(dbPath)} ${shellQuote(sarifPath)}`,
    [
      'codeql',
      'database',
      'create',
      shellQuote(dbPath),
      `--language=${codeqlCliLanguage(language)}`,
      `--source-root=${shellQuote(scanPath)}`,
      '--overwrite',
    ].join(' '),
    [
      'codeql',
      'database',
      'analyze',
      shellQuote(dbPath),
      shellQuote(suiteFile),
      '--format=sarif-latest',
      `--output=${shellQuote(sarifPath)}`,
    ].join(' '),
    'test -s ' + shellQuote(sarifPath),
    `printf '\\n${CODEQL_SARIF_BEGIN_MARKER}\\n'`,
    `cat ${shellQuote(sarifPath)}`,
    `printf '\\n${CODEQL_SARIF_END_MARKER}\\n'`,
  ].join('\n');
}

const definition = defineComponent({
  id: 'sentris.codeql.run',
  label: 'CodeQL Deep SAST Scanner',
  category: 'security',
  retryPolicy: codeqlRetryPolicy,
  runner: {
    kind: 'docker',
    ...SECURITY_DOCKER_RESOURCE_HEAVY,
    image: CODEQL_IMAGE,
    network: 'bridge',
    timeoutSeconds: CODEQL_DEFAULT_TIMEOUT_SECONDS,
    env: {
      HOME: '/tmp',
      CODEQL_JAVA_HOME: '',
      NO_COLOR: '1',
      TERM: 'dumb',
    },
    command: [],
  },
  inputs: inputSchema,
  outputs: outputSchema,
  parameters: parameterSchema,
  docs: 'Run CodeQL database creation and SARIF analysis for deep JavaScript/TypeScript security data-flow findings.',
  ui: {
    slug: 'codeql',
    version: '1.0.0',
    type: 'scan',
    category: 'security',
    description: 'Deep semantic and data-flow static analysis using CodeQL.',
    documentation: 'CodeQL CLI creates language databases and emits SARIF for security queries.',
    documentationUrl: 'https://codeql.github.com/docs/codeql-cli/',
    icon: 'ScanSearch',
    author: { name: 'SentrisAI', type: 'sentris' },
    isLatest: true,
    deprecated: false,
    example: '`codeql database create` then `codeql database analyze --format=sarif-latest`.',
    examples: ['Analyze npm package source for JS/TS security data-flow findings.'],
  },
  toolProvider: {
    kind: 'component',
    name: 'codeql_scanner',
    description: 'Deep semantic/data-flow static analyzer (CodeQL).',
  },
  async execute({ inputs, params }, context) {
    const parsedParams = parameterSchema.parse(params);
    const target =
      typeof inputs.target === 'string' && inputs.target.trim().length > 0 ? inputs.target : '';
    const volumeName =
      typeof inputs.volumeName === 'string' && inputs.volumeName.trim().length > 0
        ? inputs.volumeName.trim()
        : null;
    const scanPath = normalizeContainerPath(inputs.scanPath, CODEQL_VOLUME_MOUNT);

    if (!volumeName && target.trim().length === 0) {
      const caveat = 'No source content or repository volume provided to CodeQL.';
      context.logger.info(`[CodeQL] ${caveat}`);
      return {
        findings: [],
        sarif: '',
        rawOutput: '',
        findingCount: 0,
        scanStatus: 'skipped' as const,
        caveats: [caveat],
        results: [],
      };
    }

    const tenantId = (context as any).tenantId ?? 'default-tenant';
    const volume = volumeName
      ? IsolatedContainerVolume.attachExisting(tenantId, context.runId, volumeName)
      : new IsolatedContainerVolume(tenantId, context.runId);
    const outputVolume = new IsolatedContainerVolume(tenantId, `${context.runId}-codeql-output`);

    const baseRunner = definition.runner;
    if (baseRunner.kind !== 'docker') {
      throw new ContainerError('CodeQL runner is expected to be docker-based.', {
        details: { expectedKind: 'docker', actualKind: baseRunner.kind },
      });
    }

    let rawOutput = '';
    const caveats: string[] = [];
    let sarifFromFile = '';

    try {
      if (!volumeName) {
        await volume.initialize(materializeFileBundle(target, 'target-code.js'));
      }
      await outputVolume.initialize({});

      const runnerConfig = mergeSecurityDockerRunner(
        baseRunner,
        {
          entrypoint: 'sh',
          command: [
            '-lc',
            buildCodeqlScript(
              parsedParams.language,
              parsedParams.querySuite,
              scanPath,
              `${CODEQL_OUTPUT_MOUNT}/${CODEQL_RESULTS_FILE}`,
            ),
          ],
          volumes: [
            volume.getVolumeConfig(CODEQL_VOLUME_MOUNT, volumeName ? true : false),
            outputVolume.getVolumeConfig(CODEQL_OUTPUT_MOUNT, false),
            { source: CODEQL_CACHE_VOLUME, target: CODEQL_CACHE_MOUNT, readOnly: false },
          ],
          timeoutSeconds: parsedParams.timeoutSeconds,
        },
        parsedParams,
      );

      try {
        rawOutput = getRunnerOutputText(
          await runComponentWithRunner(
            runnerConfig,
            async () => ({}) as Output,
            { target: volumeName ? '[volume source]' : '[code content]' },
            context,
          ),
        );
      } catch (error: unknown) {
        const details = error instanceof ContainerError ? ((error as any).details ?? {}) : {};
        const captured = [details.stdout, details.stderr]
          .filter((value): value is string => typeof value === 'string' && value.length > 0)
          .join('\n');
        rawOutput = captured;
        caveats.push(
          `CodeQL failed non-blockingly: ${error instanceof Error ? error.message : String(error)}`,
        );
      }

      try {
        const outputFiles = await outputVolume.readFiles([CODEQL_RESULTS_FILE]);
        const fileSarif = outputFiles[CODEQL_RESULTS_FILE];
        if (typeof fileSarif === 'string' && fileSarif.trim().length > 0) {
          sarifFromFile = fileSarif.trim();
        }
      } catch (readError: unknown) {
        context.logger.warn(
          `[CodeQL] Could not read SARIF result file: ${
            readError instanceof Error ? readError.message : String(readError)
          }. Falling back to runner output.`,
        );
      }
    } finally {
      await volume.cleanup();
      await outputVolume.cleanup();
    }

    const sarif = sarifFromFile || extractSarifJson(rawOutput);
    const findings = parseCodeqlSarif(sarif || rawOutput);

    if (rawOutput.trim().length > 0 && sarif.length === 0) {
      caveats.push('CodeQL output did not contain parseable SARIF.');
    }

    const results: AnalyticsResult[] = findings.map((finding) => ({
      scanner: 'codeql',
      finding_hash: generateFindingHash(finding.ruleId, finding.path, String(finding.startLine)),
      severity: mapCodeqlSeverity(finding),
      asset_key: finding.ruleId,
      check_id: finding.ruleId,
      file_path: finding.path,
      start_line: finding.startLine,
      end_line: finding.endLine,
      message: finding.message,
      cwe: finding.cwe,
    }));

    const scanStatus = caveats.length > 0 ? ('failed' as const) : ('completed' as const);
    context.emitProgress({
      message:
        scanStatus === 'completed'
          ? `CodeQL found ${findings.length} findings`
          : `CodeQL completed with caveats and ${findings.length} parsed findings`,
      level: scanStatus === 'completed' ? 'info' : 'warn',
      data: { findingCount: findings.length, caveats },
    });

    return {
      findings,
      sarif,
      rawOutput,
      findingCount: findings.length,
      scanStatus,
      caveats,
      results,
    };
  },
});

componentRegistry.register(definition);

type Output = (typeof outputSchema)['__inferred'];

export type CodeqlInput = typeof inputSchema;
export type CodeqlOutput = typeof outputSchema;
