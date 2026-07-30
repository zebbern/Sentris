import { describe, expect, it } from 'bun:test';
import { PgDialect } from 'drizzle-orm/pg-core';

import { outboxEventsTable } from '../../database/schema/outbox';
import { ticketingConnectionsTable } from '../../database/schema/ticketing';
import { TicketingRepository } from '../ticketing.repository';

interface RecordedCall {
  method: string;
  args: unknown[];
}

function chainable(rows: unknown[], calls: RecordedCall[]) {
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
  if (candidate.name === expected || candidate.value === expected) return true;
  if (Array.isArray(candidate.value)) {
    return candidate.value.some((entry) => sqlContains(entry, expected));
  }
  return candidate.queryChunks?.some((chunk) => sqlContains(chunk, expected)) ?? false;
}

function unresolvedRecord() {
  return {
    id: '5a3d4557-abcb-4354-8d17-d7863fcfd3c5',
    findingTriageId: '8795d6a0-0371-4d4e-a28f-5cf38f419080',
    organizationId: 'org-1',
    provider: 'jira',
    externalId: 'sentris-pending:8795d6a0-0371-4d4e-a28f-5cf38f419080',
    externalUrl: '',
    syncStatus: 'unknown',
    lastSyncedAt: null,
    metadata: {},
    createdAt: new Date('2026-07-26T12:00:00.000Z'),
  };
}

describe('TicketingRepository ambiguous creation boundaries', () => {
  it('writes an explicit JSON null for a fresh unconfigured connection', async () => {
    const calls: RecordedCall[] = [];
    const repository = new TicketingRepository({
      insert: () => chainable([{}], calls),
    } as never);

    await repository.createConnection({
      organizationId: 'org-1',
      provider: 'jira',
      accessToken: { ciphertext: 'cipher', iv: 'iv', authTag: 'tag', keyId: 'key' },
      refreshToken: null,
      tokenExpiresAt: null,
      cloudId: 'cloud-1',
      config: null,
      createdBy: 'user-1',
    } as never);

    const values = calls.find((call) => call.method === 'values')?.args[0] as Record<
      string,
      unknown
    >;
    expect(values.config).not.toBeNull();
    expect(sqlContains(values.config, "'null'::jsonb")).toBe(true);
  });

  it('loads a ticket link only inside the requested organization', async () => {
    const calls: RecordedCall[] = [];
    const repository = new TicketingRepository({
      select: () => chainable([unresolvedRecord()], calls),
    } as never);

    await repository.findTicketLinkByTriageId('8795d6a0-0371-4d4e-a28f-5cf38f419080', 'org-1');

    const where = calls.find((call) => call.method === 'where')?.args[0];
    expect(sqlContains(where, 'finding_triage_id')).toBe(true);
    expect(sqlContains(where, 'organization_id')).toBe(true);
    expect(sqlContains(where, 'org-1')).toBe(true);
  });

  it('loads every shared issue link in one tenant-scoped query without a silent limit', async () => {
    const calls: RecordedCall[] = [];
    const repository = new TicketingRepository({
      select: () => chainable([unresolvedRecord(), unresolvedRecord()], calls),
    } as never);
    const findAll = (
      repository as unknown as {
        findTicketLinksByExternalId: (
          externalId: string,
          organizationId: string,
          provider: string,
        ) => Promise<unknown[]>;
      }
    ).findTicketLinksByExternalId;

    const rows = await findAll.call(repository, 'SEC-42', 'org-1', 'jira');

    const where = calls.find((call) => call.method === 'where')?.args[0];
    expect(rows).toHaveLength(2);
    expect(sqlContains(where, 'external_id')).toBe(true);
    expect(sqlContains(where, 'SEC-42')).toBe(true);
    expect(sqlContains(where, 'organization_id')).toBe(true);
    expect(sqlContains(where, 'org-1')).toBe(true);
    expect(sqlContains(where, 'provider')).toBe(true);
    expect(calls.some((call) => call.method === 'limit')).toBe(false);
  });

  it('persists a versioned pending registration and deduped outbox event in one transaction', async () => {
    const calls: RecordedCall[] = [];
    const insertedTables: unknown[] = [];
    const record = {
      id: '5a3d4557-abcb-4354-8d17-d7863fcfd3c5',
      organizationId: 'org-1',
      provider: 'jira',
      webhookRegistrationVersion: 2,
    };
    const transactionExecutor = {
      insert: (table: unknown) => {
        insertedTables.push(table);
        return chainable([record], calls);
      },
    };
    const repository = new TicketingRepository({
      transaction: (callback: (executor: unknown) => Promise<unknown>) =>
        callback(transactionExecutor),
    } as never);
    const persist = (
      repository as unknown as {
        saveOAuthConnectionAndQueueWebhookRegistration: (
          input: Record<string, unknown>,
        ) => Promise<typeof record>;
      }
    ).saveOAuthConnectionAndQueueWebhookRegistration;

    const result = await persist.call(repository, {
      organizationId: 'org-1',
      provider: 'jira',
      accessToken: { ciphertext: 'access', iv: 'iv', authTag: 'tag', keyId: 'key' },
      refreshToken: null,
      tokenExpiresAt: null,
      cloudId: 'cloud-1',
      webhookSecret: 'secret-1',
      createdBy: 'user-1',
    });

    expect(result).toBe(record);
    expect(insertedTables).toEqual([ticketingConnectionsTable, outboxEventsTable]);
    const values = calls.filter((call) => call.method === 'values').map((call) => call.args[0]);
    expect(values[0]).toEqual(
      expect.objectContaining({
        organizationId: 'org-1',
        webhookSecret: 'secret-1',
        webhookRegistrationStatus: 'pending',
        webhookRegistrationVersion: 1,
      }),
    );
    expect(values[1]).toEqual(
      expect.objectContaining({
        eventType: 'ticketing.jira.webhook.register.v1',
        organizationId: 'org-1',
        aggregateType: 'ticketing_connection_webhook',
        aggregateId: `${record.id}:2`,
        dedupeKey: `ticketing.jira.webhook.register:${record.id}:2`,
        payload: {
          organizationId: 'org-1',
          connectionId: record.id,
          registrationVersion: 2,
        },
      }),
    );
    expect(calls.some((call) => call.method === 'onConflictDoUpdate')).toBe(true);
    expect(calls.some((call) => call.method === 'onConflictDoNothing')).toBe(true);
  });

  it('completes registration only for the matching tenant, version, secret, and pending state', async () => {
    const calls: RecordedCall[] = [];
    const record = {
      id: '5a3d4557-abcb-4354-8d17-d7863fcfd3c5',
      webhookRegistrationVersion: 2,
      webhookRegistrationStatus: 'registered',
    };
    const repository = new TicketingRepository({
      update: () => chainable([record], calls),
    } as never);
    const complete = (
      repository as unknown as {
        completeWebhookRegistration: (input: Record<string, unknown>) => Promise<unknown>;
      }
    ).completeWebhookRegistration;

    await complete.call(repository, {
      id: record.id,
      organizationId: 'org-1',
      registrationVersion: 2,
      webhookSecret: 'secret-1',
      webhookId: 'webhook-42',
      webhookCloudId: 'cloud-1',
    });

    const set = calls.find((call) => call.method === 'set')?.args[0];
    const where = calls.find((call) => call.method === 'where')?.args[0];
    expect(set).toEqual(
      expect.objectContaining({
        webhookId: 'webhook-42',
        webhookCloudId: 'cloud-1',
        webhookRegistrationStatus: 'registered',
        webhookRegisteredAt: expect.any(Date),
      }),
    );
    expect(sqlContains(where, record.id)).toBe(true);
    expect(sqlContains(where, 'org-1')).toBe(true);
    expect(sqlContains(where, 2)).toBe(true);
    expect(sqlContains(where, 'secret-1')).toBe(true);
    expect(sqlContains(where, 'pending')).toBe(true);
  });

  it('atomically queues a bounded versioned renewal for due registered webhooks', async () => {
    const calls: RecordedCall[] = [];
    const insertedTables: unknown[] = [];
    const due = {
      id: '5a3d4557-abcb-4354-8d17-d7863fcfd3c5',
      organizationId: 'org-1',
      webhookRegistrationVersion: 4,
    };
    const queued = {
      ...due,
      registrationVersion: 5,
    };
    const transactionExecutor = {
      select: () => chainable([due], calls),
      update: () => chainable([queued], calls),
      insert: (table: unknown) => {
        insertedTables.push(table);
        return chainable([], calls);
      },
    };
    const repository = new TicketingRepository({
      transaction: (callback: (executor: unknown) => Promise<unknown>) =>
        callback(transactionExecutor),
    } as never);
    const queueDue = (
      repository as unknown as {
        queueDueJiraWebhookRenewals: (cutoff: Date, limit: number) => Promise<number>;
      }
    ).queueDueJiraWebhookRenewals;
    const cutoff = new Date('2026-07-08T12:00:00.000Z');

    const queuedCount = await queueDue.call(repository, cutoff, 100);

    expect(queuedCount).toBe(1);
    expect(insertedTables).toEqual([outboxEventsTable]);
    expect(calls.find((call) => call.method === 'for')?.args).toEqual([
      'update',
      { skipLocked: true },
    ]);
    expect(calls.some((call) => call.method === 'limit' && call.args[0] === 100)).toBe(true);
    const set = calls.find((call) => call.method === 'set')?.args[0];
    expect(set).toEqual(
      expect.objectContaining({
        webhookRegistrationStatus: 'pending',
        updatedAt: expect.any(Date),
      }),
    );
    const values = calls.find((call) => call.method === 'values')?.args[0];
    expect(values).toEqual([
      expect.objectContaining({
        eventType: 'ticketing.jira.webhook.register.v1',
        organizationId: 'org-1',
        aggregateId: `${due.id}:5`,
        dedupeKey: `ticketing.jira.webhook.register:${due.id}:5`,
        payload: {
          organizationId: 'org-1',
          connectionId: due.id,
          registrationVersion: 5,
          operation: 'renewal',
        },
      }),
    ]);
    const whereCalls = calls.filter((call) => call.method === 'where');
    expect(whereCalls.some((call) => sqlContains(call.args[0], 'registered'))).toBe(true);
    expect(whereCalls.some((call) => sqlContains(call.args[0], cutoff))).toBe(true);
  });

  it('does not double-version or enqueue rows skipped because another scanner holds the lock', async () => {
    const calls: RecordedCall[] = [];
    const transactionExecutor = {
      select: () => chainable([], calls),
      update: () => {
        throw new Error('update must not run without a locked candidate');
      },
      insert: () => {
        throw new Error('insert must not run without a locked candidate');
      },
    };
    const repository = new TicketingRepository({
      transaction: (callback: (executor: unknown) => Promise<unknown>) =>
        callback(transactionExecutor),
    } as never);

    const queued = await repository.queueDueJiraWebhookRenewals(
      new Date('2026-07-09T12:00:00.000Z'),
      100,
    );

    expect(queued).toBe(0);
    expect(calls.find((call) => call.method === 'for')?.args).toEqual([
      'update',
      { skipLocked: true },
    ]);
    expect(calls.some((call) => call.method === 'set')).toBe(false);
    expect(calls.some((call) => call.method === 'values')).toBe(false);
  });

  it('stores the retry payload with the durable creation reservation', async () => {
    const calls: RecordedCall[] = [];
    const record = unresolvedRecord();
    const repository = new TicketingRepository({
      insert: () => chainable([record], calls),
    } as never);

    await repository.reserveTicketCreation({
      findingTriageId: record.findingTriageId,
      organizationId: record.organizationId,
      provider: 'jira',
      metadata: {
        lastAttemptedProjectionVersion: 7,
        retryPayload: {
          findingOpensearchId: 'finding-1',
          title: 'SQL injection',
          description: 'Evidence',
        },
      },
    });

    const values = calls.find((call) => call.method === 'values')?.args[0] as Record<
      string,
      unknown
    >;
    expect(values.metadata).toEqual(
      expect.objectContaining({
        intentCreatedAt: expect.any(String),
        lastAttemptedProjectionVersion: 7,
        retryPayload: expect.objectContaining({ findingOpensearchId: 'finding-1' }),
      }),
    );
  });

  it('finalizes a Jira create only while the tenant reservation is still pending', async () => {
    const calls: RecordedCall[] = [];
    const repository = new TicketingRepository({
      update: () => chainable([unresolvedRecord()], calls),
    } as never);
    const finalize = (
      repository as unknown as {
        finalizeTicketCreation?: (input: Record<string, unknown>) => Promise<unknown>;
      }
    ).finalizeTicketCreation;

    expect(finalize).toBeDefined();
    if (!finalize) return;
    await finalize.call(repository, {
      id: unresolvedRecord().id,
      findingTriageId: unresolvedRecord().findingTriageId,
      organizationId: unresolvedRecord().organizationId,
      provider: 'jira',
      externalId: 'SEC-42',
      externalUrl: 'https://example.atlassian.net/browse/SEC-42',
      lastSyncedAt: new Date('2026-07-26T12:01:00.000Z'),
      metadata: { jiraIssueId: '12345' },
    });

    const where = calls.find((call) => call.method === 'where')?.args[0];
    expect(sqlContains(where, unresolvedRecord().id)).toBe(true);
    expect(sqlContains(where, unresolvedRecord().findingTriageId)).toBe(true);
    expect(sqlContains(where, 'organization_id')).toBe(true);
    expect(sqlContains(where, 'org-1')).toBe(true);
    expect(sqlContains(where, 'pending')).toBe(true);
    expect(sqlContains(where, 'sentris-pending:%')).toBe(true);
  });

  it('marks a Jira create unknown only while the tenant reservation is still pending', async () => {
    const calls: RecordedCall[] = [];
    const repository = new TicketingRepository({
      update: () => chainable([unresolvedRecord()], calls),
    } as never);
    const markUnknown = (
      repository as unknown as {
        markTicketCreationUnknown?: (input: Record<string, unknown>) => Promise<unknown>;
      }
    ).markTicketCreationUnknown;

    expect(markUnknown).toBeDefined();
    if (!markUnknown) return;
    await markUnknown.call(repository, {
      id: unresolvedRecord().id,
      findingTriageId: unresolvedRecord().findingTriageId,
      organizationId: unresolvedRecord().organizationId,
      provider: 'jira',
      metadata: { reconciliationRequired: true },
    });

    const where = calls.find((call) => call.method === 'where')?.args[0];
    expect(sqlContains(where, unresolvedRecord().id)).toBe(true);
    expect(sqlContains(where, unresolvedRecord().findingTriageId)).toBe(true);
    expect(sqlContains(where, 'organization_id')).toBe(true);
    expect(sqlContains(where, 'org-1')).toBe(true);
    expect(sqlContains(where, 'pending')).toBe(true);
    expect(sqlContains(where, 'sentris-pending:%')).toBe(true);
  });

  it('finds only pending or unknown placeholder intents in the requested organization', async () => {
    const calls: RecordedCall[] = [];
    const repository = new TicketingRepository({
      select: () => chainable([unresolvedRecord()], calls),
    } as never);

    await repository.findUnresolvedTicketIntent({
      findingTriageId: '8795d6a0-0371-4d4e-a28f-5cf38f419080',
      organizationId: 'org-1',
      provider: 'jira',
    });

    const where = calls.find((call) => call.method === 'where')?.args[0];
    expect(sqlContains(where, 'organization_id')).toBe(true);
    expect(sqlContains(where, 'org-1')).toBe(true);
    expect(sqlContains(where, 'pending')).toBe(true);
    expect(sqlContains(where, 'unknown')).toBe(true);
    expect(sqlContains(where, 'sentris-pending:%')).toBe(true);
  });

  it('atomically attaches and recovers the matching blocked triage event', async () => {
    const calls: RecordedCall[] = [];
    const transactionCalls: RecordedCall[] = [];
    const transactionExecutor = {
      update: () => chainable([unresolvedRecord()], calls),
      execute: (...args: unknown[]) => {
        transactionCalls.push({ method: 'execute', args });
        return Promise.resolve([{ scheduled: true }]);
      },
    };
    const repository = new TicketingRepository({
      transaction: (callback: (tx: unknown) => Promise<unknown>) => callback(transactionExecutor),
    } as never);

    await repository.attachUnresolvedTicketIntent({
      id: '5a3d4557-abcb-4354-8d17-d7863fcfd3c5',
      findingTriageId: '8795d6a0-0371-4d4e-a28f-5cf38f419080',
      organizationId: 'org-1',
      provider: 'jira',
      outboxAggregateId: 'finding-1',
      externalId: 'SEC-42',
      externalUrl: 'https://example.atlassian.net/browse/SEC-42',
      lastSyncedAt: new Date('2026-07-26T12:01:00.000Z'),
      metadata: { jiraIssueId: '12345' },
    });

    const where = calls.find((call) => call.method === 'where')?.args[0];
    expect(sqlContains(where, '5a3d4557-abcb-4354-8d17-d7863fcfd3c5')).toBe(true);
    expect(sqlContains(where, 'organization_id')).toBe(true);
    expect(sqlContains(where, 'org-1')).toBe(true);
    expect(sqlContains(where, 'pending')).toBe(true);
    expect(sqlContains(where, 'unknown')).toBe(true);
    expect(sqlContains(where, 'sentris-pending:%')).toBe(true);
    expect(transactionCalls).toHaveLength(1);
    expect(sqlContains(transactionCalls[0]?.args[0], 'org-1')).toBe(true);
    expect(sqlContains(transactionCalls[0]?.args[0], 'finding.triage.changed')).toBe(true);
    expect(sqlContains(transactionCalls[0]?.args[0], 'finding')).toBe(true);
    expect(sqlContains(transactionCalls[0]?.args[0], 'finding-1')).toBe(true);
    const retryQuery = new PgDialect().sqlToQuery(transactionCalls[0]?.args[0] as never);
    expect(retryQuery.sql).toContain(`"status" = 'dead'`);
    expect(retryQuery.sql).not.toContain(`"status" IN ('pending', 'processing')`);
  });

  it('aborts an attach when its same-transaction audit hook rejects', async () => {
    const calls: RecordedCall[] = [];
    let committed = false;
    const transactionExecutor: any = {
      update: () => chainable([unresolvedRecord()], calls),
      execute: () => Promise.resolve([{ scheduled: true }]),
      insert: () => chainable([], calls),
    };
    const repository = new TicketingRepository({
      transaction: async (callback: (tx: unknown) => Promise<unknown>) => {
        const result = await callback(transactionExecutor);
        committed = true;
        return result;
      },
    } as never);

    await expect(
      repository.attachUnresolvedTicketIntent(
        {
          id: '5a3d4557-abcb-4354-8d17-d7863fcfd3c5',
          findingTriageId: '8795d6a0-0371-4d4e-a28f-5cf38f419080',
          organizationId: 'org-1',
          provider: 'jira',
          outboxAggregateId: 'finding-1',
          externalId: 'SEC-42',
          externalUrl: 'https://example.atlassian.net/browse/SEC-42',
          lastSyncedAt: new Date('2026-07-26T12:01:00.000Z'),
          metadata: { jiraIssueId: '12345' },
        },
        async (executor) => {
          expect(executor).toBe(transactionExecutor);
          throw new Error('audit outbox unavailable');
        },
      ),
    ).rejects.toThrow('audit outbox unavailable');

    expect(committed).toBe(false);
  });

  it('atomically clears and recovers the matching blocked triage event', async () => {
    const calls: RecordedCall[] = [];
    const transactionCalls: RecordedCall[] = [];
    const transactionExecutor = {
      delete: () => chainable([unresolvedRecord()], calls),
      execute: (...args: unknown[]) => {
        transactionCalls.push({ method: 'execute', args });
        return Promise.resolve([{ scheduled: true }]);
      },
    };
    const repository = new TicketingRepository({
      transaction: (callback: (tx: unknown) => Promise<unknown>) => callback(transactionExecutor),
    } as never);

    await repository.clearUnresolvedTicketIntent({
      id: '5a3d4557-abcb-4354-8d17-d7863fcfd3c5',
      findingTriageId: '8795d6a0-0371-4d4e-a28f-5cf38f419080',
      organizationId: 'org-1',
      provider: 'jira',
      outboxAggregateId: 'finding-1',
    });

    const where = calls.find((call) => call.method === 'where')?.args[0];
    expect(sqlContains(where, 'organization_id')).toBe(true);
    expect(sqlContains(where, 'org-1')).toBe(true);
    expect(sqlContains(where, 'pending')).toBe(true);
    expect(sqlContains(where, 'unknown')).toBe(true);
    expect(sqlContains(where, 'sentris-pending:%')).toBe(true);
    expect(transactionCalls).toHaveLength(1);
    expect(sqlContains(transactionCalls[0]?.args[0], 'org-1')).toBe(true);
    expect(sqlContains(transactionCalls[0]?.args[0], 'finding.triage.changed')).toBe(true);
    expect(sqlContains(transactionCalls[0]?.args[0], 'finding')).toBe(true);
    expect(sqlContains(transactionCalls[0]?.args[0], 'finding-1')).toBe(true);
  });

  it('aborts a clear-and-retry when its same-transaction audit hook rejects', async () => {
    const calls: RecordedCall[] = [];
    let committed = false;
    const transactionExecutor: any = {
      delete: () => chainable([unresolvedRecord()], calls),
      execute: () => Promise.resolve([{ scheduled: true }]),
      insert: () => chainable([], calls),
    };
    const repository = new TicketingRepository({
      transaction: async (callback: (tx: unknown) => Promise<unknown>) => {
        const result = await callback(transactionExecutor);
        committed = true;
        return result;
      },
    } as never);

    await expect(
      repository.clearUnresolvedTicketIntent(
        {
          id: '5a3d4557-abcb-4354-8d17-d7863fcfd3c5',
          findingTriageId: '8795d6a0-0371-4d4e-a28f-5cf38f419080',
          organizationId: 'org-1',
          provider: 'jira',
          outboxAggregateId: 'finding-1',
        },
        async (executor) => {
          expect(executor).toBe(transactionExecutor);
          throw new Error('audit outbox unavailable');
        },
      ),
    ).rejects.toThrow('audit outbox unavailable');

    expect(committed).toBe(false);
  });

  it('aborts the transaction instead of committing a cleared intent without a durable event', async () => {
    const calls: RecordedCall[] = [];
    let committed = false;
    const transactionExecutor = {
      delete: () => chainable([unresolvedRecord()], calls),
      execute: () => Promise.resolve([{ scheduled: false }]),
    };
    const repository = new TicketingRepository({
      transaction: async (callback: (tx: unknown) => Promise<unknown>) => {
        const result = await callback(transactionExecutor);
        committed = true;
        return result;
      },
    } as never);

    await expect(
      repository.clearUnresolvedTicketIntent({
        id: '5a3d4557-abcb-4354-8d17-d7863fcfd3c5',
        findingTriageId: '8795d6a0-0371-4d4e-a28f-5cf38f419080',
        organizationId: 'org-1',
        provider: 'jira',
        outboxAggregateId: 'finding-1',
      }),
    ).rejects.toThrow('No durable triage event is available for ticket reconciliation');

    expect(calls.some((call) => call.method === 'where')).toBe(true);
    expect(committed).toBe(false);
  });

  it('releases a definitely rejected reservation only inside its tenant boundary', async () => {
    const calls: RecordedCall[] = [];
    const repository = new TicketingRepository({
      delete: () => chainable([], calls),
    } as never);

    await repository.releaseTicketCreationReservation({
      id: '5a3d4557-abcb-4354-8d17-d7863fcfd3c5',
      findingTriageId: '8795d6a0-0371-4d4e-a28f-5cf38f419080',
      organizationId: 'org-1',
      provider: 'jira',
    });

    const where = calls.find((call) => call.method === 'where')?.args[0];
    expect(sqlContains(where, 'organization_id')).toBe(true);
    expect(sqlContains(where, 'org-1')).toBe(true);
    expect(sqlContains(where, 'pending')).toBe(true);
    expect(sqlContains(where, 'sentris-pending:%')).toBe(true);
  });
});
