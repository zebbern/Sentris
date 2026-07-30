import { beforeEach, describe, expect, it, mock, vi } from 'bun:test';
import { DURABLE_KAFKA_PUBLISH_EVENT } from '@sentris/shared';

const connect = vi.fn(async () => undefined);
const send = vi.fn(async () => undefined);
const disconnect = vi.fn(async () => undefined);
const producer = { connect, send, disconnect };

mock.module('kafkajs', () => ({
  Kafka: vi.fn(() => ({
    producer: vi.fn(() => producer),
  })),
  logLevel: { NOTHING: 0 },
}));

const { TelemetryKafkaReplayListener } = await import('../telemetry-kafka-replay.listener');

const kafkaConfig = {
  brokers: 'redpanda:9092',
  instanceId: '4',
  nodeIoGroupId: undefined,
  nodeIoClientId: undefined,
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

describe('TelemetryKafkaReplayListener', () => {
  beforeEach(() => {
    connect.mockClear();
    send.mockClear();
    disconnect.mockClear();
  });

  it('replays a durable fallback to the configured instance-aware Kafka topic', async () => {
    const listener = new TelemetryKafkaReplayListener({
      get: vi.fn(() => kafkaConfig),
    } as never);

    await listener.republish({
      topic: 'telemetry.node-io.instance-4',
      key: 'run-1',
      value: '{"type":"NODE_IO_COMPLETION"}',
      outbox: {
        eventId: 'outbox-1',
        dedupeKey: `${DURABLE_KAFKA_PUBLISH_EVENT}:message-1`,
        attempt: 1,
      },
    });

    expect(connect).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith({
      topic: 'telemetry.node-io.instance-4',
      messages: [{ key: 'run-1', value: '{"type":"NODE_IO_COMPLETION"}' }],
    });
  });

  it('rejects an outbox payload that targets an unconfigured topic', async () => {
    const listener = new TelemetryKafkaReplayListener({
      get: vi.fn(() => kafkaConfig),
    } as never);

    await expect(
      listener.republish({
        topic: 'attacker-controlled-topic',
        key: null,
        value: '{}',
      }),
    ).rejects.toThrow('not an allowed telemetry topic');
    expect(send).not.toHaveBeenCalled();
  });

  it('propagates Kafka failures so the outbox retries instead of acknowledging loss', async () => {
    send.mockRejectedValueOnce(new Error('Kafka unavailable'));
    const listener = new TelemetryKafkaReplayListener({
      get: vi.fn(() => kafkaConfig),
    } as never);

    await expect(
      listener.republish({
        topic: 'telemetry.events.instance-4',
        key: 'run-1',
        value: '{"eventId":"trace-1"}',
      }),
    ).rejects.toThrow('Kafka unavailable');
  });

  it('disconnects its producer during backend shutdown', async () => {
    const listener = new TelemetryKafkaReplayListener({
      get: vi.fn(() => kafkaConfig),
    } as never);
    await listener.republish({
      topic: 'telemetry.logs.instance-4',
      key: null,
      value: '{"message":"scanner output"}',
    });

    await listener.onModuleDestroy();

    expect(disconnect).toHaveBeenCalledTimes(1);
  });

  it('boots without Kafka when ingest services are explicitly disabled and retains replay work', async () => {
    const listener = new TelemetryKafkaReplayListener({
      get: vi.fn((key: string) => {
        if (key === 'kafka') return { ...kafkaConfig, brokers: '' };
        if (key === 'ingest') {
          return {
            enableIngestServices: false,
            skipIngestServices: true,
            mcpSyncTemplatesOnStartup: false,
          };
        }
        return undefined;
      }),
    } as never);

    await expect(
      listener.republish({
        topic: 'telemetry.events.instance-4',
        key: 'run-1',
        value: '{"eventId":"trace-1"}',
      }),
    ).rejects.toThrow('telemetry replay is unavailable while ingest services are disabled');

    expect(connect).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
    await listener.onModuleDestroy();
    expect(disconnect).not.toHaveBeenCalled();
  });
});
