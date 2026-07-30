import { describe, it, expect, mock } from 'bun:test';

import type { AuthContext } from '../../auth/types';
import { AuditLogService } from '../audit-log.service';
import type { AuditLogRepository } from '../audit-log.repository';

function makeAuth(overrides: Partial<AuthContext> = {}): AuthContext {
  return {
    userId: 'user-1',
    organizationId: 'org-1',
    roles: ['MEMBER'],
    isAuthenticated: true,
    provider: 'local',
    ...overrides,
  };
}

describe('AuditLogService', () => {
  it('allows org admins to read audit logs', () => {
    const repo: AuditLogRepository = {
      insert: async () => {},
      list: async () => [],
    } as any;
    const service = new AuditLogService(repo);
    expect(service.canRead(makeAuth({ roles: ['ADMIN'] }))).toBe(true);
  });

  it('allows API keys with audit.read=true to read audit logs', () => {
    const repo: AuditLogRepository = {
      insert: async () => {},
      list: async () => [],
    } as any;
    const service = new AuditLogService(repo);
    expect(
      service.canRead(
        makeAuth({
          provider: 'api-key',
          roles: ['MEMBER'],
          apiKeyPermissions: {
            workflows: { run: false, list: false, read: false },
            runs: { read: false, cancel: false },
            audit: { read: true },
          },
        }),
      ),
    ).toBe(true);
  });

  it('denies API keys without audit.read', () => {
    const repo: AuditLogRepository = {
      insert: async () => {},
      list: async () => [],
    } as any;
    const service = new AuditLogService(repo);
    expect(
      service.canRead(
        makeAuth({
          provider: 'api-key',
          roles: ['MEMBER'],
          apiKeyPermissions: {
            workflows: { run: true, list: true, read: true },
            runs: { read: true, cancel: true },
            audit: { read: false },
          },
        }),
      ),
    ).toBe(false);
  });

  it('recordBestEffort() never throws when an approved high-volume read cannot be inserted', async () => {
    const insert = mock(async () => {
      throw new Error('db down');
    });
    const repo: AuditLogRepository = {
      enqueue: async () => {},
      insert,
      list: async () => [],
    } as any;
    const service = new AuditLogService(repo);

    expect(() =>
      service.recordBestEffort(makeAuth({ roles: ['ADMIN'] }), {
        action: 'analytics.query',
        resourceType: 'analytics',
        metadata: { page: 1 },
      }),
    ).not.toThrow();

    await Promise.resolve();
    expect(insert).toHaveBeenCalledTimes(1);
  });

  it('keeps high-volume read telemetry off the durable outbox hot path', async () => {
    const enqueue = mock(async () => undefined);
    const insert = mock(async () => undefined);
    const repo: AuditLogRepository = {
      enqueue,
      insert,
      list: async () => [],
    } as any;
    const service = new AuditLogService(repo);

    for (const action of [
      'analytics.query',
      'findings.detail',
      'findings.list',
      'findings.stats',
    ] as const) {
      service.recordBestEffort(makeAuth({ roles: ['ADMIN'] }), {
        action,
        resourceType: 'analytics',
        metadata: { page: 1, pageSize: 25 },
      });
    }
    await Promise.resolve();

    expect(insert).toHaveBeenCalledTimes(4);
    expect(enqueue).not.toHaveBeenCalled();
    expect((service as unknown as { record?: unknown }).record).toBeUndefined();
  });

  it('recordDurable resolves only after the audit event is accepted by the outbox', async () => {
    let accepted = false;
    const repo: AuditLogRepository = {
      enqueue: async () => {
        accepted = true;
      },
      insert: async () => {},
      list: async () => [],
    } as any;
    const service = new AuditLogService(repo);

    await service.recordDurable(makeAuth({ roles: ['ADMIN'] }), {
      action: 'secret.access',
      resourceType: 'secret',
      resourceId: 'secret-1',
    });

    expect(accepted).toBe(true);
  });

  it('enqueues strict mutation audits through the caller transaction', async () => {
    const enqueue = mock(async () => undefined);
    const repo: AuditLogRepository = {
      enqueue,
      insert: async () => {},
      list: async () => [],
    } as any;
    const service = new AuditLogService(repo);
    const transaction = { insert: mock(() => undefined) };

    await service.recordDurableWithExecutor(transaction as never, makeAuth({ roles: ['ADMIN'] }), {
      action: 'api_key.revoke',
      resourceType: 'api_key',
      resourceId: 'key-1',
    });

    expect(enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'api_key.revoke',
        resourceId: 'key-1',
      }),
      transaction,
    );
  });

  it('exports every row through bounded deterministic keyset pages', async () => {
    const calls: {
      organizationId: string;
      limit: number;
      cursor?: { createdAt: Date; id: string };
    }[] = [];
    const list = mock(async (filters: (typeof calls)[number]) => {
      calls.push(filters);
      const page = calls.length - 1;
      const rowCount = page < 10 ? 1_000 : page === 10 ? 1 : 0;
      return Array.from({ length: rowCount }, (_, index) => {
        const ordinal = page * 1_000 + index;
        return {
          id: `event-${ordinal.toString().padStart(5, '0')}`,
          createdAt: new Date(2_000_000_000_000 - ordinal),
        };
      });
    });
    const repo: AuditLogRepository = {
      enqueue: async () => {},
      insert: async () => {},
      list,
    } as any;
    const service = new AuditLogService(repo);
    let count = 0;

    for await (const page of service.exportPages(makeAuth({ roles: ['ADMIN'] }), {})) {
      expect(page.length).toBeLessThanOrEqual(1_000);
      count += page.length;
    }

    expect(count).toBe(10_001);
    expect(calls).toHaveLength(11);
    expect(calls.every((call) => call.organizationId === 'org-1' && call.limit === 1_000)).toBe(
      true,
    );
    expect(calls[1]?.cursor).toEqual({
      createdAt: new Date(2_000_000_000_000 - 999),
      id: 'event-00999',
    });
  });

  it('projects a retried outbox event with a stable audit id', async () => {
    const insert = mock(async () => undefined);
    const repo: AuditLogRepository = {
      enqueue: async () => {},
      insert,
      list: async () => [],
    } as any;
    const service = new AuditLogService(repo);

    await service.handlePersistEvent({
      auditId: '8d15526f-3cc5-4fae-a32f-902ea820bcc7',
      organizationId: 'org-1',
      actorId: 'user-1',
      actorType: 'user',
      actorDisplay: null,
      action: 'secret.access',
      resourceType: 'secret',
      resourceId: 'secret-1',
      resourceName: null,
      metadata: null,
      ip: null,
      userAgent: null,
      correlationId: 'request-1',
      occurredAt: '2026-07-26T12:00:00.000Z',
      outbox: {
        eventId: 'outbox-1',
        dedupeKey: 'audit.log:8d15526f-3cc5-4fae-a32f-902ea820bcc7',
        attempt: 2,
      },
    });

    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        id: '8d15526f-3cc5-4fae-a32f-902ea820bcc7',
        organizationId: 'org-1',
        action: 'secret.access',
        correlationId: 'request-1',
        createdAt: new Date('2026-07-26T12:00:00.000Z'),
      }),
    );
  });
});
