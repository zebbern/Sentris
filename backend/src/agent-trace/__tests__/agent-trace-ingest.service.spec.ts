import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';

import { AgentTraceIngestService } from '../agent-trace-ingest.service';
import type { AgentTraceRepository } from '../agent-trace.repository';
import type { AgentConversationRepository } from '../agent-conversation.repository';
import type { ConfigService } from '@nestjs/config';
import type { KafkaConfig } from '../../config';
import type { OutboxRepository } from '../../outbox/outbox.repository';

function createMockConfigService(overrides: Partial<KafkaConfig> = {}): ConfigService {
  const kafkaConfig: KafkaConfig = {
    brokers: process.env.LOG_KAFKA_BROKERS ?? '',
    instanceId: process.env.SENTRIS_INSTANCE,
    agentTraceGroupId: process.env.AGENT_TRACE_KAFKA_GROUP_ID,
    agentTraceClientId: process.env.AGENT_TRACE_KAFKA_CLIENT_ID,
    nodeIoGroupId: undefined,
    nodeIoClientId: undefined,
    eventGroupId: undefined,
    eventClientId: undefined,
    logGroupId: undefined,
    logClientId: undefined,
    logTopic: 'telemetry.logs',
    eventTopic: 'telemetry.events',
    agentTraceTopic: 'telemetry.agent-trace',
    nodeIoTopic: 'telemetry.node-io',
    ...overrides,
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

const conversations = {
  markTerminalWithExecutor: mock(async () => undefined),
} as unknown as AgentConversationRepository;

describe('AgentTraceIngestService', () => {
  function createOutboxRepository() {
    return {
      recordKafkaPoisonMessage: mock(async () => undefined),
      runKafkaEventOnce: mock(
        async (
          _identity: unknown,
          _eventId: unknown,
          _organizationId: unknown,
          project: (executor: unknown) => Promise<void>,
        ) => {
          await project({});
          return true;
        },
      ),
    };
  }

  beforeEach(() => {
    restoreEnv();
    process.env.LOG_KAFKA_BROKERS = 'localhost:19092';
    delete process.env.SENTRIS_INSTANCE;
    delete process.env.AGENT_TRACE_KAFKA_GROUP_ID;
    delete process.env.AGENT_TRACE_KAFKA_CLIENT_ID;
  });

  afterEach(() => {
    restoreEnv();
  });

  test('uses legacy defaults when SENTRIS_INSTANCE is unset', () => {
    const repository = { append: async () => undefined } as unknown as AgentTraceRepository;
    const service = new AgentTraceIngestService(
      repository,
      conversations,
      createMockConfigService(),
      createOutboxRepository() as unknown as OutboxRepository,
    ) as unknown as {
      kafkaGroupId: string;
      kafkaClientId: string;
    };

    expect(service.kafkaGroupId).toBe('sentris-agent-trace-ingestor');
    expect(service.kafkaClientId).toBe('sentris-backend-agent-trace');
  });

  test('uses instance-scoped defaults when SENTRIS_INSTANCE is set', () => {
    process.env.SENTRIS_INSTANCE = '7';
    const repository = { append: async () => undefined } as unknown as AgentTraceRepository;
    const service = new AgentTraceIngestService(
      repository,
      conversations,
      createMockConfigService(),
      createOutboxRepository() as unknown as OutboxRepository,
    ) as unknown as {
      kafkaGroupId: string;
      kafkaClientId: string;
    };

    expect(service.kafkaGroupId).toBe('sentris-agent-trace-ingestor-7');
    expect(service.kafkaClientId).toBe('sentris-backend-agent-trace-7');
  });

  test('prefers explicit env vars over defaults', () => {
    process.env.SENTRIS_INSTANCE = '3';
    process.env.AGENT_TRACE_KAFKA_GROUP_ID = 'custom-agent-trace-group';
    process.env.AGENT_TRACE_KAFKA_CLIENT_ID = 'custom-agent-trace-client';
    const repository = { append: async () => undefined } as unknown as AgentTraceRepository;
    const service = new AgentTraceIngestService(
      repository,
      conversations,
      createMockConfigService(),
      createOutboxRepository() as unknown as OutboxRepository,
    ) as unknown as {
      kafkaGroupId: string;
      kafkaClientId: string;
    };

    expect(service.kafkaGroupId).toBe('custom-agent-trace-group');
    expect(service.kafkaClientId).toBe('custom-agent-trace-client');
  });

  test('propagates persistence failures so Kafka retries the same offset', async () => {
    const repository = {
      appendWithExecutor: mock(async () => {
        throw new Error('postgres unavailable');
      }),
    } as unknown as AgentTraceRepository;
    const outbox = createOutboxRepository();
    const service = new AgentTraceIngestService(
      repository,
      conversations,
      createMockConfigService(),
      outbox as unknown as OutboxRepository,
    );

    await expect(
      (service as any).processKafkaMessage(
        Buffer.from(
          JSON.stringify({
            eventId: 'agent-1:1',
            agentRunId: 'agent-1',
            workflowRunId: 'run-1',
            workflowId: 'wf-1',
            organizationId: 'org-1',
            nodeRef: 'agent',
            sequence: 1,
            timestamp: '2026-07-26T12:00:00.000Z',
            part: { type: 'text-delta', textDelta: 'hello' },
          }),
        ),
        { topic: 'telemetry.agent-trace', partition: 1, offset: '5' },
      ),
    ).rejects.toThrow('postgres unavailable');
  });

  test('records an empty required-topic payload as poison with its exact Kafka identity', async () => {
    const outbox = createOutboxRepository();
    const service = new AgentTraceIngestService(
      {} as AgentTraceRepository,
      conversations,
      createMockConfigService(),
      outbox as unknown as OutboxRepository,
    );
    const identity = {
      topic: 'custom.agent-trace.instance-9',
      partition: 2,
      offset: '81',
    };

    await expect((service as any).processKafkaMessage(null, identity)).resolves.toBeUndefined();

    expect(outbox.recordKafkaPoisonMessage).toHaveBeenCalledWith(
      identity,
      Buffer.alloc(0),
      expect.objectContaining({ message: 'Kafka message payload is empty' }),
      null,
    );
  });

  test('uses the stable logical event identity for idempotent projection', async () => {
    const repository = {
      appendWithExecutor: mock(async () => undefined),
    } as unknown as AgentTraceRepository;
    const outbox = createOutboxRepository();
    const service = new AgentTraceIngestService(
      repository,
      conversations,
      createMockConfigService(),
      outbox as unknown as OutboxRepository,
    );

    await (service as any).processKafkaMessage(
      Buffer.from(
        JSON.stringify({
          eventId: 'agent-1:7',
          agentRunId: 'agent-1',
          workflowRunId: 'run-1',
          workflowId: 'wf-1',
          organizationId: 'org-1',
          nodeRef: 'agent',
          sequence: 7,
          timestamp: '2026-07-26T12:00:00.000Z',
          part: { type: 'finish', finishReason: 'stop', responseText: 'done' },
        }),
      ),
      { topic: 'telemetry.agent-trace', partition: 2, offset: '99' },
    );

    expect(outbox.runKafkaEventOnce).toHaveBeenCalledWith(
      { topic: 'telemetry.agent-trace', partition: 2, offset: '99' },
      'agent-1:7',
      'org-1',
      expect.any(Function),
    );
    expect(repository.appendWithExecutor).toHaveBeenCalledTimes(1);
  });

  test('acknowledges malformed poison messages', async () => {
    const repository = {
      appendWithExecutor: mock(async () => undefined),
    } as unknown as AgentTraceRepository;
    const outbox = createOutboxRepository();
    const service = new AgentTraceIngestService(
      repository,
      conversations,
      createMockConfigService(),
      outbox as unknown as OutboxRepository,
    );

    await expect(
      (service as any).processKafkaMessage(Buffer.from('{}'), {
        topic: 'telemetry.agent-trace',
        partition: 1,
        offset: '6',
      }),
    ).resolves.toBeUndefined();
    expect(outbox.runKafkaEventOnce).not.toHaveBeenCalled();
    expect(outbox.recordKafkaPoisonMessage).toHaveBeenCalledWith(
      { topic: 'telemetry.agent-trace', partition: 1, offset: '6' },
      expect.any(Buffer),
      expect.anything(),
      null,
    );
  });
});
