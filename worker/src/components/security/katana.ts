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
  SECURITY_DOCKER_RESOURCE_STANDARD,
} from './security-docker-resources';

const KATANA_IMAGE = 'projectdiscovery/katana:latest';
const KATANA_TIMEOUT_SECONDS = 600; // 10 minutes default

const targetValueSchema = z.preprocess(
  (val) => (typeof val === 'string' ? [val] : val),
  z.array(z.string().min(1)),
);

const inputSchema = inputs({
  targets: port(targetValueSchema.describe('Array of URLs or domains to crawl'), {
    label: 'Targets',
    description: 'URLs or domains to crawl for endpoint discovery.',
    connectionType: { kind: 'list', element: { kind: 'primitive', name: 'text' } },
  }),
  customFlags: port(
    z.string().optional().describe('Raw CLI flags to append to the katana command'),
    {
      label: 'Custom CLI Flags',
      description: 'Additional katana CLI options exactly as you would on the command line.',
      connectionType: { kind: 'primitive', name: 'text' },
    },
  ),
});

const parameterSchema = parameters({
  depth: param(z.number().int().min(1).max(10).default(3), {
    label: 'Crawl Depth',
    editor: 'number',
    min: 1,
    max: 10,
    description: 'Maximum depth to crawl from the seed URLs.',
  }),
  headless: param(z.boolean().default(false), {
    label: 'Headless Browser',
    editor: 'boolean',
    description: 'Use headless browser for JavaScript-rendered pages.',
  }),
  timeout: param(z.number().int().min(10).max(3600).default(300), {
    label: 'Timeout (seconds)',
    editor: 'number',
    min: 10,
    max: 3600,
    description: 'Maximum time in seconds for the crawl.',
  }),
  scope: param(z.enum(['strict', 'fuzzy', 'subs']).default('strict'), {
    label: 'Crawl Scope',
    editor: 'select',
    options: [
      { label: 'Strict (same host)', value: 'strict' },
      { label: 'Fuzzy (related hosts)', value: 'fuzzy' },
      { label: 'Subdomains', value: 'subs' },
    ],
    description: 'Controls which URLs are in scope for crawling.',
  }),
});

const outputSchema = outputs({
  endpoints: port(z.array(z.string()), {
    label: 'Discovered Endpoints',
    description: 'Array of all discovered URLs/endpoints.',
  }),
  rawOutput: port(z.string(), {
    label: 'Raw Output',
    description: 'Raw tool output for debugging.',
  }),
  endpointCount: port(z.number(), {
    label: 'Endpoint Count',
    description: 'Number of unique endpoints discovered.',
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

type KatanaScope = z.infer<typeof parameterSchema>['scope'];

export function mapKatanaScope(scope: KatanaScope): 'fqdn' | 'rdn' | 'dn' {
  switch (scope) {
    case 'fuzzy':
      return 'rdn';
    case 'subs':
      return 'dn';
    case 'strict':
    default:
      return 'fqdn';
  }
}

export function buildKatanaArgs(options: {
  depth: number;
  scope: KatanaScope;
  timeout?: number;
  headless: boolean;
  customFlags: string[];
}): string[] {
  const args: string[] = [
    '-list',
    '/inputs/targets.txt',
    '-jsonl',
    '-silent',
    '-depth',
    String(options.depth),
    '-field-scope',
    mapKatanaScope(options.scope),
  ];

  if (options.headless) {
    args.push('-headless');
  }

  if (options.timeout) {
    args.push('-timeout', String(options.timeout));
  }

  for (const flag of options.customFlags) {
    if (flag.length > 0) {
      args.push(flag);
    }
  }

  return args;
}

const katanaRetryPolicy: ComponentRetryPolicy = {
  maxAttempts: 2,
  initialIntervalSeconds: 5,
  maximumIntervalSeconds: 30,
  backoffCoefficient: 2.0,
  nonRetryableErrorTypes: ['ContainerError', 'ValidationError', 'ConfigurationError'],
};

const runnerOutputSchema = z
  .object({
    stdout: z.string().optional().default(''),
    stderr: z.string().optional().default(''),
    exitCode: z.number().optional().default(0),
  })
  .strict();

const definition = defineComponent({
  id: 'sentris.katana.run',
  label: 'Katana Web Crawler',
  category: 'security',
  retryPolicy: katanaRetryPolicy,
  runner: {
    kind: 'docker',
    ...SECURITY_DOCKER_RESOURCE_STANDARD,
    image: KATANA_IMAGE,
    network: 'bridge',
    timeoutSeconds: KATANA_TIMEOUT_SECONDS,
    env: {
      HOME: '/tmp',
    },
    command: [],
  },
  inputs: inputSchema,
  outputs: outputSchema,
  parameters: parameterSchema,
  docs: 'Run ProjectDiscovery Katana to crawl websites and discover endpoints, JS files, API routes, and forms.',
  ui: {
    slug: 'katana',
    version: '1.0.0',
    type: 'scan',
    category: 'security',
    description:
      'Crawl websites to discover endpoints, JavaScript files, API routes, and forms using ProjectDiscovery Katana.',
    documentation:
      'ProjectDiscovery Katana documentation details CLI flags for crawling, scope control, and output formats.',
    documentationUrl: 'https://github.com/projectdiscovery/katana',
    icon: 'Globe',
    author: {
      name: 'SentrisAI',
      type: 'sentris',
    },
    isLatest: true,
    deprecated: false,
    example:
      '`katana -u https://example.com -depth 3 -jsonl` - Crawl example.com to depth 3 and output JSONL.',
    examples: [
      'Discover hidden endpoints and API routes before vulnerability scanning.',
      'Map application attack surface by crawling JavaScript files and forms.',
    ],
  },
  toolProvider: {
    kind: 'component',
    name: 'web_crawler',
    description: 'Web crawling and endpoint discovery tool (Katana).',
  },
  async execute({ inputs, params }, context) {
    const parsedParams = parameterSchema.parse(params);

    const customFlags =
      typeof inputs.customFlags === 'string' && inputs.customFlags.length > 0
        ? inputs.customFlags
        : null;
    const customFlagArgs = customFlags ? splitCliArgs(customFlags) : [];

    // Collect targets
    const targetSet = new Set<string>();
    if (Array.isArray(inputs.targets)) {
      for (const t of inputs.targets) {
        const trimmed = t.trim();
        if (trimmed.length > 0) {
          targetSet.add(trimmed);
        }
      }
    }

    const targets = Array.from(targetSet);

    if (targets.length === 0) {
      context.logger.info('[Katana] Skipping execution because no targets were provided.');
      return {
        endpoints: [],
        rawOutput: '',
        endpointCount: 0,
        results: [],
      };
    }

    context.logger.info(`[Katana] Crawling ${targets.length} target(s)`);
    context.emitProgress({
      message: `Launching Katana for ${targets.length} target${targets.length === 1 ? '' : 's'}`,
      level: 'info',
      data: { targets: targets.slice(0, 5) },
    });

    const tenantId = (context as any).tenantId ?? 'default-tenant';
    const volume = new IsolatedContainerVolume(tenantId, context.runId);

    const baseRunner = definition.runner;
    if (baseRunner.kind !== 'docker') {
      throw new ContainerError('Katana runner is expected to be docker-based.', {
        details: { expectedKind: 'docker', actualKind: baseRunner.kind },
      });
    }

    let rawOutput: string;
    try {
      await volume.initialize({
        'targets.txt': targets.join('\n'),
      });
      context.logger.info(`[Katana] Created isolated volume: ${volume.getVolumeName()}`);

      const args = buildKatanaArgs({
        depth: parsedParams.depth,
        scope: parsedParams.scope,
        timeout: parsedParams.timeout,
        headless: parsedParams.headless,
        customFlags: customFlagArgs,
      });

      const runnerConfig = mergeSecurityDockerRunner(baseRunner, {
        command: [...(baseRunner.command ?? []), ...args],
        volumes: [volume.getVolumeConfig('/inputs', true)],
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
        } else if (result && typeof result === 'object' && 'rawOutput' in result) {
          rawOutput = String((result as any).rawOutput ?? '');
        } else if (result && typeof result === 'object') {
          const parsed = runnerOutputSchema.safeParse(result);
          if (parsed.success) {
            rawOutput = parsed.data.stdout ?? '';
          } else {
            rawOutput = JSON.stringify(result);
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
              '[Katana] Container exited non-zero but produced output. Preserving partial results.',
            );
            context.emitProgress({
              message: 'Katana exited with errors but found some results',
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
      context.logger.info('[Katana] Cleaned up isolated volume');
    }

    // Parse JSONL output — each line is a JSON object with endpoint info
    const endpointSet = new Set<string>();
    const lines = rawOutput
      .trim()
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    for (const line of lines) {
      try {
        const payload = JSON.parse(line);
        if (payload && typeof payload === 'object') {
          // Katana JSON output has 'request.endpoint' or 'endpoint' or 'url'
          const endpoint = payload.request?.endpoint ?? payload.endpoint ?? payload.url ?? null;
          if (typeof endpoint === 'string' && endpoint.length > 0) {
            endpointSet.add(endpoint);
          }
        }
      } catch {
        // Non-JSON line — might be a plain URL from non-JSON mode
        if (line.startsWith('http://') || line.startsWith('https://')) {
          endpointSet.add(line);
        }
      }
    }

    const endpoints = Array.from(endpointSet);
    const endpointCount = endpoints.length;

    context.logger.info(`[Katana] Found ${endpointCount} unique endpoints`);

    if (endpointCount === 0) {
      context.emitProgress({
        message: 'No endpoints discovered by Katana',
        level: 'warn',
      });
    } else {
      context.emitProgress({
        message: `Katana discovered ${endpointCount} endpoints`,
        level: 'info',
        data: { endpoints: endpoints.slice(0, 10) },
      });
    }

    // Build analytics-ready results
    const analyticsResults: AnalyticsResult[] = endpoints.map((endpoint) => ({
      scanner: 'katana',
      finding_hash: generateFindingHash('endpoint-discovery', endpoint, targets.join(',')),
      severity: 'info' as const,
      asset_key: endpoint,
      endpoint,
      seed_targets: targets,
    }));

    return {
      endpoints,
      rawOutput,
      endpointCount,
      results: analyticsResults,
    };
  },
});

componentRegistry.register(definition);

type Output = (typeof outputSchema)['__inferred'];

type KatanaInput = typeof inputSchema;
type KatanaOutput = typeof outputSchema;

export type { KatanaInput, KatanaOutput };
