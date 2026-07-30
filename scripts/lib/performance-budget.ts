export const REQUIRED_RELEASE_METRICS = [
  'api.request.median_ms',
  'api.request.p95_ms',
  'workflow.duration.median_ms',
  'workflow.duration.p95_ms',
  'workflow.throughput_per_minute',
  'component.startup.median_ms',
  'component.startup.p95_ms',
  'frontend.journey.median_ms',
  'frontend.journey.p95_ms',
] as const;

export type MetricDirection = 'lower' | 'higher';

export interface PerformanceMetric {
  value: number;
  unit: string;
  direction: MetricDirection;
  sampleCount: number;
}

export interface PerformanceArtifact {
  schemaVersion: 2;
  recordedAt: string;
  revision: string;
  environment: {
    instance: number;
    trustProfile: 'trusted-local' | 'hardened';
    hostFingerprint: string;
    description?: string;
  };
  metrics: Record<string, PerformanceMetric>;
}

export interface PerformanceComparison {
  metric: string;
  baseline: number;
  candidate: number;
  regressionPercent: number;
  budgetPercent: number;
  passed: boolean;
}

function assertFinitePositive(value: number, label: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${label} must be a finite number greater than zero`);
  }
}

export function validatePerformanceArtifact(
  artifact: PerformanceArtifact,
  requiredMetrics: readonly string[] = REQUIRED_RELEASE_METRICS,
): void {
  if (artifact.schemaVersion !== 2) {
    throw new Error(`Unsupported performance artifact schemaVersion ${artifact.schemaVersion}`);
  }
  if (!Number.isInteger(artifact.environment.instance) || artifact.environment.instance < 0) {
    throw new Error('Performance artifact must identify an explicit non-negative instance');
  }
  if (!artifact.revision.trim()) {
    throw new Error('Performance artifact revision is required');
  }
  if (!/^sha256:[a-f0-9]{64}$/.test(artifact.environment.hostFingerprint)) {
    throw new Error('Performance artifact hostFingerprint must be a SHA-256 fingerprint');
  }
  if (
    artifact.environment.trustProfile !== 'trusted-local' &&
    artifact.environment.trustProfile !== 'hardened'
  ) {
    throw new Error('Performance artifact trustProfile must be trusted-local or hardened');
  }
  if (Number.isNaN(Date.parse(artifact.recordedAt))) {
    throw new Error('Performance artifact recordedAt must be an ISO timestamp');
  }

  for (const metricName of requiredMetrics) {
    const metric = artifact.metrics[metricName];
    if (!metric) {
      throw new Error(`Performance artifact is missing required metric ${metricName}`);
    }
    assertFinitePositive(metric.value, `${metricName}.value`);
    if (!Number.isInteger(metric.sampleCount) || metric.sampleCount < 5) {
      throw new Error(`${metricName}.sampleCount must be at least 5`);
    }
    if (metric.direction !== 'lower' && metric.direction !== 'higher') {
      throw new Error(`${metricName}.direction must be lower or higher`);
    }
    if (!metric.unit.trim()) {
      throw new Error(`${metricName}.unit is required`);
    }
  }
}

export function comparePerformanceArtifacts(
  baseline: PerformanceArtifact,
  candidate: PerformanceArtifact,
  budgetPercent = 10,
  requiredMetrics: readonly string[] = REQUIRED_RELEASE_METRICS,
): PerformanceComparison[] {
  assertFinitePositive(budgetPercent, 'Performance budget');
  validatePerformanceArtifact(baseline, requiredMetrics);
  validatePerformanceArtifact(candidate, requiredMetrics);
  if (baseline === candidate || JSON.stringify(baseline) === JSON.stringify(candidate)) {
    throw new Error('Baseline and candidate resolve to the same benchmark artifact');
  }
  if (baseline.environment.instance !== candidate.environment.instance) {
    throw new Error('Baseline and candidate must target the same SENTRIS_INSTANCE');
  }
  if (baseline.environment.trustProfile !== candidate.environment.trustProfile) {
    throw new Error('Baseline and candidate must use the same trust profile');
  }
  if (baseline.environment.hostFingerprint !== candidate.environment.hostFingerprint) {
    throw new Error('Baseline and candidate must use the same benchmark host');
  }
  if (baseline.revision === candidate.revision) {
    throw new Error('Baseline and candidate must identify different revisions');
  }
  if (Date.parse(candidate.recordedAt) <= Date.parse(baseline.recordedAt)) {
    throw new Error('Candidate benchmark must be recorded after the baseline');
  }

  return requiredMetrics.map((metricName) => {
    const baselineMetric = baseline.metrics[metricName]!;
    const candidateMetric = candidate.metrics[metricName]!;
    if (baselineMetric.direction !== candidateMetric.direction) {
      throw new Error(`${metricName} direction differs between baseline and candidate`);
    }
    if (baselineMetric.unit !== candidateMetric.unit) {
      throw new Error(`${metricName} unit differs between baseline and candidate`);
    }
    if (baselineMetric.sampleCount !== candidateMetric.sampleCount) {
      throw new Error(`${metricName} sampleCount differs between baseline and candidate`);
    }

    const regressionPercent =
      baselineMetric.direction === 'lower'
        ? ((candidateMetric.value - baselineMetric.value) / baselineMetric.value) * 100
        : ((baselineMetric.value - candidateMetric.value) / baselineMetric.value) * 100;

    return {
      metric: metricName,
      baseline: baselineMetric.value,
      candidate: candidateMetric.value,
      regressionPercent,
      budgetPercent,
      passed: regressionPercent <= budgetPercent,
    };
  });
}
