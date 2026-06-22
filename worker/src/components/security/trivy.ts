import { z } from 'zod';
import {
  componentRegistry,
  runComponentWithRunner,
  type DockerRunnerConfig,
  ContainerError,
  ComponentRetryPolicy,
  ValidationError,
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
  SECURITY_DOCKER_RESOURCE_HEAVY,
} from './security-docker-resources';

const TRIVY_IMAGE = 'aquasec/trivy:latest';
const TRIVY_TIMEOUT_SECONDS = 600; // 10 minutes default

const inputSchema = inputs({
  target: port(
    z
      .string()
      .min(1, 'Target is required')
      .describe('Container image name, filesystem path, or repo URL to scan'),
    {
      label: 'Target',
      description:
        'Container image name (e.g., nginx:latest), filesystem path, or repository URL to scan.',
      connectionType: { kind: 'primitive', name: 'text' },
    },
  ),
  customFlags: port(
    z.string().optional().describe('Raw CLI flags to append to the trivy command'),
    {
      label: 'Custom CLI Flags',
      description: 'Additional trivy CLI options exactly as you would on the command line.',
      connectionType: { kind: 'primitive', name: 'text' },
    },
  ),
  ref: port(z.string().trim().optional().describe('Git ref to scan for repository targets'), {
    label: 'Git Ref',
    description: 'Optional branch, tag, or commit to scan when Scan Type is Repository.',
    connectionType: { kind: 'primitive', name: 'text' },
  }),
});

const parameterSchema = parameters({
  scanType: param(z.enum(['image', 'fs', 'repo']).default('image'), {
    label: 'Scan Type',
    editor: 'select',
    options: [
      { label: 'Container Image', value: 'image' },
      { label: 'Filesystem', value: 'fs' },
      { label: 'Repository', value: 'repo' },
    ],
    description: 'Type of scan to perform.',
  }),
  severity: param(
    z
      .array(z.enum(['UNKNOWN', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL']))
      .optional()
      .describe('Filter by vulnerability severity'),
    {
      label: 'Severity Filter',
      editor: 'multi-select',
      options: [
        { label: 'Unknown', value: 'UNKNOWN' },
        { label: 'Low', value: 'LOW' },
        { label: 'Medium', value: 'MEDIUM' },
        { label: 'High', value: 'HIGH' },
        { label: 'Critical', value: 'CRITICAL' },
      ],
      description: 'Only report vulnerabilities matching these severity levels.',
    },
  ),
  format: param(z.literal('json').default('json'), {
    label: 'Output Format',
    editor: 'select',
    options: [{ label: 'JSON', value: 'json' }],
    description: 'Structured JSON output required for vulnerability parsing.',
  }),
});

const vulnerabilitySchema = z.object({
  vulnerabilityId: z.string(),
  pkgName: z.string(),
  installedVersion: z.string(),
  fixedVersion: z.string().optional(),
  severity: z.string(),
  title: z.string().optional(),
  description: z.string().optional(),
  primaryUrl: z.string().optional(),
});

type Vulnerability = z.infer<typeof vulnerabilitySchema>;

const outputSchema = outputs({
  vulnerabilities: port(z.array(vulnerabilitySchema), {
    label: 'Vulnerabilities',
    description: 'Array of detected vulnerabilities with CVE details.',
    connectionType: { kind: 'list', element: { kind: 'primitive', name: 'json' } },
  }),
  rawOutput: port(z.string(), {
    label: 'Raw Output',
    description: 'Raw tool output for debugging.',
  }),
  vulnerabilityCount: port(z.number(), {
    label: 'Vulnerability Count',
    description: 'Number of vulnerabilities detected.',
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

function assertNoOutputFormatOverride(args: string[]): void {
  const hasFormatOverride = args.some(
    (arg) =>
      arg === '--format' ||
      arg.startsWith('--format=') ||
      arg === '-f' ||
      arg.startsWith('-f=') ||
      /^-f[^\s=]+$/.test(arg),
  );

  if (hasFormatOverride) {
    throw new ValidationError(
      'Trivy output format is fixed to JSON because this component parses vulnerability results.',
    );
  }
}

/**
 * Map Trivy severity string to analytics severity.
 */
const mapTrivySeverity = (severity: string): 'critical' | 'high' | 'medium' | 'low' | 'info' => {
  switch (severity.toUpperCase()) {
    case 'CRITICAL':
      return 'critical';
    case 'HIGH':
      return 'high';
    case 'MEDIUM':
      return 'medium';
    case 'LOW':
      return 'low';
    default:
      return 'info';
  }
};

const trivyRetryPolicy: ComponentRetryPolicy = {
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

function parseTrivyJsonOutput(rawOutput: string): unknown | null {
  const trimmed = rawOutput.trim();
  if (trimmed.length === 0) return null;

  try {
    return JSON.parse(trimmed);
  } catch {
    // Trivy normally writes JSON to stdout, but some runners merge log
    // text around stdout. Extract the first balanced JSON object.
  }

  let start = trimmed.indexOf('{');
  while (start >= 0) {
    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let index = start; index < trimmed.length; index += 1) {
      const char = trimmed[index];

      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (char === '\\') {
          escaped = true;
        } else if (char === '"') {
          inString = false;
        }
        continue;
      }

      if (char === '"') {
        inString = true;
      } else if (char === '{') {
        depth += 1;
      } else if (char === '}') {
        depth -= 1;
        if (depth === 0) {
          const candidate = trimmed.slice(start, index + 1);
          try {
            return JSON.parse(candidate);
          } catch {
            break;
          }
        }
      }
    }

    start = trimmed.indexOf('{', start + 1);
  }

  return null;
}

function cleanRepoRef(value: string): string {
  const text = value.trim();
  if (!text) return '';
  if (/^https?:\/\//i.test(text) || text.includes('..') || text.startsWith('-')) {
    throw new ValidationError('Invalid Trivy repository ref', {
      fieldErrors: { ref: ['Ref cannot be a URL, flag, or contain path traversal'] },
    });
  }
  return text.replace(/^\/+|\/+$/g, '');
}

function buildTrivyRepoRefArgs(value: string | undefined): string[] {
  const ref = cleanRepoRef(value ?? '');
  if (!ref) return [];

  if (ref.startsWith('refs/heads/')) {
    return ['--branch', ref.slice('refs/heads/'.length)];
  }
  if (ref.startsWith('refs/tags/')) {
    return ['--tag', ref.slice('refs/tags/'.length)];
  }
  if (/^[a-f0-9]{7,40}$/i.test(ref)) {
    return ['--commit', ref];
  }
  if (/^v?\d+\.\d+(?:\.\d+)?(?:[-+][0-9A-Za-z.-]+)?$/.test(ref)) {
    return ['--tag', ref];
  }

  return ['--branch', ref];
}

const definition = defineComponent({
  id: 'sentris.trivy.run',
  label: 'Trivy Vulnerability Scanner',
  category: 'security',
  retryPolicy: trivyRetryPolicy,
  runner: {
    kind: 'docker',
    ...SECURITY_DOCKER_RESOURCE_HEAVY,
    image: TRIVY_IMAGE,
    network: 'bridge',
    timeoutSeconds: TRIVY_TIMEOUT_SECONDS,
    env: {
      HOME: '/tmp',
    },
    command: [],
  },
  inputs: inputSchema,
  outputs: outputSchema,
  parameters: parameterSchema,
  docs: 'Run Trivy to scan container images, filesystems, or repositories for known vulnerabilities (CVEs).',
  ui: {
    slug: 'trivy',
    version: '1.0.0',
    type: 'scan',
    category: 'security',
    description:
      'Scan container images, filesystems, or repositories for vulnerabilities using Aqua Trivy.',
    documentation:
      'Trivy documentation covers image scanning, filesystem analysis, repository scanning, and vulnerability databases.',
    documentationUrl: 'https://github.com/aquasecurity/trivy',
    icon: 'Shield',
    author: {
      name: 'SentrisAI',
      type: 'sentris',
    },
    isLatest: true,
    deprecated: false,
    example: '`trivy image nginx:latest --format json` - Scan nginx image for vulnerabilities.',
    examples: [
      'Scan container images for known CVEs before deployment.',
      'Audit project dependencies by scanning the filesystem.',
    ],
  },
  toolProvider: {
    kind: 'component',
    name: 'vulnerability_scanner',
    description: 'Container and dependency vulnerability scanner (Trivy).',
  },
  async execute({ inputs, params }, context) {
    const parsedParams = parameterSchema.parse(params);

    const customFlags =
      typeof inputs.customFlags === 'string' && inputs.customFlags.length > 0
        ? inputs.customFlags
        : null;
    const customFlagArgs = customFlags ? splitCliArgs(customFlags) : [];
    assertNoOutputFormatOverride(customFlagArgs);

    const target = inputs.target.trim();

    context.logger.info(`[Trivy] Scanning target: ${target} (type: ${parsedParams.scanType})`);
    context.emitProgress({
      message: `Launching Trivy ${parsedParams.scanType} scan on ${target}`,
      level: 'info',
    });

    const tenantId = (context as any).tenantId ?? 'default-tenant';
    const volume = new IsolatedContainerVolume(tenantId, context.runId);

    const baseRunner = definition.runner;
    if (baseRunner.kind !== 'docker') {
      throw new ContainerError('Trivy runner is expected to be docker-based.', {
        details: { expectedKind: 'docker', actualKind: baseRunner.kind },
      });
    }

    let rawOutput: string;
    try {
      // For fs scans, the target content could be written into the volume.
      // For image/repo scans, the target is passed as a CLI argument.
      const inputFiles: Record<string, string> = {};

      if (parsedParams.scanType === 'fs') {
        // Write target content into the volume for filesystem scanning
        inputFiles['target-content.txt'] = target;
      }

      await volume.initialize(inputFiles);
      context.logger.info(`[Trivy] Created isolated volume: ${volume.getVolumeName()}`);

      // Build Trivy CLI args
      // trivy {scanType} {target} --format json [--severity ...]
      const args: string[] = [parsedParams.scanType];

      if (parsedParams.scanType === 'fs') {
        // Scan the mounted volume
        args.push('/inputs');
      } else {
        // image or repo: pass the target directly
        args.push(target);
      }

      args.push('--format', parsedParams.format);

      if (parsedParams.severity && parsedParams.severity.length > 0) {
        args.push('--severity', parsedParams.severity.join(','));
      }

      if (parsedParams.scanType === 'repo') {
        args.push(...buildTrivyRepoRefArgs(inputs.ref));
      }

      // Append custom flags last
      for (const flag of customFlagArgs) {
        if (flag.length > 0) {
          args.push(flag);
        }
      }

      const volumes = [volume.getVolumeConfig('/inputs', true)];

      const runnerConfig = mergeSecurityDockerRunner(baseRunner, {
        command: [...(baseRunner.command ?? []), ...args],
        volumes,
      });

      try {
        const result = await runComponentWithRunner(
          runnerConfig,
          async () => ({}) as Output,
          { target, scanType: parsedParams.scanType },
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
              '[Trivy] Container exited non-zero but produced output. Preserving partial results.',
            );
            context.emitProgress({
              message: 'Trivy exited with errors but found some results',
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
      context.logger.info('[Trivy] Cleaned up isolated volume');
    }

    // Parse Trivy JSON output
    // Structure: { Results: [ { Vulnerabilities: [ { VulnerabilityID, ... } ] } ] }
    const vulnerabilities: Vulnerability[] = [];

    const trimmed = rawOutput.trim();
    if (trimmed.length > 0) {
      try {
        const parsed = parseTrivyJsonOutput(trimmed);
        const trivyResults =
          parsed && typeof parsed === 'object'
            ? (parsed as { Results?: unknown }).Results
            : undefined;
        if (Array.isArray(trivyResults)) {
          for (const resultGroup of trivyResults) {
            if (Array.isArray(resultGroup.Vulnerabilities)) {
              for (const vuln of resultGroup.Vulnerabilities) {
                const candidate: Vulnerability = {
                  vulnerabilityId: vuln.VulnerabilityID ?? vuln.vulnerabilityId ?? '',
                  pkgName: vuln.PkgName ?? vuln.pkgName ?? '',
                  installedVersion: vuln.InstalledVersion ?? vuln.installedVersion ?? '',
                  fixedVersion: vuln.FixedVersion ?? vuln.fixedVersion,
                  severity: vuln.Severity ?? vuln.severity ?? 'UNKNOWN',
                  title: vuln.Title ?? vuln.title,
                  description: vuln.Description ?? vuln.description,
                  primaryUrl: vuln.PrimaryURL ?? vuln.primaryUrl,
                };
                const validated = vulnerabilitySchema.safeParse(candidate);
                if (validated.success && candidate.vulnerabilityId.length > 0) {
                  vulnerabilities.push(validated.data);
                }
              }
            }
          }
        }
      } catch {
        // Non-JSON output (e.g., table format) — rawOutput is still captured
        context.logger.warn('[Trivy] Could not parse output as JSON. Raw output preserved.');
      }
    }

    const vulnerabilityCount = vulnerabilities.length;

    context.logger.info(`[Trivy] Found ${vulnerabilityCount} vulnerabilities`);

    if (vulnerabilityCount === 0) {
      context.emitProgress({
        message: 'No vulnerabilities detected by Trivy',
        level: 'info',
      });
    } else {
      context.emitProgress({
        message: `Trivy found ${vulnerabilityCount} vulnerabilities`,
        level: 'info',
        data: { vulnerabilities: vulnerabilities.slice(0, 10).map((v) => v.vulnerabilityId) },
      });
    }

    // Build analytics-ready results
    const analyticsResults: AnalyticsResult[] = vulnerabilities.map((vuln) => ({
      scanner: 'trivy',
      finding_hash: generateFindingHash(vuln.vulnerabilityId, vuln.pkgName),
      severity: mapTrivySeverity(vuln.severity),
      asset_key: vuln.vulnerabilityId,
      vulnerability_id: vuln.vulnerabilityId,
      pkg_name: vuln.pkgName,
      installed_version: vuln.installedVersion,
      fixed_version: vuln.fixedVersion,
      title: vuln.title,
    }));

    return {
      vulnerabilities,
      rawOutput,
      vulnerabilityCount,
      results: analyticsResults,
    };
  },
});

componentRegistry.register(definition);

type Output = (typeof outputSchema)['__inferred'];

type TrivyInput = typeof inputSchema;
type TrivyOutput = typeof outputSchema;

export type { TrivyInput, TrivyOutput };
