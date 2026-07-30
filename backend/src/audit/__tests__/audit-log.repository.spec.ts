import { describe, expect, it } from 'bun:test';

import { auditLogsTable, outboxEventsTable } from '../../database/schema';
import { AuditLogRepository } from '../audit-log.repository';

interface Call {
  table?: unknown;
  method: string;
  args: unknown[];
}

function chainable(calls: Call[], table?: unknown) {
  const chain = new Proxy(
    {},
    {
      get(_target, property: string) {
        if (property === 'then') {
          return (resolve: (value: unknown) => void) => resolve([]);
        }
        return (...args: unknown[]) => {
          calls.push({ table, method: property, args });
          return chain;
        };
      },
    },
  );
  return chain;
}

function repositoryWithCalls() {
  const calls: Call[] = [];
  const db = {
    insert: (table: unknown) => {
      calls.push({ table, method: 'insert', args: [] });
      return chainable(calls, table);
    },
  };
  return {
    calls,
    repository: new AuditLogRepository(db as never),
  };
}

describe('AuditLogRepository', () => {
  it('enqueues a stable outbox event carrying the original occurrence time', async () => {
    const { calls, repository } = repositoryWithCalls();

    await repository.enqueue({
      id: '8d15526f-3cc5-4fae-a32f-902ea820bcc7',
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
      createdAt: new Date('2026-07-26T12:00:00.000Z'),
    });

    const values = calls.find(
      (call) => call.table === outboxEventsTable && call.method === 'values',
    )?.args[0];
    expect(values).toMatchObject({
      eventType: 'audit.log.persist.v1',
      organizationId: 'org-1',
      aggregateType: 'audit_log',
      aggregateId: '8d15526f-3cc5-4fae-a32f-902ea820bcc7',
      dedupeKey: 'audit.log:8d15526f-3cc5-4fae-a32f-902ea820bcc7',
      payload: expect.objectContaining({
        auditId: '8d15526f-3cc5-4fae-a32f-902ea820bcc7',
        occurredAt: '2026-07-26T12:00:00.000Z',
      }),
    });
    expect(
      calls.some(
        (call) => call.table === outboxEventsTable && call.method === 'onConflictDoNothing',
      ),
    ).toBe(true);
  });

  it('makes a retried audit projection idempotent on the stable audit id', async () => {
    const { calls, repository } = repositoryWithCalls();

    await repository.insert({
      id: '8d15526f-3cc5-4fae-a32f-902ea820bcc7',
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
      createdAt: new Date('2026-07-26T12:00:00.000Z'),
    });

    expect(
      calls.some((call) => call.table === auditLogsTable && call.method === 'onConflictDoNothing'),
    ).toBe(true);
  });
});
