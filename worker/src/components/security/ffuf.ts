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
  SECURITY_DOCKER_RESOURCE_STANDARD,
} from './security-docker-resources';

const FFUF_IMAGE = 'parrotsec/ffuf:latest';
const FFUF_TIMEOUT_SECONDS = 600; // 10 minutes default

const inputSchema = inputs({
  target: port(
    z.string().min(1, 'Target URL is required').describe('URL with FUZZ keyword for fuzzing'),
    {
      label: 'Target URL',
      description:
        'URL with FUZZ keyword indicating where to inject wordlist entries (e.g., https://example.com/FUZZ).',
      connectionType: { kind: 'primitive', name: 'text' },
    },
  ),
  wordlist: port(
    z.string().min(1, 'Wordlist is required').describe('Newline-separated wordlist content'),
    {
      label: 'Wordlist',
      description:
        'Newline-separated list of words to fuzz with. Written to a file in the container.',
      connectionType: { kind: 'primitive', name: 'text' },
    },
  ),
  customFlags: port(z.string().optional().describe('Raw CLI flags to append to the ffuf command'), {
    label: 'Custom CLI Flags',
    description: 'Additional ffuf CLI options exactly as you would on the command line.',
    connectionType: { kind: 'primitive', name: 'text' },
  }),
});

const parameterSchema = parameters({
  ...securityDockerResourceParameterShape(),
  extensions: param(
    z.string().trim().optional().describe('Comma-separated file extensions (e.g., ".php,.html")'),
    {
      label: 'Extensions',
      editor: 'text',
      placeholder: '.php,.html,.js',
      description: 'Comma-separated file extensions to append to each wordlist entry.',
    },
  ),
  method: param(z.enum(['GET', 'POST', 'PUT', 'DELETE', 'HEAD']).default('GET'), {
    label: 'HTTP Method',
    editor: 'select',
    options: [
      { label: 'GET', value: 'GET' },
      { label: 'POST', value: 'POST' },
      { label: 'PUT', value: 'PUT' },
      { label: 'DELETE', value: 'DELETE' },
      { label: 'HEAD', value: 'HEAD' },
    ],
    description: 'HTTP method to use for requests.',
  }),
  rate: param(z.number().int().min(1).max(10000).default(100), {
    label: 'Rate (req/sec)',
    editor: 'number',
    min: 1,
    max: 10000,
    description: 'Maximum requests per second.',
  }),
  filterStatus: param(
    z
      .string()
      .trim()
      .optional()
      .describe('Comma-separated status codes to filter out (e.g., "404,403")'),
    {
      label: 'Filter Status Codes',
      editor: 'text',
      placeholder: '404,403',
      description: 'Comma-separated HTTP status codes to filter OUT (exclude from results).',
    },
  ),
  timeout: param(z.number().int().min(10).max(3600).default(300), {
    label: 'Timeout (seconds)',
    editor: 'number',
    min: 10,
    max: 3600,
    description: 'Maximum time for the entire fuzzing run.',
  }),
});

const discoveredEntrySchema = z.object({
  url: z.string(),
  status: z.number(),
  length: z.number(),
  words: z.number(),
  lines: z.number().optional(),
  redirectlocation: z.string().optional(),
});

type DiscoveredEntry = z.infer<typeof discoveredEntrySchema>;

const outputSchema = outputs({
  discovered: port(z.array(discoveredEntrySchema), {
    label: 'Discovered Paths',
    description: 'Array of discovered paths with HTTP status, length, and word count.',
    connectionType: { kind: 'list', element: { kind: 'primitive', name: 'json' } },
  }),
  rawOutput: port(z.string(), {
    label: 'Raw Output',
    description: 'Raw tool output for debugging.',
  }),
  discoveredCount: port(z.number(), {
    label: 'Discovered Count',
    description: 'Number of paths discovered.',
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
 * Map HTTP status code to severity for analytics.
 * 200=info (found content), 401/403=low (auth-protected), 500=medium (server error).
 */
const statusToSeverity = (status: number): 'info' | 'low' | 'medium' | 'high' => {
  if (status >= 500) return 'medium';
  if (status === 401 || status === 403) return 'low';
  return 'info';
};

const ffufRetryPolicy: ComponentRetryPolicy = {
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
  id: 'sentris.ffuf.run',
  label: 'ffuf Web Fuzzer',
  category: 'security',
  retryPolicy: ffufRetryPolicy,
  runner: {
    kind: 'docker',
    ...SECURITY_DOCKER_RESOURCE_STANDARD,
    image: FFUF_IMAGE,
    network: 'bridge',
    timeoutSeconds: FFUF_TIMEOUT_SECONDS,
    env: {
      HOME: '/tmp',
    },
    command: [],
  },
  inputs: inputSchema,
  outputs: outputSchema,
  parameters: parameterSchema,
  docs: 'Run ffuf to fuzz web paths and directories, discovering hidden content and endpoints.',
  ui: {
    slug: 'ffuf',
    version: '1.0.0',
    type: 'scan',
    category: 'security',
    description: 'Fuzz web paths and directories to discover hidden content using ffuf.',
    documentation:
      'ffuf (Fuzz Faster U Fool) documentation covers URL fuzzing, wordlists, filters, and output formats.',
    documentationUrl: 'https://github.com/ffuf/ffuf',
    icon: 'Search',
    author: {
      name: 'SentrisAI',
      type: 'sentris',
    },
    isLatest: true,
    deprecated: false,
    example:
      '`ffuf -u https://example.com/FUZZ -w wordlist.txt -mc 200,301` - Fuzz paths on example.com.',
    examples: [
      'Discover hidden directories and files on a web server.',
      'Fuzz API endpoints to find undocumented routes.',
    ],
  },
  toolProvider: {
    kind: 'component',
    name: 'web_fuzzer',
    description: 'Web fuzzing and directory brute-force tool (ffuf).',
  },
  async execute({ inputs, params }, context) {
    const parsedParams = parameterSchema.parse(params);

    const customFlags =
      typeof inputs.customFlags === 'string' && inputs.customFlags.length > 0
        ? inputs.customFlags
        : null;
    const customFlagArgs = customFlags ? splitCliArgs(customFlags) : [];

    const target = inputs.target.trim();
    const wordlist = inputs.wordlist;

    if (!target.includes('FUZZ')) {
      context.logger.warn(
        '[ffuf] Target URL does not contain FUZZ keyword. ffuf requires FUZZ in the URL to know where to inject.',
      );
    }

    context.logger.info(`[ffuf] Fuzzing target: ${target}`);
    context.emitProgress({
      message: `Launching ffuf against ${target}`,
      level: 'info',
    });

    const tenantId = (context as any).tenantId ?? 'default-tenant';
    const volume = new IsolatedContainerVolume(tenantId, context.runId);

    const baseRunner = definition.runner;
    if (baseRunner.kind !== 'docker') {
      throw new ContainerError('ffuf runner is expected to be docker-based.', {
        details: { expectedKind: 'docker', actualKind: baseRunner.kind },
      });
    }

    let rawOutput: string;
    try {
      await volume.initialize({
        'wordlist.txt': wordlist,
      });
      context.logger.info(`[ffuf] Created isolated volume: ${volume.getVolumeName()}`);

      // Build ffuf CLI args
      const args: string[] = [
        '-u',
        target,
        '-w',
        '/inputs/wordlist.txt',
        '-json',
        '-s',
        '-X',
        parsedParams.method,
        '-rate',
        String(parsedParams.rate),
      ];

      if (parsedParams.extensions) {
        args.push('-e', parsedParams.extensions);
      }

      if (parsedParams.filterStatus) {
        args.push('-fc', parsedParams.filterStatus);
      }

      // Append custom flags last
      for (const flag of customFlagArgs) {
        if (flag.length > 0) {
          args.push(flag);
        }
      }

      const runnerConfig = mergeSecurityDockerRunner(baseRunner, {
        timeoutSeconds: parsedParams.timeout,
        command: [...(baseRunner.command ?? []), ...args],
        volumes: [volume.getVolumeConfig('/inputs', true)],
      });

      try {
        const result = await runComponentWithRunner(
          runnerConfig,
          async () => ({}) as Output,
          { target, wordlist: '[wordlist content]' },
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
              '[ffuf] Container exited non-zero but produced output. Preserving partial results.',
            );
            context.emitProgress({
              message: 'ffuf exited with errors but found some results',
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
      context.logger.info('[ffuf] Cleaned up isolated volume');
    }

    // Parse ffuf output
    // ffuf -json outputs a single JSON object with a "results" array
    const discovered: DiscoveredEntry[] = [];

    const trimmed = rawOutput.trim();
    if (trimmed.length > 0) {
      // Try parsing as a single JSON object first (ffuf standard format)
      try {
        const parsed = JSON.parse(trimmed);
        if (parsed && typeof parsed === 'object' && Array.isArray(parsed.results)) {
          for (const entry of parsed.results) {
            const candidate: DiscoveredEntry = {
              url: entry.url ?? entry.input?.FUZZ ?? '',
              status: entry.status ?? 0,
              length: entry.length ?? entry['content-length'] ?? 0,
              words: entry.words ?? 0,
              lines: entry.lines,
              redirectlocation: entry.redirectlocation,
            };
            const validEntry = discoveredEntrySchema.safeParse(candidate);
            if (validEntry.success && candidate.url.length > 0) {
              discovered.push(validEntry.data);
            }
          }
        }
      } catch {
        // Try JSONL parsing (line-by-line)
        const lines = trimmed
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter((line) => line.length > 0);

        for (const line of lines) {
          try {
            const entry = JSON.parse(line);
            const candidate: DiscoveredEntry = {
              url: entry.url ?? entry.input?.FUZZ ?? '',
              status: entry.status ?? 0,
              length: entry.length ?? entry['content-length'] ?? 0,
              words: entry.words ?? 0,
              lines: entry.lines,
              redirectlocation: entry.redirectlocation,
            };
            const validEntry = discoveredEntrySchema.safeParse(candidate);
            if (validEntry.success && candidate.url.length > 0) {
              discovered.push(validEntry.data);
            }
          } catch {
            // Skip non-JSON lines
          }
        }
      }
    }

    const discoveredCount = discovered.length;

    context.logger.info(`[ffuf] Found ${discoveredCount} paths`);

    if (discoveredCount === 0) {
      context.emitProgress({
        message: 'No paths discovered by ffuf',
        level: 'warn',
      });
    } else {
      context.emitProgress({
        message: `ffuf discovered ${discoveredCount} paths`,
        level: 'info',
        data: { discovered: discovered.slice(0, 10).map((d) => d.url) },
      });
    }

    // Build analytics-ready results
    const analyticsResults: AnalyticsResult[] = discovered.map((entry) => ({
      scanner: 'ffuf',
      finding_hash: generateFindingHash(entry.url, String(entry.status)),
      severity: statusToSeverity(entry.status),
      asset_key: entry.url,
      url: entry.url,
      status: entry.status,
      length: entry.length,
      words: entry.words,
    }));

    return {
      discovered,
      rawOutput,
      discoveredCount,
      results: analyticsResults,
    };
  },
});

componentRegistry.register(definition);

type Output = (typeof outputSchema)['__inferred'];

type FfufInput = typeof inputSchema;
type FfufOutput = typeof outputSchema;

export type { FfufInput, FfufOutput };
