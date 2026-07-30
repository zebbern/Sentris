import { describe, expect, it, vi } from 'bun:test';
import { HealthCheckError } from '@nestjs/terminus';

import { KafkaIngestHealthRegistry } from '../../common/kafka-ingest-health.registry';
import { KafkaIngestHealthIndicator } from '../indicators/kafka-ingest.health-indicator';

function createRegistry(enabled: boolean): KafkaIngestHealthRegistry {
  const configService = {
    get: vi.fn((key: string) => {
      if (key === 'ingest') {
        return {
          enableIngestServices: enabled,
          skipIngestServices: !enabled,
          mcpSyncTemplatesOnStartup: false,
        };
      }
      return undefined;
    }),
  };
  return new KafkaIngestHealthRegistry(configService as any);
}

describe('KafkaIngestHealthIndicator', () => {
  it('does not require consumers when ingest services are disabled', async () => {
    const registry = createRegistry(false);
    const indicator = new KafkaIngestHealthIndicator(registry);

    const result = await indicator.isHealthy();

    expect(result.kafkaIngest.status).toBe('up');
    expect(result.kafkaIngest.consumers).toEqual({
      events: { required: false, state: 'disabled' },
      'agent-trace': { required: false, state: 'disabled' },
      'node-io': { required: false, state: 'disabled' },
      logs: { required: false, state: 'disabled' },
    });
  });

  it('keeps readiness down until every enabled consumer is running', async () => {
    const registry = createRegistry(true);
    const indicator = new KafkaIngestHealthIndicator(registry);

    await expect(indicator.isHealthy()).rejects.toBeInstanceOf(HealthCheckError);

    registry.markRunning('events');
    registry.markRunning('agent-trace');
    registry.markRunning('node-io');
    await expect(indicator.isHealthy()).rejects.toBeInstanceOf(HealthCheckError);

    registry.markRunning('logs');
    await expect(indicator.isHealthy()).resolves.toMatchObject({
      kafkaIngest: {
        status: 'up',
        consumers: {
          events: { required: true, state: 'running' },
          logs: { required: true, state: 'running' },
        },
      },
    });
  });

  it('reports a runtime consumer failure with the affected stream', async () => {
    const registry = createRegistry(true);
    for (const consumer of ['events', 'agent-trace', 'node-io', 'logs'] as const) {
      registry.markRunning(consumer);
    }
    registry.markFailed('node-io', new Error('broker connection closed'));
    const indicator = new KafkaIngestHealthIndicator(registry);

    try {
      await indicator.isHealthy();
      expect.unreachable('required consumer failure should fail readiness');
    } catch (error) {
      expect(error).toBeInstanceOf(HealthCheckError);
      expect((error as HealthCheckError).causes).toMatchObject({
        kafkaIngest: {
          status: 'down',
          consumers: {
            'node-io': {
              required: true,
              state: 'failed',
              error: 'broker connection closed',
            },
          },
        },
      });
    }
  });
});
