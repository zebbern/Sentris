import { describe, expect, it } from 'bun:test';

import {
  comparePerformanceArtifacts,
  REQUIRED_RELEASE_METRICS,
  validatePerformanceArtifact,
  type PerformanceArtifact,
} from '../lib/performance-budget';
import { parsePerformanceBudgetArgs } from '../performance-budget';

function makeArtifact(
  valueOverrides: Record<string, number> = {},
  directionOverrides: Record<string, 'lower' | 'higher'> = {},
  metadataOverrides: Partial<Pick<PerformanceArtifact, 'recordedAt' | 'revision'>> & {
    hostFingerprint?: string;
  } = {},
): PerformanceArtifact {
  return {
    schemaVersion: 2,
    recordedAt: metadataOverrides.recordedAt ?? '2026-07-26T12:00:00.000Z',
    revision: metadataOverrides.revision ?? 'baseline-abc123',
    environment: {
      instance: 7,
      trustProfile: 'trusted-local',
      hostFingerprint:
        metadataOverrides.hostFingerprint ??
        'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    },
    metrics: Object.fromEntries(
      REQUIRED_RELEASE_METRICS.map((name) => [
        name,
        {
          value: valueOverrides[name] ?? 100,
          unit: name.includes('throughput') ? 'runs/minute' : 'ms',
          direction: directionOverrides[name] ?? (name.includes('throughput') ? 'higher' : 'lower'),
          sampleCount: 20,
        },
      ]),
    ),
  };
}

function makeCandidate(
  valueOverrides: Record<string, number> = {},
  directionOverrides: Record<string, 'lower' | 'higher'> = {},
): PerformanceArtifact {
  return makeArtifact(valueOverrides, directionOverrides, {
    revision: 'candidate-def456',
    recordedAt: '2026-07-26T13:00:00.000Z',
  });
}

describe('performance release budget', () => {
  it('accepts a candidate at the inclusive ten-percent boundary', () => {
    const baseline = makeArtifact();
    const candidateValues = Object.fromEntries(
      REQUIRED_RELEASE_METRICS.map((name) => [name, name.includes('throughput') ? 90 : 110]),
    );
    const results = comparePerformanceArtifacts(baseline, makeCandidate(candidateValues));

    expect(results).toHaveLength(REQUIRED_RELEASE_METRICS.length);
    expect(results.every((result) => result.passed)).toBe(true);
  });

  it('fails lower latency and higher throughput regressions over budget', () => {
    const results = comparePerformanceArtifacts(
      makeArtifact(),
      makeCandidate({
        'api.request.p95_ms': 111,
        'workflow.throughput_per_minute': 89,
      }),
    );

    expect(results.find((result) => result.metric === 'api.request.p95_ms')?.passed).toBe(false);
    expect(
      results.find((result) => result.metric === 'workflow.throughput_per_minute')?.passed,
    ).toBe(false);
  });

  it('rejects incomplete or under-sampled evidence', () => {
    const artifact = makeArtifact();
    delete artifact.metrics['frontend.journey.p95_ms'];
    expect(() => validatePerformanceArtifact(artifact)).toThrow('frontend.journey.p95_ms');

    const underSampled = makeArtifact();
    underSampled.metrics['api.request.median_ms']!.sampleCount = 1;
    expect(() => validatePerformanceArtifact(underSampled)).toThrow('sampleCount');
  });

  it('rejects incomparable environments, sample sizes, and duplicate artifacts', () => {
    const differentInstance = makeArtifact();
    differentInstance.environment.instance = 8;
    expect(() => comparePerformanceArtifacts(makeCandidate(), differentInstance)).toThrow(
      'same SENTRIS_INSTANCE',
    );

    const differentProfile = makeCandidate();
    differentProfile.environment.trustProfile = 'hardened';
    expect(() => comparePerformanceArtifacts(makeArtifact(), differentProfile)).toThrow(
      'same trust profile',
    );

    const differentSamples = makeCandidate();
    differentSamples.metrics['api.request.p95_ms']!.sampleCount = 21;
    expect(() => comparePerformanceArtifacts(makeArtifact(), differentSamples)).toThrow(
      'sampleCount differs',
    );

    const differentHost = makeCandidate();
    differentHost.environment.hostFingerprint =
      'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
    expect(() => comparePerformanceArtifacts(makeArtifact(), differentHost)).toThrow(
      'same benchmark host',
    );

    const sameRevision = makeCandidate();
    sameRevision.revision = 'baseline-abc123';
    expect(() => comparePerformanceArtifacts(makeArtifact(), sameRevision)).toThrow(
      'different revisions',
    );

    const earlierCandidate = makeCandidate();
    earlierCandidate.recordedAt = '2026-07-26T11:00:00.000Z';
    expect(() => comparePerformanceArtifacts(makeArtifact(), earlierCandidate)).toThrow(
      'recorded after the baseline',
    );
  });

  it('requires explicit baseline and candidate paths in the CLI', () => {
    expect(
      parsePerformanceBudgetArgs([
        '--baseline',
        'before.json',
        '--candidate',
        'after.json',
        '--budget',
        '7.5',
      ]),
    ).toEqual({
      baselinePath: 'before.json',
      candidatePath: 'after.json',
      budgetPercent: 7.5,
    });
    expect(() => parsePerformanceBudgetArgs(['--baseline', 'before.json'])).toThrow('Usage');
  });
});
