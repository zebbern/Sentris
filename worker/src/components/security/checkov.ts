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

const CHECKOV_IMAGE = 'bridgecrew/checkov:latest';
const CHECKOV_TIMEOUT_SECONDS = 600;
const INPUT_DIR = '/input';

const inputSchema = inputs({
  target: port(z.string().min(1, 'Target cannot be empty').describe('IaC file content to scan'), {
    label: 'Target',
    description:
      'Infrastructure-as-Code content to scan (Terraform, CloudFormation, Kubernetes YAML, Dockerfile, etc.).',
    connectionType: { kind: 'primitive', name: 'text' },
  }),
  customFlags: port(
    z.string().trim().optional().describe('Raw CLI flags to append to the checkov command'),
    {
      label: 'Custom CLI Flags',
      editor: 'textarea',
      description: 'Additional Checkov CLI options. Appended after generated options.',
    },
  ),
});

const parameterSchema = parameters({
  framework: param(
    z
      .enum([
        'terraform',
        'cloudformation',
        'kubernetes',
        'dockerfile',
        'helm',
        'serverless',
        'arm',
      ])
      .default('terraform'),
    {
      label: 'Framework',
      editor: 'select',
      options: [
        { label: 'Terraform', value: 'terraform' },
        { label: 'CloudFormation', value: 'cloudformation' },
        { label: 'Kubernetes', value: 'kubernetes' },
        { label: 'Dockerfile', value: 'dockerfile' },
        { label: 'Helm', value: 'helm' },
        { label: 'Serverless', value: 'serverless' },
        { label: 'ARM', value: 'arm' },
      ],
      description: 'IaC framework to scan for.',
    },
  ),
  severity: param(z.array(z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'])).optional(), {
    label: 'Severity Filter',
    editor: 'multi-select',
    options: [
      { label: 'Low', value: 'LOW' },
      { label: 'Medium', value: 'MEDIUM' },
      { label: 'High', value: 'HIGH' },
      { label: 'Critical', value: 'CRITICAL' },
    ],
    description: 'Only report checks matching these severity levels.',
  }),
  compact: param(z.boolean().default(true), {
    label: 'Compact Output',
    editor: 'boolean',
    description: 'Use compact output format (less verbose).',
  }),
});

const violationSchema = z.object({
  checkId: z.string(),
  checkType: z.string().optional(),
  result: z.string(),
  resource: z.string(),
  guideline: z.string().optional(),
  severity: z.string().optional(),
  filePath: z.string().optional(),
  fileLineRange: z.array(z.number()).optional(),
  description: z.string().optional(),
});

type Violation = z.infer<typeof violationSchema>;

const outputSchema = outputs({
  violations: port(z.array(violationSchema), {
    label: 'Policy Violations',
    description: 'Array of failed IaC security checks with check ID, resource, and guideline.',
    connectionType: { kind: 'list', element: { kind: 'primitive', name: 'json' } },
  }),
  rawOutput: port(z.string(), {
    label: 'Raw Output',
    description: 'Raw tool output for debugging.',
  }),
  results: port(z.array(analyticsResultSchema()), {
    label: 'Results',
    description: 'Analytics-ready findings. Connect to Analytics Sink.',
  }),
  passedCount: port(z.number(), {
    label: 'Passed Checks',
    description: 'Number of passed security checks.',
  }),
  failedCount: port(z.number(), {
    label: 'Failed Checks',
    description: 'Number of failed security checks.',
  }),
});

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
  if (current.length > 0) args.push(current);
  return args;
};

const mapSeverity = (raw: string | undefined): 'critical' | 'high' | 'medium' | 'low' | 'info' => {
  if (!raw) return 'medium';
  const upper = raw.toUpperCase();
  if (upper === 'CRITICAL') return 'critical';
  if (upper === 'HIGH') return 'high';
  if (upper === 'MEDIUM') return 'medium';
  if (upper === 'LOW') return 'low';
  return 'info';
};

const getFilenameForFramework = (framework: string): string => {
  switch (framework) {
    case 'terraform':
      return 'main.tf';
    case 'cloudformation':
      return 'template.yaml';
    case 'kubernetes':
      return 'manifest.yaml';
    case 'dockerfile':
      return 'Dockerfile';
    case 'helm':
      return 'values.yaml';
    case 'serverless':
      return 'serverless.yml';
    case 'arm':
      return 'template.json';
    default:
      return 'main.tf';
  }
};

const runnerOutputSchema = z.object({
  stdout: z.string().optional().default(''),
  stderr: z.string().optional().default(''),
  exitCode: z.number().optional().default(0),
});

const definition = defineComponent({
  id: 'sentris.checkov.run',
  label: 'Checkov — IaC Security Scanner',
  category: 'security',
  retryPolicy: {
    maxAttempts: 2,
    initialIntervalSeconds: 5,
    maximumIntervalSeconds: 30,
    backoffCoefficient: 2.0,
    nonRetryableErrorTypes: ['ContainerError', 'ValidationError', 'ConfigurationError'],
  } satisfies ComponentRetryPolicy,
  runner: {
    kind: 'docker',
    image: CHECKOV_IMAGE,
    entrypoint: 'checkov',
    network: 'none',
    timeoutSeconds: CHECKOV_TIMEOUT_SECONDS,
    command: [],
    env: { HOME: '/tmp', BC_SKIP_MAPPING: 'true' },
  },
  inputs: inputSchema,
  outputs: outputSchema,
  parameters: parameterSchema,
  docs: 'Runs Checkov to scan Infrastructure-as-Code for misconfigurations across Terraform, CloudFormation, Kubernetes, Dockerfiles, and more.',
  ui: {
    slug: 'checkov',
    version: '1.0.0',
    type: 'scan',
    category: 'security',
    description: 'Scan IaC templates for security misconfigurations using Bridgecrew Checkov.',
    documentation: 'Checkov scans cloud IaC for security and compliance misconfigurations.',
    documentationUrl: 'https://github.com/bridgecrewio/checkov',
    icon: 'FileCheck',
    author: { name: 'SentrisAI', type: 'sentris' },
    isLatest: true,
    deprecated: false,
    example: '`checkov -d /code/ --output json --framework terraform`',
    examples: [
      'Scan Terraform modules for AWS security best practices.',
      'Audit Kubernetes manifests for pod security misconfigurations.',
    ],
  },
  async execute({ inputs, params }, context) {
    const parsedParams = parameterSchema.parse(params);
    const { framework, severity, compact } = parsedParams;
    const target = inputs.target.trim();
    const customFlags =
      typeof inputs.customFlags === 'string' && inputs.customFlags.trim().length > 0
        ? inputs.customFlags.trim()
        : null;
    const customFlagArgs = customFlags ? splitCliArgs(customFlags) : [];

    context.logger.info(`[Checkov] Scanning IaC content for ${framework} misconfigurations`);
    context.emitProgress({
      message: `Launching Checkov scan (${framework})`,
      level: 'info',
      data: { framework },
    });

    const tenantId = (context as any).tenantId ?? 'default-tenant';
    const volume = new IsolatedContainerVolume(tenantId, context.runId);
    const baseRunner = definition.runner;
    if (baseRunner.kind !== 'docker') {
      throw new ContainerError('Checkov runner is expected to be docker-based.', {
        details: { expectedKind: 'docker', actualKind: baseRunner.kind },
      });
    }

    let rawOutput = '';
    try {
      const filename = getFilenameForFramework(framework);
      // Write file at volume root — IsolatedContainerVolume does not create subdirectories
      await volume.initialize({ [filename]: target });
      context.logger.info(`[Checkov] Created isolated volume: ${volume.getVolumeName()}`);

      const args: string[] = ['-d', INPUT_DIR, '--output', 'json', '--framework', framework];
      if (compact) args.push('--compact');
      if (severity && severity.length > 0) args.push('--check-severity', severity.join(','));
      for (const flag of customFlagArgs) {
        if (flag.length > 0) args.push(flag);
      }

      const runnerConfig: DockerRunnerConfig = {
        kind: 'docker',
        image: baseRunner.image,
        entrypoint: baseRunner.entrypoint,
        network: baseRunner.network,
        timeoutSeconds: baseRunner.timeoutSeconds ?? CHECKOV_TIMEOUT_SECONDS,
        env: { ...(baseRunner.env ?? {}) },
        command: [...(baseRunner.command ?? []), ...args],
        volumes: [volume.getVolumeConfig(INPUT_DIR, true)],
      };

      try {
        const result = await runComponentWithRunner(
          runnerConfig,
          async () => ({}) as Output,
          { target: `${framework} IaC content` },
          context,
        );
        if (typeof result === 'string') {
          rawOutput = result;
        } else if (result && typeof result === 'object') {
          const parsed = runnerOutputSchema.safeParse(result);
          if (parsed.success) rawOutput = parsed.data.stdout || parsed.data.stderr || '';
          else if ('rawOutput' in result)
            rawOutput = String((result as Record<string, unknown>).rawOutput ?? '');
        }
      } catch (error: unknown) {
        // Checkov exits non-zero when violations are found — expected behavior
        if (error instanceof ContainerError) {
          const details = (error as any).details as Record<string, unknown> | undefined;
          const capturedStdout = details?.stdout;
          if (typeof capturedStdout === 'string' && capturedStdout.trim().length > 0) {
            context.logger.info(
              '[Checkov] Container exited non-zero (expected when violations found). Preserving results.',
            );
            rawOutput = capturedStdout;
          } else {
            throw error;
          }
        } else {
          throw error;
        }
      }

      const { violations, passedCount, failedCount } = parseCheckovOutput(rawOutput, context);
      context.logger.info(
        `[Checkov] Scan complete: ${failedCount} violation(s), ${passedCount} passed`,
      );

      if (failedCount === 0) {
        context.emitProgress({
          message: `Checkov scan passed — ${passedCount} checks passed, 0 violations`,
          level: 'info',
        });
      } else {
        context.emitProgress({
          message: `Checkov found ${failedCount} violation(s), ${passedCount} passed`,
          level: 'warn',
          data: { failedCount, passedCount },
        });
      }

      const analyticsResults: AnalyticsResult[] = violations.map((v) => ({
        scanner: 'checkov',
        finding_hash: generateFindingHash(v.checkId, v.resource),
        severity: mapSeverity(v.severity),
        asset_key: v.checkId,
        check_id: v.checkId,
        resource: v.resource,
        guideline: v.guideline,
        framework,
      }));

      return { violations, rawOutput, results: analyticsResults, passedCount, failedCount };
    } finally {
      await volume.cleanup();
      context.logger.info('[Checkov] Cleaned up isolated volume');
    }
  },
});

function parseCheckovOutput(
  raw: string,
  context: any,
): { violations: Violation[]; passedCount: number; failedCount: number } {
  if (!raw || raw.trim().length === 0) return { violations: [], passedCount: 0, failedCount: 0 };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    context.logger.warn('[Checkov] Failed to parse JSON output');
    return { violations: [], passedCount: 0, failedCount: 0 };
  }

  const resultSets = Array.isArray(parsed) ? parsed : [parsed];
  const violations: Violation[] = [];
  let totalPassed = 0;
  let totalFailed = 0;

  for (const resultSet of resultSets) {
    if (!resultSet || typeof resultSet !== 'object') continue;
    const results = (resultSet as any).results;
    if (!results || typeof results !== 'object') continue;

    totalPassed += Array.isArray(results.passed_checks) ? results.passed_checks.length : 0;
    const failedChecks = Array.isArray(results.failed_checks) ? results.failed_checks : [];
    totalFailed += failedChecks.length;

    for (const check of failedChecks) {
      if (!check || typeof check !== 'object') continue;
      const candidate: Violation = {
        checkId: String(check.check_id ?? 'unknown'),
        checkType: typeof check.check_type === 'string' ? check.check_type : undefined,
        result: String(check.check_result?.result ?? 'FAILED'),
        resource: String(check.resource ?? 'unknown'),
        guideline:
          typeof check.guideline === 'string' && check.guideline.length > 0
            ? check.guideline
            : undefined,
        severity:
          typeof check.severity === 'string' && check.severity.length > 0
            ? check.severity
            : undefined,
        filePath:
          typeof check.file_path === 'string' && check.file_path.length > 0
            ? check.file_path
            : undefined,
        fileLineRange: Array.isArray(check.file_line_range) ? check.file_line_range : undefined,
        description:
          typeof check.check_name === 'string' && check.check_name.length > 0
            ? check.check_name
            : undefined,
      };
      const result = violationSchema.safeParse(candidate);
      if (result.success) violations.push(result.data);
      else context.logger.warn(`[Checkov] Skipping invalid violation: ${result.error.message}`);
    }
  }

  return { violations, passedCount: totalPassed, failedCount: totalFailed };
}

componentRegistry.register(definition);

type Output = (typeof outputSchema)['__inferred'];
type CheckovInput = typeof inputSchema;
type CheckovOutput = typeof outputSchema;

export type { CheckovInput, CheckovOutput };
