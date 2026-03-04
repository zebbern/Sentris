import { describe, it, expect, beforeEach } from 'bun:test';
import { NotificationChannelRepository } from '../repository/notification-channel.repository';
import type { NotificationChannelRecord } from '../../database/schema';

// ---------------------------------------------------------------------------
// Mock Drizzle database
// ---------------------------------------------------------------------------

function makeChannelRecord(
  overrides: Partial<NotificationChannelRecord> = {},
): NotificationChannelRecord {
  const now = new Date();
  return {
    id: overrides.id ?? 'ch-1',
    organizationId: overrides.organizationId ?? 'org-1',
    name: overrides.name ?? 'Slack Alerts',
    type: overrides.type ?? 'slack',
    config: overrides.config ?? { webhookUrl: 'https://hooks.slack.com/services/T/B/x' },
    status: overrides.status ?? 'active',
    events: overrides.events ?? ['run.failed'],
    createdBy: overrides.createdBy ?? 'user-1',
    createdAt: overrides.createdAt ?? now,
    updatedAt: overrides.updatedAt ?? now,
  };
}

/**
 * Creates a chainable Drizzle mock that resolves db.select/insert/update/delete
 * to the supplied rows. Tracks calls so assertions can verify filter clauses.
 */
function createMockDb(rows: NotificationChannelRecord[] = []) {
  const calls: {
    method: string;
    args: unknown[];
  }[] = [];

  // Build a chainable builder proxy: any method call on it returns `self`,
  // except when awaited, which resolves to the rows array.
  function chainable(resolvedValue: unknown) {
    const builder: Record<string, unknown> = {};
    const self = new Proxy(builder, {
      get(_target, prop: string) {
        if (prop === 'then') {
          // Make the proxy thenable so `await` works
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
    delete: (...args: unknown[]) => {
      calls.push({ method: 'delete', args });
      return chainable(undefined);
    },
    _calls: calls,
  };

  return db as any;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('NotificationChannelRepository', () => {
  let repo: NotificationChannelRepository;
  let mockDb: ReturnType<typeof createMockDb>;

  const sampleRecord = makeChannelRecord();

  beforeEach(() => {
    mockDb = createMockDb([sampleRecord]);
    repo = new NotificationChannelRepository(mockDb);
  });

  describe('create', () => {
    it('inserts a record and returns it', async () => {
      const result = await repo.create({
        organizationId: 'org-1',
        name: 'Slack Alerts',
        type: 'slack',
        config: { webhookUrl: 'https://hooks.slack.com/services/T/B/x' },
        events: ['run.failed'],
        status: 'active',
        createdBy: 'user-1',
      });

      expect(result).toEqual(sampleRecord);
      const insertCall = mockDb._calls.find((c: { method: string }) => c.method === 'insert');
      expect(insertCall).toBeDefined();
    });
  });

  describe('findById', () => {
    it('returns a record matching the id', async () => {
      const result = await repo.findById('ch-1', { organizationId: 'org-1' });
      expect(result).toEqual(sampleRecord);
    });

    it('returns undefined when db returns no rows', async () => {
      const emptyDb = createMockDb([]);
      const emptyRepo = new NotificationChannelRepository(emptyDb);
      const result = await emptyRepo.findById('nonexistent');
      expect(result).toBeUndefined();
    });
  });

  describe('list', () => {
    it('returns records filtered by organizationId', async () => {
      const results = await repo.list({ organizationId: 'org-1' });
      expect(results).toEqual([sampleRecord]);
    });
  });

  describe('update', () => {
    it('updates a record and returns the updated version', async () => {
      const updatedRecord = makeChannelRecord({ name: 'Updated Channel' });
      const updateDb = createMockDb([updatedRecord]);
      const updateRepo = new NotificationChannelRepository(updateDb);

      const result = await updateRepo.update(
        'ch-1',
        { name: 'Updated Channel' },
        { organizationId: 'org-1' },
      );

      expect(result).toEqual(updatedRecord);
    });

    it('returns undefined when no record matches', async () => {
      const emptyDb = createMockDb([]);
      const emptyRepo = new NotificationChannelRepository(emptyDb);
      const result = await emptyRepo.update('nonexistent', { name: 'x' });
      expect(result).toBeUndefined();
    });
  });

  describe('delete', () => {
    it('calls delete on the db', async () => {
      await repo.delete('ch-1', { organizationId: 'org-1' });
      const deleteCall = mockDb._calls.find((c: { method: string }) => c.method === 'delete');
      expect(deleteCall).toBeDefined();
    });
  });

  describe('findActiveByEventType', () => {
    it('returns active channels subscribing to the given event type', async () => {
      const results = await repo.findActiveByEventType('org-1', 'run.failed');
      expect(results).toEqual([sampleRecord]);
    });
  });
});
