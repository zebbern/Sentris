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
import {
  mergeSecurityDockerRunner,
  SECURITY_DOCKER_RESOURCE_LIGHT,
} from './security-docker-resources';

const WAFW00F_IMAGE = 'python:3.11-slim';
const WAFW00F_TIMEOUT_SECONDS = 300;
const INPUT_DIR = '/input';
const OUTPUT_DIR = '/output';
const TARGETS_FILE = 'targets.txt';
const RESULTS_FILE = 'results.json';

const inputSchema = inputs({
  targets: port(
    z
      .array(z.string().min(1, 'URL cannot be empty'))
      .min(1, 'At least one target is required')
      .describe('URLs to check for WAF'),
    {
      label: 'Targets',
      description: 'URLs to check for Web Application Firewalls (e.g., "https://example.com").',
      connectionType: { kind: 'list', element: { kind: 'primitive', name: 'text' } },
    },
  ),
  customFlags: port(
    z.string().trim().optional().describe('Raw CLI flags to append to the wafw00f command'),
    {
      label: 'Custom CLI Flags',
      editor: 'textarea',
      description: 'Additional wafw00f CLI options. Appended after generated options.',
    },
  ),
});

const parameterSchema = parameters({
  findAll: param(z.boolean().default(false), {
    label: 'Find All WAFs',
    editor: 'boolean',
    description: 'Check all WAF signatures instead of stopping at the first match.',
  }),
  verbose: param(z.boolean().default(false), {
    label: 'Verbose Output',
    editor: 'boolean',
    description: 'Enable verbose output for detailed detection information.',
  }),
});

const wafDetectionSchema = z.object({
  url: z.string(),
  detected: z.boolean(),
  firewall: z.string(),
  manufacturer: z.string(),
});

type WafDetection = z.infer<typeof wafDetectionSchema>;

const outputSchema = outputs({
  wafDetections: port(z.array(wafDetectionSchema), {
    label: 'WAF Detections',
    description: 'WAF detection results per target URL.',
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
  detectionCount: port(z.number(), {
    label: 'Detection Count',
    description: 'Number of targets where a WAF was detected.',
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

const runnerOutputSchema = z.object({
  stdout: z.string().optional().default(''),
  stderr: z.string().optional().default(''),
  exitCode: z.number().optional().default(0),
});

const definition = defineComponent({
  id: 'sentris.wafw00f.run',
  label: 'wafw00f — WAF Detector',
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
    ...SECURITY_DOCKER_RESOURCE_LIGHT,
    image: WAFW00F_IMAGE,
    entrypoint: 'sh',
    network: 'bridge',
    timeoutSeconds: WAFW00F_TIMEOUT_SECONDS,
    command: [],
    env: { HOME: '/tmp' },
  },
  inputs: inputSchema,
  outputs: outputSchema,
  parameters: parameterSchema,
  docs: 'Runs wafw00f to detect Web Application Firewalls protecting target URLs.',
  ui: {
    slug: 'wafw00f',
    version: '1.0.0',
    type: 'scan',
    category: 'security',
    description: 'Detect Web Application Firewalls (WAFs) protecting target websites.',
    documentation: 'wafw00f identifies and fingerprints Web Application Firewalls.',
    documentationUrl: 'https://github.com/EnableSecurity/wafw00f',
    icon: 'ShieldAlert',
    author: { name: 'SentrisAI', type: 'sentris' },
    isLatest: true,
    deprecated: false,
    example: '`wafw00f -i targets.txt -o results.json -f json`',
    examples: [
      'Detect WAFs before penetration testing to adjust attack strategy.',
      'Inventory WAF coverage across web assets.',
    ],
  },
  async execute({ inputs, params }, context) {
    const parsedParams = parameterSchema.parse(params);
    const { findAll, verbose } = parsedParams;
    const targets = inputs.targets.map((t) => t.trim()).filter((t) => t.length > 0);
    const customFlags =
      typeof inputs.customFlags === 'string' && inputs.customFlags.trim().length > 0
        ? inputs.customFlags.trim()
        : null;
    const customFlagArgs = customFlags ? splitCliArgs(customFlags) : [];

    if (targets.length === 0) {
      context.logger.info('[wafw00f] No targets provided, skipping.');
      return { wafDetections: [], rawOutput: '', results: [], detectionCount: 0 };
    }

    context.logger.info(`[wafw00f] Checking ${targets.length} target(s) for WAF presence`);
    context.emitProgress({
      message: `Launching wafw00f for ${targets.length} target(s)`,
      level: 'info',
      data: { targets: targets.slice(0, 5) },
    });

    const tenantId = (context as any).tenantId ?? 'default-tenant';
    const volume = new IsolatedContainerVolume(tenantId, context.runId);
    const baseRunner = definition.runner;
    if (baseRunner.kind !== 'docker') {
      throw new ContainerError('wafw00f runner is expected to be docker-based.', {
        details: { expectedKind: 'docker', actualKind: baseRunner.kind },
      });
    }

    let rawOutput = '';
    try {
      await volume.initialize({ [TARGETS_FILE]: targets.join('\n') });
      context.logger.info(`[wafw00f] Created isolated volume: ${volume.getVolumeName()}`);

      const wafw00fArgs: string[] = [
        '-i',
        `${INPUT_DIR}/${TARGETS_FILE}`,
        '-o',
        `${OUTPUT_DIR}/${RESULTS_FILE}`,
        '-f',
        'json',
      ];

      if (findAll) wafw00fArgs.push('-a');
      if (verbose) wafw00fArgs.push('-v');
      for (const flag of customFlagArgs) {
        if (flag.length > 0) wafw00fArgs.push(flag);
      }

      // wafw00f has no official Docker image — install via pip at runtime
      const escapedArgs = wafw00fArgs.map((a) => `'${a.replace(/'/g, "'\\''")}'`).join(' ');
      const shellCmd = `pip install wafw00f -q && wafw00f ${escapedArgs}`;

      const runnerConfig = mergeSecurityDockerRunner(baseRunner, {
        entrypoint: baseRunner.entrypoint,
        command: ['-c', shellCmd],
        volumes: [
          volume.getVolumeConfig(INPUT_DIR, true),
          volume.getVolumeConfig(OUTPUT_DIR, false),
        ],
      });

      try {
        const result = await runComponentWithRunner(
          runnerConfig,
          async () => ({}) as Output,
          { targets },
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
        if (error instanceof ContainerError) {
          const details = (error as any).details as Record<string, unknown> | undefined;
          const capturedStdout = details?.stdout;
          if (typeof capturedStdout === 'string' && capturedStdout.trim().length > 0) {
            context.logger.warn(
              '[wafw00f] Container exited non-zero but produced output. Preserving results.',
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
      let detections: WafDetection[] = [];
      try {
        const outputFiles = await volume.readFiles([RESULTS_FILE]);
        const jsonContent = outputFiles[RESULTS_FILE];
        if (jsonContent && jsonContent.trim().length > 0) {
          detections = parseWafw00fOutput(jsonContent, context);
        }
      } catch (readError: unknown) {
        context.logger.warn(
          `[wafw00f] Could not read results file: ${readError instanceof Error ? readError.message : String(readError)}`,
        );
      }

      // Fallback: parse stdout if no file results
      if (detections.length === 0 && rawOutput.trim().length > 0) {
        detections = parseWafw00fOutput(rawOutput, context);
      }

      const detectionCount = detections.filter((d) => d.detected).length;
      context.logger.info(
        `[wafw00f] Scan complete: ${detectionCount} WAF(s) detected across ${targets.length} target(s)`,
      );
      context.emitProgress({
        message: `wafw00f detected ${detectionCount} WAF(s) across ${targets.length} target(s)`,
        level: detectionCount > 0 ? 'info' : 'warn',
        data: { detectionCount, targetCount: targets.length },
      });

      const analyticsResults: AnalyticsResult[] = detections.map((d) => ({
        scanner: 'wafw00f',
        finding_hash: generateFindingHash(d.url, d.firewall),
        severity: 'info' as const,
        asset_key: d.url,
        url: d.url,
        detected: d.detected,
        firewall: d.firewall,
        manufacturer: d.manufacturer,
      }));

      return { wafDetections: detections, rawOutput, results: analyticsResults, detectionCount };
    } finally {
      await volume.cleanup();
      context.logger.info('[wafw00f] Cleaned up isolated volume');
    }
  },
});

function parseWafw00fOutput(raw: string, context: any): WafDetection[] {
  if (!raw || raw.trim().length === 0) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    context.logger.warn('[wafw00f] Failed to parse JSON output');
    return [];
  }

  const items = Array.isArray(parsed) ? parsed : [];
  const detections: WafDetection[] = [];

  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    const candidate: WafDetection = {
      url: String(item.url ?? ''),
      detected: Boolean(item.detected ?? false),
      firewall: String(item.firewall ?? item.waf ?? 'None'),
      manufacturer: String(item.manufacturer ?? ''),
    };
    const result = wafDetectionSchema.safeParse(candidate);
    if (result.success) detections.push(result.data);
    else context.logger.warn(`[wafw00f] Skipping invalid detection: ${result.error.message}`);
  }

  return detections;
}

componentRegistry.register(definition);

type Output = (typeof outputSchema)['__inferred'];
type Wafw00fInput = typeof inputSchema;
type Wafw00fOutput = typeof outputSchema;

export type { Wafw00fInput, Wafw00fOutput };
