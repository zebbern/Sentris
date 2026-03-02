import { z } from 'zod';
import {
  componentRegistry,
  runComponentWithRunner,
  type DockerRunnerConfig,
  ContainerError,
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

const YARA_IMAGE = 'blacktop/yara:latest';
const YARA_DEFAULT_TIMEOUT_SECONDS = 120;
const INPUT_MOUNT_NAME = 'input';
const CONTAINER_INPUT_DIR = `/${INPUT_MOUNT_NAME}`;
const TARGET_FILE_NAME = 'target.bin';
const RULES_FILE_NAME = 'rules.yar';

const inputSchema = inputs({
  target: port(z.string(), {
    label: 'Target',
    description: 'File content to scan.',
    connectionType: { kind: 'primitive', name: 'text' },
  }),
  rules: port(z.string(), {
    label: 'YARA Rules',
    description: 'YARA rule definitions.',
    connectionType: { kind: 'primitive', name: 'text' },
  }),
  customFlags: port(z.string().optional().default(''), {
    label: 'Custom Flags',
    description: 'Additional YARA CLI flags.',
  }),
});

const yaraMatchSchema = z.object({
  rule: z.string(),
  tags: z.array(z.string()),
  strings: z.array(z.string()),
});

const outputSchema = outputs({
  matches: port(z.array(yaraMatchSchema), {
    label: 'Matches',
    description: 'Parsed YARA rule matches.',
    connectionType: { kind: 'list', element: { kind: 'primitive', name: 'json' } },
  }),
  raw: port(z.string(), {
    label: 'Raw Output',
    description: 'Raw YARA stdout for debugging.',
    connectionType: { kind: 'primitive', name: 'text' },
  }),
  results: port(z.array(analyticsResultSchema()), {
    label: 'Results',
    description:
      'Analytics-ready findings with scanner, finding_hash, and severity. Connect to Analytics Sink.',
    connectionType: { kind: 'list', element: { kind: 'primitive', name: 'json' } },
  }),
});

const parameterSchema = parameters({
  timeout: param(z.number().default(60), {
    label: 'Timeout (seconds)',
    editor: 'number',
    min: 1,
    max: 600,
    description: 'Maximum scan time in seconds.',
  }),
});

/**
 * Parse YARA -s stdout into structured match objects.
 *
 * YARA output format with -s:
 *   RuleName [tag1,tag2] /input/target.bin
 *   0xoffset:$string_id: matched_data
 *
 * or without tags:
 *   RuleName /input/target.bin
 *   0xoffset:$string_id: matched_data
 */
function parseYaraOutput(rawOutput: string): { rule: string; tags: string[]; strings: string[] }[] {
  const lines = rawOutput
    .split(/\r?\n/)
    // eslint-disable-next-line no-control-regex
    .map((line) => line.replace(/\x1B\[[0-9;]*m/g, '').trim()) // Strip ANSI escape codes
    .filter((line) => {
      if (line.length === 0) return false;
      // Filter out Docker pull progress and image download noise
      if (line.startsWith('Unable to find image')) return false;
      if (line.startsWith('Pulling from')) return false;
      if (line.includes(': Pulling fs layer')) return false;
      if (line.includes(': Verifying Checksum')) return false;
      if (line.includes(': Download complete')) return false;
      if (line.includes(': Pull complete')) return false;
      if (line.startsWith('Digest:')) return false;
      if (line.startsWith('Status:')) return false;
      if (line.includes('docker.io/')) return false;
      return true;
    });
  const matches: { rule: string; tags: string[]; strings: string[] }[] = [];
  let currentMatch: { rule: string; tags: string[]; strings: string[] } | null = null;

  for (const line of lines) {
    // String match lines start with 0x
    if (/^0x[0-9a-fA-F]+:/.test(line)) {
      if (currentMatch) {
        currentMatch.strings.push(line.trim());
      }
      continue;
    }

    // Rule match line: "RuleName [tag1,tag2] /path" or "RuleName /path"
    const ruleMatch = line.match(/^(\S+)\s+(?:\[([^\]]*)\]\s+)?(.+)$/);
    if (ruleMatch) {
      // Save previous match
      if (currentMatch) {
        matches.push(currentMatch);
      }

      const ruleName = ruleMatch[1];
      const tagStr = ruleMatch[2] ?? '';
      const tags = tagStr
        .split(',')
        .map((t) => t.trim())
        .filter((t) => t.length > 0);

      currentMatch = {
        rule: ruleName,
        tags,
        strings: [],
      };
    }
  }

  // Push the last match
  if (currentMatch) {
    matches.push(currentMatch);
  }

  return matches;
}

/**
 * Split custom CLI flags into an array of arguments.
 */
function splitCliFlags(input: string): string[] {
  const trimmed = input.trim();
  if (trimmed.length === 0) return [];
  return trimmed.split(/\s+/);
}

const definition = defineComponent({
  id: 'sentris.yara.run',
  label: 'YARA',
  category: 'security',
  runner: {
    kind: 'docker',
    image: YARA_IMAGE,
    network: 'none',
    timeoutSeconds: YARA_DEFAULT_TIMEOUT_SECONDS,
    command: [],
  },
  inputs: inputSchema,
  outputs: outputSchema,
  parameters: parameterSchema,
  docs: 'Pattern matching for malware and IOC detection using YARA rules. Scans file content against user-defined YARA rules in a secure Docker container.',
  ui: {
    slug: 'yara',
    version: '1.0.0',
    type: 'scan',
    category: 'security',
    description: 'Scan files for malware patterns and IOCs using YARA rules.',
    documentationUrl: 'https://yara.readthedocs.io/',
    icon: 'FileSearch',
    author: {
      name: 'SentrisAI',
      type: 'sentris',
    },
    isLatest: true,
    deprecated: false,
    examples: [
      'Scan suspicious file attachments against malware YARA rules.',
      'Detect IOCs in collected artifacts using custom threat intelligence rules.',
    ],
  },
  async execute({ inputs, params }, context) {
    const { target, rules, customFlags } = inputs;
    const { timeout } = params;

    if (!target || target.trim().length === 0) {
      context.logger.info('[YARA] No target content provided, returning empty results.');
      return { matches: [], raw: '', results: [] };
    }

    if (!rules || rules.trim().length === 0) {
      context.logger.info('[YARA] No YARA rules provided, returning empty results.');
      return { matches: [], raw: '', results: [] };
    }

    context.logger.info('[YARA] Starting YARA scan');
    context.emitProgress({
      message: 'Launching YARA scanner...',
      level: 'info',
    });

    // Extract tenant ID from context
    const tenantId = (context as any).tenantId ?? 'default-tenant';

    // Create isolated volume for this execution
    const volume = new IsolatedContainerVolume(tenantId, context.runId);

    const baseRunner = definition.runner;
    if (baseRunner.kind !== 'docker') {
      throw new ContainerError('YARA runner is expected to be docker-based.', {
        details: { expectedKind: 'docker', actualKind: baseRunner.kind },
      });
    }

    let rawOutput: string;
    try {
      // Prepare input files
      const inputFiles: Record<string, string> = {
        [TARGET_FILE_NAME]: target,
        [RULES_FILE_NAME]: rules,
      };

      const volumeName = await volume.initialize(inputFiles);
      context.logger.info(`[YARA] Created isolated volume: ${volumeName}`);

      // Build YARA CLI args
      const yaraArgs: string[] = [
        '-s', // Print matching strings
      ];

      // Add custom flags
      const extraFlags = splitCliFlags(customFlags ?? '');
      yaraArgs.push(...extraFlags);

      // Rules file and target file
      yaraArgs.push(
        `${CONTAINER_INPUT_DIR}/${RULES_FILE_NAME}`,
        `${CONTAINER_INPUT_DIR}/${TARGET_FILE_NAME}`,
      );

      const runnerConfig: DockerRunnerConfig = {
        kind: 'docker',
        image: baseRunner.image,
        network: baseRunner.network ?? 'none',
        timeoutSeconds: timeout ?? YARA_DEFAULT_TIMEOUT_SECONDS,
        env: {},
        command: yaraArgs,
        volumes: [volume.getVolumeConfig(CONTAINER_INPUT_DIR, true)],
        stdinJson: false,
      };

      try {
        const result = await runComponentWithRunner(
          runnerConfig,
          async () => ({}) as Output,
          { target, rules },
          context,
        );

        if (typeof result === 'string') {
          rawOutput = result;
        } else if (result && typeof result === 'object' && 'rawOutput' in result) {
          rawOutput = String((result as any).rawOutput ?? '');
        } else {
          rawOutput = '';
        }
      } catch (error: unknown) {
        // YARA exits with code 0 on no matches, non-zero on errors.
        // However, some edge cases may produce partial output.
        if (error instanceof ContainerError) {
          const details = (error as any).details as Record<string, unknown> | undefined;
          const capturedStdout = details?.stdout;
          if (typeof capturedStdout === 'string' && capturedStdout.trim().length > 0) {
            context.logger.warn(
              '[YARA] Container exited non-zero but produced output. Preserving partial results.',
            );
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
      context.logger.info('[YARA] Cleaned up isolated volume');
    }

    // Parse YARA output
    const matches = parseYaraOutput(rawOutput);
    const matchCount = matches.length;

    context.logger.info(`[YARA] Found ${matchCount} rule match(es)`);
    context.emitProgress({
      message: matchCount > 0 ? `YARA: ${matchCount} rule(s) matched` : 'YARA: No matches found',
      level: matchCount > 0 ? 'warn' : 'info',
      data: { matchCount },
    });

    // Generate a stable hash for the target content
    const targetHash = generateFindingHash(target.slice(0, 1024));

    // Build analytics results
    const analyticsResults: AnalyticsResult[] = matches.map((match) => ({
      scanner: 'yara',
      finding_hash: generateFindingHash(match.rule, targetHash),
      severity: 'medium' as const,
      asset_key: match.rule,
      rule: match.rule,
      tags: match.tags,
      matched_strings: match.strings.length,
    }));

    return {
      matches,
      raw: rawOutput,
      results: analyticsResults,
    };
  },
});

componentRegistry.register(definition);

type Output = (typeof outputSchema)['__inferred'];

type YaraInput = typeof inputSchema;
type YaraOutput = typeof outputSchema;

export type { YaraInput, YaraOutput };
