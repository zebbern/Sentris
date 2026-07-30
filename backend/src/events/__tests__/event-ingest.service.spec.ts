import { beforeEach, describe, expect, it, vi } from 'bun:test';

import { EventIngestService } from '../event-ingest.service';
import type { TraceRepository } from '../../trace/trace.repository';
import type { OutboxRepository } from '../../outbox/outbox.repository';

/**
 * EventIngestService relies on Kafka, which is constructed eagerly in the
 * constructor from ConfigService values. We test the persistEvent logic
 * by constructing the service with valid config and then invoking the
 * private persistEvent method through the message handler path.
 *
 * Since the Kafka consumer is created in connectToKafka (called in
 * onModuleInit), we can test the service construction, the lifecycle
 * hooks, and the event persistence logic without a live Kafka broker.
 */

function makeConfigService() {
  return {
    get: vi.fn().mockImplementation((key: string) => {
      if (key === 'kafka') {
        return {
          brokers: 'localhost:9092',
          instanceId: undefined,
          eventTopic: 'telemetry.events',
          eventGroupId: 'test-group',
          eventClientId: 'test-client',
        };
      }
      return undefined;
    }),
  };
}

describe('EventIngestService', () => {
  let traceRepo: Record<string, ReturnType<typeof vi.fn>>;
  let outboxRepo: Record<string, ReturnType<typeof vi.fn>>;
  let configService: ReturnType<typeof makeConfigService>;
  let service: EventIngestService;

  beforeEach(() => {
    traceRepo = {
      append: vi.fn(),
      appendMany: vi.fn(),
      appendWithExecutor: vi.fn(),
      notifyAppended: vi.fn(),
    };
    outboxRepo = {
      recordKafkaPoisonMessage: vi.fn(async () => undefined),
      runKafkaEventOnce: vi.fn(
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
    configService = makeConfigService();

    service = new EventIngestService(
      traceRepo as unknown as TraceRepository,
      configService as any,
      outboxRepo as unknown as OutboxRepository,
    );
  });

  it('constructs with valid Kafka config', () => {
    expect(service).toBeDefined();
  });

  it('throws when no Kafka brokers are configured', () => {
    const badConfig = {
      get: vi.fn().mockReturnValue({
        brokers: '',
        instanceId: undefined,
        eventTopic: 'telemetry.events',
        eventGroupId: undefined,
        eventClientId: undefined,
      }),
    };

    expect(
      () => new EventIngestService(traceRepo as any, badConfig as any, outboxRepo as any),
    ).toThrow('LOG_KAFKA_BROKERS must be configured');
  });

  it('disconnects Kafka consumer on module destroy', async () => {
    // consumer is undefined initially (connectToKafka not called)
    // onModuleDestroy should handle this gracefully
    await service.onModuleDestroy();
    // No error thrown — graceful no-op
  });

  it('persists a valid trace event', async () => {
    traceRepo.appendWithExecutor.mockResolvedValue(undefined);

    // Access persistEvent via the public-facing path: simulate what the
    // Kafka handler does by calling the private method directly.
    const persistEvent = (service as any).persistEvent.bind(service);

    await persistEvent(
      {
        eventId: 'trace:run-1:activity-1:1',
        runId: 'run-1',
        workflowId: 'wf-1',
        organizationId: 'org-1',
        type: 'NODE_STARTED',
        nodeRef: 'scanner',
        timestamp: '2024-06-01T00:00:00.000Z',
        sequence: 1,
        level: 'info',
        message: 'Node started',
        data: { key: 'value' },
      },
      { topic: 'telemetry.events', partition: 0, offset: '9' },
    );

    expect(traceRepo.appendWithExecutor).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        runId: 'run-1',
        type: 'NODE_STARTED',
        nodeRef: 'scanner',
        sequence: 1,
      }),
    );
    expect(outboxRepo.runKafkaEventOnce).toHaveBeenCalledWith(
      { topic: 'telemetry.events', partition: 0, offset: '9' },
      'trace:run-1:activity-1:1',
      'org-1',
      expect.any(Function),
    );
  });

  it('records a well-formed event with an invalid sequence as poison instead of silently dropping it', async () => {
    const processKafkaMessage = (service as any).processKafkaMessage.bind(service);
    const raw = Buffer.from(
      JSON.stringify({
        eventId: 'trace:run-1:activity-1:2',
        runId: 'run-1',
        type: 'NODE_STARTED',
        nodeRef: 'scanner',
        timestamp: '2024-06-01T00:00:00.000Z',
        sequence: 0,
        level: 'info',
      }),
    );

    await expect(
      processKafkaMessage(raw, {
        topic: 'telemetry.events',
        partition: 0,
        offset: '10',
      }),
    ).resolves.toBeUndefined();

    expect(traceRepo.appendWithExecutor).not.toHaveBeenCalled();
    expect(outboxRepo.runKafkaEventOnce).not.toHaveBeenCalled();
    expect(outboxRepo.recordKafkaPoisonMessage).toHaveBeenCalledWith(
      { topic: 'telemetry.events', partition: 0, offset: '10' },
      raw,
      expect.anything(),
      null,
    );
  });

  it('records an empty required-topic payload as poison with its exact Kafka identity', async () => {
    const identity = { topic: 'custom.events.instance-9', partition: 3, offset: '77' };

    await expect((service as any).processKafkaMessage(null, identity)).resolves.toBeUndefined();

    expect(outboxRepo.recordKafkaPoisonMessage).toHaveBeenCalledWith(
      identity,
      Buffer.alloc(0),
      expect.objectContaining({ message: 'Kafka message payload is empty' }),
      null,
    );
  });

  it('propagates persistence failures so Kafka does not resolve the offset', async () => {
    traceRepo.appendWithExecutor.mockRejectedValue(new Error('postgres unavailable'));
    const processKafkaMessage = (service as any).processKafkaMessage.bind(service);

    await expect(
      processKafkaMessage(
        Buffer.from(
          JSON.stringify({
            eventId: 'trace:run-1:activity-1:3',
            runId: 'run-1',
            type: 'NODE_STARTED',
            nodeRef: 'scanner',
            timestamp: '2024-06-01T00:00:00.000Z',
            sequence: 1,
            level: 'info',
          }),
        ),
        { topic: 'telemetry.events', partition: 0, offset: '11' },
      ),
    ).rejects.toThrow('postgres unavailable');
  });

  it('deduplicates the same logical event across two consumers and Kafka offsets', async () => {
    const acceptedEventIds = new Set<string>();
    const sharedOutbox = {
      recordKafkaPoisonMessage: vi.fn(async () => undefined),
      runKafkaEventOnce: vi.fn(
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
    const sharedTrace = {
      appendWithExecutor: vi.fn(async () => undefined),
      notifyAppended: vi.fn(async () => undefined),
    };
    const firstConsumer = new EventIngestService(
      sharedTrace as unknown as TraceRepository,
      makeConfigService() as never,
      sharedOutbox as unknown as OutboxRepository,
    );
    const restartedConsumer = new EventIngestService(
      sharedTrace as unknown as TraceRepository,
      makeConfigService() as never,
      sharedOutbox as unknown as OutboxRepository,
    );
    const payload = Buffer.from(
      JSON.stringify({
        eventId: 'trace:run-1:activity-7:1',
        runId: 'run-1',
        workflowId: 'wf-1',
        organizationId: 'org-1',
        type: 'NODE_STARTED',
        nodeRef: 'scanner',
        timestamp: '2026-07-26T12:00:00.000Z',
        sequence: 70_001,
        level: 'info',
      }),
    );

    await (firstConsumer as any).processKafkaMessage(payload, {
      topic: 'telemetry.events',
      partition: 0,
      offset: '20',
    });
    await (restartedConsumer as any).processKafkaMessage(payload, {
      topic: 'telemetry.events',
      partition: 0,
      offset: '21',
    });

    expect(sharedOutbox.runKafkaEventOnce).toHaveBeenCalledTimes(2);
    expect(sharedTrace.appendWithExecutor).toHaveBeenCalledTimes(1);
    expect(sharedTrace.notifyAppended).toHaveBeenCalledTimes(1);
  });

  it('acknowledges malformed poison messages without invoking persistence', async () => {
    const processKafkaMessage = (service as any).processKafkaMessage.bind(service);

    await expect(
      processKafkaMessage(Buffer.from('{not-json'), {
        topic: 'telemetry.events',
        partition: 0,
        offset: '12',
      }),
    ).resolves.toBeUndefined();

    expect(outboxRepo.runKafkaEventOnce).not.toHaveBeenCalled();
    expect(outboxRepo.recordKafkaPoisonMessage).toHaveBeenCalledWith(
      { topic: 'telemetry.events', partition: 0, offset: '12' },
      expect.any(Buffer),
      expect.any(SyntaxError),
      null,
    );
  });
});
