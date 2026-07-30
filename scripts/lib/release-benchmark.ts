import { createHash } from 'node:crypto';
import { arch, cpus, hostname, platform, release, totalmem } from 'node:os';

import {
  validatePerformanceArtifact,
  type PerformanceArtifact,
  type PerformanceMetric,
} from './performance-budget';

export interface ReleaseBenchmarkConfig {
  instance: number;
  apiBaseUrl: string;
  frontendUrl: string;
  trustProfile: 'trusted-local' | 'hardened';
  sampleCount: number;
  revision: string;
  outputPath: string;
  adminUsername: string;
  adminPassword: string;
  internalToken: string;
  runTimeoutMs: number;
  pollIntervalMs: number;
  description?: string;
  hostFingerprint: string;
}

export function buildReleaseBenchmarkConfig(
  env: Record<string, string | undefined>,
): ReleaseBenchmarkConfig {
  const rawInstance = env.SENTRIS_INSTANCE?.trim();
  if (!rawInstance) {
    throw new Error(
      'SENTRIS_INSTANCE is required; release benchmarks never infer an active instance',
    );
  }
  if (!/^[0-9]+$/.test(rawInstance)) {
    throw new Error('SENTRIS_INSTANCE must be an integer from 0 to 9');
  }
  const instance = Number.parseInt(rawInstance, 10);
  if (instance < 0 || instance > 9) {
    throw new Error('SENTRIS_INSTANCE must be an integer from 0 to 9');
  }

  const trustProfile = env.SENTRIS_TRUST_PROFILE?.trim();
  if (trustProfile !== 'trusted-local' && trustProfile !== 'hardened') {
    throw new Error('SENTRIS_TRUST_PROFILE must be explicitly set to trusted-local or hardened');
  }

  const sampleCount = parseBoundedInteger(
    env.RELEASE_BENCHMARK_SAMPLE_COUNT ?? '10',
    'RELEASE_BENCHMARK_SAMPLE_COUNT',
    5,
    100,
  );
  const runTimeoutMs = parseBoundedInteger(
    env.RELEASE_BENCHMARK_RUN_TIMEOUT_MS ?? '180000',
    'RELEASE_BENCHMARK_RUN_TIMEOUT_MS',
    1_000,
    900_000,
  );
  const pollIntervalMs = parseBoundedInteger(
    env.RELEASE_BENCHMARK_POLL_INTERVAL_MS ?? '100',
    'RELEASE_BENCHMARK_POLL_INTERVAL_MS',
    25,
    5_000,
  );

  const revision = requireEnv(env, 'RELEASE_BENCHMARK_REVISION');
  const adminUsername = requireEnv(env, 'RELEASE_BENCHMARK_ADMIN_USERNAME');
  const adminPassword = requireEnv(env, 'RELEASE_BENCHMARK_ADMIN_PASSWORD');
  const internalToken =
    env.RELEASE_BENCHMARK_INTERNAL_TOKEN?.trim() ||
    env.E2E_INTERNAL_SERVICE_TOKEN?.trim() ||
    env.INTERNAL_SERVICE_TOKEN?.trim();
  if (!internalToken) {
    throw new Error(
      'RELEASE_BENCHMARK_INTERNAL_TOKEN, E2E_INTERNAL_SERVICE_TOKEN, or INTERNAL_SERVICE_TOKEN is required',
    );
  }

  return {
    instance,
    apiBaseUrl: stripTrailingSlash(
      env.RELEASE_BENCHMARK_API_BASE_URL?.trim() ||
        `http://127.0.0.1:${3211 + instance * 100}/api/v1`,
    ),
    frontendUrl: stripTrailingSlash(
      env.RELEASE_BENCHMARK_FRONTEND_URL?.trim() || `http://127.0.0.1:${5173 + instance * 100}`,
    ),
    trustProfile,
    sampleCount,
    revision,
    outputPath:
      env.RELEASE_BENCHMARK_OUTPUT?.trim() ||
      `artifacts/performance/${revision}-instance-${instance}.json`,
    adminUsername,
    adminPassword,
    internalToken,
    runTimeoutMs,
    pollIntervalMs,
    description: env.RELEASE_BENCHMARK_DESCRIPTION?.trim() || undefined,
    hostFingerprint: buildReleaseBenchmarkHostFingerprint(env.RELEASE_BENCHMARK_HOST_ID),
  };
}

export function buildReleaseBenchmarkHostFingerprint(operatorHostId?: string): string {
  const descriptor = operatorHostId?.trim()
    ? `operator:${operatorHostId.trim()}`
    : JSON.stringify({
        platform: platform(),
        release: release(),
        arch: arch(),
        hostname: hostname(),
        cpuModel: cpus()[0]?.model ?? 'unknown',
        logicalCpuCount: cpus().length,
        totalMemoryBytes: totalmem(),
      });
  return `sha256:${createHash('sha256').update(descriptor).digest('hex')}`;
}

function requireEnv(env: Record<string, string | undefined>, name: string): string {
  const value = env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function parseBoundedInteger(
  rawValue: string,
  name: string,
  minimum: number,
  maximum: number,
): number {
  if (!/^[0-9]+$/.test(rawValue.trim())) {
    throw new Error(`${name} must be an integer from ${minimum} to ${maximum}`);
  }
  const value = Number.parseInt(rawValue, 10);
  if (value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer from ${minimum} to ${maximum}`);
  }
  return value;
}

function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

export function summarizeSamples(samples: number[]): {
  median: number;
  p95: number;
  sampleCount: number;
} {
  if (samples.length < 5) {
    throw new Error('A release benchmark requires at least 5 samples');
  }
  if (samples.some((sample) => !Number.isFinite(sample) || sample <= 0)) {
    throw new Error('Release benchmark samples must be finite numbers greater than zero');
  }

  const sorted = [...samples].sort((left, right) => left - right);
  const midpoint = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 0 ? (sorted[midpoint - 1]! + sorted[midpoint]!) / 2 : sorted[midpoint]!;
  const p95Index = Math.max(0, Math.ceil(sorted.length * 0.95) - 1);

  return {
    median: roundMetric(median),
    p95: roundMetric(sorted[p95Index]!),
    sampleCount: sorted.length,
  };
}

export function durationBetweenTraceEvents(
  events: Array<{ nodeId?: string; type?: string; timestamp?: string }>,
  nodeId: string,
): number {
  const started = events
    .filter((event) => event.nodeId === nodeId && event.type === 'STARTED')
    .map((event) => Date.parse(event.timestamp ?? ''))
    .filter(Number.isFinite);
  const completed = events
    .filter((event) => event.nodeId === nodeId && event.type === 'COMPLETED')
    .map((event) => Date.parse(event.timestamp ?? ''))
    .filter(Number.isFinite);

  if (started.length === 0 || completed.length === 0) {
    throw new Error(`Trace is missing STARTED or COMPLETED timestamps for node ${nodeId}`);
  }

  const durationMs = Math.max(...completed) - Math.min(...started);
  if (durationMs <= 0) {
    throw new Error(`Trace timestamps for node ${nodeId} do not form a positive duration`);
  }
  return durationMs;
}

interface BenchmarkWorkflowNode {
  id: string;
  type: string;
  position: { x: number; y: number };
  data: {
    label: string;
    config: {
      params: Record<string, unknown>;
      inputOverrides: Record<string, unknown>;
    };
  };
}

interface BenchmarkWorkflow {
  name: string;
  description: string;
  nodes: BenchmarkWorkflowNode[];
  edges: Array<{ id: string; source: string; target: string }>;
  viewport: { x: number; y: number; zoom: number };
}

function entryPointNode(): BenchmarkWorkflowNode {
  return {
    id: 'start',
    type: 'core.workflow.entrypoint',
    position: { x: 0, y: 0 },
    data: {
      label: 'Start',
      config: {
        params: { runtimeInputs: [] },
        inputOverrides: {},
      },
    },
  };
}

export function buildReleaseBenchmarkWorkflows(message: string): {
  inline: BenchmarkWorkflow;
  docker: BenchmarkWorkflow;
} {
  const suffix = message.replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 64) || 'run';
  const viewport = { x: 0, y: 0, zoom: 1 };

  return {
    inline: {
      name: `release-benchmark-inline-${suffix}`,
      description: 'Deterministic inline workflow used for release performance evidence',
      nodes: [
        entryPointNode(),
        {
          id: 'sleep',
          type: 'test.sleep.parallel',
          position: { x: 260, y: 0 },
          data: {
            label: 'Deterministic delay',
            config: {
              params: { delay: 50, label: suffix },
              inputOverrides: {},
            },
          },
        },
      ],
      edges: [{ id: 'start-sleep', source: 'start', target: 'sleep' }],
      viewport,
    },
    docker: {
      name: `release-benchmark-docker-${suffix}`,
      description: 'Deterministic Docker workflow used for release startup evidence',
      nodes: [
        entryPointNode(),
        {
          id: 'docker',
          type: 'test.docker.echo',
          position: { x: 260, y: 0 },
          data: {
            label: 'Docker echo',
            config: {
              params: {},
              inputOverrides: { message },
            },
          },
        },
      ],
      edges: [{ id: 'start-docker', source: 'start', target: 'docker' }],
      viewport,
    },
  };
}

interface BuildPerformanceArtifactInput {
  instance: number;
  trustProfile: 'trusted-local' | 'hardened';
  hostFingerprint: string;
  revision: string;
  recordedAt: string;
  apiRequestSamplesMs: number[];
  workflowDurationSamplesMs: number[];
  workflowThroughputPerMinute: number;
  workflowSampleCount: number;
  componentStartupSamplesMs: number[];
  frontendJourneySamplesMs: number[];
  description?: string;
}

function latencyMetrics(prefix: string, samples: number[]): Record<string, PerformanceMetric> {
  const summary = summarizeSamples(samples);
  const common = {
    unit: 'ms',
    direction: 'lower' as const,
    sampleCount: summary.sampleCount,
  };
  return {
    [`${prefix}.median_ms`]: { value: summary.median, ...common },
    [`${prefix}.p95_ms`]: { value: summary.p95, ...common },
  };
}

function roundMetric(value: number): number {
  return Math.round(value * 1_000) / 1_000;
}

export function buildPerformanceArtifact(
  input: BuildPerformanceArtifactInput,
): PerformanceArtifact {
  if (
    !Number.isFinite(input.workflowThroughputPerMinute) ||
    input.workflowThroughputPerMinute <= 0
  ) {
    throw new Error('Workflow throughput must be a finite number greater than zero');
  }
  if (!Number.isInteger(input.workflowSampleCount) || input.workflowSampleCount < 5) {
    throw new Error('Workflow throughput must be based on at least 5 workflow samples');
  }

  const artifact: PerformanceArtifact = {
    schemaVersion: 2,
    recordedAt: input.recordedAt,
    revision: input.revision,
    environment: {
      instance: input.instance,
      trustProfile: input.trustProfile,
      hostFingerprint: input.hostFingerprint,
      description: input.description,
    },
    metrics: {
      ...latencyMetrics('api.request', input.apiRequestSamplesMs),
      ...latencyMetrics('workflow.duration', input.workflowDurationSamplesMs),
      'workflow.throughput_per_minute': {
        value: roundMetric(input.workflowThroughputPerMinute),
        unit: 'runs/minute',
        direction: 'higher',
        sampleCount: input.workflowSampleCount,
      },
      ...latencyMetrics('component.startup', input.componentStartupSamplesMs),
      ...latencyMetrics('frontend.journey', input.frontendJourneySamplesMs),
    },
  };

  validatePerformanceArtifact(artifact);
  return artifact;
}
