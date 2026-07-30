import { describe, expect, it } from 'bun:test';

import {
  buildPerformanceArtifact,
  buildReleaseBenchmarkConfig,
  buildReleaseBenchmarkWorkflows,
  durationBetweenTraceEvents,
  summarizeSamples,
} from '../lib/release-benchmark';

const root = new URL('../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

describe('release benchmark configuration', () => {
  it('rejects an implicit instance instead of falling back to instance zero', () => {
    expect(() =>
      buildReleaseBenchmarkConfig({
        RELEASE_BENCHMARK_ADMIN_USERNAME: 'admin',
        RELEASE_BENCHMARK_ADMIN_PASSWORD: 'benchmark-only',
      }),
    ).toThrow('SENTRIS_INSTANCE is required');
  });

  it('derives instance URLs and honors explicit release credentials', () => {
    const config = buildReleaseBenchmarkConfig({
      SENTRIS_INSTANCE: '3',
      SENTRIS_TRUST_PROFILE: 'trusted-local',
      RELEASE_BENCHMARK_ADMIN_USERNAME: 'operator',
      RELEASE_BENCHMARK_ADMIN_PASSWORD: 'benchmark-only',
      RELEASE_BENCHMARK_INTERNAL_TOKEN: 'scoped-token',
      RELEASE_BENCHMARK_SAMPLE_COUNT: '7',
      RELEASE_BENCHMARK_REVISION: 'candidate-abc',
      RELEASE_BENCHMARK_OUTPUT: 'artifacts/candidate.json',
    });

    expect(config).toMatchObject({
      instance: 3,
      apiBaseUrl: 'http://127.0.0.1:3511/api/v1',
      frontendUrl: 'http://127.0.0.1:5473',
      trustProfile: 'trusted-local',
      sampleCount: 7,
      revision: 'candidate-abc',
      outputPath: 'artifacts/candidate.json',
      adminUsername: 'operator',
      adminPassword: 'benchmark-only',
      internalToken: 'scoped-token',
    });
    expect(config.hostFingerprint).toMatch(/^sha256:[a-f0-9]{64}$/);
  });
});

describe('release benchmark CLI', () => {
  it('fails before contacting services when the instance is implicit', () => {
    const result = Bun.spawnSync([process.execPath, 'scripts/release-benchmark.ts'], {
      cwd: root,
      env: {
        PATH: process.env.PATH ?? '',
        SystemRoot: process.env.SystemRoot ?? '',
      },
      stdout: 'pipe',
      stderr: 'pipe',
    });

    expect(result.exitCode).toBe(1);
    expect(`${result.stdout.toString()}${result.stderr.toString()}`).toContain(
      'SENTRIS_INSTANCE is required',
    );
  });

  it('prints a secret-free dry-run target without contacting the selected instance', () => {
    const result = Bun.spawnSync([process.execPath, 'scripts/release-benchmark.ts', '--dry-run'], {
      cwd: root,
      env: {
        PATH: process.env.PATH ?? '',
        SystemRoot: process.env.SystemRoot ?? '',
        SENTRIS_INSTANCE: '4',
        SENTRIS_TRUST_PROFILE: 'trusted-local',
        RELEASE_BENCHMARK_ADMIN_USERNAME: 'operator',
        RELEASE_BENCHMARK_ADMIN_PASSWORD: 'password-must-not-print',
        RELEASE_BENCHMARK_INTERNAL_TOKEN: 'token-must-not-print',
        RELEASE_BENCHMARK_REVISION: 'candidate-abc',
        RELEASE_BENCHMARK_OUTPUT: 'artifacts/candidate.json',
      },
      stdout: 'pipe',
      stderr: 'pipe',
    });

    const output = `${result.stdout.toString()}${result.stderr.toString()}`;
    expect(result.exitCode).toBe(0);
    expect(output).toContain('"instance": 4');
    expect(output).toContain('"apiBaseUrl": "http://127.0.0.1:3611/api/v1"');
    expect(output).toContain('"frontendUrl": "http://127.0.0.1:5573"');
    expect(output).not.toContain('password-must-not-print');
    expect(output).not.toContain('token-must-not-print');
  });
});

describe('release benchmark measurements', () => {
  it('uses a stable nearest-rank p95 and arithmetic median', () => {
    expect(summarizeSamples([50, 10, 40, 20, 30])).toEqual({
      median: 30,
      p95: 50,
      sampleCount: 5,
    });
  });

  it('measures a named component from persisted trace timestamps', () => {
    expect(
      durationBetweenTraceEvents(
        [
          {
            nodeId: 'docker',
            type: 'STARTED',
            timestamp: '2026-07-26T12:00:00.100Z',
          },
          {
            nodeId: 'docker',
            type: 'COMPLETED',
            timestamp: '2026-07-26T12:00:00.425Z',
          },
        ],
        'docker',
      ),
    ).toBe(325);
  });

  it('builds deterministic zero-input inline and Docker benchmark workflows', () => {
    const workflows = buildReleaseBenchmarkWorkflows('benchmark-123');

    expect(workflows.inline.nodes.map((node) => node.type)).toEqual([
      'core.workflow.entrypoint',
      'test.sleep.parallel',
    ]);
    expect(workflows.inline.nodes[0]?.data.config.params).toEqual({ runtimeInputs: [] });
    expect(workflows.docker.nodes.map((node) => node.type)).toEqual([
      'core.workflow.entrypoint',
      'test.docker.echo',
    ]);
    expect(workflows.docker.nodes[1]?.data.config.inputOverrides).toEqual({
      message: 'benchmark-123',
    });
  });

  it('emits every required release metric with the correct direction and sample count', () => {
    const artifact = buildPerformanceArtifact({
      instance: 2,
      trustProfile: 'trusted-local',
      hostFingerprint:
        'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      revision: 'candidate-abc',
      recordedAt: '2026-07-26T12:00:00.000Z',
      apiRequestSamplesMs: [10, 20, 30, 40, 50],
      workflowDurationSamplesMs: [100, 110, 120, 130, 140],
      workflowThroughputPerMinute: 25,
      workflowSampleCount: 5,
      componentStartupSamplesMs: [200, 210, 220, 230, 240],
      frontendJourneySamplesMs: [300, 310, 320, 330, 340],
      description: 'controlled test',
    });

    expect(artifact.metrics).toEqual({
      'api.request.median_ms': {
        value: 30,
        unit: 'ms',
        direction: 'lower',
        sampleCount: 5,
      },
      'api.request.p95_ms': {
        value: 50,
        unit: 'ms',
        direction: 'lower',
        sampleCount: 5,
      },
      'workflow.duration.median_ms': {
        value: 120,
        unit: 'ms',
        direction: 'lower',
        sampleCount: 5,
      },
      'workflow.duration.p95_ms': {
        value: 140,
        unit: 'ms',
        direction: 'lower',
        sampleCount: 5,
      },
      'workflow.throughput_per_minute': {
        value: 25,
        unit: 'runs/minute',
        direction: 'higher',
        sampleCount: 5,
      },
      'component.startup.median_ms': {
        value: 220,
        unit: 'ms',
        direction: 'lower',
        sampleCount: 5,
      },
      'component.startup.p95_ms': {
        value: 240,
        unit: 'ms',
        direction: 'lower',
        sampleCount: 5,
      },
      'frontend.journey.median_ms': {
        value: 320,
        unit: 'ms',
        direction: 'lower',
        sampleCount: 5,
      },
      'frontend.journey.p95_ms': {
        value: 340,
        unit: 'ms',
        direction: 'lower',
        sampleCount: 5,
      },
    });
    expect(artifact).toMatchObject({
      schemaVersion: 2,
      environment: {
        instance: 2,
        trustProfile: 'trusted-local',
        hostFingerprint:
          'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      },
    });
  });
});
