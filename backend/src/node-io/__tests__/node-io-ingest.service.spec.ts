import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';

import { NodeIOIngestService } from '../node-io-ingest.service';
import type { NodeIORepository } from '../node-io.repository';
import type { ConfigService } from '@nestjs/config';
import type { KafkaConfig } from '../../config';
import type { OutboxRepository } from '../../outbox/outbox.repository';

function createMockConfigService(): ConfigService {
  const kafkaConfig: KafkaConfig = {
    brokers: process.env.LOG_KAFKA_BROKERS ?? '',
    instanceId: process.env.SENTRIS_INSTANCE,
    nodeIoGroupId: process.env.NODE_IO_KAFKA_GROUP_ID,
    nodeIoClientId: process.env.NODE_IO_KAFKA_CLIENT_ID,
    eventGroupId: undefined,
    eventClientId: undefined,
    agentTraceGroupId: undefined,
    agentTraceClientId: undefined,
    logGroupId: undefined,
    logClientId: undefined,
    logTopic: 'telemetry.logs',
    eventTopic: 'telemetry.events',
    agentTraceTopic: 'telemetry.agent-trace',
    nodeIoTopic: 'telemetry.node-io',
  };
  return {
    get: (key: string) => {
      if (key === 'kafka') return kafkaConfig;
      return undefined;
    },
  } as unknown as ConfigService;
}

const ORIGINAL_ENV = { ...process.env };

function restoreEnv(): void {
  process.env = { ...ORIGINAL_ENV };
}

describe('NodeIOIngestService', () => {
  function createOutboxRepository() {
    const transactionExecutor = { name: 'node-io-ingest-transaction' };
    return {
      recordKafkaPoisonMessage: mock(async () => undefined),
      runKafkaEventOnce: mock(
        async (
          _identity: { topic: string; partition: number; offset: string },
          _eventId: string,
          _organizationId: string | null,
          project: (executor: unknown) => Promise<void>,
        ) => {
          await project(transactionExecutor);
          return true;
        },
      ),
      transactionExecutor,
    };
  }

  beforeEach(() => {
    restoreEnv();
    process.env.LOG_KAFKA_BROKERS = 'localhost:19092';
    delete process.env.SENTRIS_INSTANCE;
    delete process.env.NODE_IO_KAFKA_GROUP_ID;
    delete process.env.NODE_IO_KAFKA_CLIENT_ID;
  });

  afterEach(() => {
    restoreEnv();
  });

  test('uses legacy defaults when SENTRIS_INSTANCE is unset', () => {
    const repository = {
      recordStart: async () => undefined,
      recordCompletion: async () => undefined,
    } as unknown as NodeIORepository;
    const service = new NodeIOIngestService(
      repository,
      createMockConfigService(),
      createOutboxRepository() as unknown as OutboxRepository,
    ) as unknown as {
      kafkaGroupId: string;
      kafkaClientId: string;
    };

    expect(service.kafkaGroupId).toBe('sentris-node-io-ingestor');
    expect(service.kafkaClientId).toBe('sentris-backend-node-io');
  });

  test('uses instance-scoped defaults when SENTRIS_INSTANCE is set', () => {
    process.env.SENTRIS_INSTANCE = '4';
    const repository = {
      recordStart: async () => undefined,
      recordCompletion: async () => undefined,
    } as unknown as NodeIORepository;
    const service = new NodeIOIngestService(
      repository,
      createMockConfigService(),
      createOutboxRepository() as unknown as OutboxRepository,
    ) as unknown as {
      kafkaGroupId: string;
      kafkaClientId: string;
    };

    expect(service.kafkaGroupId).toBe('sentris-node-io-ingestor-4');
    expect(service.kafkaClientId).toBe('sentris-backend-node-io-4');
  });

  test('prefers explicit env vars over defaults', () => {
    process.env.SENTRIS_INSTANCE = '9';
    process.env.NODE_IO_KAFKA_GROUP_ID = 'custom-node-io-group';
    process.env.NODE_IO_KAFKA_CLIENT_ID = 'custom-node-io-client';
    const repository = {
      recordStart: async () => undefined,
      recordCompletion: async () => undefined,
    } as unknown as NodeIORepository;
    const service = new NodeIOIngestService(
      repository,
      createMockConfigService(),
      createOutboxRepository() as unknown as OutboxRepository,
    ) as unknown as {
      kafkaGroupId: string;
      kafkaClientId: string;
    };

    expect(service.kafkaGroupId).toBe('custom-node-io-group');
    expect(service.kafkaClientId).toBe('custom-node-io-client');
  });

  test('propagates persistence failures so Kafka can retry without committing the offset', async () => {
    const repository = {
      recordStart: mock(async () => undefined),
      recordCompletionWithExecutor: mock(async () => {
        throw new Error('database unavailable');
      }),
    } as unknown as NodeIORepository;
    const service = new NodeIOIngestService(
      repository,
      createMockConfigService(),
      createOutboxRepository() as unknown as OutboxRepository,
    ) as unknown as {
      processKafkaMessage(
        value: Buffer,
        context: { topic: string; partition: number; offset: string },
      ): Promise<void>;
    };

    await expect(
      service.processKafkaMessage(
        Buffer.from(
          JSON.stringify({
            type: 'NODE_IO_COMPLETION',
            runId: 'run-1',
            nodeRef: 'scanner',
            componentId: 'sentris.subfinder.run',
            organizationId: 'org-1',
            outputs: { subdomains: ['a.example.com'] },
            status: 'completed',
            timestamp: '2026-07-26T12:00:00.000Z',
          }),
        ),
        { topic: 'telemetry.node-io', partition: 0, offset: '17' },
      ),
    ).rejects.toThrow('database unavailable');
  });

  test('records an empty required-topic payload as poison with its exact Kafka identity', async () => {
    const outbox = createOutboxRepository();
    const service = new NodeIOIngestService(
      {} as NodeIORepository,
      createMockConfigService(),
      outbox as unknown as OutboxRepository,
    );
    const identity = { topic: 'custom.node-io.instance-9', partition: 4, offset: '93' };

    await expect((service as any).processKafkaMessage(null, identity)).resolves.toBeUndefined();

    expect(outbox.recordKafkaPoisonMessage).toHaveBeenCalledWith(
      identity,
      Buffer.alloc(0),
      expect.objectContaining({ message: 'Kafka message payload is empty' }),
      null,
    );
  });

  test('persists the Kafka receipt, node completion, and asset projection in one transaction', async () => {
    const repository = {
      recordStartWithExecutor: mock(async () => undefined),
      recordCompletionWithExecutor: mock(async () => undefined),
    } as unknown as NodeIORepository;
    const outbox = createOutboxRepository();
    const service = new NodeIOIngestService(
      repository,
      createMockConfigService(),
      outbox as unknown as OutboxRepository,
    ) as unknown as {
      processKafkaMessage(
        value: Buffer,
        context: { topic: string; partition: number; offset: string },
      ): Promise<void>;
    };
    const identity = { topic: 'telemetry.node-io', partition: 2, offset: '19' };

    await service.processKafkaMessage(
      Buffer.from(
        JSON.stringify({
          type: 'NODE_IO_COMPLETION',
          eventId: 'node-io:run-atomic:scanner:completed',
          runId: 'run-atomic',
          nodeRef: 'scanner',
          componentId: 'sentris.subfinder.run',
          organizationId: 'org-1',
          outputs: { subdomains: ['a.example.com'] },
          status: 'completed',
          timestamp: '2026-07-26T12:00:00.000Z',
        }),
      ),
      identity,
    );

    expect(outbox.runKafkaEventOnce).toHaveBeenCalledWith(
      identity,
      'node-io:run-atomic:scanner:completed',
      'org-1',
      expect.any(Function),
    );
    expect(repository.recordCompletionWithExecutor).toHaveBeenCalledWith(
      outbox.transactionExecutor,
      expect.objectContaining({
        runId: 'run-atomic',
        nodeRef: 'scanner',
        completionEventId: 'node-io:run-atomic:scanner:completed',
        projectAssets: true,
      }),
    );
  });

  test('does not replay a node projection when its durable Kafka receipt already exists', async () => {
    const repository = {
      recordStartWithExecutor: mock(async () => undefined),
      recordCompletionWithExecutor: mock(async () => undefined),
    } as unknown as NodeIORepository;
    const outbox = createOutboxRepository();
    outbox.runKafkaEventOnce.mockImplementationOnce(async () => false);
    const service = new NodeIOIngestService(
      repository,
      createMockConfigService(),
      outbox as unknown as OutboxRepository,
    ) as unknown as {
      processKafkaMessage(
        value: Buffer,
        context: { topic: string; partition: number; offset: string },
      ): Promise<void>;
    };

    await service.processKafkaMessage(
      Buffer.from(
        JSON.stringify({
          type: 'NODE_IO_START',
          eventId: 'node-io:run-replayed:scanner:start',
          runId: 'run-replayed',
          nodeRef: 'scanner',
          componentId: 'sentris.subfinder.run',
          organizationId: 'org-1',
          inputs: { domain: 'example.com' },
          timestamp: '2026-07-26T12:00:00.000Z',
        }),
      ),
      { topic: 'telemetry.node-io', partition: 0, offset: '20' },
    );

    expect(repository.recordStartWithExecutor).not.toHaveBeenCalled();
    expect(repository.recordCompletionWithExecutor).not.toHaveBeenCalled();
  });

  test('acknowledges malformed poison messages without invoking the repository', async () => {
    const repository = {
      recordStart: mock(async () => undefined),
      recordCompletion: mock(async () => undefined),
    } as unknown as NodeIORepository;
    const outbox = createOutboxRepository();
    const service = new NodeIOIngestService(
      repository,
      createMockConfigService(),
      outbox as unknown as OutboxRepository,
    ) as unknown as {
      processKafkaMessage(
        value: Buffer,
        context: { topic: string; partition: number; offset: string },
      ): Promise<void>;
    };

    await expect(
      service.processKafkaMessage(Buffer.from('{not-json'), {
        topic: 'telemetry.node-io',
        partition: 0,
        offset: '18',
      }),
    ).resolves.toBeUndefined();
    expect(repository.recordStart).not.toHaveBeenCalled();
    expect(repository.recordCompletion).not.toHaveBeenCalled();
    expect(outbox.recordKafkaPoisonMessage).toHaveBeenCalledWith(
      { topic: 'telemetry.node-io', partition: 0, offset: '18' },
      expect.any(Buffer),
      expect.any(SyntaxError),
      null,
    );
  });
});
