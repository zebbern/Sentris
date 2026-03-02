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

const TESTSSL_IMAGE = 'drwetter/testssl.sh:latest';
const TESTSSL_TIMEOUT_SECONDS = 900; // 15 minutes — testssl full scans can take 3+ minutes
const OUTPUT_DIR = '/output';
const RESULTS_FILE = 'results.json';

const inputSchema = inputs({
  target: port(z.string().min(1, 'Target cannot be empty').describe('Hostname:port to audit'), {
    label: 'Target',
    description:
      'Hostname and optional port to test (e.g., "example.com", "example.com:443"). Defaults to port 443 if not specified.',
    connectionType: { kind: 'primitive', name: 'text' },
  }),
  customFlags: port(
    z.string().trim().optional().describe('Raw CLI flags to append to the testssl.sh command'),
    {
      label: 'Custom CLI Flags',
      editor: 'textarea',
      description:
        'Additional testssl.sh CLI options exactly as you would on the command line. Appended after generated options.',
    },
  ),
});

const parameterSchema = parameters({
  protocols: param(z.boolean().default(true), {
    label: 'Test Protocols',
    editor: 'boolean',
    description: 'Test SSL/TLS protocol support (SSLv2, SSLv3, TLS 1.0–1.3).',
  }),
  ciphers: param(z.boolean().default(true), {
    label: 'Test Ciphers',
    editor: 'boolean',
    description: 'Test standard cipher suites offered by the server.',
  }),
  vulnerabilities: param(z.boolean().default(true), {
    label: 'Test Vulnerabilities',
    editor: 'boolean',
    description: 'Test for known TLS vulnerabilities (Heartbleed, POODLE, ROBOT, DROWN, etc.).',
  }),
  timeout: param(z.number().int().min(60).max(1800).default(600), {
    label: 'Timeout (seconds)',
    editor: 'number',
    min: 60,
    max: 1800,
    description: 'Maximum execution time in seconds.',
  }),
});

const findingSchema = z.object({
  id: z.string(),
  severity: z.string(),
  finding: z.string(),
  ip: z.string().optional(),
  port: z.string().optional(),
  cve: z.string().optional(),
  cwe: z.string().optional(),
});

type Finding = z.infer<typeof findingSchema>;

const outputSchema = outputs({
  findings: port(z.array(findingSchema), {
    label: 'TLS Findings',
    description: 'Array of TLS/SSL findings with severity and details.',
    connectionType: { kind: 'list', element: { kind: 'primitive', name: 'json' } },
  }),
  rawOutput: port(z.string(), {
    label: 'Raw Output',
    description: 'Raw tool output for debugging.',
  }),
  results: port(z.array(analyticsResultSchema()), {
    label: 'Results',
    description:
      'Analytics-ready findings with scanner, finding_hash, and severity. Connect to Analytics Sink.',
  }),
  findingCount: port(z.number(), {
    label: 'Finding Count',
    description: 'Total number of TLS findings.',
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
 * Maps testssl.sh severity strings to normalized severity levels.
 */
const mapSeverity = (raw: string): 'critical' | 'high' | 'medium' | 'low' | 'info' => {
  const upper = raw.toUpperCase();
  if (upper === 'CRITICAL') return 'critical';
  if (upper === 'HIGH') return 'high';
  if (upper === 'MEDIUM') return 'medium';
  if (upper === 'LOW') return 'low';
  // OK, INFO, WARN, or anything else maps to info
  return 'info';
};

const testsslRetryPolicy: ComponentRetryPolicy = {
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
  id: 'sentris.testssl.run',
  label: 'testssl.sh — TLS/SSL Auditor',
  category: 'security',
  retryPolicy: testsslRetryPolicy,
  runner: {
    kind: 'docker',
    image: TESTSSL_IMAGE,
    network: 'bridge',
    timeoutSeconds: TESTSSL_TIMEOUT_SECONDS,
    command: [],
    env: {
      HOME: '/tmp',
    },
  },
  inputs: inputSchema,
  outputs: outputSchema,
  parameters: parameterSchema,
  docs: 'Runs testssl.sh to audit SSL/TLS configurations — protocols, cipher suites, and known vulnerabilities like Heartbleed and POODLE.',
  ui: {
    slug: 'testssl',
    version: '1.0.0',
    type: 'scan',
    category: 'security',
    description:
      'Audit SSL/TLS configurations for protocols, ciphers, and vulnerabilities using testssl.sh.',
    documentation:
      'testssl.sh is a command-line tool for testing TLS/SSL encryption on any port, checking protocols, ciphers, and known vulnerabilities.',
    documentationUrl: 'https://github.com/drwetter/testssl.sh',
    icon: 'Lock',
    author: {
      name: 'SentrisAI',
      type: 'sentris',
    },
    isLatest: true,
    deprecated: false,
    example:
      '`testssl.sh --jsonfile results.json example.com:443` — Full TLS audit with JSON output.',
    examples: [
      'Audit TLS configuration of a web server before deployment.',
      'Check for Heartbleed, POODLE, and other TLS vulnerabilities.',
    ],
  },
  async execute({ inputs, params }, context) {
    const parsedParams = parameterSchema.parse(params);
    const { protocols, ciphers, vulnerabilities, timeout } = parsedParams;

    const target = inputs.target.trim();
    const customFlags =
      typeof inputs.customFlags === 'string' && inputs.customFlags.trim().length > 0
        ? inputs.customFlags.trim()
        : null;
    const customFlagArgs = customFlags ? splitCliArgs(customFlags) : [];

    context.logger.info(`[testssl] Auditing TLS configuration for: ${target}`);
    context.emitProgress({
      message: `Launching testssl.sh for ${target}`,
      level: 'info',
      data: { target },
    });

    const tenantId = (context as any).tenantId ?? 'default-tenant';
    const volume = new IsolatedContainerVolume(tenantId, context.runId);

    const baseRunner = definition.runner;
    if (baseRunner.kind !== 'docker') {
      throw new ContainerError('testssl runner is expected to be docker-based.', {
        details: { expectedKind: 'docker', actualKind: baseRunner.kind },
      });
    }

    let rawOutput = '';

    try {
      // Initialize volume for output
      await volume.initialize({});
      context.logger.info(`[testssl] Created isolated volume: ${volume.getVolumeName()}`);

      // Build testssl.sh CLI arguments
      const args: string[] = [];

      // JSON output to file in output volume
      args.push('--jsonfile', `${OUTPUT_DIR}/${RESULTS_FILE}`);

      // Selective test flags — if all are false, testssl runs everything (default)
      // If specific ones are enabled, run only those
      const hasSpecificTests = protocols || ciphers || vulnerabilities;
      const allEnabled = protocols && ciphers && vulnerabilities;

      if (hasSpecificTests && !allEnabled) {
        if (protocols) args.push('--protocols');
        if (ciphers) args.push('--std');
        if (vulnerabilities) args.push('--vulnerable');
      }
      // If all are enabled or none are enabled, let testssl run its default full test suite

      // Custom flags appended last
      for (const flag of customFlagArgs) {
        if (flag.length > 0) {
          args.push(flag);
        }
      }

      // Target is always the last argument
      args.push(target);

      const effectiveTimeout = timeout ?? 300;
      const runnerConfig: DockerRunnerConfig = {
        kind: 'docker',
        image: baseRunner.image,
        network: baseRunner.network,
        timeoutSeconds: Math.max(
          effectiveTimeout,
          baseRunner.timeoutSeconds ?? TESTSSL_TIMEOUT_SECONDS,
        ),
        env: { ...(baseRunner.env ?? {}) },
        command: [...(baseRunner.command ?? []), ...args],
        volumes: [volume.getVolumeConfig(OUTPUT_DIR, false)],
      };

      try {
        const result = await runComponentWithRunner(
          runnerConfig,
          async () => ({}) as Output,
          { target },
          context,
        );

        if (typeof result === 'string') {
          rawOutput = result;
        } else if (result && typeof result === 'object') {
          const parsed = runnerOutputSchema.safeParse(result);
          if (parsed.success) {
            rawOutput = parsed.data.stdout || parsed.data.stderr || '';
          } else if ('rawOutput' in result) {
            rawOutput = String((result as Record<string, unknown>).rawOutput ?? '');
          }
        }
      } catch (error: unknown) {
        if (error instanceof ContainerError) {
          const details = (error as any).details as Record<string, unknown> | undefined;
          const capturedStdout = details?.stdout;
          if (typeof capturedStdout === 'string' && capturedStdout.trim().length > 0) {
            context.logger.warn(
              `[testssl] Container exited non-zero but produced output. Preserving partial results.`,
            );
            rawOutput = capturedStdout;
          } else {
            throw error;
          }
        } else {
          throw error;
        }
      }

      // Read JSON results file from volume
      let findings: Finding[] = [];
      try {
        const outputFiles = await volume.readFiles([RESULTS_FILE]);
        const jsonContent = outputFiles[RESULTS_FILE];

        if (jsonContent && jsonContent.trim().length > 0) {
          findings = parseTestsslOutput(jsonContent, context);
        }
      } catch (readError: unknown) {
        context.logger.warn(
          `[testssl] Could not read results file: ${readError instanceof Error ? readError.message : String(readError)}`,
        );
        // Try parsing stdout as fallback
        if (rawOutput.trim().length > 0) {
          try {
            findings = parseTestsslOutput(rawOutput, context);
          } catch {
            context.logger.warn('[testssl] Could not parse stdout as JSON either.');
          }
        }
      }

      context.logger.info(`[testssl] Audit complete: ${findings.length} finding(s) for ${target}`);

      if (findings.length === 0) {
        context.emitProgress({
          message: 'No TLS findings detected by testssl.sh',
          level: 'warn',
        });
      } else {
        context.emitProgress({
          message: `testssl.sh found ${findings.length} finding(s)`,
          level: 'info',
          data: { findingCount: findings.length },
        });
      }

      // Build analytics-ready results
      const analyticsResults: AnalyticsResult[] = findings.map((finding) => ({
        scanner: 'testssl',
        finding_hash: generateFindingHash(finding.id, target),
        severity: mapSeverity(finding.severity),
        asset_key: finding.id,
        id: finding.id,
        finding: finding.finding,
        target,
        cve: finding.cve,
        cwe: finding.cwe,
      }));

      return {
        findings,
        rawOutput,
        results: analyticsResults,
        findingCount: findings.length,
      };
    } finally {
      await volume.cleanup();
      context.logger.info('[testssl] Cleaned up isolated volume');
    }
  },
});

/**
 * Parse testssl.sh JSON output into normalized findings.
 * testssl outputs a JSON array of objects with id, severity, finding, ip, port fields.
 */
function parseTestsslOutput(raw: string, context: any): Finding[] {
  if (!raw || raw.trim().length === 0) {
    return [];
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    context.logger.warn('[testssl] Failed to parse JSON output');
    return [];
  }

  const items = Array.isArray(parsed) ? parsed : [];
  const findings: Finding[] = [];

  for (const item of items) {
    if (!item || typeof item !== 'object') continue;

    const candidate: Finding = {
      id: String(item.id ?? 'unknown'),
      severity: String(item.severity ?? 'INFO'),
      finding: String(item.finding ?? ''),
      ip: typeof item.ip === 'string' ? item.ip : undefined,
      port: typeof item.port === 'string' ? item.port : undefined,
      cve: typeof item.cve === 'string' && item.cve.length > 0 ? item.cve : undefined,
      cwe: typeof item.cwe === 'string' && item.cwe.length > 0 ? item.cwe : undefined,
    };

    const result = findingSchema.safeParse(candidate);
    if (result.success) {
      findings.push(result.data);
    } else {
      context.logger.warn(`[testssl] Skipping invalid finding: ${result.error.message}`);
    }
  }

  return findings;
}

componentRegistry.register(definition);

type Output = (typeof outputSchema)['__inferred'];
type TestsslInput = typeof inputSchema;
type TestsslOutput = typeof outputSchema;

export type { TestsslInput, TestsslOutput };
