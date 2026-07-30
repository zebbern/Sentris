import { describe, expect, it, vi } from 'bun:test';
import { DURABLE_KAFKA_PUBLISH_EVENT } from '@sentris/shared';

import {
  PostgresDurableKafkaFallback,
  publishWithDurableFallback,
  type DurableKafkaFallbackInput,
} from '../durable-kafka-fallback';

describe('PostgresDurableKafkaFallback', () => {
  it('stores an exhausted Kafka publication in the shared durable outbox', async () => {
    const query = vi.fn(async (_statement: string, _parameters: unknown[]) => ({
      rowCount: 1,
    }));
    const fallback = new PostgresDurableKafkaFallback({ query } as never);

    await fallback.enqueue({
      topic: 'telemetry.node-io.instance-4',
      key: 'run-1',
      value: '{"type":"NODE_IO_COMPLETION","runId":"run-1"}',
      organizationId: 'org-1',
    });

    expect(query).toHaveBeenCalledTimes(1);
    const [statement, parameters] = query.mock.calls[0]!;
    expect(String(statement)).toContain('INSERT INTO outbox_events');
    expect(String(statement)).toContain('ON CONFLICT (dedupe_key) DO NOTHING');
    expect(parameters[0]).toBe(DURABLE_KAFKA_PUBLISH_EVENT);
    expect(parameters[1]).toBe('org-1');
    expect(parameters[2]).toBe('telemetry_delivery');
    expect(parameters[3]).toMatch(/^[a-f0-9]{64}$/);
    expect(parameters[4]).toBe(`${DURABLE_KAFKA_PUBLISH_EVENT}:${parameters[3]}`);
    expect(JSON.parse(String(parameters[5]))).toEqual({
      topic: 'telemetry.node-io.instance-4',
      key: 'run-1',
      value: '{"type":"NODE_IO_COMPLETION","runId":"run-1"}',
    });
  });

  it('uses exact message identity so an ambiguous retry cannot enqueue duplicates', async () => {
    const calls: unknown[][] = [];
    const query = vi.fn(async (_statement: string, parameters: unknown[]) => {
      calls.push(parameters);
      return { rowCount: calls.length === 1 ? 1 : 0 };
    });
    const fallback = new PostgresDurableKafkaFallback({ query } as never);
    const publication = {
      topic: 'telemetry.events',
      key: 'run-1',
      value: '{"eventId":"trace-1"}',
      organizationId: 'org-1',
    };

    await fallback.enqueue(publication);
    await fallback.enqueue(publication);

    expect(calls).toHaveLength(2);
    expect(calls[1]![3]).toBe(calls[0]![3]);
    expect(calls[1]![4]).toBe(calls[0]![4]);
  });

  it('keeps identities distinct when Kafka keys contain the hash field separator', async () => {
    const calls: unknown[][] = [];
    const query = vi.fn(async (_statement: string, parameters: unknown[]) => {
      calls.push(parameters);
      return { rowCount: 1 };
    });
    const fallback = new PostgresDurableKafkaFallback({ query } as never);

    await fallback.enqueue({
      topic: 'telemetry.events',
      key: 'run-a',
      value: 'node-b\u0000payload-c',
      organizationId: 'org-1',
    });
    await fallback.enqueue({
      topic: 'telemetry.events',
      key: 'run-a\u0000node-b',
      value: 'payload-c',
      organizationId: 'org-1',
    });

    expect(calls[0]![4]).not.toBe(calls[1]![4]);
  });

  it('reports and propagates a fallback persistence failure', async () => {
    const onFailure = vi.fn();
    const fallback = new PostgresDurableKafkaFallback(
      {
        query: vi.fn(async () => {
          throw new Error('PostgreSQL unavailable');
        }),
      } as never,
      onFailure,
    );

    await expect(
      fallback.enqueue({
        topic: 'telemetry.logs',
        key: null,
        value: '{"message":"scan output"}',
        organizationId: null,
      }),
    ).rejects.toThrow('PostgreSQL unavailable');
    expect(onFailure).toHaveBeenCalledWith(expect.stringContaining('PostgreSQL unavailable'));
  });
});

describe('publishWithDurableFallback', () => {
  it('keeps the healthy Kafka path free of fallback database work', async () => {
    const publish = vi.fn(async () => undefined);
    const fallback = {
      enqueue: vi.fn(async (_input: DurableKafkaFallbackInput) => undefined),
    };

    await publishWithDurableFallback({
      publish,
      fallback,
      publication: {
        topic: 'telemetry.events',
        key: 'run-1',
        value: '{"eventId":"trace-1"}',
        organizationId: 'org-1',
      },
      source: 'test',
      logger: { error: vi.fn() },
    });

    expect(publish).toHaveBeenCalledTimes(1);
    expect(fallback.enqueue).not.toHaveBeenCalled();
  });

  it('acknowledges an exhausted Kafka send only after the durable fallback accepts it', async () => {
    const fallback = {
      enqueue: vi.fn(async (_input: DurableKafkaFallbackInput) => undefined),
    };
    const publication = {
      topic: 'telemetry.events',
      key: 'run-1',
      value: '{"eventId":"trace-1"}',
      organizationId: 'org-1',
    };

    await expect(
      publishWithDurableFallback({
        publish: async () => {
          throw new Error('Kafka unavailable');
        },
        fallback,
        publication,
        source: 'test',
        logger: { error: vi.fn() },
      }),
    ).resolves.toBeUndefined();

    expect(fallback.enqueue).toHaveBeenCalledWith(publication);
  });

  it('propagates failure when neither Kafka nor the fallback can retain the message', async () => {
    const logger = { error: vi.fn() };

    await expect(
      publishWithDurableFallback({
        publish: async () => {
          throw new Error('Kafka unavailable');
        },
        fallback: {
          enqueue: async () => {
            throw new Error('PostgreSQL unavailable');
          },
        },
        publication: {
          topic: 'telemetry.logs',
          key: null,
          value: '{"message":"scan output"}',
          organizationId: 'org-1',
        },
        source: 'test',
        logger,
      }),
    ).rejects.toThrow('PostgreSQL unavailable');
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('both failed'),
      expect.any(Object),
    );
  });
});
