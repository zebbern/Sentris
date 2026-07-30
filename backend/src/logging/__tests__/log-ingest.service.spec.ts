import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';

import { LogIngestService } from '../log-ingest.service';
import type { LogStreamRepository } from '../../trace/log-stream.repository';
import type { ConfigService } from '@nestjs/config';
import type { OutboxRepository } from '../../outbox/outbox.repository';

function createMockConfigService(): ConfigService {
  return {
    get: (key: string) => {
      if (key === 'kafka') {
        return {
          brokers: process.env.LOG_KAFKA_BROKERS ?? '',
          instanceId: undefined,
          logGroupId: undefined,
          logClientId: undefined,
          logTopic: 'telemetry.logs',
          eventTopic: 'telemetry.events',
          agentTraceTopic: 'telemetry.agent-trace',
          nodeIoTopic: 'telemetry.node-io',
        };
      }
      if (key === 'loki') {
        return {
          url: process.env.LOKI_URL,
          tenantId: undefined,
          username: undefined,
          password: undefined,
        };
      }
      return undefined;
    },
  } as unknown as ConfigService;
}

describe('LogIngestService', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.LOG_KAFKA_BROKERS = 'localhost:9092';
    process.env.LOKI_URL = 'http://localhost:3100';
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('redacts sensitive data before pushing to Loki', async () => {
    const repository = {
      upsertMetadataWithExecutor: mock(async () => undefined),
    } as unknown as LogStreamRepository;

    const outbox = {
      hasKafkaMessageReceipt: mock(async () => false),
      recordKafkaPoisonMessage: mock(async () => undefined),
      runKafkaMessageOnce: mock(
        async (
          _identity: unknown,
          _organizationId: unknown,
          project: (executor: unknown) => Promise<void>,
        ) => {
          await project({});
          return true;
        },
      ),
    } as unknown as OutboxRepository;
    const service = new LogIngestService(repository, createMockConfigService(), outbox);
    const push = mock(async () => undefined);
    (service as any).lokiClient = { push };

    await (service as any).processEntry(
      {
        runId: 'run-1',
        nodeRef: 'node-1',
        stream: 'stdout',
        message: 'token=abc123 authorization=Bearer super-secret',
        timestamp: '2026-02-21T00:00:00.000Z',
        organizationId: 'org-1',
      },
      { topic: 'telemetry.logs', partition: 0, offset: '3' },
    );

    expect(push).toHaveBeenCalledTimes(1);
    const call = push.mock.calls[0] as unknown[] | undefined;
    expect(call).toBeTruthy();
    const lines = (call?.[1] ?? []) as { message: string }[];
    expect(lines).toHaveLength(1);
    expect(lines[0]?.message).toContain('token=[REDACTED]');
    expect(lines[0]?.message).toContain('authorization=[REDACTED]');
    expect(lines[0]?.message).not.toContain('abc123');
    expect(lines[0]?.message).not.toContain('super-secret');
  });

  it('propagates Loki failures so Kafka retries without recording a receipt', async () => {
    const repository = {
      upsertMetadataWithExecutor: mock(async () => undefined),
    } as unknown as LogStreamRepository;
    const outbox = {
      hasKafkaMessageReceipt: mock(async () => false),
      recordKafkaPoisonMessage: mock(async () => undefined),
      runKafkaMessageOnce: mock(async () => true),
    };
    const service = new LogIngestService(
      repository,
      createMockConfigService(),
      outbox as unknown as OutboxRepository,
    );
    (service as any).lokiClient = {
      push: mock(async () => {
        throw new Error('loki unavailable');
      }),
    };

    await expect(
      (service as any).processKafkaMessage(
        Buffer.from(
          JSON.stringify({
            runId: 'run-1',
            nodeRef: 'node-1',
            stream: 'stdout',
            message: 'hello',
            timestamp: '2026-02-21T00:00:00.000Z',
          }),
        ),
        { topic: 'telemetry.logs', partition: 0, offset: '4' },
        '2026-02-21T00:00:00.000Z',
      ),
    ).rejects.toThrow('loki unavailable');
    expect(outbox.runKafkaMessageOnce).not.toHaveBeenCalled();
  });

  it('records an empty required-topic payload as poison with its exact Kafka identity', async () => {
    const outbox = {
      recordKafkaPoisonMessage: mock(async () => undefined),
    };
    const service = new LogIngestService(
      {} as LogStreamRepository,
      createMockConfigService(),
      outbox as unknown as OutboxRepository,
    );
    const identity = { topic: 'custom.logs.instance-9', partition: 1, offset: '105' };

    await expect(
      (service as any).processKafkaMessage(null, identity, '1785153600000'),
    ).resolves.toBeUndefined();

    expect(outbox.recordKafkaPoisonMessage).toHaveBeenCalledWith(
      identity,
      Buffer.alloc(0),
      expect.objectContaining({ message: 'Kafka message payload is empty' }),
      null,
    );
  });

  it('skips an already receipted log without pushing it to Loki again', async () => {
    const repository = {
      upsertMetadataWithExecutor: mock(async () => undefined),
    } as unknown as LogStreamRepository;
    const outbox = {
      hasKafkaMessageReceipt: mock(async () => true),
      recordKafkaPoisonMessage: mock(async () => undefined),
      runKafkaMessageOnce: mock(async () => false),
    };
    const service = new LogIngestService(
      repository,
      createMockConfigService(),
      outbox as unknown as OutboxRepository,
    );
    const push = mock(async () => undefined);
    (service as any).lokiClient = { push };

    await (service as any).processEntry(
      {
        runId: 'run-1',
        nodeRef: 'node-1',
        stream: 'stdout',
        message: 'hello',
        timestamp: '2026-02-21T00:00:00.000Z',
      },
      { topic: 'telemetry.logs', partition: 0, offset: '5' },
    );

    expect(push).not.toHaveBeenCalled();
    expect(repository.upsertMetadataWithExecutor).not.toHaveBeenCalled();
  });

  it('retries an ambiguous Loki success with the exact same deduplicable entry', async () => {
    let metadataAttempts = 0;
    const repository = {
      upsertMetadataWithExecutor: mock(async () => {
        metadataAttempts += 1;
        if (metadataAttempts === 1) {
          throw new Error('postgres unavailable after Loki accepted the entry');
        }
      }),
    } as unknown as LogStreamRepository;
    const outbox = {
      hasKafkaMessageReceipt: mock(async () => false),
      recordKafkaPoisonMessage: mock(async () => undefined),
      runKafkaMessageOnce: mock(
        async (
          _identity: unknown,
          _organizationId: unknown,
          project: (executor: unknown) => Promise<void>,
        ) => {
          await project({});
          return true;
        },
      ),
    };
    const service = new LogIngestService(
      repository,
      createMockConfigService(),
      outbox as unknown as OutboxRepository,
    );
    const push = mock(async () => undefined);
    (service as any).lokiClient = { push };
    const entry = {
      runId: 'run-1',
      nodeRef: 'node-1',
      stream: 'stdout',
      message: 'stable retry',
      timestamp: '2026-02-21T00:00:00.000Z',
    };
    const identity = { topic: 'telemetry.logs', partition: 0, offset: '6' };

    await expect((service as any).processEntry(entry, identity)).rejects.toThrow(
      'postgres unavailable',
    );
    await (service as any).processEntry(entry, identity);

    expect(push).toHaveBeenCalledTimes(2);
    expect(push.mock.calls[1]).toEqual(push.mock.calls[0]);
    expect(repository.upsertMetadataWithExecutor).toHaveBeenCalledTimes(2);
  });

  it('projects one logical log event once when fallback replay arrives at a new offset', async () => {
    const acceptedEventIds = new Set<string>();
    const repository = {
      upsertMetadataWithExecutor: mock(async () => undefined),
    } as unknown as LogStreamRepository;
    const outbox = {
      hasKafkaMessageReceipt: mock(async () => false),
      hasKafkaEventReceipt: mock(async (eventId: string) => acceptedEventIds.has(eventId)),
      recordKafkaPoisonMessage: mock(async () => undefined),
      runKafkaEventOnce: mock(
        async (
          _identity: unknown,
          eventId: string,
          _organizationId: unknown,
          project: (executor: unknown) => Promise<void>,
        ) => {
          if (acceptedEventIds.has(eventId)) return false;
          acceptedEventIds.add(eventId);
          await project({});
          return true;
        },
      ),
    };
    const service = new LogIngestService(
      repository,
      createMockConfigService(),
      outbox as unknown as OutboxRepository,
    );
    const push = mock(async () => undefined);
    (service as any).lokiClient = { push };
    const entry = {
      eventId: 'log:event-1',
      runId: 'run-1',
      nodeRef: 'node-1',
      stream: 'stdout',
      message: 'stable replay',
      timestamp: '2026-02-21T00:00:00.000Z',
    };

    await (service as any).processEntry(entry, {
      topic: 'telemetry.logs',
      partition: 0,
      offset: '10',
    });
    await (service as any).processEntry(entry, {
      topic: 'telemetry.logs',
      partition: 0,
      offset: '11',
    });

    expect(push).toHaveBeenCalledTimes(1);
    expect(repository.upsertMetadataWithExecutor).toHaveBeenCalledTimes(1);
    expect(outbox.runKafkaEventOnce).toHaveBeenCalledTimes(1);
  });
});
