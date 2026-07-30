import { describe, expect, it, mock } from 'bun:test';

import { enqueueOutboxEvent } from '../enqueue-outbox-event';
import { ensureAggregateEventScheduledWithExecutor, OutboxRepository } from '../outbox.repository';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { OutboxEventRecord } from '../../database/schema';

function chainable(rows: unknown[], calls: { method: string; args: unknown[] }[]) {
  const self = new Proxy(
    {},
    {
      get(_target, property: string) {
        if (property === 'then') {
          return (resolve: (value: unknown) => void) => resolve(rows);
        }
        return (...args: unknown[]) => {
          calls.push({ method: property, args });
          return self;
        };
      },
    },
  );
  return self;
}

function sqlContains(node: unknown, expected: unknown): boolean {
  if (typeof node === 'string') return node.includes(String(expected));
  if (Array.isArray(node)) return node.some((entry) => sqlContains(entry, expected));
  if (!node || typeof node !== 'object') return false;
  const candidate = node as {
    name?: string;
    value?: unknown;
    queryChunks?: unknown[];
    constructor?: { name?: string };
  };
  if (candidate.name === expected) return true;
  if (candidate.value === expected) return true;
  if (
    Array.isArray(candidate.value) &&
    candidate.value.some((entry) => sqlContains(entry, expected))
  )
    return true;
  if (typeof candidate.value === 'string' && candidate.value.includes(String(expected)))
    return true;
  if (candidate.constructor?.name === 'Param' && candidate.value === expected) return true;
  return candidate.queryChunks?.some((chunk) => sqlContains(chunk, expected)) ?? false;
}

function deadLetter(
  id: string,
  createdAt: string,
  overrides: Partial<OutboxEventRecord> = {},
): OutboxEventRecord {
  const timestamp = new Date(createdAt);
  return {
    id,
    eventType: 'human_input.resolution.signal.v1',
    organizationId: 'org-1',
    aggregateType: 'human_input',
    aggregateId: 'request-1',
    dedupeKey: `human-input-resolution-signal:${id}`,
    payload: { requestId: 'request-1' },
    status: 'dead',
    attempts: 8,
    maxAttempts: 8,
    availableAt: timestamp,
    lockedAt: null,
    lockedBy: null,
    lastError: 'Temporal unavailable',
    processedAt: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides,
  };
}

describe('enqueueOutboxEvent', () => {
  it('inserts a stable deduplicated event through the supplied transaction executor', async () => {
    const calls: { method: string; args: unknown[] }[] = [];
    const executor = {
      insert: (...args: unknown[]) => {
        calls.push({ method: 'insert', args });
        return chainable([], calls);
      },
    };

    await enqueueOutboxEvent(executor as never, {
      eventType: 'finding.triage.changed',
      organizationId: 'org-1',
      aggregateType: 'finding',
      aggregateId: 'finding-1',
      dedupeKey: 'finding.triage.changed:finding-1:7',
      payload: { sequence: 7 },
    });

    const values = calls.find((call) => call.method === 'values')?.args[0] as Record<
      string,
      unknown
    >;
    expect(values).toMatchObject({
      eventType: 'finding.triage.changed',
      organizationId: 'org-1',
      aggregateType: 'finding',
      aggregateId: 'finding-1',
      dedupeKey: 'finding.triage.changed:finding-1:7',
      payload: { sequence: 7 },
      maxAttempts: 8,
    });
    expect(calls.some((call) => call.method === 'onConflictDoNothing')).toBe(true);
  });
});

describe('OutboxRepository', () => {
  it('requeues the oldest dead aggregate event through the caller transaction executor', async () => {
    const execute = mock(async (_query: unknown) => ({ rows: [{ scheduled: true }] }));

    const scheduled = await ensureAggregateEventScheduledWithExecutor({ execute } as never, {
      organizationId: 'org-1',
      eventType: 'finding.triage.changed',
      aggregateType: 'finding',
      aggregateId: 'finding-1',
    });

    expect(scheduled).toBe(true);
    expect(execute).toHaveBeenCalledTimes(1);
    const query = execute.mock.calls[0]?.[0];
    expect(sqlContains(query, 'org-1')).toBe(true);
    expect(sqlContains(query, 'finding.triage.changed')).toBe(true);
    expect(sqlContains(query, 'finding')).toBe(true);
    expect(sqlContains(query, 'finding-1')).toBe(true);
    expect(sqlContains(query, 'dead')).toBe(true);
    expect(sqlContains(query, 'pending')).toBe(true);
    const compiled = new PgDialect().sqlToQuery(query as never);
    expect(compiled.sql).not.toContain(`"status" IN ('pending', 'processing')`);
    expect(sqlContains(query, 'FOR UPDATE')).toBe(true);
  });

  it('requires the requeued dead predecessor to match the requested event type', async () => {
    const execute = mock(async (_query: unknown) => ({ rows: [{ scheduled: true }] }));

    const scheduled = await ensureAggregateEventScheduledWithExecutor({ execute } as never, {
      organizationId: 'org-1',
      eventType: 'finding.triage.changed',
      aggregateType: 'finding',
      aggregateId: 'finding-1',
    });

    expect(scheduled).toBe(true);
    const query = execute.mock.calls[0]?.[0];
    const compiled = new PgDialect().sqlToQuery(query as never);
    const oldestDeadSelector = compiled.sql.slice(
      compiled.sql.indexOf('WITH oldest_dead'),
      compiled.sql.indexOf('requeued AS'),
    );
    expect(oldestDeadSelector).not.toContain('"event_type"');
    expect(compiled.sql).toContain('RETURNING "outbox_events"."id", "outbox_events"."event_type"');
    expect(compiled.sql).toMatch(/SELECT EXISTS \(\s*SELECT 1\s*FROM requeued/);
    expect(compiled.sql).toMatch(/WHERE requeued\.event_type = \$\d+/);
    expect(compiled.sql).not.toContain(`"status" IN ('pending', 'processing')`);
  });

  it('reports no durable aggregate retry when no matching dead event exists', async () => {
    const execute = mock(async (_query: unknown) => ({ rows: [{ scheduled: false }] }));

    const scheduled = await ensureAggregateEventScheduledWithExecutor({ execute } as never, {
      organizationId: 'org-1',
      eventType: 'finding.triage.changed',
      aggregateType: 'finding',
      aggregateId: 'finding-1',
    });

    expect(scheduled).toBe(false);
  });

  it('persists the Kafka receipt and projection in one transaction', async () => {
    const calls: { method: string; args: unknown[] }[] = [];
    const tx = {
      insert: (...args: unknown[]) => {
        calls.push({ method: 'insert', args });
        return chainable([{ id: 'receipt-1' }], calls);
      },
    };
    const db = {
      transaction: mock(async (handler: (executor: typeof tx) => Promise<boolean>) => handler(tx)),
    };
    const repository = new OutboxRepository(db as never);
    const project = mock(async () => undefined);

    const processed = await repository.runKafkaMessageOnce(
      {
        topic: 'telemetry.events',
        partition: 2,
        offset: '41',
      },
      'org-1',
      project,
    );

    expect(processed).toBe(true);
    expect(project).toHaveBeenCalledWith(tx);
    const values = calls.find((call) => call.method === 'values')?.args[0];
    expect(values).toMatchObject({
      eventType: 'telemetry.kafka.ingested.v1',
      organizationId: 'org-1',
      aggregateType: 'kafka_message',
      aggregateId: 'telemetry.events:2:41',
      dedupeKey: 'telemetry.kafka.ingested:telemetry.events:2:41',
      status: 'completed',
      attempts: 0,
      maxAttempts: 1,
    });
  });

  it('deduplicates a logical telemetry event across different Kafka deliveries', async () => {
    const calls: { method: string; args: unknown[] }[] = [];
    const tx = {
      insert: (...args: unknown[]) => {
        calls.push({ method: 'insert', args });
        return chainable([{ id: 'receipt-1' }], calls);
      },
    };
    const db = {
      transaction: mock(async (handler: (executor: typeof tx) => Promise<boolean>) => handler(tx)),
    };
    const repository = new OutboxRepository(db as never);
    const project = mock(async () => undefined);

    await repository.runKafkaEventOnce(
      { topic: 'telemetry.events', partition: 2, offset: '41' },
      'trace:run-1:activity-7:1',
      'org-1',
      project,
    );

    const values = calls.find((call) => call.method === 'values')?.args[0] as Record<
      string,
      unknown
    >;
    expect(values).toMatchObject({
      eventType: 'telemetry.kafka.ingested.v1',
      aggregateType: 'telemetry_event',
      aggregateId: 'trace:run-1:activity-7:1',
      dedupeKey: 'telemetry.event.ingested:trace:run-1:activity-7:1',
      status: 'completed',
    });
    expect(values.payload).toMatchObject({
      eventId: 'trace:run-1:activity-7:1',
      topic: 'telemetry.events',
      partition: 2,
      offset: '41',
    });
  });

  it('skips a Kafka projection when its durable receipt already exists', async () => {
    const tx = {
      insert: () => chainable([], []),
    };
    const db = {
      transaction: mock(async (handler: (executor: typeof tx) => Promise<boolean>) => handler(tx)),
    };
    const repository = new OutboxRepository(db as never);
    const project = mock(async () => undefined);

    const processed = await repository.runKafkaMessageOnce(
      {
        topic: 'telemetry.events',
        partition: 2,
        offset: '41',
      },
      null,
      project,
    );

    expect(processed).toBe(false);
    expect(project).not.toHaveBeenCalled();
  });

  it('finds a logical telemetry receipt independently of Kafka offset', async () => {
    const calls: { method: string; args: unknown[] }[] = [];
    const db = {
      select: (...args: unknown[]) => {
        calls.push({ method: 'select', args });
        return chainable([{ id: 'receipt-1' }], calls);
      },
    };
    const repository = new OutboxRepository(db as never);

    expect(await repository.hasKafkaEventReceipt('log:event-1')).toBe(true);

    const where = calls.find((call) => call.method === 'where')?.args[0];
    expect(sqlContains(where, 'telemetry.event.ingested:log:event-1')).toBe(true);
  });

  it('stores a malformed Kafka offset as a durable dead letter without raw payload data', async () => {
    const calls: { method: string; args: unknown[] }[] = [];
    const db = {
      insert: (...args: unknown[]) => {
        calls.push({ method: 'insert', args });
        return chainable([], calls);
      },
    };
    const repository = new OutboxRepository(db as never);

    await repository.recordKafkaPoisonMessage(
      { topic: 'telemetry.logs', partition: 1, offset: '7' },
      Buffer.from('token=super-secret'),
      new Error('invalid payload'),
      'org-1',
    );

    const values = calls.find((call) => call.method === 'values')?.args[0] as
      | Record<string, unknown>
      | undefined;
    expect(values).toMatchObject({
      eventType: 'telemetry.kafka.poison.v1',
      organizationId: 'org-1',
      aggregateId: 'telemetry.logs:1:7',
      dedupeKey: 'telemetry.kafka.poison:telemetry.logs:1:7',
      status: 'dead',
      maxAttempts: 1,
      lastError: 'invalid payload',
    });
    expect(JSON.stringify(values)).not.toContain('super-secret');
    expect((values?.payload as Record<string, unknown>).sha256).toBeString();
  });

  it('purges only expired Kafka receipts in a bounded batch', async () => {
    const execute = mock(async (_query: unknown) => ({
      rows: [{ id: 'receipt-1' }, { id: 'receipt-2' }],
    }));
    const repository = new OutboxRepository({ execute } as never);

    const removed = await repository.purgeKafkaReceiptsBefore(
      new Date('2026-06-26T00:00:00.000Z'),
      500,
    );

    expect(removed).toBe(2);
    const query = execute.mock.calls[0]?.[0];
    expect(sqlContains(query, 'telemetry.kafka.ingested.v1')).toBe(true);
    const compiled = new PgDialect().sqlToQuery(query as never);
    expect(compiled.sql).toMatch(
      /ORDER BY "outbox_events"\."created_at" ASC,\s*"outbox_events"\."id" ASC/,
    );
  });

  it('purges only completed durable telemetry publications in a bounded batch', async () => {
    const execute = mock(async (_query: unknown) => ({
      rows: [{ id: 'publication-1' }, { id: 'publication-2' }],
    }));
    const repository = new OutboxRepository({ execute } as never);

    const removed = await repository.purgeCompletedTelemetryPublicationsBefore(
      new Date('2026-06-26T00:00:00.000Z'),
      500,
    );

    expect(removed).toBe(2);
    const query = execute.mock.calls[0]?.[0];
    expect(sqlContains(query, 'telemetry.kafka.publish.v1')).toBe(true);
    expect(sqlContains(query, 'completed')).toBe(true);
    expect(sqlContains(query, 'pending')).toBe(false);
    expect(sqlContains(query, 'processing')).toBe(false);
    expect(sqlContains(query, 'dead')).toBe(false);
    const compiled = new PgDialect().sqlToQuery(query as never);
    expect(compiled.sql).toMatch(
      /ORDER BY "outbox_events"\."created_at" ASC,\s*"outbox_events"\."id" ASC/,
    );
  });

  it('maps an atomically claimed row and increments its attempt before dispatch', async () => {
    const execute = mock(async (_query: unknown) => ({
      rows: [
        {
          id: 'event-1',
          event_type: 'run.status.terminal',
          organization_id: 'org-1',
          aggregate_type: 'workflow_run',
          aggregate_id: 'run-1',
          dedupe_key: 'run.status.terminal:run-1',
          payload: { runId: 'run-1' },
          attempts: 2,
          max_attempts: 8,
        },
      ],
    }));
    const repository = new OutboxRepository({ execute } as never);

    const events = await repository.claimBatch('worker-a', 25);

    expect(events).toEqual([
      {
        id: 'event-1',
        eventType: 'run.status.terminal',
        organizationId: 'org-1',
        aggregateType: 'workflow_run',
        aggregateId: 'run-1',
        dedupeKey: 'run.status.terminal:run-1',
        payload: { runId: 'run-1' },
        attempts: 2,
        maxAttempts: 8,
      },
    ]);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('claims only the oldest unfinished event for each aggregate', async () => {
    const execute = mock(async (_query: unknown) => ({ rows: [] }));
    const repository = new OutboxRepository({ execute } as never);

    await repository.claimBatch('worker-a', 25);

    const query = execute.mock.calls[0]?.[0];
    expect(sqlContains(query, 'NOT EXISTS')).toBe(true);
    expect(sqlContains(query, 'IS NOT DISTINCT FROM')).toBe(true);
    expect(sqlContains(query, 'dead')).toBe(true);
  });

  it('renders claim aliases against the physical outbox events relation', async () => {
    const execute = mock(async (_query: unknown) => ({ rows: [] }));
    const repository = new OutboxRepository({ execute } as never);

    await repository.claimBatch('worker-a', 25);

    const query = execute.mock.calls[0]?.[0];
    const compiled = new PgDialect().sqlToQuery(query as never);
    expect(compiled.sql).toContain('FROM "outbox_events" AS "claim_candidate"');
    expect(compiled.sql).toContain('FROM "outbox_events" AS "claim_predecessor"');
  });

  it('renews a lease only while the same worker still owns the processing event', async () => {
    const calls: { method: string; args: unknown[] }[] = [];
    const db = {
      update: (...args: unknown[]) => {
        calls.push({ method: 'update', args });
        return chainable([{ id: 'event-1' }], calls);
      },
    };
    const repository = new OutboxRepository(db as never);

    const renewed = await repository.renewLease('event-1', 'worker-a');

    expect(renewed).toBe(true);
    const values = calls.find((call) => call.method === 'set')?.args[0];
    expect(values).toMatchObject({
      lockedAt: expect.any(Date),
      updatedAt: expect.any(Date),
    });
    const where = calls.find((call) => call.method === 'where')?.args[0];
    expect(sqlContains(where, 'event-1')).toBe(true);
    expect(sqlContains(where, 'worker-a')).toBe(true);
    expect(sqlContains(where, 'processing')).toBe(true);
  });

  it('returns a keyset page with an explicit cursor when older dead letters exist', async () => {
    const calls: { method: string; args: unknown[] }[] = [];
    const rows = [
      deadLetter('30000000-0000-4000-8000-000000000000', '2026-07-26T12:00:00.000Z'),
      deadLetter('20000000-0000-4000-8000-000000000000', '2026-07-26T11:00:00.000Z'),
      deadLetter('10000000-0000-4000-8000-000000000000', '2026-07-26T10:00:00.000Z'),
    ];
    const db = {
      select: (...args: unknown[]) => {
        calls.push({ method: 'select', args });
        return chainable(rows, calls);
      },
    };
    const repository = new OutboxRepository(db as never);

    const page = await repository.listDeadLetters('org-1', 2);

    expect(page).toEqual({
      items: rows.slice(0, 2),
      nextCursor: {
        createdAt: rows[1]!.createdAt,
        id: rows[1]!.id,
      },
    });
    expect(calls.find((call) => call.method === 'limit')?.args[0]).toBe(3);
    expect(calls.find((call) => call.method === 'orderBy')?.args).toHaveLength(2);
  });

  it('uses organization-scoped created-at/id keyset predicates for older dead letters', async () => {
    const calls: { method: string; args: unknown[] }[] = [];
    const db = {
      select: (...args: unknown[]) => {
        calls.push({ method: 'select', args });
        return chainable([], calls);
      },
    };
    const repository = new OutboxRepository(db as never);
    const cursor = {
      createdAt: new Date('2026-07-26T11:00:00.000Z'),
      id: '20000000-0000-4000-8000-000000000000',
    };

    await repository.listDeadLetters('org-1', 20, cursor);

    const where = calls.find((call) => call.method === 'where')?.args[0];
    expect(sqlContains(where, 'org-1')).toBe(true);
    expect(sqlContains(where, cursor.createdAt)).toBe(true);
    expect(sqlContains(where, cursor.id)).toBe(true);
  });

  it('requeues a dead letter only inside the authenticated organization', async () => {
    const calls: { method: string; args: unknown[] }[] = [];
    const record = deadLetter('5b5879f4-6798-4027-92e6-56a863460098', '2026-07-26T11:00:00.000Z');
    const db = {
      update: (...args: unknown[]) => {
        calls.push({ method: 'update', args });
        return chainable([record], calls);
      },
    };
    const repository = new OutboxRepository(db as never);

    const requeued = await repository.requeueDeadLetter(record.id, 'org-1');

    expect(requeued).toEqual(record);
    const where = calls.find((call) => call.method === 'where')?.args[0];
    expect(sqlContains(where, 'organization_id')).toBe(true);
    expect(sqlContains(where, 'org-1')).toBe(true);
  });

  it('runs requeue and its mutation hook in one transaction and skips the hook if no row wins', async () => {
    const record = deadLetter('5b5879f4-6798-4027-92e6-56a863460098', '2026-07-26T11:00:00.000Z');
    const successfulCalls: { method: string; args: unknown[] }[] = [];
    const successfulTx = {
      update: (...args: unknown[]) => {
        successfulCalls.push({ method: 'update', args });
        return chainable([record], successfulCalls);
      },
      insert: mock(() => chainable([], successfulCalls)),
    };
    const successfulDb = {
      transaction: mock(async (callback: (executor: typeof successfulTx) => Promise<unknown>) =>
        callback(successfulTx),
      ),
    };
    const onRequeued = mock(async () => undefined);
    const successfulRepository = new OutboxRepository(successfulDb as never);

    const result = await successfulRepository.requeueDeadLetter(record.id, 'org-1', onRequeued);

    expect(result).toEqual(record);
    expect(successfulDb.transaction).toHaveBeenCalledTimes(1);
    expect(onRequeued).toHaveBeenCalledWith(successfulTx, record);
    await expect(
      successfulRepository.requeueDeadLetter(record.id, 'org-1', async () => {
        throw new Error('audit outbox unavailable');
      }),
    ).rejects.toThrow('audit outbox unavailable');

    const emptyCalls: { method: string; args: unknown[] }[] = [];
    const emptyTx = {
      update: () => chainable([], emptyCalls),
      insert: mock(() => chainable([], emptyCalls)),
    };
    const emptyDb = {
      transaction: mock(async (callback: (executor: typeof emptyTx) => Promise<unknown>) =>
        callback(emptyTx),
      ),
    };
    const emptyHook = mock(async () => undefined);
    const emptyRepository = new OutboxRepository(emptyDb as never);

    expect(await emptyRepository.requeueDeadLetter(record.id, 'org-1', emptyHook)).toBeUndefined();
    expect(emptyHook).toHaveBeenCalledTimes(0);
  });

  it('reports only unfinished events for the requested organization and event type', async () => {
    const calls: { method: string; args: unknown[] }[] = [];
    const db = {
      select: (...args: unknown[]) => {
        calls.push({ method: 'select', args });
        return chainable([{ id: 'event-1' }], calls);
      },
    };
    const repository = new OutboxRepository(db as never);

    const outstanding = await repository.hasOutstandingEvent('org-1', 'finding.triage.project.v1');

    expect(outstanding).toBe(true);
    const where = calls.find((call) => call.method === 'where')?.args[0];
    expect(sqlContains(where, 'org-1')).toBe(true);
    expect(sqlContains(where, 'finding.triage.project.v1')).toBe(true);
  });
});
