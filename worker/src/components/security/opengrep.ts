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

const OPENGREP_IMAGE = 'debian:bookworm-slim';
const OPENGREP_TIMEOUT_SECONDS = 600;
const OPENGREP_VOLUME_SCAN_TIMEOUT_SECONDS = 3600;
const OPENGREP_VERSION = 'v1.23.0';
const OPENGREP_RELEASE_BASE_URL = `https://github.com/opengrep/opengrep/releases/download/${OPENGREP_VERSION}`;
const OPENGREP_LINUX_X86_ASSET = 'opengrep_manylinux_x86';
const OPENGREP_LINUX_X86_SHA256 =
  '1f06548af379ab6080698a609612890ffad2d92dc2172f1e97d38d48096d5ef8';
const OPENGREP_LINUX_AARCH64_ASSET = 'opengrep_manylinux_aarch64';
const OPENGREP_LINUX_AARCH64_SHA256 =
  'ddf4935b138a2e825e6860529df1fb031524f7a2da8933ab7b2a16e5939c5178';

const DEFAULT_REPO_EXCLUDE_PATTERNS = [
  'node_modules',
  '.next',
  'coverage',
  'out',
  '.git',
  'vendor',
  'fixtures',
  '__snapshots__',
  '*.min.js',
  '*.min.css',
  '*.map',
] as const;

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
    z.string().trim().default('/repo').describe('Directory inside the mounted volume to scan.'),
    {
      label: 'Scan Path',
      description: 'Directory path inside the mounted volume, for example /repo.',
      connectionType: { kind: 'primitive', name: 'text' },
    },
  ),
  customFlags: port(z.string().optional().describe('Raw CLI flags to append to OpenGrep'), {
    label: 'Custom CLI Flags',
    description: 'Additional OpenGrep CLI options exactly as you would on the command line.',
    connectionType: { kind: 'primitive', name: 'text' },
  }),
});

const parameterSchema = parameters({
  ...securityDockerResourceParameterShape(),
  config: param(z.string().trim().default('auto').describe('OpenGrep rule config'), {
    label: 'Config / Ruleset',
    editor: 'textarea',
    rows: 2,
    placeholder: 'auto',
    description: 'Fallback ruleset when configs is empty.',
  }),
  configs: param(
    z
      .array(z.string().trim().min(1))
      .optional()
      .describe('OpenGrep/Semgrep-compatible rulesets applied together.'),
    {
      label: 'Config Rulesets',
      editor: 'multi-select',
      options: [
        { label: 'Security audit', value: 'p/security-audit' },
        { label: 'OWASP Top 10', value: 'p/owasp-top-ten' },
        { label: 'JavaScript', value: 'p/javascript' },
        { label: 'TypeScript', value: 'p/typescript' },
        { label: 'React', value: 'p/react' },
        { label: 'Node.js', value: 'p/nodejs' },
        { label: 'Auto', value: 'auto' },
      ],
      description: 'Multiple compatible configs run in one scan for broader pattern coverage.',
    },
  ),
  excludePatterns: param(
    z
      .array(z.string().trim().min(1))
      .default([...DEFAULT_REPO_EXCLUDE_PATTERNS])
      .describe('Path globs excluded from repository scans.'),
    {
      label: 'Exclude Patterns',
      editor: 'multi-select',
      options: DEFAULT_REPO_EXCLUDE_PATTERNS.map((pattern) => ({
        label: pattern,
        value: pattern,
      })),
      description: 'Skip generated assets, dependencies, and test fixtures during repo scans.',
    },
  ),
  timeoutSeconds: param(
    z
      .number()
      .int()
      .min(60)
      .max(7200)
      .default(OPENGREP_TIMEOUT_SECONDS)
      .describe('Maximum OpenGrep container runtime in seconds.'),
    {
      label: 'Timeout (seconds)',
      editor: 'number',
      min: 60,
      max: 7200,
      description: 'Increase for full-repository scans on large monorepos.',
    },
  ),
  severity: param(
    z
      .array(z.enum(['ERROR', 'WARNING', 'INFO']))
      .optional()
      .describe('Filter findings by severity'),
    {
      label: 'Severity Filter',
      editor: 'multi-select',
      options: [
        { label: 'Error', value: 'ERROR' },
        { label: 'Warning', value: 'WARNING' },
        { label: 'Info', value: 'INFO' },
      ],
      description: 'Only report findings matching these severity levels.',
    },
  ),
  lang: param(z.string().trim().optional().describe('Language filter'), {
    label: 'Language',
    editor: 'text',
    placeholder: 'javascript',
    description: 'Filter scanning to a specific language.',
  }),
});

const findingSchema = z.object({
  checkId: z.string(),
  path: z.string(),
  startLine: z.number(),
  endLine: z.number(),
  message: z.string(),
  severity: z.string(),
  cwe: z.array(z.string()).optional(),
  owasp: z.array(z.string()).optional(),
  fix: z.string().optional(),
});

type Finding = z.infer<typeof findingSchema>;

const outputSchema = outputs({
  findings: port(z.array(findingSchema), {
    label: 'OpenGrep Findings',
    description: 'Array of pattern SAST findings with rule ID, path, line numbers, and severity.',
    connectionType: { kind: 'list', element: { kind: 'primitive', name: 'json' } },
  }),
  rawOutput: port(z.string(), {
    label: 'Raw Output',
    description: 'Raw tool output for debugging.',
  }),
  findingCount: port(z.number(), {
    label: 'Finding Count',
    description: 'Number of findings detected.',
  }),
  scanStatus: port(z.enum(['completed', 'failed', 'skipped']), {
    label: 'Scan Status',
    description: 'Whether OpenGrep completed, failed non-blockingly, or skipped.',
  }),
  caveats: port(z.array(z.string()), {
    label: 'Caveats',
    description: 'Non-blocking OpenGrep setup, execution, or parsing caveats.',
  }),
  results: port(z.array(analyticsResultSchema()), {
    label: 'Results',
    description: 'Analytics-ready OpenGrep findings.',
  }),
});

const opengrepRetryPolicy: ComponentRetryPolicy = {
  maxAttempts: 1,
  nonRetryableErrorTypes: ['ContainerError', 'ValidationError', 'ConfigurationError'],
};

function splitCliArgs(input: string): string[] {
  const args: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;
  let escape = false;

  for (const ch of input) {
    if (escape) {
      current += ch;
      escape = false;
      continue;
    }
    if (ch === '\\') {
      escape = true;
      continue;
    }
    if (quote) {
      if (ch === quote) quote = null;
      else current += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (/\s/.test(ch)) {
      if (current.length > 0) {
        args.push(current);
        current = '';
      }
      continue;
    }
    current += ch;
  }

  if (current.length > 0) args.push(current);
  return args;
}

function parseJsonObject(rawOutput: string): unknown | null {
  const trimmed = rawOutput.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    let start = trimmed.indexOf('{');
    while (start >= 0) {
      let depth = 0;
      let inString = false;
      let escaped = false;
      for (let index = start; index < trimmed.length; index += 1) {
        const char = trimmed[index];
        if (inString) {
          if (escaped) escaped = false;
          else if (char === '\\') escaped = true;
          else if (char === '"') inString = false;
          continue;
        }
        if (char === '"') inString = true;
        else if (char === '{') depth += 1;
        else if (char === '}') {
          depth -= 1;
          if (depth === 0) {
            try {
              return JSON.parse(trimmed.slice(start, index + 1));
            } catch {
              break;
            }
          }
        }
      }
      start = trimmed.indexOf('{', start + 1);
    }
  }
  return null;
}

export function parseOpenGrepJsonOutput(rawOutput: string): Finding[] {
  const parsed = parseJsonObject(rawOutput);
  const results =
    parsed && typeof parsed === 'object' ? (parsed as { results?: unknown }).results : undefined;
  if (!Array.isArray(results)) return [];

  const findings: Finding[] = [];
  for (const result of results) {
    const entry = result as Record<string, any>;
    const cweValue = entry.extra?.metadata?.cwe;
    const owaspValue = entry.extra?.metadata?.owasp;
    const cwe = Array.isArray(cweValue)
      ? cweValue.map(String)
      : typeof cweValue === 'string'
        ? [cweValue]
        : undefined;
    const owasp = Array.isArray(owaspValue)
      ? owaspValue.map(String)
      : typeof owaspValue === 'string'
        ? [owaspValue]
        : undefined;
    const candidate: Finding = {
      checkId: String(entry.check_id ?? ''),
      path: String(entry.path ?? ''),
      startLine: Number(entry.start?.line ?? 0),
      endLine: Number(entry.end?.line ?? entry.start?.line ?? 0),
      message: String(entry.extra?.message ?? ''),
      severity: String(entry.extra?.severity ?? entry.severity ?? 'INFO'),
      cwe,
      owasp,
      fix: typeof entry.extra?.fix === 'string' ? entry.extra.fix : undefined,
    };

    const validated = findingSchema.safeParse(candidate);
    if (validated.success && candidate.checkId.length > 0) {
      findings.push(validated.data);
    }
  }
  return findings;
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

function mapSeverity(severity: string): 'critical' | 'high' | 'medium' | 'low' | 'info' {
  switch (severity.toUpperCase()) {
    case 'ERROR':
      return 'high';
    case 'WARNING':
      return 'medium';
    case 'INFO':
      return 'info';
    default:
      return 'info';
  }
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\"'\"'")}'`;
}

function buildOpenGrepScript(args: string[]): string {
  const quotedArgs = args.map(shellQuote).join(' ');
  return [
    'set -eu',
    'export DEBIAN_FRONTEND=noninteractive',
    'if ! command -v curl >/dev/null 2>&1; then apt-get update >/dev/null && apt-get install -y --no-install-recommends ca-certificates curl >/dev/null; fi',
    `OPENGREP_VERSION=${shellQuote(OPENGREP_VERSION)}`,
    `OPENGREP_RELEASE_BASE_URL=${shellQuote(OPENGREP_RELEASE_BASE_URL)}`,
    'ARCH="$(uname -m)"',
    [
      'case "$ARCH" in',
      `  x86_64|amd64) OPENGREP_ASSET=${shellQuote(OPENGREP_LINUX_X86_ASSET)}; OPENGREP_SHA256=${shellQuote(OPENGREP_LINUX_X86_SHA256)} ;;`,
      `  aarch64|arm64) OPENGREP_ASSET=${shellQuote(OPENGREP_LINUX_AARCH64_ASSET)}; OPENGREP_SHA256=${shellQuote(OPENGREP_LINUX_AARCH64_SHA256)} ;;`,
      '  *) echo "Unsupported OpenGrep scanner architecture: $ARCH" >&2; exit 1 ;;',
      'esac',
    ].join(' '),
    'OPENGREP_DIR="${HOME:-/root}/.opengrep/cli/${OPENGREP_VERSION}"',
    'OPENGREP_BIN="${OPENGREP_DIR}/opengrep"',
    'if [ ! -x "$OPENGREP_BIN" ]; then mkdir -p "$OPENGREP_DIR"; curl -fsSL "${OPENGREP_RELEASE_BASE_URL}/${OPENGREP_ASSET}" -o "$OPENGREP_BIN.tmp"; echo "${OPENGREP_SHA256}  $OPENGREP_BIN.tmp" | sha256sum -c - >/dev/null; chmod +x "$OPENGREP_BIN.tmp"; mv "$OPENGREP_BIN.tmp" "$OPENGREP_BIN"; fi',
    `"$OPENGREP_BIN" ${quotedArgs}`,
  ].join(' && ');
}

const definition = defineComponent({
  id: 'sentris.opengrep.run',
  label: 'OpenGrep Pattern SAST Scanner',
  category: 'security',
  retryPolicy: opengrepRetryPolicy,
  runner: {
    kind: 'docker',
    ...SECURITY_DOCKER_RESOURCE_HEAVY,
    image: OPENGREP_IMAGE,
    entrypoint: 'sh',
    network: 'bridge',
    timeoutSeconds: OPENGREP_VOLUME_SCAN_TIMEOUT_SECONDS,
    env: {
      HOME: '/tmp',
      NO_COLOR: '1',
      TERM: 'dumb',
    },
    command: [],
  },
  inputs: inputSchema,
  outputs: outputSchema,
  parameters: parameterSchema,
  docs: 'Run OpenGrep pattern-based SAST and emit Semgrep-compatible JSON findings.',
  ui: {
    slug: 'opengrep',
    version: '1.0.0',
    type: 'scan',
    category: 'security',
    description: 'Fast open-source pattern SAST using OpenGrep compatible JSON output.',
    documentation:
      'OpenGrep provides Semgrep-compatible pattern matching for rapid code review leads.',
    documentationUrl: 'https://github.com/opengrep/opengrep',
    icon: 'FileSearch',
    author: { name: 'SentrisAI', type: 'sentris' },
    isLatest: true,
    deprecated: false,
    example: '`opengrep scan --config p/security-audit --json /repo`.',
    examples: ['Run OpenGrep alongside Semgrep and compare pattern-matching leads.'],
  },
  toolProvider: {
    kind: 'component',
    name: 'opengrep_scanner',
    description: 'Pattern-based static analyzer (OpenGrep).',
  },
  async execute({ inputs, params }, context) {
    const parsedParams = parameterSchema.parse(params);
    const target =
      typeof inputs.target === 'string' && inputs.target.trim().length > 0 ? inputs.target : '';
    const volumeName =
      typeof inputs.volumeName === 'string' && inputs.volumeName.trim().length > 0
        ? inputs.volumeName.trim()
        : null;
    const scanPath =
      typeof inputs.scanPath === 'string' && inputs.scanPath.trim().length > 0
        ? inputs.scanPath.trim().replace(/\/+$/, '')
        : '/repo';

    if (!volumeName && target.trim().length === 0) {
      const caveat = 'No source content or repository volume provided to OpenGrep.';
      return {
        findings: [],
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
    const baseRunner = definition.runner;
    if (baseRunner.kind !== 'docker') {
      throw new ContainerError('OpenGrep runner is expected to be docker-based.', {
        details: { expectedKind: 'docker', actualKind: baseRunner.kind },
      });
    }

    const configs =
      parsedParams.configs && parsedParams.configs.length > 0
        ? parsedParams.configs
        : [parsedParams.config];
    const customFlags =
      typeof inputs.customFlags === 'string' && inputs.customFlags.length > 0
        ? splitCliArgs(inputs.customFlags)
        : [];
    const timeoutSeconds = parsedParams.timeoutSeconds;

    let rawOutput = '';
    const caveats: string[] = [];

    try {
      if (!volumeName) {
        await volume.initialize(materializeFileBundle(target, 'target-code.txt'));
      }

      const args = ['scan', '--json', '--quiet'];
      for (const config of configs) {
        args.push('--config', config);
      }
      if (volumeName) {
        for (const pattern of parsedParams.excludePatterns) {
          args.push('--exclude', pattern);
        }
      }
      if (parsedParams.severity) {
        for (const severity of parsedParams.severity) {
          args.push('--severity', severity);
        }
      }
      if (parsedParams.lang) {
        args.push('--lang', parsedParams.lang);
      }
      args.push(volumeName ? `${scanPath}/` : '/inputs/');
      args.push(...customFlags.filter(Boolean));

      const runnerConfig = mergeSecurityDockerRunner(
        baseRunner,
        {
          entrypoint: 'sh',
          command: ['-lc', buildOpenGrepScript(args)],
          volumes: [
            volume.getVolumeConfig(volumeName ? '/repo' : '/inputs', volumeName ? true : false),
          ],
          timeoutSeconds,
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
        rawOutput = [details.stdout, details.stderr]
          .filter((value): value is string => typeof value === 'string' && value.length > 0)
          .join('\n');
        caveats.push(
          `OpenGrep failed non-blockingly: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    } finally {
      await volume.cleanup();
    }

    const findings = parseOpenGrepJsonOutput(rawOutput);
    if (rawOutput.trim().length > 0 && findings.length === 0) {
      const parsed = parseJsonObject(rawOutput);
      if (!parsed) caveats.push('OpenGrep output did not contain parseable JSON.');
    }

    const results: AnalyticsResult[] = findings.map((finding) => ({
      scanner: 'opengrep',
      finding_hash: generateFindingHash(finding.checkId, finding.path, String(finding.startLine)),
      severity: mapSeverity(finding.severity),
      asset_key: finding.checkId,
      check_id: finding.checkId,
      file_path: finding.path,
      start_line: finding.startLine,
      end_line: finding.endLine,
      message: finding.message,
      cwe: finding.cwe,
    }));

    const scanStatus = caveats.length > 0 ? ('failed' as const) : ('completed' as const);
    return {
      findings,
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

export type OpenGrepInput = typeof inputSchema;
export type OpenGrepOutput = typeof outputSchema;
