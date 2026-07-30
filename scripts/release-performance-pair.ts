#!/usr/bin/env bun

/* eslint-disable no-console -- This is an operator-facing release gate. */
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

import {
  comparePerformanceArtifacts,
  REQUIRED_RELEASE_METRICS,
  validatePerformanceArtifact,
  type PerformanceArtifact,
  type PerformanceComparison,
} from './lib/performance-budget';

const smoke = require('./production-compose-smoke.js') as {
  resolveSmokeEnvironment(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv;
  runCommand(step: PerformancePairCommand, env: NodeJS.ProcessEnv): Promise<void>;
};

const USAGE =
  'Usage: bun scripts/release-performance-pair.ts --baseline-root <path> --baseline-revision <revision> --candidate-root <path> --candidate-revision <revision> --output-dir <path>';

const PERFORMANCE_BUDGET_PERCENT = 10;
const DEFAULT_SAMPLE_COUNT = 10;
const DEFAULT_WAIT_SECONDS = 600;
const DEFAULT_BENCHMARK_TIMEOUT_SECONDS = 3_600;

export interface PerformancePairSource {
  label: 'baseline' | 'candidate';
  root: string;
  revision: string;
  artifactPath: string;
}

export interface PerformancePairCommand {
  name: string;
  command: string;
  args: string[];
  timeoutMs: number;
  cwd: string;
}

export interface ReleasePerformancePairConfig {
  instance: number;
  trustProfile: 'trusted-local';
  sampleCount: number;
  waitTimeoutSeconds: number;
  benchmarkTimeoutMs: number;
  outputDirectory: string;
  benchmarkScriptPath: string;
  pairId: string;
  baseline: PerformancePairSource;
  candidate: PerformancePairSource;
  baseEnvironment: NodeJS.ProcessEnv;
}

export interface ReleasePerformancePairResult {
  baseline: PerformanceArtifact;
  candidate: PerformanceArtifact;
  comparisons: PerformanceComparison[];
}

export interface PerformancePairLegPlan {
  environment: NodeJS.ProcessEnv;
  preclean: PerformancePairCommand;
  up: PerformancePairCommand;
  benchmark: PerformancePairCommand;
  down: PerformancePairCommand;
}

interface ExecutionDependencies {
  runStep?: (step: PerformancePairCommand, env: NodeJS.ProcessEnv) => Promise<void>;
  readArtifact?: (path: string) => PerformanceArtifact;
  log?: (message: string) => void;
}

interface ParsedArguments {
  baselineRoot: string;
  baselineRevision: string;
  candidateRoot: string;
  candidateRevision: string;
  outputDirectory?: string;
}

interface SyncCommandResult {
  status: number | null;
  stdout?: string | Buffer | null;
  stderr?: string | Buffer | null;
  error?: Error;
}

type SpawnSyncImplementation = (
  command: string,
  args: string[],
  options: {
    encoding: 'utf8';
    shell: false;
    timeout: number;
    windowsHide: true;
  },
) => SyncCommandResult;

interface ConfigurationDependencies {
  verifySourceCheckout?: (root: string, requestedRevision: string, label: string) => string;
}

function parseArguments(args: readonly string[]): ParsedArguments {
  if (args.length === 0 || args.length % 2 !== 0) {
    throw new Error(USAGE);
  }
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    if (!flag?.startsWith('--') || !value?.trim()) {
      throw new Error(USAGE);
    }
    if (values.has(flag)) {
      throw new Error(`Duplicate release performance pair option ${flag}`);
    }
    values.set(flag, value);
  }

  const allowed = new Set([
    '--baseline-root',
    '--baseline-revision',
    '--candidate-root',
    '--candidate-revision',
    '--output-dir',
  ]);
  for (const flag of values.keys()) {
    if (!allowed.has(flag)) {
      throw new Error(`Unknown release performance pair option ${flag}`);
    }
  }

  const baselineRoot = values.get('--baseline-root');
  const baselineRevision = values.get('--baseline-revision');
  const candidateRoot = values.get('--candidate-root');
  const candidateRevision = values.get('--candidate-revision');
  if (!baselineRoot || !baselineRevision || !candidateRoot || !candidateRevision) {
    throw new Error(USAGE);
  }

  return {
    baselineRoot,
    baselineRevision,
    candidateRoot,
    candidateRevision,
    outputDirectory: values.get('--output-dir'),
  };
}

function requireCredential(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function parseBoundedInteger(
  rawValue: string | undefined,
  fallback: number,
  name: string,
  minimum: number,
  maximum: number,
): number {
  const value = rawValue?.trim() || String(fallback);
  if (!/^[0-9]+$/.test(value)) {
    throw new Error(`${name} must be an integer from ${minimum} to ${maximum}`);
  }
  const parsed = Number.parseInt(value, 10);
  if (parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be an integer from ${minimum} to ${maximum}`);
  }
  return parsed;
}

function validateRevision(revision: string, label: string): string {
  const value = revision.trim();
  if (value.length > 160 || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new Error(`${label} revision must be a bounded printable identifier`);
  }
  return value;
}

function resolveSourceRoot(input: string, workingDirectory: string, label: string): string {
  const path = resolve(workingDirectory, input);
  if (!existsSync(path) || !statSync(path).isDirectory()) {
    throw new Error(`${label} source root does not exist or is not a directory`);
  }
  const canonical = realpathSync(path);
  if (!existsSync(join(canonical, 'docker', 'docker-compose.full.yml'))) {
    throw new Error(`${label} source root is missing docker/docker-compose.full.yml`);
  }
  return canonical;
}

function commandOutput(value: string | Buffer | null | undefined): string {
  if (typeof value === 'string') return value;
  return value?.toString('utf8') ?? '';
}

function runGitInspection(
  root: string,
  label: string,
  operation: string,
  args: string[],
  spawnSyncImpl: SpawnSyncImplementation,
): string {
  const result = spawnSyncImpl('git', ['-C', root, ...args], {
    encoding: 'utf8',
    shell: false,
    timeout: 10_000,
    windowsHide: true,
  });
  if (result.error) {
    throw new Error(`${label} source root git ${operation} failed: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(
      `${label} source root git ${operation} exited with status ${result.status ?? 'unknown'}`,
    );
  }
  return commandOutput(result.stdout);
}

export function verifySourceCheckout(
  root: string,
  requestedRevision: string,
  label: string,
  spawnSyncImpl: SpawnSyncImplementation = spawnSync,
): string {
  const normalizedRevision = requestedRevision.trim().toLowerCase();
  if (!/^[a-f0-9]{40}$/.test(normalizedRevision)) {
    throw new Error(`${label} revision must be a full 40-character commit SHA`);
  }

  const actualRevision = runGitInspection(
    root,
    label,
    'rev-parse',
    ['rev-parse', '--verify', 'HEAD'],
    spawnSyncImpl,
  )
    .trim()
    .toLowerCase();
  if (actualRevision !== normalizedRevision) {
    throw new Error(
      `${label} source root HEAD does not equal requested commit ${normalizedRevision}`,
    );
  }

  const dirtyState = runGitInspection(
    root,
    label,
    'status',
    ['status', '--porcelain', '--untracked-files=all'],
    spawnSyncImpl,
  );
  if (dirtyState.trim()) {
    throw new Error(
      `${label} source root has tracked or untracked changes; benchmark only an exact clean commit`,
    );
  }
  return normalizedRevision;
}

function canonicalizeFuturePath(path: string): string {
  let existingAncestor = path;
  const missingSegments: string[] = [];
  while (!existsSync(existingAncestor)) {
    const parent = dirname(existingAncestor);
    if (parent === existingAncestor) return path;
    missingSegments.unshift(basename(existingAncestor));
    existingAncestor = parent;
  }
  return resolve(realpathSync(existingAncestor), ...missingSegments);
}

function isWithin(root: string, path: string): boolean {
  const pathFromRoot = relative(root, path);
  return (
    pathFromRoot === '' ||
    (pathFromRoot !== '..' && !pathFromRoot.startsWith(`..${sep}`) && !isAbsolute(pathFromRoot))
  );
}

export function buildReleasePerformancePairConfig(
  args: readonly string[],
  input: NodeJS.ProcessEnv = process.env,
  workingDirectory = process.cwd(),
  dependencies: ConfigurationDependencies = {},
): ReleasePerformancePairConfig {
  if (input.CI !== 'true' && input.SENTRIS_ALLOW_RELEASE_PERFORMANCE_PAIR !== 'true') {
    throw new Error(
      'The release performance pair is destructive; run in CI or set SENTRIS_ALLOW_RELEASE_PERFORMANCE_PAIR=true',
    );
  }
  if (
    input.SENTRIS_TRUST_PROFILE !== undefined &&
    input.SENTRIS_TRUST_PROFILE.trim() !== 'trusted-local'
  ) {
    throw new Error('The release performance pair must use the trusted-local trust profile');
  }

  const parsed = parseArguments(args);
  const baselineRoot = resolveSourceRoot(parsed.baselineRoot, workingDirectory, 'Baseline');
  const candidateRoot = resolveSourceRoot(parsed.candidateRoot, workingDirectory, 'Candidate');
  if (baselineRoot === candidateRoot) {
    throw new Error('Baseline and candidate must use different source roots');
  }
  const inspectSource = dependencies.verifySourceCheckout ?? verifySourceCheckout;
  const baselineRevision = inspectSource(
    baselineRoot,
    validateRevision(parsed.baselineRevision, 'Baseline'),
    'Baseline',
  );
  const candidateRevision = inspectSource(
    candidateRoot,
    validateRevision(parsed.candidateRevision, 'Candidate'),
    'Candidate',
  );
  if (baselineRevision === candidateRevision) {
    throw new Error('Baseline and candidate must identify different revisions');
  }

  const benchmarkScriptPath = join(candidateRoot, 'scripts', 'release-benchmark.ts');
  if (!existsSync(benchmarkScriptPath)) {
    throw new Error(
      'Candidate source root is missing the current scripts/release-benchmark.ts collector',
    );
  }

  const adminUsername = requireCredential(input, 'RELEASE_BENCHMARK_ADMIN_USERNAME');
  const adminPassword = requireCredential(input, 'RELEASE_BENCHMARK_ADMIN_PASSWORD');
  const internalToken =
    input.RELEASE_BENCHMARK_INTERNAL_TOKEN?.trim() ||
    input.E2E_INTERNAL_SERVICE_TOKEN?.trim() ||
    input.INTERNAL_SERVICE_TOKEN?.trim();
  if (!internalToken) {
    throw new Error(
      'RELEASE_BENCHMARK_INTERNAL_TOKEN, E2E_INTERNAL_SERVICE_TOKEN, or INTERNAL_SERVICE_TOKEN is required',
    );
  }

  const smokeEnvironment = smoke.resolveSmokeEnvironment({
    ...input,
    SENTRIS_TRUST_PROFILE: 'trusted-local',
    ADMIN_USERNAME: adminUsername,
    ADMIN_PASSWORD: adminPassword,
    INTERNAL_SERVICE_TOKEN: internalToken,
    E2E_INTERNAL_SERVICE_TOKEN: internalToken,
    SENTRIS_PUBLIC_API_BASE_URL: 'http://127.0.0.1',
    SENTRIS_SMOKE_NGINX_URL: 'http://127.0.0.1',
  });
  const instance = Number.parseInt(smokeEnvironment.SENTRIS_INSTANCE!, 10);
  const sampleCount = parseBoundedInteger(
    input.RELEASE_BENCHMARK_SAMPLE_COUNT,
    DEFAULT_SAMPLE_COUNT,
    'RELEASE_BENCHMARK_SAMPLE_COUNT',
    5,
    100,
  );
  const waitTimeoutSeconds = parseBoundedInteger(
    input.RELEASE_PERFORMANCE_WAIT_SECONDS,
    DEFAULT_WAIT_SECONDS,
    'RELEASE_PERFORMANCE_WAIT_SECONDS',
    1,
    1_800,
  );
  const benchmarkTimeoutSeconds = parseBoundedInteger(
    input.RELEASE_PERFORMANCE_BENCHMARK_TIMEOUT_SECONDS,
    DEFAULT_BENCHMARK_TIMEOUT_SECONDS,
    'RELEASE_PERFORMANCE_BENCHMARK_TIMEOUT_SECONDS',
    60,
    7_200,
  );
  const rawOutputDirectory =
    parsed.outputDirectory?.trim() || input.RELEASE_PERFORMANCE_OUTPUT_DIR?.trim();
  if (!rawOutputDirectory) {
    throw new Error(
      '--output-dir or RELEASE_PERFORMANCE_OUTPUT_DIR is required and must be outside both source roots',
    );
  }
  const outputDirectory = canonicalizeFuturePath(resolve(workingDirectory, rawOutputDirectory));
  if (existsSync(outputDirectory) && !statSync(outputDirectory).isDirectory()) {
    throw new Error('Release performance output path must be a directory');
  }
  if (isWithin(baselineRoot, outputDirectory) || isWithin(candidateRoot, outputDirectory)) {
    throw new Error('Release performance artifacts must be written outside both source roots');
  }
  const pairId = createHash('sha256')
    .update(
      JSON.stringify({
        instance,
        baselineRoot,
        baselineRevision,
        candidateRoot,
        candidateRevision,
      }),
    )
    .digest('hex')
    .slice(0, 12);

  return {
    instance,
    trustProfile: 'trusted-local',
    sampleCount,
    waitTimeoutSeconds,
    benchmarkTimeoutMs: benchmarkTimeoutSeconds * 1_000,
    outputDirectory,
    benchmarkScriptPath: realpathSync(benchmarkScriptPath),
    pairId,
    baseline: {
      label: 'baseline',
      root: baselineRoot,
      revision: baselineRevision,
      artifactPath: join(outputDirectory, 'baseline.json'),
    },
    candidate: {
      label: 'candidate',
      root: candidateRoot,
      revision: candidateRevision,
      artifactPath: join(outputDirectory, 'candidate.json'),
    },
    baseEnvironment: smokeEnvironment,
  };
}

export function buildPerformancePairLegPlan(
  config: ReleasePerformancePairConfig,
  source: PerformancePairSource,
): PerformancePairLegPlan {
  const composePrefix = ['compose', '-f', 'docker/docker-compose.full.yml'];
  const environment: NodeJS.ProcessEnv = {
    ...config.baseEnvironment,
    SENTRIS_INSTANCE: String(config.instance),
    SENTRIS_TRUST_PROFILE: 'trusted-local',
    SENTRIS_DEPLOYMENT_ID: `sentris-performance-pair-${config.pairId}`,
    SENTRIS_TAG: `performance-pair-${config.pairId}`,
    COMPOSE_PROJECT_NAME: `sentris-performance-${config.pairId}-${source.label}`,
    SENTRIS_PUBLIC_API_BASE_URL: 'http://127.0.0.1',
    SENTRIS_SMOKE_NGINX_URL: 'http://127.0.0.1',
    VITE_API_URL: '',
    RELEASE_BENCHMARK_API_BASE_URL: 'http://127.0.0.1/api/v1',
    RELEASE_BENCHMARK_FRONTEND_URL: 'http://127.0.0.1',
    RELEASE_BENCHMARK_SAMPLE_COUNT: String(config.sampleCount),
    RELEASE_BENCHMARK_REVISION: source.revision,
    RELEASE_BENCHMARK_OUTPUT: source.artifactPath,
    RELEASE_BENCHMARK_DESCRIPTION: `${source.label} source root ${source.root}; revision ${source.revision}`,
  };
  const cleanupArgs = [...composePrefix, 'down', '-v', '--remove-orphans'];

  return {
    environment,
    preclean: {
      name: `${source.label}-compose-preclean`,
      command: 'docker',
      args: cleanupArgs,
      timeoutMs: 300_000,
      cwd: source.root,
    },
    up: {
      name: `${source.label}-compose-up`,
      command: 'docker',
      args: [
        ...composePrefix,
        'up',
        '-d',
        '--build',
        '--wait',
        '--wait-timeout',
        String(config.waitTimeoutSeconds),
      ],
      timeoutMs: (config.waitTimeoutSeconds + 120) * 1_000,
      cwd: source.root,
    },
    benchmark: {
      name: `${source.label}-benchmark`,
      command: process.execPath,
      args: [config.benchmarkScriptPath],
      timeoutMs: config.benchmarkTimeoutMs,
      cwd: config.candidate.root,
    },
    down: {
      name: `${source.label}-compose-down`,
      command: 'docker',
      args: cleanupArgs,
      timeoutMs: 300_000,
      cwd: source.root,
    },
  };
}

function isCleanupUnsafeError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'cleanupUnsafe' in error &&
    error.cleanupUnsafe === true
  );
}

function readPerformanceArtifact(path: string): PerformanceArtifact {
  return JSON.parse(readFileSync(path, 'utf8')) as PerformanceArtifact;
}

function validateCollectedArtifact(
  artifact: PerformanceArtifact,
  config: ReleasePerformancePairConfig,
  source: PerformancePairSource,
): void {
  validatePerformanceArtifact(artifact);
  if (artifact.revision !== source.revision) {
    throw new Error(
      `${source.label} artifact does not identify the exact requested revision ${source.revision}`,
    );
  }
  if (artifact.environment.instance !== config.instance) {
    throw new Error(
      `${source.label} artifact does not identify SENTRIS_INSTANCE ${config.instance}`,
    );
  }
  if (artifact.environment.trustProfile !== 'trusted-local') {
    throw new Error(`${source.label} artifact does not identify the trusted-local profile`);
  }
  const expectedDescription = `${source.label} source root ${source.root}; revision ${source.revision}`;
  if (artifact.environment.description !== expectedDescription) {
    throw new Error(`${source.label} artifact does not identify the exact requested source root`);
  }
  for (const metric of REQUIRED_RELEASE_METRICS) {
    if (artifact.metrics[metric]!.sampleCount !== config.sampleCount) {
      throw new Error(
        `${source.label} artifact metric ${metric} did not use requested sample count ${config.sampleCount}`,
      );
    }
  }
}

async function executeLeg(
  plan: PerformancePairLegPlan,
  config: ReleasePerformancePairConfig,
  source: PerformancePairSource,
  dependencies: Required<ExecutionDependencies>,
): Promise<PerformanceArtifact> {
  await dependencies.runStep(plan.preclean, plan.environment);

  let primaryError: unknown;
  let upAttempted = false;
  try {
    upAttempted = true;
    await dependencies.runStep(plan.up, plan.environment);
    await dependencies.runStep(plan.benchmark, plan.environment);
  } catch (error) {
    primaryError = error;
  }

  if (primaryError !== undefined && isCleanupUnsafeError(primaryError)) {
    throw primaryError;
  }

  if (upAttempted) {
    try {
      await dependencies.runStep(plan.down, plan.environment);
    } catch (cleanupError) {
      if (primaryError !== undefined) {
        throw new AggregateError(
          [primaryError, cleanupError],
          `${source.label} benchmark failed and its Compose cleanup also failed`,
        );
      }
      throw cleanupError;
    }
  }

  if (primaryError !== undefined) throw primaryError;
  const artifact = dependencies.readArtifact(source.artifactPath);
  validateCollectedArtifact(artifact, config, source);
  return artifact;
}

export async function executeReleasePerformancePair(
  config: ReleasePerformancePairConfig,
  inputDependencies: ExecutionDependencies = {},
): Promise<ReleasePerformancePairResult> {
  const dependencies: Required<ExecutionDependencies> = {
    runStep: inputDependencies.runStep ?? smoke.runCommand,
    readArtifact: inputDependencies.readArtifact ?? readPerformanceArtifact,
    log: inputDependencies.log ?? console.log,
  };
  for (const source of [config.baseline, config.candidate]) {
    if (existsSync(source.artifactPath)) {
      throw new Error(
        `Performance artifact path already exists; choose an empty --output-dir: ${source.artifactPath}`,
      );
    }
  }
  mkdirSync(config.outputDirectory, { recursive: true });

  dependencies.log(
    `[release-performance-pair] baseline ${config.baseline.revision} from ${config.baseline.root}`,
  );
  const baseline = await executeLeg(
    buildPerformancePairLegPlan(config, config.baseline),
    config,
    config.baseline,
    dependencies,
  );

  dependencies.log(
    `[release-performance-pair] candidate ${config.candidate.revision} from ${config.candidate.root}`,
  );
  const candidate = await executeLeg(
    buildPerformancePairLegPlan(config, config.candidate),
    config,
    config.candidate,
    dependencies,
  );

  const comparisons = comparePerformanceArtifacts(baseline, candidate, PERFORMANCE_BUDGET_PERCENT);
  for (const comparison of comparisons) {
    dependencies.log(
      `[release-performance-pair] ${comparison.metric}: ${comparison.regressionPercent.toFixed(
        2,
      )}% regression (${comparison.passed ? 'PASS' : 'FAIL'})`,
    );
  }
  const failed = comparisons.filter(({ passed }) => !passed);
  if (failed.length > 0) {
    throw new Error(
      `Performance budget exceeded: ${failed
        .map(
          ({ metric, regressionPercent }) =>
            `${metric} (${regressionPercent.toFixed(2)}% > ${PERFORMANCE_BUDGET_PERCENT.toFixed(
              2,
            )}%)`,
        )
        .join(', ')}`,
    );
  }
  dependencies.log(
    `[release-performance-pair] all ${comparisons.length} metrics passed the fixed ${PERFORMANCE_BUDGET_PERCENT}% budget`,
  );
  return { baseline, candidate, comparisons };
}

async function main(): Promise<void> {
  await executeReleasePerformancePair(
    buildReleasePerformancePairConfig(process.argv.slice(2), process.env),
  );
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}

export { PERFORMANCE_BUDGET_PERCENT };
