import { describe, it, expect, beforeEach } from 'bun:test';
import { PgDialect } from 'drizzle-orm/pg-core';
import { NotificationDeliveryRepository } from '../repository/notification-delivery.repository';
import type { NotificationDeliveryRecord } from '../../database/schema';

// ---------------------------------------------------------------------------
// Mock Drizzle database
// ---------------------------------------------------------------------------

function makeDeliveryRecord(
  overrides: Partial<NotificationDeliveryRecord> = {},
): NotificationDeliveryRecord {
  const now = new Date();
  return {
    id: overrides.id ?? 'del-1',
    channelId: overrides.channelId ?? 'ch-1',
    runId: overrides.runId ?? 'run-1',
    eventType: overrides.eventType ?? 'run.failed',
    status: overrides.status ?? 'pending',
    payload: overrides.payload ?? { runId: 'run-1' },
    errorMessage: overrides.errorMessage ?? null,
    durationMs: overrides.durationMs ?? null,
    responseStatus: overrides.responseStatus ?? null,
    responseBody: overrides.responseBody ?? null,
    outboxEventId: overrides.outboxEventId ?? null,
    createdAt: overrides.createdAt ?? now,
    sendingStartedAt: overrides.sendingStartedAt ?? null,
    sentAt: overrides.sentAt ?? null,
  };
}

function createMockDb(rows: NotificationDeliveryRecord[] = []) {
  const calls: { method: string; args: unknown[] }[] = [];

  function chainable(resolvedValue: unknown) {
    const builder: Record<string, unknown> = {};
    const self = new Proxy(builder, {
      get(_target, prop: string) {
        if (prop === 'then') {
          return (resolve: (v: unknown) => void) => resolve(resolvedValue);
        }
        return (...args: unknown[]) => {
          calls.push({ method: prop, args });
          return self;
        };
      },
    });
    return self;
  }

  const db = {
    insert: (...args: unknown[]) => {
      calls.push({ method: 'insert', args });
      return chainable(rows);
    },
    select: (...args: unknown[]) => {
      calls.push({ method: 'select', args });
      return chainable(rows);
    },
    update: (...args: unknown[]) => {
      calls.push({ method: 'update', args });
      return chainable(rows);
    },
    execute: async (...args: unknown[]) => {
      calls.push({ method: 'execute', args });
      return { rows };
    },
    transaction: async (handler: (executor: unknown) => Promise<unknown>) => {
      calls.push({ method: 'transaction', args: [] });
      return handler(db);
    },
    _calls: calls,
  };

  return db as any;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('NotificationDeliveryRepository', () => {
  let repo: NotificationDeliveryRepository;
  let mockDb: ReturnType<typeof createMockDb>;

  const sampleRecord = makeDeliveryRecord();

  beforeEach(() => {
    mockDb = createMockDb([sampleRecord]);
    repo = new NotificationDeliveryRepository(mockDb);
  });

  describe('create', () => {
    it('inserts a delivery record and returns it', async () => {
      const result = await repo.create({
        channelId: 'ch-1',
        runId: 'run-1',
        eventType: 'run.failed',
        status: 'pending',
        payload: { runId: 'run-1' },
      });

      expect(result).toEqual(sampleRecord);
      const insertCall = mockDb._calls.find((c: { method: string }) => c.method === 'insert');
      expect(insertCall).toBeDefined();
    });
  });

  describe('update', () => {
    it('updates a delivery record and returns the updated version', async () => {
      const updatedRecord = makeDeliveryRecord({ status: 'sent', sentAt: new Date() });
      const updateDb = createMockDb([updatedRecord]);
      const updateRepo = new NotificationDeliveryRepository(updateDb);

      const result = await updateRepo.update('del-1', {
        status: 'sent',
        sentAt: new Date(),
      });

      expect(result).toEqual(updatedRecord);
    });

    it('returns undefined when no record matches', async () => {
      const emptyDb = createMockDb([]);
      const emptyRepo = new NotificationDeliveryRepository(emptyDb);
      const result = await emptyRepo.update('nonexistent', { status: 'sent' });
      expect(result).toBeUndefined();
    });
  });

  describe('claimForSend', () => {
    it('atomically claims a pending or failed delivery', async () => {
      expect(await repo.claimForSend('del-1')).toBe(true);

      const setCall = mockDb._calls.find(
        (call: { method: string; args: unknown[] }) => call.method === 'set',
      );
      const whereCall = mockDb._calls.find(
        (call: { method: string; args: unknown[] }) => call.method === 'where',
      );
      expect(setCall?.args[0]).toEqual({
        status: 'sending',
        sendingStartedAt: expect.any(Date),
      });
      expect(whereCall).toBeDefined();
    });

    it('returns false when another dispatcher already claimed the delivery', async () => {
      const emptyRepo = new NotificationDeliveryRepository(createMockDb([]));
      expect(await emptyRepo.claimForSend('del-1')).toBe(false);
    });
  });

  describe('manual resend reservation', () => {
    it('reserves one eligible original delivery and records its audit through the same transaction', async () => {
      const failed = makeDeliveryRecord({ status: 'sending' });
      const reservationDb = createMockDb([failed]);
      const reservationRepo = new NotificationDeliveryRepository(reservationDb);
      let hookExecutor: unknown;
      let hookRecord: NotificationDeliveryRecord | undefined;

      const reserved = await reservationRepo.reserveManualResend(
        'del-1',
        'ch-1',
        'failed',
        'sentris-manual-resend|reservation-1|1785081600000|failed',
        {
          id: 'reservation-1',
          channelId: 'ch-1',
          runId: 'run-1',
          eventType: 'run.failed',
          status: 'pending',
          payload: { runId: 'run-1' },
        },
        async (executor: unknown, record: NotificationDeliveryRecord) => {
          hookExecutor = executor;
          hookRecord = record;
        },
      );

      expect(reserved).toBe(true);
      expect(hookExecutor).toBe(reservationDb);
      expect(hookRecord).toBe(failed);
      expect(
        reservationDb._calls.some((call: { method: string }) => call.method === 'transaction'),
      ).toBe(true);
      expect(
        reservationDb._calls.find((call: { method: string }) => call.method === 'set')?.args[0],
      ).toEqual({
        status: 'sending',
        errorMessage: 'sentris-manual-resend|reservation-1|1785081600000|failed',
        sendingStartedAt: expect.any(Date),
      });
    });

    it('does not audit when a concurrent manual resend already holds the reservation', async () => {
      const emptyDb = createMockDb([]);
      const emptyRepo = new NotificationDeliveryRepository(emptyDb);
      let hookCalls = 0;

      const reserved = await emptyRepo.reserveManualResend(
        'del-1',
        'ch-1',
        'unknown',
        'sentris-manual-resend|reservation-1|1785081600000|unknown',
        {
          id: 'reservation-1',
          channelId: 'ch-1',
          runId: 'run-1',
          eventType: 'run.failed',
          status: 'pending',
          payload: { runId: 'run-1' },
        },
        async () => {
          hookCalls += 1;
        },
      );

      expect(reserved).toBe(false);
      expect(hookCalls).toBe(0);
    });

    it('finalizes only the matching active manual resend reservation', async () => {
      const completed = await repo.completeManualResend(
        'del-1',
        'ch-1',
        'sentris-manual-resend|reservation-1|1785081600000|failed',
        {
          status: 'sent',
          errorMessage: 'Resolved by manual delivery del-2',
        },
      );

      expect(completed).toBe(true);
      const setCall = mockDb._calls.find((call: { method: string }) => call.method === 'set');
      expect(setCall?.args[0]).toEqual({
        status: 'sent',
        errorMessage: 'Resolved by manual delivery del-2',
        sendingStartedAt: null,
      });
      const whereCall = mockDb._calls.find((call: { method: string }) => call.method === 'where');
      expect(whereCall).toBeDefined();
    });

    it('finalizes through the supplied outbox transaction executor', async () => {
      const recoveryCalls: { method: string; args: unknown[] }[] = [];
      const recoveryExecutor = {
        update: (...args: unknown[]) => {
          recoveryCalls.push({ method: 'update', args });
          return createMockDb([makeDeliveryRecord({ status: 'sent' })]).update(...args);
        },
      };

      const completed = await repo.completeManualResend(
        'del-1',
        'ch-1',
        'sentris-manual-resend|reservation-1|1785081600000|failed',
        {
          status: 'sent',
          errorMessage: 'Resolved by manual delivery del-2',
        },
        recoveryExecutor as never,
      );

      expect(completed).toBe(true);
      expect(recoveryCalls).toHaveLength(1);
      expect(mockDb._calls.some((call: { method: string }) => call.method === 'update')).toBe(
        false,
      );
    });
  });

  describe('listByChannelId', () => {
    it('returns delivery records for the given channel', async () => {
      const results = await repo.listByChannelId('ch-1');
      expect(results).toEqual([sampleRecord]);
    });

    it('returns records with default limit of 100', async () => {
      const results = await repo.listByChannelId('ch-1');
      expect(results).toBeDefined();
      // Verify limit call was made
      const limitCall = mockDb._calls.find((c: { method: string }) => c.method === 'limit');
      expect(limitCall).toBeDefined();
    });
  });

  describe('listByRunId', () => {
    it('returns delivery records for the given run', async () => {
      const results = await repo.listByRunId('run-1');
      expect(results).toEqual([sampleRecord]);
    });
  });

  describe('ambiguous non-outbox delivery recovery', () => {
    it('uses a status-and-age CAS before changing sending to unknown', async () => {
      const cutoff = new Date('2026-07-29T12:00:00.000Z');

      const result = await repo.markStaleSendingUnknown(
        'del-1',
        'ch-1',
        cutoff,
        'ambiguous outcome',
      );

      expect(result).toEqual(sampleRecord);
      const setCall = mockDb._calls.find((call: { method: string }) => call.method === 'set');
      expect(setCall?.args[0]).toEqual({
        status: 'unknown',
        errorMessage: 'ambiguous outcome',
        sendingStartedAt: null,
      });
      const whereCall = mockDb._calls.find((call: { method: string }) => call.method === 'where');
      const compiled = new PgDialect().sqlToQuery(
        (whereCall?.args[0] as { getSQL(): unknown }).getSQL() as never,
      );
      expect(compiled.sql).toContain('"notification_deliveries"."status" = $');
      expect(compiled.sql).toContain('"notification_deliveries"."sending_started_at" <= $');
      expect(compiled.params.filter((value) => value === cutoff.toISOString())).toHaveLength(2);
    });
  });

  describe('retention cleanup', () => {
    it('deletes only bounded resolved rows whose durable outbox work is complete', async () => {
      const cutoff = new Date('2026-04-30T00:00:00.000Z');
      const result = await repo.purgeResolvedBefore(cutoff, 50_000);
      const executeCall = mockDb._calls.find(
        (call: { method: string }) => call.method === 'execute',
      );
      const compiled = new PgDialect().sqlToQuery(executeCall?.args[0] as never);

      expect(result).toBe(1);
      expect(compiled.sql).toContain('LEFT JOIN "outbox_events"');
      expect(compiled.sql).toContain(`"notification_deliveries"."status" IN ('sent', 'failed')`);
      expect(compiled.sql).toContain(`"outbox_events"."status" = 'completed'`);
      expect(compiled.sql).toContain(
        'ORDER BY "notification_deliveries"."created_at" ASC, "notification_deliveries"."id" ASC',
      );
      expect(compiled.params).toContain(cutoff);
      expect(compiled.params).toContain(10_000);
    });
  });
});
