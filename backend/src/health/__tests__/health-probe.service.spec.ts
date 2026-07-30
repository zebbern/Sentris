import { describe, expect, it, vi } from 'bun:test';

import { HealthProbeService } from '../health-probe.service';

describe('HealthProbeService', () => {
  it('includes required Kafka ingest consumers in backend readiness', async () => {
    const checks: (() => Promise<unknown>)[] = [];
    const health = {
      check: vi.fn(async (registeredChecks: (() => Promise<unknown>)[]) => {
        checks.push(...registeredChecks);
        return { status: 'ok', info: {}, error: {}, details: {} };
      }),
    };
    const postgres = { isHealthy: vi.fn(async () => ({ postgres: { status: 'up' } })) };
    const redis = { isHealthy: vi.fn(async () => ({ redis: { status: 'up' } })) };
    const temporal = { isHealthy: vi.fn(async () => ({ temporal: { status: 'up' } })) };
    const kafkaIngest = {
      isHealthy: vi.fn(async () => ({ kafkaIngest: { status: 'up' } })),
    };
    const probe = new HealthProbeService(
      health as any,
      postgres as any,
      redis as any,
      temporal as any,
      kafkaIngest as any,
    );

    await probe.readiness();
    await Promise.all(checks.map((check) => check()));

    expect(health.check).toHaveBeenCalledTimes(1);
    expect(checks).toHaveLength(4);
    expect(kafkaIngest.isHealthy).toHaveBeenCalledTimes(1);
  });
});
