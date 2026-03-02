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

// Official theHarvester Docker image from GitHub Container Registry
const THEHARVESTER_IMAGE = 'ghcr.io/laramies/theharvester:latest';
const THEHARVESTER_TIMEOUT_SECONDS = 600;
const OUTPUT_DIR = '/output';
const RESULTS_FILE = 'results.json';

// Passive sources that work without API keys
const DEFAULT_SOURCES = 'baidu,bing,duckduckgo,yahoo';

const inputSchema = inputs({
  domain: port(z.string().min(1, 'Domain cannot be empty').describe('Target domain to harvest'), {
    label: 'Domain',
    description: 'Target domain for OSINT gathering (e.g., "example.com").',
    connectionType: { kind: 'primitive', name: 'text' },
  }),
  customFlags: port(
    z.string().trim().optional().describe('Raw CLI flags to append to theHarvester command'),
    {
      label: 'Custom CLI Flags',
      editor: 'textarea',
      description: 'Additional theHarvester CLI options. Appended after generated options.',
    },
  ),
});

const parameterSchema = parameters({
  sources: param(z.string().default(DEFAULT_SOURCES).describe('Comma-separated data sources'), {
    label: 'Data Sources',
    editor: 'text',
    placeholder: DEFAULT_SOURCES,
    description:
      'Comma-separated list of data sources. Without API keys, only passive sources work: baidu, bing, duckduckgo, yahoo, crtsh, certspotter, anubis, hackertarget, rapiddns, urlscan.',
  }),
  limit: param(z.number().int().min(1).max(5000).default(500), {
    label: 'Result Limit',
    editor: 'number',
    min: 1,
    max: 5000,
    description: 'Maximum number of results to gather per source.',
  }),
});

const outputSchema = outputs({
  emails: port(z.array(z.string()), {
    label: 'Emails',
    description: 'Email addresses discovered for the target domain.',
  }),
  subdomains: port(z.array(z.string()), {
    label: 'Subdomains',
    description: 'Subdomains discovered for the target domain.',
  }),
  ips: port(z.array(z.string()), {
    label: 'IP Addresses',
    description: 'IP addresses discovered for the target domain.',
  }),
  rawOutput: port(z.string(), {
    label: 'Raw Output',
    description: 'Raw tool output for debugging.',
  }),
  results: port(z.array(analyticsResultSchema()), {
    label: 'Results',
    description: 'Analytics-ready findings. Connect to Analytics Sink.',
  }),
  totalFindings: port(z.number(), {
    label: 'Total Findings',
    description: 'Total number of unique findings across all categories.',
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
  id: 'sentris.theharvester.run',
  label: 'theHarvester — OSINT Harvester',
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
    image: THEHARVESTER_IMAGE,
    network: 'bridge',
    timeoutSeconds: THEHARVESTER_TIMEOUT_SECONDS,
    command: [],
    env: { HOME: '/tmp' },
  },
  inputs: inputSchema,
  outputs: outputSchema,
  parameters: parameterSchema,
  docs: 'Runs theHarvester for OSINT gathering — discovers emails, subdomains, and IP addresses from public sources.',
  ui: {
    slug: 'theharvester',
    version: '1.0.0',
    type: 'scan',
    category: 'security',
    description: 'OSINT gathering tool for emails, subdomains, and IPs from public sources.',
    documentation:
      'theHarvester gathers emails, subdomains, hosts, and IPs using multiple public data sources.',
    documentationUrl: 'https://github.com/laramies/theHarvester',
    icon: 'Search',
    author: { name: 'SentrisAI', type: 'sentris' },
    isLatest: true,
    deprecated: false,
    example: '`theHarvester -d example.com -l 500 -b bing,duckduckgo`',
    examples: [
      'Discover email addresses for a target domain before social engineering assessments.',
      'Enumerate subdomains from passive OSINT sources.',
    ],
  },
  async execute({ inputs, params }, context) {
    const parsedParams = parameterSchema.parse(params);
    const { sources, limit } = parsedParams;
    const domain = inputs.domain.trim();
    const customFlags =
      typeof inputs.customFlags === 'string' && inputs.customFlags.trim().length > 0
        ? inputs.customFlags.trim()
        : null;
    const customFlagArgs = customFlags ? splitCliArgs(customFlags) : [];

    context.logger.info(`[theHarvester] Gathering OSINT for domain: ${domain}`);
    context.emitProgress({
      message: `Launching theHarvester for ${domain}`,
      level: 'info',
      data: { domain, sources },
    });

    const tenantId = (context as any).tenantId ?? 'default-tenant';
    const volume = new IsolatedContainerVolume(tenantId, context.runId);
    const baseRunner = definition.runner;
    if (baseRunner.kind !== 'docker') {
      throw new ContainerError('theHarvester runner is expected to be docker-based.', {
        details: { expectedKind: 'docker', actualKind: baseRunner.kind },
      });
    }

    let rawOutput = '';
    try {
      await volume.initialize({});
      context.logger.info(`[theHarvester] Created isolated volume: ${volume.getVolumeName()}`);

      const args: string[] = [
        '-d',
        domain,
        '-l',
        String(limit),
        '-b',
        sources,
        '-f',
        `${OUTPUT_DIR}/${RESULTS_FILE}`,
      ];

      for (const flag of customFlagArgs) {
        if (flag.length > 0) args.push(flag);
      }

      const runnerConfig: DockerRunnerConfig = {
        kind: 'docker',
        image: baseRunner.image,
        entrypoint: 'theHarvester',
        network: baseRunner.network,
        timeoutSeconds: baseRunner.timeoutSeconds ?? THEHARVESTER_TIMEOUT_SECONDS,
        env: { ...(baseRunner.env ?? {}) },
        command: [...(baseRunner.command ?? []), ...args],
        volumes: [volume.getVolumeConfig(OUTPUT_DIR, false)],
      };

      try {
        const result = await runComponentWithRunner(
          runnerConfig,
          async () => ({}) as Output,
          { domain },
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
              '[theHarvester] Container exited non-zero but produced output. Preserving partial results.',
            );
            rawOutput = capturedStdout;
          } else {
            throw error;
          }
        } else {
          throw error;
        }
      }

      // Try to read JSON results file from volume
      let emails: string[] = [];
      let subdomains: string[] = [];
      let ips: string[] = [];

      try {
        const outputFiles = await volume.readFiles([RESULTS_FILE]);
        const jsonContent = outputFiles[RESULTS_FILE];
        if (jsonContent && jsonContent.trim().length > 0) {
          const parsed = parseHarvesterJson(jsonContent, context);
          emails = parsed.emails;
          subdomains = parsed.subdomains;
          ips = parsed.ips;
        }
      } catch (readError: unknown) {
        context.logger.warn(
          `[theHarvester] Could not read results file: ${readError instanceof Error ? readError.message : String(readError)}`,
        );
      }

      // If JSON file didn't yield results, try parsing stdout
      if (
        emails.length === 0 &&
        subdomains.length === 0 &&
        ips.length === 0 &&
        rawOutput.trim().length > 0
      ) {
        const fromStdout = parseHarvesterStdout(rawOutput);
        emails = fromStdout.emails;
        subdomains = fromStdout.subdomains;
        ips = fromStdout.ips;
      }

      const totalFindings = emails.length + subdomains.length + ips.length;
      context.logger.info(
        `[theHarvester] Found ${emails.length} emails, ${subdomains.length} subdomains, ${ips.length} IPs`,
      );
      context.emitProgress({
        message: `theHarvester found ${totalFindings} result(s) for ${domain}`,
        level: totalFindings > 0 ? 'info' : 'warn',
        data: { emails: emails.length, subdomains: subdomains.length, ips: ips.length },
      });

      // Build analytics results
      const analyticsResults: AnalyticsResult[] = [
        ...emails.map((email) => ({
          scanner: 'theharvester',
          finding_hash: generateFindingHash('email', email),
          severity: 'info' as const,
          asset_key: email,
          type: 'email',
          value: email,
          domain,
        })),
        ...subdomains.map((sub) => ({
          scanner: 'theharvester',
          finding_hash: generateFindingHash('subdomain', sub),
          severity: 'info' as const,
          asset_key: sub,
          type: 'subdomain',
          value: sub,
          domain,
        })),
        ...ips.map((ip) => ({
          scanner: 'theharvester',
          finding_hash: generateFindingHash('ip', ip),
          severity: 'info' as const,
          asset_key: ip,
          type: 'ip',
          value: ip,
          domain,
        })),
      ];

      return { emails, subdomains, ips, rawOutput, results: analyticsResults, totalFindings };
    } finally {
      await volume.cleanup();
      context.logger.info('[theHarvester] Cleaned up isolated volume');
    }
  },
});

/** Parse theHarvester JSON output file. */
function parseHarvesterJson(
  raw: string,
  context: any,
): { emails: string[]; subdomains: string[]; ips: string[] } {
  try {
    const data = JSON.parse(raw);
    const emails = dedup(extractStringArray(data.emails));
    const subdomains = dedup(extractStringArray(data.hosts ?? data.subdomains ?? data.hostnames));
    const ips = dedup(extractStringArray(data.ips ?? data.ip_addresses));
    return { emails, subdomains, ips };
  } catch {
    context.logger.warn('[theHarvester] Failed to parse JSON results file');
    return { emails: [], subdomains: [], ips: [] };
  }
}

/** Fallback: parse theHarvester text stdout for results sections. */
function parseHarvesterStdout(raw: string): {
  emails: string[];
  subdomains: string[];
  ips: string[];
} {
  const emails: string[] = [];
  const subdomains: string[] = [];
  const ips: string[] = [];
  const lines = raw.split(/\r?\n/);
  let section: 'none' | 'emails' | 'hosts' | 'ips' = 'none';

  for (const line of lines) {
    const trimmed = line.trim();
    if (/emails\s*found/i.test(trimmed) || /email.*:/i.test(trimmed)) {
      section = 'emails';
      continue;
    }
    if (/hosts\s*found/i.test(trimmed) || /host.*:/i.test(trimmed) || /subdomains/i.test(trimmed)) {
      section = 'hosts';
      continue;
    }
    if (/ips?\s*found/i.test(trimmed) || /ip.*address/i.test(trimmed)) {
      section = 'ips';
      continue;
    }
    if (trimmed.startsWith('[') || trimmed.startsWith('=') || trimmed.length === 0) {
      if (trimmed.length === 0) section = 'none';
      continue;
    }
    if (section === 'emails' && trimmed.includes('@')) emails.push(trimmed);
    else if (section === 'hosts' && trimmed.includes('.')) subdomains.push(trimmed.split(':')[0]);
    else if (section === 'ips' && /^\d+\.\d+\.\d+\.\d+/.test(trimmed)) ips.push(trimmed);
  }

  return { emails: dedup(emails), subdomains: dedup(subdomains), ips: dedup(ips) };
}

function extractStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    .map((s) => s.trim());
}

function dedup(arr: string[]): string[] {
  return Array.from(new Set(arr));
}

componentRegistry.register(definition);

type Output = (typeof outputSchema)['__inferred'];
type TheHarvesterInput = typeof inputSchema;
type TheHarvesterOutput = typeof outputSchema;

export type { TheHarvesterInput, TheHarvesterOutput };
