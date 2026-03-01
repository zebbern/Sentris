import { z } from 'zod';
import {
  componentRegistry,
  runComponentWithRunner,
  type DockerRunnerConfig,
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

const SEMGREP_IMAGE = 'semgrep/semgrep:latest';
const SEMGREP_TIMEOUT_SECONDS = 600; // 10 minutes default

const inputSchema = inputs({
  target: port(
    z.string().min(1, 'Target code content is required').describe('Source code content to scan'),
    {
      label: 'Target Code',
      description:
        'Source code content or file content to scan. Will be written to a file in the container for analysis.',
      connectionType: { kind: 'primitive', name: 'text' },
    },
  ),
  customFlags: port(
    z.string().optional().describe('Raw CLI flags to append to the semgrep command'),
    {
      label: 'Custom CLI Flags',
      description: 'Additional semgrep CLI options exactly as you would on the command line.',
      connectionType: { kind: 'primitive', name: 'text' },
    },
  ),
});

const parameterSchema = parameters({
  config: param(z.string().trim().default('auto').describe('Semgrep rule config'), {
    label: 'Config / Ruleset',
    editor: 'textarea',
    rows: 2,
    placeholder: 'auto',
    description:
      'Semgrep rule config: "auto", a registry name like "p/owasp-top-ten", or custom YAML rules.',
  }),
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
    placeholder: 'python',
    description: 'Filter scanning to a specific language (e.g., python, javascript, go).',
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
    label: 'Security Findings',
    description: 'Array of SAST findings with rule ID, path, line numbers, and severity.',
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
  results: port(z.array(analyticsResultSchema()), {
    label: 'Results',
    description:
      'Analytics-ready findings with scanner, finding_hash, and severity. Connect to Analytics Sink.',
  }),
});

// Split custom CLI flags into an array of arguments
const splitCliArgs = (input: string): string[] => {
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
      if (ch === quote) {
        quote = null;
      } else {
        current += ch;
      }
      continue;
    }

    if (ch === '"' || ch === "'") {
      quote = ch as '"' | "'";
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

  if (current.length > 0) {
    args.push(current);
  }

  return args;
};

/**
 * Map Semgrep severity string to analytics severity.
 */
const mapSemgrepSeverity = (severity: string): 'critical' | 'high' | 'medium' | 'low' | 'info' => {
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
};

const semgrepRetryPolicy: ComponentRetryPolicy = {
  maxAttempts: 2,
  initialIntervalSeconds: 5,
  maximumIntervalSeconds: 30,
  backoffCoefficient: 2.0,
  nonRetryableErrorTypes: ['ContainerError', 'ValidationError', 'ConfigurationError'],
};

const runnerOutputSchema = z.object({
  stdout: z.string().optional().default(''),
  stderr: z.string().optional().default(''),
  exitCode: z.number().optional().default(0),
});

const definition = defineComponent({
  id: 'sentris.semgrep.run',
  label: 'Semgrep SAST Scanner',
  category: 'security',
  retryPolicy: semgrepRetryPolicy,
  runner: {
    kind: 'docker',
    image: SEMGREP_IMAGE,
    network: 'bridge',
    timeoutSeconds: SEMGREP_TIMEOUT_SECONDS,
    env: {
      HOME: '/tmp',
      // Disable Semgrep telemetry in container
      SEMGREP_SEND_METRICS: 'off',
    },
    command: [],
  },
  inputs: inputSchema,
  outputs: outputSchema,
  parameters: parameterSchema,
  docs: 'Run Semgrep static analysis to find security vulnerabilities, bugs, and anti-patterns in source code.',
  ui: {
    slug: 'semgrep',
    version: '1.0.0',
    type: 'scan',
    category: 'security',
    description:
      'Static application security testing (SAST) using Semgrep to find code vulnerabilities and anti-patterns.',
    documentation:
      'Semgrep documentation covers rule syntax, registry rulesets, language support, and CI integration.',
    documentationUrl: 'https://github.com/semgrep/semgrep',
    icon: 'FileCode',
    author: {
      name: 'SentrisAI',
      type: 'sentris',
    },
    isLatest: true,
    deprecated: false,
    example:
      '`semgrep scan --config auto --json /path/to/code` - Scan code with auto-detected rules.',
    examples: [
      'Scan source code for OWASP Top 10 vulnerabilities.',
      'Run custom Semgrep rules against a codebase for anti-patterns.',
    ],
  },
  toolProvider: {
    kind: 'component',
    name: 'sast_scanner',
    description: 'Static application security testing scanner (Semgrep).',
  },
  async execute({ inputs, params }, context) {
    const parsedParams = parameterSchema.parse(params);

    const customFlags =
      typeof inputs.customFlags === 'string' && inputs.customFlags.length > 0
        ? inputs.customFlags
        : null;
    const customFlagArgs = customFlags ? splitCliArgs(customFlags) : [];

    const target = inputs.target;

    context.logger.info(`[Semgrep] Starting SAST scan with config: ${parsedParams.config}`);
    context.emitProgress({
      message: `Launching Semgrep scan with config: ${parsedParams.config}`,
      level: 'info',
    });

    const tenantId = (context as any).tenantId ?? 'default-tenant';
    const volume = new IsolatedContainerVolume(tenantId, context.runId);

    const baseRunner = definition.runner;
    if (baseRunner.kind !== 'docker') {
      throw new ContainerError('Semgrep runner is expected to be docker-based.', {
        details: { expectedKind: 'docker', actualKind: baseRunner.kind },
      });
    }

    let rawOutput: string;
    try {
      // Write target code into the volume for scanning
      await volume.initialize({
        'code/target-code.txt': target,
      });
      context.logger.info(`[Semgrep] Created isolated volume: ${volume.getVolumeName()}`);

      // Build Semgrep CLI args
      // semgrep scan --config {config} --json /inputs/code/ [--severity ...] [--lang ...]
      const args: string[] = [
        'semgrep',
        'scan',
        '--config',
        parsedParams.config,
        '--json',
        '--no-git',
      ];

      if (parsedParams.severity && parsedParams.severity.length > 0) {
        for (const sev of parsedParams.severity) {
          args.push('--severity', sev);
        }
      }

      if (parsedParams.lang) {
        args.push('--lang', parsedParams.lang);
      }

      // Target directory inside container
      args.push('/inputs/code/');

      // Append custom flags last
      for (const flag of customFlagArgs) {
        if (flag.length > 0) {
          args.push(flag);
        }
      }

      const runnerConfig: DockerRunnerConfig = {
        kind: 'docker',
        image: baseRunner.image,
        network: baseRunner.network,
        timeoutSeconds: baseRunner.timeoutSeconds ?? SEMGREP_TIMEOUT_SECONDS,
        env: { ...(baseRunner.env ?? {}) },
        command: [...(baseRunner.command ?? []), ...args],
        volumes: [volume.getVolumeConfig('/inputs', true)],
      };

      try {
        const result = await runComponentWithRunner(
          runnerConfig,
          async () => ({}) as Output,
          { target: '[code content]', config: parsedParams.config },
          context,
        );

        if (typeof result === 'string') {
          rawOutput = result;
        } else if (result && typeof result === 'object' && 'rawOutput' in result) {
          rawOutput = String((result as any).rawOutput ?? '');
        } else if (result && typeof result === 'object') {
          const parsed = runnerOutputSchema.safeParse(result);
          if (parsed.success) {
            rawOutput = parsed.data.stdout ?? '';
          } else {
            rawOutput = '';
          }
        } else {
          rawOutput = '';
        }
      } catch (error: unknown) {
        if (error instanceof ContainerError) {
          const details = (error as any).details as Record<string, unknown> | undefined;
          const capturedStdout = details?.stdout;
          if (typeof capturedStdout === 'string' && capturedStdout.trim().length > 0) {
            context.logger.warn(
              '[Semgrep] Container exited non-zero but produced output. Preserving partial results.',
            );
            context.emitProgress({
              message: 'Semgrep exited with errors but found some results',
              level: 'warn',
              data: { exitCode: details?.exitCode },
            });
            rawOutput = capturedStdout;
          } else {
            throw error;
          }
        } else {
          throw error;
        }
      }
    } finally {
      await volume.cleanup();
      context.logger.info('[Semgrep] Cleaned up isolated volume');
    }

    // Parse Semgrep JSON output
    // Structure: { results: [ { check_id, path, start: { line }, end: { line }, extra: { message, severity, metadata: { cwe, owasp } } } ] }
    const findings: Finding[] = [];

    const trimmed = rawOutput.trim();
    if (trimmed.length > 0) {
      try {
        const parsed = JSON.parse(trimmed);
        if (parsed && typeof parsed === 'object' && Array.isArray(parsed.results)) {
          for (const result of parsed.results) {
            const cweList: string[] = [];
            const owaspList: string[] = [];

            if (result.extra?.metadata?.cwe) {
              const cwe = result.extra.metadata.cwe;
              if (Array.isArray(cwe)) {
                cweList.push(...cwe.map(String));
              } else if (typeof cwe === 'string') {
                cweList.push(cwe);
              }
            }

            if (result.extra?.metadata?.owasp) {
              const owasp = result.extra.metadata.owasp;
              if (Array.isArray(owasp)) {
                owaspList.push(...owasp.map(String));
              } else if (typeof owasp === 'string') {
                owaspList.push(owasp);
              }
            }

            const candidate: Finding = {
              checkId: result.check_id ?? '',
              path: result.path ?? '',
              startLine: result.start?.line ?? 0,
              endLine: result.end?.line ?? 0,
              message: result.extra?.message ?? '',
              severity: result.extra?.severity ?? result.severity ?? 'INFO',
              cwe: cweList.length > 0 ? cweList : undefined,
              owasp: owaspList.length > 0 ? owaspList : undefined,
              fix: result.extra?.fix,
            };

            const validated = findingSchema.safeParse(candidate);
            if (validated.success && candidate.checkId.length > 0) {
              findings.push(validated.data);
            }
          }
        }
      } catch {
        context.logger.warn('[Semgrep] Could not parse output as JSON. Raw output preserved.');
      }
    }

    const findingCount = findings.length;

    context.logger.info(`[Semgrep] Found ${findingCount} findings`);

    if (findingCount === 0) {
      context.emitProgress({
        message: 'No findings detected by Semgrep',
        level: 'info',
      });
    } else {
      context.emitProgress({
        message: `Semgrep found ${findingCount} findings`,
        level: 'info',
        data: { findings: findings.slice(0, 10).map((f) => f.checkId) },
      });
    }

    // Build analytics-ready results
    const analyticsResults: AnalyticsResult[] = findings.map((finding) => ({
      scanner: 'semgrep',
      finding_hash: generateFindingHash(finding.checkId, finding.path, String(finding.startLine)),
      severity: mapSemgrepSeverity(finding.severity),
      asset_key: finding.checkId,
      check_id: finding.checkId,
      file_path: finding.path,
      start_line: finding.startLine,
      end_line: finding.endLine,
      message: finding.message,
      cwe: finding.cwe,
    }));

    return {
      findings,
      rawOutput,
      findingCount,
      results: analyticsResults,
    };
  },
});

componentRegistry.register(definition);

type Output = (typeof outputSchema)['__inferred'];

type SemgrepInput = typeof inputSchema;
type SemgrepOutput = typeof outputSchema;

export type { SemgrepInput, SemgrepOutput };
