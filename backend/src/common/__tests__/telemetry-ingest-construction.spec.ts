import { beforeEach, describe, expect, it, vi } from 'bun:test';
import { MODULE_METADATA } from '@nestjs/common/constants';

import { AgentTraceIngestService } from '../../agent-trace/agent-trace-ingest.service';
import { EventIngestService } from '../../events/event-ingest.service';
import { LogIngestService } from '../../logging/log-ingest.service';
import { NodeIOModule } from '../../node-io/node-io.module';
import { NodeIOIngestService } from '../../node-io/node-io-ingest.service';
import { TraceModule } from '../../trace/trace.module';
import { KafkaIngestHealthRegistry } from '../kafka-ingest-health.registry';
import { resetTopicResolver } from '../kafka-topic-resolver';

const configService = {
  get: vi.fn((key: string) => {
    if (key === 'kafka') {
      return {
        brokers: 'localhost:9092',
        instanceId: '9',
        eventTopic: 'custom.events',
        agentTraceTopic: 'custom.agent-trace',
        nodeIoTopic: 'custom.node-io',
        logTopic: 'custom.logs',
        eventGroupId: undefined,
        eventClientId: undefined,
        agentTraceGroupId: undefined,
        agentTraceClientId: undefined,
        nodeIoGroupId: undefined,
        nodeIoClientId: undefined,
        logGroupId: undefined,
        logClientId: undefined,
      };
    }
    if (key === 'loki') {
      return { url: 'http://localhost:3100' };
    }
    return undefined;
  }),
};

function construct(
  name: 'events' | 'agent-trace' | 'node-io' | 'logs',
  healthRegistry?: object,
  config: object = configService,
) {
  const outbox = {} as any;
  switch (name) {
    case 'events':
      return new EventIngestService({} as any, config as any, outbox, healthRegistry as any);
    case 'agent-trace':
      return new AgentTraceIngestService(
        {} as any,
        {} as any,
        config as any,
        outbox,
        healthRegistry as any,
      );
    case 'node-io':
      return new NodeIOIngestService({} as any, config as any, outbox, healthRegistry as any);
    case 'logs':
      return new LogIngestService({} as any, config as any, outbox, healthRegistry as any);
  }
}

function fakeConsumer() {
  return {
    events: {
      CRASH: 'consumer.crash',
      DISCONNECT: 'consumer.disconnect',
      STOP: 'consumer.stop',
      HEARTBEAT: 'consumer.heartbeat',
    },
    on: vi.fn(() => () => undefined),
    disconnect: vi.fn(async () => undefined),
  };
}

describe('telemetry ingest construction', () => {
  beforeEach(() => {
    resetTopicResolver();
  });

  it('resolves all four custom topics independently in varied construction order', () => {
    const expectedTopics = {
      events: 'custom.events.instance-9',
      'agent-trace': 'custom.agent-trace.instance-9',
      'node-io': 'custom.node-io.instance-9',
      logs: 'custom.logs.instance-9',
    };
    const orders = [
      ['events', 'agent-trace', 'node-io', 'logs'],
      ['logs', 'node-io', 'agent-trace', 'events'],
    ] as const;

    for (const order of orders) {
      resetTopicResolver();
      const services = Object.fromEntries(order.map((name) => [name, construct(name)])) as Record<
        (typeof order)[number],
        object
      >;

      for (const [name, expected] of Object.entries(expectedTopics)) {
        expect((services[name as keyof typeof services] as any).kafkaTopic).toBe(expected);
      }
    }
  });

  it('uses instance-scoped event and log consumer identities by default', () => {
    const events = construct('events') as any;
    const logs = construct('logs') as any;

    expect(events.kafkaGroupId).toBe('sentris-event-ingestor-9');
    expect(events.kafkaClientId).toBe('sentris-backend-events-9');
    expect(logs.kafkaGroupId).toBe('sentris-log-ingestor-9');
    expect(logs.kafkaClientId).toBe('sentris-backend-9');
  });

  it('registers ingest providers statically so loaded runtime config decides their lifecycle', () => {
    const traceProviders = Reflect.getMetadata(MODULE_METADATA.PROVIDERS, TraceModule) as unknown[];
    const nodeIOProviders = Reflect.getMetadata(
      MODULE_METADATA.PROVIDERS,
      NodeIOModule,
    ) as unknown[];

    expect(traceProviders).toEqual(
      expect.arrayContaining([EventIngestService, AgentTraceIngestService, LogIngestService]),
    );
    expect(nodeIOProviders).toContain(NodeIOIngestService);
  });

  it('constructs and shuts down without Kafka or Loki when runtime config disables ingest', async () => {
    const disabledConfig = {
      get: vi.fn((key: string) =>
        key === 'ingest'
          ? {
              enableIngestServices: false,
              skipIngestServices: false,
              mcpSyncTemplatesOnStartup: false,
            }
          : undefined,
      ),
    };
    const healthRegistry = new KafkaIngestHealthRegistry(disabledConfig as any);
    const services = (['events', 'agent-trace', 'node-io', 'logs'] as const).map((name) =>
      construct(name, healthRegistry, disabledConfig),
    );

    for (const service of services) {
      service.onModuleInit();
    }
    await Promise.all(services.map((service) => service.onModuleDestroy()));

    expect(disabledConfig.get).not.toHaveBeenCalledWith('kafka');
    expect(disabledConfig.get).not.toHaveBeenCalledWith('loki');
    expect(healthRegistry.snapshot()).toEqual({
      events: { required: false, state: 'disabled' },
      'agent-trace': { required: false, state: 'disabled' },
      'node-io': { required: false, state: 'disabled' },
      logs: { required: false, state: 'disabled' },
    });
    expect(healthRegistry.allRequiredRunning()).toBe(true);
  });

  it('supervises and reports all four production consumers through one readiness registry', async () => {
    const names = ['events', 'agent-trace', 'node-io', 'logs'] as const;
    const connected = new Set<string>();
    const stopped = new Set<string>();
    const healthRegistry = {
      reporter: vi.fn((name: string) => ({
        connecting: vi.fn(),
        running: vi.fn(() => connected.add(name)),
        failed: vi.fn(),
        stopped: vi.fn(() => stopped.add(name)),
      })),
    };
    const services = names.map((name) => {
      const service = construct(name, healthRegistry) as any;
      const consumer = fakeConsumer();
      service.createConsumer = () => consumer;
      service.startConsumer = async () => undefined;
      return { service, consumer };
    });

    for (const { service } of services) {
      service.onModuleInit();
    }
    while (connected.size < names.length) {
      await Promise.resolve();
    }

    expect(healthRegistry.reporter.mock.calls.map(([name]) => name)).toEqual([...names]);
    expect([...connected]).toEqual([...names]);

    await Promise.all(services.map(({ service }) => service.onModuleDestroy()));
    expect([...stopped]).toEqual([...names]);
    expect(services.every(({ consumer }) => consumer.disconnect.mock.calls.length === 1)).toBe(
      true,
    );
  });
});
