import { afterEach, describe, expect, it } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { REQUIRED_RELEASE_METRICS, type PerformanceArtifact } from '../lib/performance-budget';

const temporaryRoots: string[] = [];
const BASELINE_REVISION = 'a'.repeat(40);
const CANDIDATE_REVISION = 'b'.repeat(40);
const OTHER_REVISION = 'c'.repeat(40);

type PairModule = typeof import('../release-performance-pair');

function buildTestConfig(
  pair: PairModule,
  args: readonly string[],
  environment = approvedEnvironment(),
  workingDirectory = resolve('.'),
) {
  return pair.buildReleasePerformancePairConfig(args, environment, workingDirectory, {
    verifySourceCheckout(_root, revision) {
      return revision;
    },
  });
}

function makeSourceRoot(name: string, includeBenchmark = false): string {
  const parent = mkdtempSync(join(tmpdir(), 'sentris-performance-pair-'));
  temporaryRoots.push(parent);
  const root = join(parent, name);
  mkdirSync(join(root, 'docker'), { recursive: true });
  writeFileSync(join(root, 'docker', 'docker-compose.full.yml'), 'services: {}\n');
  if (includeBenchmark) {
    mkdirSync(join(root, 'scripts'), { recursive: true });
    writeFileSync(join(root, 'scripts', 'release-benchmark.ts'), 'process.exit(0);\n');
  }
  return root;
}

function makeOutputDirectory(): string {
  const parent = mkdtempSync(join(tmpdir(), 'sentris-performance-artifacts-'));
  temporaryRoots.push(parent);
  return join(parent, 'pair');
}

function approvedEnvironment(): NodeJS.ProcessEnv {
  return {
    CI: 'true',
    SENTRIS_INSTANCE: '7',
    SENTRIS_TRUST_PROFILE: 'trusted-local',
    RELEASE_BENCHMARK_ADMIN_USERNAME: 'benchmark-admin',
    RELEASE_BENCHMARK_ADMIN_PASSWORD: 'password-must-not-print',
    RELEASE_BENCHMARK_INTERNAL_TOKEN: 'token-must-not-print',
    RELEASE_BENCHMARK_SAMPLE_COUNT: '8',
  };
}

function makeArtifact(
  revision: string,
  recordedAt: string,
  valueOverrides: Record<string, number> = {},
  hostFingerprint = 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  description?: string,
): PerformanceArtifact {
  return {
    schemaVersion: 2,
    recordedAt,
    revision,
    environment: {
      instance: 7,
      trustProfile: 'trusted-local',
      hostFingerprint,
      description,
    },
    metrics: Object.fromEntries(
      REQUIRED_RELEASE_METRICS.map((name) => [
        name,
        {
          value: valueOverrides[name] ?? 100,
          unit: name.includes('throughput') ? 'runs/minute' : 'ms',
          direction: name.includes('throughput') ? 'higher' : 'lower',
          sampleCount: 8,
        },
      ]),
    ),
  };
}

function sourceDescription(source: {
  label: 'baseline' | 'candidate';
  root: string;
  revision: string;
}): string {
  return `${source.label} source root ${source.root}; revision ${source.revision}`;
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    if (existsSync(root)) rmSync(root, { recursive: true, force: true });
  }
});

describe('release performance source verification', () => {
  it('proves the exact clean HEAD with bounded no-shell git commands', async () => {
    const pair = await import('../release-performance-pair');
    const calls: Array<{
      command: string;
      args: string[];
      options: Record<string, unknown>;
    }> = [];
    const results = [
      { status: 0, stdout: `${BASELINE_REVISION}\n`, stderr: '' },
      { status: 0, stdout: '', stderr: '' },
    ];

    pair.verifySourceCheckout(
      'C:\\source\\baseline',
      BASELINE_REVISION.toUpperCase(),
      'Baseline',
      (command, args, options) => {
        calls.push({ command, args, options });
        return results.shift()!;
      },
    );

    expect(calls).toEqual([
      {
        command: 'git',
        args: ['-C', 'C:\\source\\baseline', 'rev-parse', '--verify', 'HEAD'],
        options: {
          encoding: 'utf8',
          shell: false,
          timeout: 10_000,
          windowsHide: true,
        },
      },
      {
        command: 'git',
        args: ['-C', 'C:\\source\\baseline', 'status', '--porcelain', '--untracked-files=all'],
        options: {
          encoding: 'utf8',
          shell: false,
          timeout: 10_000,
          windowsHide: true,
        },
      },
    ]);
  });

  it('rejects a different HEAD or any tracked or untracked source change', async () => {
    const pair = await import('../release-performance-pair');

    expect(() =>
      pair.verifySourceCheckout('C:\\source\\baseline', BASELINE_REVISION, 'Baseline', () => ({
        status: 0,
        stdout: `${OTHER_REVISION}\n`,
        stderr: '',
      })),
    ).toThrow(`Baseline source root HEAD does not equal requested commit ${BASELINE_REVISION}`);

    const results = [
      { status: 0, stdout: `${BASELINE_REVISION}\n`, stderr: '' },
      { status: 0, stdout: '?? untracked-file.ts\n', stderr: '' },
    ];
    expect(() =>
      pair.verifySourceCheckout(
        'C:\\source\\baseline',
        BASELINE_REVISION,
        'Baseline',
        () => results.shift()!,
      ),
    ).toThrow('Baseline source root has tracked or untracked changes');
  });
});

describe('release performance pair configuration', () => {
  it('requires explicit distinct source roots and revisions for one trusted-local instance', async () => {
    const pair = await import('../release-performance-pair');
    const baselineRoot = makeSourceRoot('baseline');
    const candidateRoot = makeSourceRoot('candidate', true);
    const outputDirectory = makeOutputDirectory();

    const config = buildTestConfig(
      pair,
      [
        '--baseline-root',
        baselineRoot,
        '--baseline-revision',
        'baseline-abc123',
        '--candidate-root',
        candidateRoot,
        '--candidate-revision',
        'candidate-def456',
        '--output-dir',
        outputDirectory,
      ],
      approvedEnvironment(),
      resolve('.'),
    );

    expect(config).toMatchObject({
      instance: 7,
      trustProfile: 'trusted-local',
      sampleCount: 8,
      pairId: expect.stringMatching(/^[a-f0-9]{12}$/),
      baseline: {
        root: resolve(baselineRoot),
        revision: 'baseline-abc123',
      },
      candidate: {
        root: resolve(candidateRoot),
        revision: 'candidate-def456',
      },
      benchmarkScriptPath: resolve(candidateRoot, 'scripts/release-benchmark.ts'),
    });
    expect(config.baseline.artifactPath).not.toBe(config.candidate.artifactPath);
  });

  it('fails closed on implicit authority, instance, profile, or comparable source identity', async () => {
    const pair = await import('../release-performance-pair');
    const baselineRoot = makeSourceRoot('baseline');
    const candidateRoot = makeSourceRoot('candidate', true);
    const outputDirectory = makeOutputDirectory();
    const args = [
      '--baseline-root',
      baselineRoot,
      '--baseline-revision',
      'baseline-abc123',
      '--candidate-root',
      candidateRoot,
      '--candidate-revision',
      'candidate-def456',
      '--output-dir',
      outputDirectory,
    ];

    expect(() =>
      buildTestConfig(pair, args, {
        ...approvedEnvironment(),
        CI: undefined,
      }),
    ).toThrow('destructive');
    expect(() =>
      buildTestConfig(pair, args, {
        ...approvedEnvironment(),
        SENTRIS_INSTANCE: undefined,
      }),
    ).toThrow('SENTRIS_INSTANCE');
    expect(() =>
      buildTestConfig(pair, args, {
        ...approvedEnvironment(),
        SENTRIS_TRUST_PROFILE: 'hardened',
      }),
    ).toThrow('trusted-local');
    expect(() =>
      buildTestConfig(
        pair,
        [
          '--baseline-root',
          baselineRoot,
          '--baseline-revision',
          'same-revision',
          '--candidate-root',
          candidateRoot,
          '--candidate-revision',
          'same-revision',
          '--output-dir',
          outputDirectory,
        ],
        approvedEnvironment(),
      ),
    ).toThrow('different revisions');
    expect(() =>
      buildTestConfig(
        pair,
        [
          '--baseline-root',
          candidateRoot,
          '--baseline-revision',
          'baseline-abc123',
          '--candidate-root',
          candidateRoot,
          '--candidate-revision',
          'candidate-def456',
          '--output-dir',
          outputDirectory,
        ],
        approvedEnvironment(),
      ),
    ).toThrow('different source roots');
  });

  it('keeps benchmark artifacts outside both Docker build contexts', async () => {
    const pair = await import('../release-performance-pair');
    const baselineRoot = makeSourceRoot('baseline');
    const candidateRoot = makeSourceRoot('candidate', true);
    const sourceArgs = [
      '--baseline-root',
      baselineRoot,
      '--baseline-revision',
      'baseline-abc123',
      '--candidate-root',
      candidateRoot,
      '--candidate-revision',
      'candidate-def456',
    ];

    expect(() => buildTestConfig(pair, sourceArgs, approvedEnvironment())).toThrow('--output-dir');

    expect(() =>
      buildTestConfig(
        pair,
        [...sourceArgs, '--output-dir', join(candidateRoot, 'artifacts', 'performance')],
        approvedEnvironment(),
      ),
    ).toThrow('outside both source roots');

    const linkedTarget = join(candidateRoot, 'linked-artifacts');
    const externalLink = makeOutputDirectory();
    mkdirSync(linkedTarget, { recursive: true });
    symlinkSync(linkedTarget, externalLink, 'junction');
    expect(() =>
      buildTestConfig(pair, [...sourceArgs, '--output-dir', externalLink], approvedEnvironment()),
    ).toThrow('outside both source roots');
  });
});

describe('release performance pair command plan', () => {
  it('builds and measures both source roots with the candidate collector and nginx URLs', async () => {
    const pair = await import('../release-performance-pair');
    const baselineRoot = makeSourceRoot('baseline');
    const candidateRoot = makeSourceRoot('candidate', true);
    const outputDirectory = makeOutputDirectory();
    const config = buildTestConfig(
      pair,
      [
        '--baseline-root',
        baselineRoot,
        '--baseline-revision',
        'baseline-abc123',
        '--candidate-root',
        candidateRoot,
        '--candidate-revision',
        'candidate-def456',
        '--output-dir',
        outputDirectory,
      ],
      approvedEnvironment(),
    );

    const baseline = pair.buildPerformancePairLegPlan(config, config.baseline);
    const candidate = pair.buildPerformancePairLegPlan(config, config.candidate);

    expect(baseline.preclean).toEqual({
      name: 'baseline-compose-preclean',
      command: 'docker',
      args: ['compose', '-f', 'docker/docker-compose.full.yml', 'down', '-v', '--remove-orphans'],
      timeoutMs: 300_000,
      cwd: resolve(baselineRoot),
    });
    expect(baseline.up).toEqual({
      name: 'baseline-compose-up',
      command: 'docker',
      args: [
        'compose',
        '-f',
        'docker/docker-compose.full.yml',
        'up',
        '-d',
        '--build',
        '--wait',
        '--wait-timeout',
        '600',
      ],
      timeoutMs: 720_000,
      cwd: resolve(baselineRoot),
    });
    expect(baseline.down).toEqual({
      name: 'baseline-compose-down',
      command: 'docker',
      args: ['compose', '-f', 'docker/docker-compose.full.yml', 'down', '-v', '--remove-orphans'],
      timeoutMs: 300_000,
      cwd: resolve(baselineRoot),
    });
    expect(baseline.benchmark.args).toEqual([config.benchmarkScriptPath]);
    expect(candidate.benchmark.args).toEqual([config.benchmarkScriptPath]);
    expect(baseline.benchmark.cwd).toBe(resolve(candidateRoot));
    expect(candidate.benchmark.cwd).toBe(resolve(candidateRoot));
    expect(baseline.environment).toMatchObject({
      SENTRIS_INSTANCE: '7',
      SENTRIS_TRUST_PROFILE: 'trusted-local',
      RELEASE_BENCHMARK_API_BASE_URL: 'http://127.0.0.1/api/v1',
      RELEASE_BENCHMARK_FRONTEND_URL: 'http://127.0.0.1',
      RELEASE_BENCHMARK_SAMPLE_COUNT: '8',
      RELEASE_BENCHMARK_REVISION: 'baseline-abc123',
      RELEASE_BENCHMARK_OUTPUT: config.baseline.artifactPath,
    });
    expect(candidate.environment).toMatchObject({
      RELEASE_BENCHMARK_SAMPLE_COUNT: '8',
      RELEASE_BENCHMARK_REVISION: 'candidate-def456',
      RELEASE_BENCHMARK_OUTPUT: config.candidate.artifactPath,
    });
    expect(baseline.environment.COMPOSE_PROJECT_NAME).toBe(
      `sentris-performance-${config.pairId}-baseline`,
    );
    expect(candidate.environment.COMPOSE_PROJECT_NAME).toBe(
      `sentris-performance-${config.pairId}-candidate`,
    );
    const serializedCommands = JSON.stringify([
      baseline.preclean,
      baseline.up,
      baseline.benchmark,
      baseline.down,
      candidate.preclean,
      candidate.up,
      candidate.benchmark,
      candidate.down,
    ]);
    expect(serializedCommands).not.toContain('password-must-not-print');
    expect(serializedCommands).not.toContain('token-must-not-print');
  });
});

describe('release performance pair execution', () => {
  it('refuses pre-existing artifact paths instead of accepting stale evidence', async () => {
    const pair = await import('../release-performance-pair');
    const baselineRoot = makeSourceRoot('baseline');
    const candidateRoot = makeSourceRoot('candidate', true);
    const outputDirectory = makeOutputDirectory();
    const config = buildTestConfig(
      pair,
      [
        '--baseline-root',
        baselineRoot,
        '--baseline-revision',
        'baseline-abc123',
        '--candidate-root',
        candidateRoot,
        '--candidate-revision',
        'candidate-def456',
        '--output-dir',
        outputDirectory,
      ],
      approvedEnvironment(),
    );
    mkdirSync(outputDirectory, { recursive: true });
    writeFileSync(config.baseline.artifactPath, '{"stale":true}\n');
    const executed: string[] = [];

    await expect(
      pair.executeReleasePerformancePair(config, {
        async runStep(step) {
          executed.push(step.name);
        },
        log() {},
      }),
    ).rejects.toThrow('already exists');
    expect(executed).toEqual([]);
  });

  it('collects baseline then candidate only after each exact volume cleanup', async () => {
    const pair = await import('../release-performance-pair');
    const baselineRoot = makeSourceRoot('baseline');
    const candidateRoot = makeSourceRoot('candidate', true);
    const outputDirectory = makeOutputDirectory();
    const config = buildTestConfig(
      pair,
      [
        '--baseline-root',
        baselineRoot,
        '--baseline-revision',
        'baseline-abc123',
        '--candidate-root',
        candidateRoot,
        '--candidate-revision',
        'candidate-def456',
        '--output-dir',
        outputDirectory,
      ],
      approvedEnvironment(),
    );
    const executed: string[] = [];
    const logged: string[] = [];

    const result = await pair.executeReleasePerformancePair(config, {
      async runStep(step) {
        executed.push(step.name);
        if (step.name === 'baseline-benchmark') {
          writeFileSync(
            config.baseline.artifactPath,
            JSON.stringify(
              makeArtifact(
                'baseline-abc123',
                '2026-07-29T12:00:00.000Z',
                {},
                undefined,
                sourceDescription(config.baseline),
              ),
            ),
          );
        }
        if (step.name === 'candidate-benchmark') {
          writeFileSync(
            config.candidate.artifactPath,
            JSON.stringify(
              makeArtifact(
                'candidate-def456',
                '2026-07-29T12:01:00.000Z',
                {},
                undefined,
                sourceDescription(config.candidate),
              ),
            ),
          );
        }
      },
      log(message) {
        logged.push(message);
      },
    });

    expect(executed).toEqual([
      'baseline-compose-preclean',
      'baseline-compose-up',
      'baseline-benchmark',
      'baseline-compose-down',
      'candidate-compose-preclean',
      'candidate-compose-up',
      'candidate-benchmark',
      'candidate-compose-down',
    ]);
    expect(result.comparisons).toHaveLength(REQUIRED_RELEASE_METRICS.length);
    expect(result.comparisons.every(({ passed }) => passed)).toBe(true);
    expect(existsSync(config.baseline.artifactPath)).toBe(true);
    expect(existsSync(config.candidate.artifactPath)).toBe(true);
    expect(logged.join('\n')).not.toContain('password-must-not-print');
    expect(logged.join('\n')).not.toContain('token-must-not-print');
  });

  it('cleans a normally failed baseline and never advances to the candidate', async () => {
    const pair = await import('../release-performance-pair');
    const baselineRoot = makeSourceRoot('baseline');
    const candidateRoot = makeSourceRoot('candidate', true);
    const config = buildTestConfig(
      pair,
      [
        '--baseline-root',
        baselineRoot,
        '--baseline-revision',
        'baseline-abc123',
        '--candidate-root',
        candidateRoot,
        '--candidate-revision',
        'candidate-def456',
        '--output-dir',
        makeOutputDirectory(),
      ],
      approvedEnvironment(),
    );
    const executed: string[] = [];

    await expect(
      pair.executeReleasePerformancePair(config, {
        async runStep(step) {
          executed.push(step.name);
          if (step.name === 'baseline-benchmark') {
            throw new Error('injected benchmark failure');
          }
        },
        log() {},
      }),
    ).rejects.toThrow('injected benchmark failure');
    expect(executed).toEqual([
      'baseline-compose-preclean',
      'baseline-compose-up',
      'baseline-benchmark',
      'baseline-compose-down',
    ]);
  });

  it('suppresses cleanup and follow-on work when process-tree settlement is unsafe', async () => {
    const pair = await import('../release-performance-pair');
    const baselineRoot = makeSourceRoot('baseline');
    const candidateRoot = makeSourceRoot('candidate', true);
    const config = buildTestConfig(
      pair,
      [
        '--baseline-root',
        baselineRoot,
        '--baseline-revision',
        'baseline-abc123',
        '--candidate-root',
        candidateRoot,
        '--candidate-revision',
        'candidate-def456',
        '--output-dir',
        makeOutputDirectory(),
      ],
      approvedEnvironment(),
    );
    const executed: string[] = [];
    const unsafe = Object.assign(new Error('unsettled process tree'), { cleanupUnsafe: true });

    await expect(
      pair.executeReleasePerformancePair(config, {
        async runStep(step) {
          executed.push(step.name);
          if (step.name === 'baseline-compose-up') throw unsafe;
        },
        log() {},
      }),
    ).rejects.toThrow('unsettled process tree');
    expect(executed).toEqual(['baseline-compose-preclean', 'baseline-compose-up']);
  });

  it('hard-fails an eleven-percent regression only after retaining both artifacts', async () => {
    const pair = await import('../release-performance-pair');
    const baselineRoot = makeSourceRoot('baseline');
    const candidateRoot = makeSourceRoot('candidate', true);
    const config = buildTestConfig(
      pair,
      [
        '--baseline-root',
        baselineRoot,
        '--baseline-revision',
        'baseline-abc123',
        '--candidate-root',
        candidateRoot,
        '--candidate-revision',
        'candidate-def456',
        '--output-dir',
        makeOutputDirectory(),
      ],
      approvedEnvironment(),
    );
    const executed: string[] = [];

    await expect(
      pair.executeReleasePerformancePair(config, {
        async runStep(step) {
          executed.push(step.name);
          if (step.name === 'baseline-benchmark') {
            writeFileSync(
              config.baseline.artifactPath,
              JSON.stringify(
                makeArtifact(
                  'baseline-abc123',
                  '2026-07-29T12:00:00.000Z',
                  {},
                  undefined,
                  sourceDescription(config.baseline),
                ),
              ),
            );
          }
          if (step.name === 'candidate-benchmark') {
            writeFileSync(
              config.candidate.artifactPath,
              JSON.stringify(
                makeArtifact(
                  'candidate-def456',
                  '2026-07-29T12:01:00.000Z',
                  {
                    'api.request.p95_ms': 111,
                  },
                  undefined,
                  sourceDescription(config.candidate),
                ),
              ),
            );
          }
        },
        log() {},
      }),
    ).rejects.toThrow('Performance budget exceeded');

    expect(executed.slice(-2)).toEqual(['candidate-benchmark', 'candidate-compose-down']);
    expect(existsSync(config.baseline.artifactPath)).toBe(true);
    expect(existsSync(config.candidate.artifactPath)).toBe(true);
    expect(pair.PERFORMANCE_BUDGET_PERCENT).toBe(10);
  });

  it('rejects an artifact that does not identify the exact requested source before advancing', async () => {
    const pair = await import('../release-performance-pair');
    const baselineRoot = makeSourceRoot('baseline');
    const candidateRoot = makeSourceRoot('candidate', true);
    const config = buildTestConfig(
      pair,
      [
        '--baseline-root',
        baselineRoot,
        '--baseline-revision',
        'baseline-abc123',
        '--candidate-root',
        candidateRoot,
        '--candidate-revision',
        'candidate-def456',
        '--output-dir',
        makeOutputDirectory(),
      ],
      approvedEnvironment(),
    );
    const executed: string[] = [];

    await expect(
      pair.executeReleasePerformancePair(config, {
        async runStep(step) {
          executed.push(step.name);
          if (step.name === 'baseline-benchmark') {
            writeFileSync(
              config.baseline.artifactPath,
              JSON.stringify(
                makeArtifact(
                  'unrequested-revision',
                  '2026-07-29T12:00:00.000Z',
                  {},
                  undefined,
                  'a different source',
                ),
              ),
            );
          }
        },
        log() {},
      }),
    ).rejects.toThrow('exact requested revision');

    expect(executed).toEqual([
      'baseline-compose-preclean',
      'baseline-compose-up',
      'baseline-benchmark',
      'baseline-compose-down',
    ]);
  });

  it('rejects a collector artifact that did not use the requested shared sample count', async () => {
    const pair = await import('../release-performance-pair');
    const baselineRoot = makeSourceRoot('baseline');
    const candidateRoot = makeSourceRoot('candidate', true);
    const config = buildTestConfig(
      pair,
      [
        '--baseline-root',
        baselineRoot,
        '--baseline-revision',
        'baseline-abc123',
        '--candidate-root',
        candidateRoot,
        '--candidate-revision',
        'candidate-def456',
        '--output-dir',
        makeOutputDirectory(),
      ],
      approvedEnvironment(),
    );
    const artifact = makeArtifact(
      'baseline-abc123',
      '2026-07-29T12:00:00.000Z',
      {},
      undefined,
      sourceDescription(config.baseline),
    );
    artifact.metrics['workflow.duration.p95_ms']!.sampleCount = 7;
    const executed: string[] = [];

    await expect(
      pair.executeReleasePerformancePair(config, {
        async runStep(step) {
          executed.push(step.name);
          if (step.name === 'baseline-benchmark') {
            writeFileSync(config.baseline.artifactPath, JSON.stringify(artifact));
          }
        },
        log() {},
      }),
    ).rejects.toThrow('requested sample count 8');
    expect(executed).toEqual([
      'baseline-compose-preclean',
      'baseline-compose-up',
      'baseline-benchmark',
      'baseline-compose-down',
    ]);
  });
});
