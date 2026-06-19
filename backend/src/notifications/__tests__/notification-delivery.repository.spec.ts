import { describe, it, expect, beforeEach } from 'bun:test';
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
    createdAt: overrides.createdAt ?? now,
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
});
