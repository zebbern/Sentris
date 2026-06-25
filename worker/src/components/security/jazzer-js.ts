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

const JAZZER_IMAGE = 'node:22-trixie-slim';
const DEFAULT_TIMEOUT_SECONDS = 300;

const fuzzTargetSchema = z.object({
  name: z.string().trim().min(1),
  code: z.string().min(1),
  rationale: z.string().optional(),
});

type FuzzTarget = z.infer<typeof fuzzTargetSchema>;

const inputSchema = inputs({
  volumeName: port(
    z
      .string()
      .trim()
      .min(1)
      .optional()
      .describe('Existing Docker volume containing package files.'),
    {
      label: 'Volume Name',
      description: 'Source volume for the npm package or repository under test.',
      connectionType: { kind: 'primitive', name: 'text' },
    },
  ),
  scanPath: port(
    z.string().trim().default('/repo').describe('Directory inside the mounted source volume.'),
    {
      label: 'Scan Path',
      description: 'Directory path inside the mounted source volume, for example /repo.',
      connectionType: { kind: 'primitive', name: 'text' },
    },
  ),
  fuzzTargets: port(
    z
      .union([z.array(fuzzTargetSchema), z.string()])
      .optional()
      .describe('Generated Jazzer.js fuzz targets.'),
    {
      label: 'Fuzz Targets',
      description:
        'Array or JSON string of { name, code, rationale } harnesses. Empty input skips fuzzing with a caveat.',
      connectionType: { kind: 'primitive', name: 'json' },
    },
  ),
});

const parameterSchema = parameters({
  ...securityDockerResourceParameterShape(),
  timeoutSeconds: param(
    z
      .number()
      .int()
      .min(10)
      .max(3600)
      .default(DEFAULT_TIMEOUT_SECONDS)
      .describe('Maximum Jazzer.js container runtime in seconds.'),
    {
      label: 'Timeout (seconds)',
      editor: 'number',
      min: 10,
      max: 3600,
      description: 'Overall runtime budget for all generated fuzz targets.',
    },
  ),
  maxCrashes: param(
    z.number().int().min(1).max(20).default(3).describe('Maximum crash records to keep.'),
    {
      label: 'Max Crashes',
      editor: 'number',
      min: 1,
      max: 20,
      description: 'Stop preserving crash summaries after this many crashes.',
    },
  ),
  installDependencies: param(
    z.boolean().default(false).describe('Run npm install in the mounted package before fuzzing.'),
    {
      label: 'Install dependencies',
      editor: 'boolean',
      description:
        'Use only when the target package needs dependencies installed before a harness can run.',
    },
  ),
  buildCommand: param(z.string().trim().optional().describe('Optional package build command.'), {
    label: 'Build Command',
    editor: 'text',
    placeholder: 'npm run build',
    description: 'Optional package build command executed after dependency installation.',
  }),
});

const crashSchema = z.object({
  targetName: z.string(),
  error: z.string(),
  crashPath: z.string().optional(),
  reproducerCommand: z.string().optional(),
  rawSnippet: z.string(),
});

type JazzerCrash = z.infer<typeof crashSchema>;

const harnessStatusSchema = z.object({
  targetName: z.string(),
  status: z.enum(['completed', 'crashed', 'failed', 'not_run']),
  exitCode: z.number().int().optional(),
  error: z.string().optional(),
});

type JazzerHarnessStatus = z.infer<typeof harnessStatusSchema>;

const outputSchema = outputs({
  crashes: port(z.array(crashSchema), {
    label: 'Crashes',
    description: 'Jazzer.js crash summaries with reproducer commands when available.',
    connectionType: { kind: 'list', element: { kind: 'primitive', name: 'json' } },
  }),
  crashCount: port(z.number(), {
    label: 'Crash Count',
    description: 'Number of crashes detected.',
  }),
  crashArtifacts: port(z.array(z.string()), {
    label: 'Crash Artifacts',
    description: 'Container paths to crash inputs or artifacts reported by Jazzer.js.',
  }),
  reproducerCommand: port(z.string().optional(), {
    label: 'Reproducer Command',
    description: 'First reproducer command reported by Jazzer.js, if available.',
  }),
  harnessSummary: port(
    z.object({
      targetCount: z.number(),
      targets: z.array(z.object({ name: z.string(), rationale: z.string().optional() })),
    }),
    {
      label: 'Harness Summary',
      description: 'Generated harness count and rationale.',
      connectionType: { kind: 'primitive', name: 'json' },
    },
  ),
  harnessStatuses: port(z.array(harnessStatusSchema), {
    label: 'Harness Statuses',
    description:
      'Per-harness outcome, separating confirmed crashes from setup or harness failures.',
    connectionType: { kind: 'list', element: { kind: 'primitive', name: 'json' } },
  }),
  rawOutput: port(z.string(), {
    label: 'Raw Output',
    description: 'Raw Jazzer.js output for debugging.',
  }),
  scanStatus: port(z.enum(['completed', 'crashed', 'failed', 'skipped']), {
    label: 'Scan Status',
    description: 'Whether fuzzing completed, found crashes, failed non-blockingly, or skipped.',
  }),
  caveats: port(z.array(z.string()), {
    label: 'Caveats',
    description: 'Non-blocking Jazzer.js setup, execution, or parsing caveats.',
  }),
  results: port(z.array(analyticsResultSchema()), {
    label: 'Results',
    description: 'Analytics-ready Jazzer.js crash findings.',
  }),
});

const jazzerRetryPolicy: ComponentRetryPolicy = {
  maxAttempts: 1,
  nonRetryableErrorTypes: ['ContainerError', 'ValidationError', 'ConfigurationError'],
};

function sanitizeName(value: string, index: number): string {
  const sanitized = value
    .trim()
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/^_+/, '');
  return sanitized || `target-${index}`;
}

function normalizeScanPath(value: unknown): string {
  const raw = typeof value === 'string' && value.trim().length > 0 ? value.trim() : '/repo';
  const normalized = raw.replace(/\/+$/, '') || '/repo';
  if (!normalized.startsWith('/') || !/^\/[a-zA-Z0-9._/-]+$/.test(normalized)) {
    return '/repo';
  }
  return normalized;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\"'\"'")}'`;
}

function parseFuzzTargets(value: unknown): FuzzTarget[] {
  let candidate = value;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return [];
    try {
      candidate = JSON.parse(trimmed);
    } catch {
      candidate = [{ name: 'generated-target', code: trimmed }];
    }
  }

  const rawTargets = Array.isArray(candidate) ? candidate : candidate ? [candidate] : [];
  const targets: FuzzTarget[] = [];
  for (const rawTarget of rawTargets) {
    const parsed = fuzzTargetSchema.safeParse(rawTarget);
    if (parsed.success) {
      targets.push(parsed.data);
    }
  }
  return targets;
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

function normalizeTargetName(value: string): string {
  return value.replace(/^\d{3}-/, '');
}

export function parseJazzerOutput(
  rawOutput: string,
  targets: FuzzTarget[],
  maxCrashes: number,
): JazzerCrash[] {
  const lines = rawOutput.split(/\r?\n/);
  const crashes: JazzerCrash[] = [];
  let currentTarget = targets[0]?.name ?? 'jazzer-target';
  let currentError = '';
  let currentSnippet: string[] = [];

  const flush = () => {
    if (!currentError || crashes.length >= maxCrashes) return;
    const snippet = currentSnippet.join('\n').trim();
    const crashPathMatch = snippet.match(/Crash input written to\s+(\S+)/i);
    const reproducerMatch = snippet.match(/Reproducer command:\s*(.+)$/im);
    crashes.push({
      targetName: currentTarget,
      error: currentError,
      crashPath: crashPathMatch?.[1],
      reproducerCommand: reproducerMatch?.[1]?.trim(),
      rawSnippet: snippet.slice(0, 4000),
    });
  };

  for (const line of lines) {
    const targetMatch = line.match(/(?:Running target|Target):\s*([a-zA-Z0-9._-]+)/i);
    if (targetMatch?.[1]) {
      currentTarget = normalizeTargetName(targetMatch[1]);
    }

    if (/==ERROR: Jazzer\.js/i.test(line) || /\buncaught exception\b/i.test(line)) {
      flush();
      currentError = line.replace(/^.*==ERROR:\s*/i, '').trim() || 'Jazzer.js crash';
      currentSnippet = [line];
      continue;
    }

    if (currentError) {
      currentSnippet.push(line);
    }
  }

  flush();
  return crashes;
}

export function parseJazzerHarnessStatuses(
  rawOutput: string,
  targets: FuzzTarget[],
  crashes: JazzerCrash[],
): JazzerHarnessStatus[] {
  const statuses = new Map<string, JazzerHarnessStatus>();
  for (const target of targets) {
    statuses.set(target.name, { targetName: target.name, status: 'not_run' });
  }

  for (const line of rawOutput.split(/\r?\n/)) {
    const startMatch = line.match(/^SENTRIS_JAZZER_TARGET_START:([a-zA-Z0-9._-]+)$/);
    if (startMatch?.[1]) {
      const targetName = normalizeTargetName(startMatch[1]);
      statuses.set(targetName, { targetName, status: 'completed' });
      continue;
    }

    const exitMatch = line.match(/^SENTRIS_JAZZER_TARGET_EXIT:([a-zA-Z0-9._-]+):(\d+)$/);
    if (exitMatch?.[1] && exitMatch[2]) {
      const targetName = normalizeTargetName(exitMatch[1]);
      const exitCode = Number(exitMatch[2]);
      statuses.set(targetName, {
        targetName,
        status: exitCode === 0 ? 'completed' : 'failed',
        exitCode,
      });
    }
  }

  for (const crash of crashes) {
    statuses.set(crash.targetName, {
      targetName: crash.targetName,
      status: 'crashed',
      error: crash.error,
    });
  }

  return targets.map(
    (target) => statuses.get(target.name) ?? { targetName: target.name, status: 'not_run' },
  );
}

function buildJazzerScript(
  scanPath: string,
  targetCount: number,
  params: z.infer<typeof parameterSchema>,
): string {
  const commands = [
    'set -eu',
    'mkdir -p /work /crashes',
    'cd /work',
    'npm init -y >/dev/null 2>&1',
    'npm install --no-audit --no-fund @jazzer.js/core >/dev/null 2>&1',
  ];

  if (params.installDependencies) {
    commands.push(`cd ${shellQuote(scanPath)} && npm install --no-audit --no-fund`);
  }
  if (params.buildCommand) {
    commands.push(`cd ${shellQuote(scanPath)} && ${params.buildCommand}`);
  }

  for (let index = 1; index <= targetCount; index += 1) {
    const file = `/fuzz-targets/${String(index).padStart(3, '0')}-*.js`;
    commands.push(
      [
        'cd /work',
        `for TARGET in ${file}; do`,
        '  [ -f "$TARGET" ] || continue;',
        '  TARGET_NAME="$(basename "$TARGET" .js)";',
        '  echo "SENTRIS_JAZZER_TARGET_START:$TARGET_NAME";',
        '  echo "INFO: Running target ${TARGET_NAME#???-}";',
        '  set +e;',
        '  npx jazzer "$TARGET" --sync -- -runs=1000;',
        '  STATUS="$?";',
        '  set -e;',
        '  echo "SENTRIS_JAZZER_TARGET_EXIT:$TARGET_NAME:$STATUS";',
        'done',
      ].join('\n'),
    );
  }

  return commands.join(' && ');
}

const definition = defineComponent({
  id: 'sentris.jazzer-js.run',
  label: 'Jazzer.js Crash Fuzzer',
  category: 'security',
  retryPolicy: jazzerRetryPolicy,
  runner: {
    kind: 'docker',
    ...SECURITY_DOCKER_RESOURCE_HEAVY,
    image: JAZZER_IMAGE,
    network: 'bridge',
    timeoutSeconds: DEFAULT_TIMEOUT_SECONDS,
    env: {
      HOME: '/tmp',
      npm_config_cache: '/tmp/npm-cache',
      NO_COLOR: '1',
      TERM: 'dumb',
    },
    command: [],
  },
  inputs: inputSchema,
  outputs: outputSchema,
  parameters: parameterSchema,
  docs: 'Run generated Jazzer.js harnesses against npm package source to discover runtime crashes.',
  ui: {
    slug: 'jazzer-js',
    version: '1.0.0',
    type: 'scan',
    category: 'security',
    description: 'Coverage-guided JavaScript/TypeScript crash discovery using Jazzer.js harnesses.',
    documentation:
      'Jazzer.js fuzzes Node.js code and reports crashing inputs for exploitability review.',
    documentationUrl: 'https://github.com/CodeIntelligenceTesting/jazzer.js',
    icon: 'Bug',
    author: { name: 'SentrisAI', type: 'sentris' },
    isLatest: true,
    deprecated: false,
    example: 'Run generated parser or decoder harnesses with Jazzer.js.',
    examples: ['Fuzz parser APIs discovered during AI source review.'],
  },
  toolProvider: {
    kind: 'component',
    name: 'jazzer_js_fuzzer',
    description: 'Runtime crash discovery for fuzzable JS/TS package entrypoints.',
  },
  async execute({ inputs, params }, context) {
    const parsedParams = parameterSchema.parse(params);
    const targets = parseFuzzTargets(inputs.fuzzTargets);
    const harnessSummary = {
      targetCount: targets.length,
      targets: targets.map((target) => ({ name: target.name, rationale: target.rationale })),
    };

    if (targets.length === 0) {
      const caveat = 'No Jazzer.js fuzz targets were provided; fuzzing skipped.';
      return {
        crashes: [],
        crashCount: 0,
        crashArtifacts: [],
        reproducerCommand: undefined,
        harnessSummary,
        harnessStatuses: [],
        rawOutput: '',
        scanStatus: 'skipped' as const,
        caveats: [caveat],
        results: [],
      };
    }

    const volumeName =
      typeof inputs.volumeName === 'string' && inputs.volumeName.trim().length > 0
        ? inputs.volumeName.trim()
        : null;
    if (!volumeName) {
      const caveat = 'No source volume provided to Jazzer.js; fuzzing skipped.';
      return {
        crashes: [],
        crashCount: 0,
        crashArtifacts: [],
        reproducerCommand: undefined,
        harnessSummary,
        harnessStatuses: [],
        rawOutput: '',
        scanStatus: 'skipped' as const,
        caveats: [caveat],
        results: [],
      };
    }

    const tenantId = (context as any).tenantId ?? 'default-tenant';
    const sourceVolume = IsolatedContainerVolume.attachExisting(
      tenantId,
      context.runId,
      volumeName,
    );
    const harnessVolume = new IsolatedContainerVolume(tenantId, `${context.runId}-jazzer-targets`);
    const scanPath = normalizeScanPath(inputs.scanPath);
    const baseRunner = definition.runner;
    if (baseRunner.kind !== 'docker') {
      throw new ContainerError('Jazzer.js runner is expected to be docker-based.', {
        details: { expectedKind: 'docker', actualKind: baseRunner.kind },
      });
    }

    const files: Record<string, string> = {};
    targets.forEach((target, index) => {
      files[`${String(index + 1).padStart(3, '0')}-${sanitizeName(target.name, index + 1)}.js`] =
        target.code;
    });

    let rawOutput = '';
    const caveats: string[] = [];

    try {
      await harnessVolume.initialize(files);
      const runnerConfig = mergeSecurityDockerRunner(
        baseRunner,
        {
          command: ['sh', '-lc', buildJazzerScript(scanPath, targets.length, parsedParams)],
          volumes: [
            sourceVolume.getVolumeConfig('/repo', true),
            harnessVolume.getVolumeConfig('/fuzz-targets', true),
          ],
          timeoutSeconds: parsedParams.timeoutSeconds,
        },
        parsedParams,
      );

      try {
        rawOutput = getRunnerOutputText(
          await runComponentWithRunner(
            runnerConfig,
            async () => ({}) as Output,
            { target: '[jazzer harnesses]' },
            context,
          ),
        );
      } catch (error: unknown) {
        const details = error instanceof ContainerError ? ((error as any).details ?? {}) : {};
        rawOutput = [details.stdout, details.stderr]
          .filter((value): value is string => typeof value === 'string' && value.length > 0)
          .join('\n');
        caveats.push(
          `Jazzer.js failed non-blockingly: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    } finally {
      await harnessVolume.cleanup();
      await sourceVolume.cleanup();
    }

    const crashes = parseJazzerOutput(rawOutput, targets, parsedParams.maxCrashes);
    const harnessStatuses = parseJazzerHarnessStatuses(rawOutput, targets, crashes);
    for (const status of harnessStatuses) {
      if (status.status === 'failed') {
        caveats.push(
          `Jazzer.js harness ${status.targetName} exited with code ${status.exitCode ?? 'unknown'} without a confirmed crash.`,
        );
      }
    }
    const crashArtifacts = crashes
      .map((crash) => crash.crashPath)
      .filter((value): value is string => typeof value === 'string' && value.length > 0);
    const results: AnalyticsResult[] = crashes.map((crash) => ({
      scanner: 'jazzer-js',
      finding_hash: generateFindingHash(crash.targetName, crash.error, crash.crashPath ?? 'crash'),
      severity: 'high',
      asset_key: crash.targetName,
      check_id: 'jazzer-js-crash',
      file_path: crash.crashPath,
      message: crash.error,
    }));

    const scanStatus =
      crashes.length > 0
        ? ('crashed' as const)
        : caveats.length > 0
          ? ('failed' as const)
          : ('completed' as const);
    return {
      crashes,
      crashCount: crashes.length,
      crashArtifacts,
      reproducerCommand: crashes[0]?.reproducerCommand,
      harnessSummary,
      harnessStatuses,
      rawOutput,
      scanStatus,
      caveats,
      results,
    };
  },
});

componentRegistry.register(definition);

type Output = (typeof outputSchema)['__inferred'];

export type JazzerJsInput = typeof inputSchema;
export type JazzerJsOutput = typeof outputSchema;
