import { beforeEach, describe, expect, it, vi } from 'bun:test';

import { EventIngestService } from '../event-ingest.service';
import type { TraceRepository } from '../../trace/trace.repository';

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
  let configService: ReturnType<typeof makeConfigService>;
  let service: EventIngestService;

  beforeEach(() => {
    traceRepo = { append: vi.fn(), appendMany: vi.fn() };
    configService = makeConfigService();

    service = new EventIngestService(traceRepo as unknown as TraceRepository, configService as any);
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

    expect(() => new EventIngestService(traceRepo as any, badConfig as any)).toThrow(
      'LOG_KAFKA_BROKERS must be configured',
    );
  });

  it('disconnects Kafka consumer on module destroy', async () => {
    // consumer is undefined initially (connectToKafka not called)
    // onModuleDestroy should handle this gracefully
    await service.onModuleDestroy();
    // No error thrown — graceful no-op
  });

  it('persists a valid trace event', async () => {
    traceRepo.append.mockResolvedValue(undefined);

    // Access persistEvent via the public-facing path: simulate what the
    // Kafka handler does by calling the private method directly.
    const persistEvent = (service as any).persistEvent.bind(service);

    await persistEvent({
      runId: 'run-1',
      workflowId: 'wf-1',
      organizationId: 'org-1',
      type: 'node_started',
      nodeRef: 'scanner',
      timestamp: '2024-06-01T00:00:00.000Z',
      sequence: 1,
      level: 'info',
      message: 'Node started',
      data: { key: 'value' },
    });

    expect(traceRepo.append).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: 'run-1',
        type: 'node_started',
        nodeRef: 'scanner',
        sequence: 1,
      }),
    );
  });

  it('drops events with invalid sequence numbers', async () => {
    const persistEvent = (service as any).persistEvent.bind(service);

    await persistEvent({
      runId: 'run-1',
      type: 'node_started',
      nodeRef: 'scanner',
      timestamp: '2024-06-01T00:00:00.000Z',
      sequence: 0,
      level: 'info',
    });

    expect(traceRepo.append).not.toHaveBeenCalled();
  });
});
