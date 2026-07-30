import { describe, expect, it, jest } from 'bun:test';

import {
  findingProjectionReconciliationTable,
  findingTriageEventsTable,
  findingTriageTable,
  outboxEventsTable,
  type FindingTriageRecord,
} from '../../database/schema';
import { PgDialect } from 'drizzle-orm/pg-core';
import { buildFindingObservationIndexName } from '@sentris/shared/finding-observation-id';
import { FindingTriageRepository } from '../finding-triage.repository';

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

describe('FindingTriageRepository.commitChange', () => {
  it('commits state, history, and versioned durable events in one transaction', async () => {
    const now = new Date('2026-07-26T12:00:00.000Z');
    const record: FindingTriageRecord = {
      id: '7f1ec7ea-4188-443e-8247-06b84e7d0435',
      organizationId: 'org-1',
      findingOpensearchId: 'finding-1',
      status: 'fixed',
      assigneeUserId: 'user-1',
      severityOverride: 'critical',
      notes: 'verified',
      slaDeadline: null,
      projectionVersion: 8,
      createdAt: now,
      updatedAt: now,
    };
    const calls: { table: unknown; method: string; args: unknown[] }[] = [];
    let activeTable: unknown;
    const tx = {
      insert: (table: unknown) => {
        activeTable = table;
        calls.push({ table, method: 'insert', args: [] });
        const tableCalls: { method: string; args: unknown[] }[] = [];
        const chain = chainable(table === findingTriageTable ? [record] : [], tableCalls);
        for (const call of tableCalls) {
          calls.push({ table: activeTable, ...call });
        }
        return new Proxy(chain, {
          get(target, property: string) {
            if (property === 'then') return Reflect.get(target, property);
            return (...args: unknown[]) => {
              calls.push({ table, method: property, args });
              return target;
            };
          },
        });
      },
    };
    const transaction = jest.fn(async (callback: (executor: typeof tx) => unknown) => callback(tx));
    const repository = new FindingTriageRepository({ transaction } as never);

    const result = await repository.commitChange({
      organizationId: 'org-1',
      findingOpensearchId: 'finding-1',
      triageId: record.id,
      expectedVersion: 7,
      previousStatus: 'in_progress',
      source: 'user',
      userId: 'user-1',
      data: {
        status: 'fixed',
        assigneeUserId: 'user-1',
        severityOverride: 'critical',
        notes: 'verified',
      },
      events: [
        {
          eventType: 'status_change',
          fieldChanged: 'status',
          oldValue: 'in_progress',
          newValue: 'fixed',
          comment: 'verified',
        },
      ],
    });

    expect(transaction).toHaveBeenCalledTimes(1);
    expect(result).toBe(record);
    const historyValues = calls.find(
      (call) => call.table === findingTriageEventsTable && call.method === 'values',
    )?.args[0];
    expect(historyValues).toEqual([
      expect.objectContaining({
        findingTriageId: record.id,
        eventType: 'status_change',
        userId: 'user-1',
      }),
    ]);
    const outboxValues = calls
      .filter((call) => call.table === outboxEventsTable && call.method === 'values')
      .map((call) => call.args[0] as Record<string, unknown>);
    expect(outboxValues).toHaveLength(2);
    expect(outboxValues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eventType: 'finding.triage.project.v1',
          dedupeKey: 'finding-triage-project:org-1:finding-1:v8',
        }),
        expect.objectContaining({
          eventType: 'finding.triage.changed',
          dedupeKey: 'finding-triage-changed:org-1:finding-1:v8',
        }),
      ]),
    );
  });
});

describe('FindingTriageRepository projection reconciliation state', () => {
  it('loads the exact durable OpenSearch composite discovery cursor', async () => {
    const cursor = {
      indexName: buildFindingObservationIndexName(' Org-A '),
      organizationId: ' Org-A ',
    };
    const calls: { method: string; args: unknown[] }[] = [];
    const db = {
      select: jest.fn().mockReturnValue(chainable([{ cursor: JSON.stringify(cursor) }], calls)),
    };
    const repository = new FindingTriageRepository(db as never);

    await expect(repository.getFindingObservationDiscoveryCursor()).resolves.toEqual(cursor);
    expect(calls.find((call) => call.method === 'limit')?.args).toEqual([1]);
  });

  it('persists the global discovery cursor in a reserved reconciliation-state row', async () => {
    const cursor = {
      indexName: buildFindingObservationIndexName('Org-A'),
      organizationId: 'Org-A',
    };
    const calls: { method: string; args: unknown[] }[] = [];
    const db = {
      insert: jest.fn((table) => {
        expect(table).toBe(findingProjectionReconciliationTable);
        return chainable([], calls);
      }),
    };
    const repository = new FindingTriageRepository(db as never);

    await repository.saveFindingObservationDiscoveryCursor(cursor);

    const values = calls.find((call) => call.method === 'values')?.args[0] as {
      organizationId: string;
      cursor: string;
    };
    expect(values.organizationId).toMatch(/^\p{Cc}/u);
    expect(JSON.parse(values.cursor)).toEqual(cursor);
    expect(
      (
        calls.find((call) => call.method === 'onConflictDoUpdate')?.args[0] as {
          target: unknown;
        }
      ).target,
    ).toBe(findingProjectionReconciliationTable.organizationId);
  });

  it('checks discovered organizations in one bounded exact-case batch', async () => {
    const calls: { method: string; args: unknown[] }[] = [];
    const db = {
      selectDistinct: jest
        .fn()
        .mockReturnValue(
          chainable([{ organizationId: 'Org-A' }, { organizationId: 'org-a' }], calls),
        ),
    };
    const repository = new FindingTriageRepository(db as never);

    await expect(
      repository.listExistingProjectionOrganizations(['Org-A', 'org-a', 'Org-A']),
    ).resolves.toEqual(['Org-A', 'org-a']);

    const where = calls.find((call) => call.method === 'where')?.args[0] as {
      getSQL(): unknown;
    };
    const compiled = new PgDialect().sqlToQuery(where.getSQL() as never);
    expect(compiled.sql).toContain('"finding_triage"."organization_id" in ($1, $2)');
    expect(compiled.params).toEqual(['Org-A', 'org-a']);
  });

  it('keyset-pages authoritative rows inside one organization and cycle cutoff', async () => {
    const calls: { method: string; args: unknown[] }[] = [];
    const db = {
      select: jest.fn().mockReturnValue(chainable([], calls)),
    };
    const repository = new FindingTriageRepository(db as never);
    const cutoff = new Date('2026-07-26T12:00:00.000Z');

    await repository.listProjectionPage('org-a', 'finding-0500', cutoff, 500);

    const where = calls.find((call) => call.method === 'where')?.args[0] as {
      getSQL(): unknown;
    };
    const compiled = new PgDialect().sqlToQuery(where.getSQL() as never);
    expect(compiled.sql).toContain('"finding_triage"."organization_id" = $1');
    expect(compiled.sql).toContain('"finding_triage"."updated_at" <= $2');
    expect(compiled.sql).toContain('"finding_triage"."id" > $3');
    expect(compiled.params).toEqual(['org-a', cutoff.toISOString(), 'finding-0500']);
    expect(calls.find((call) => call.method === 'limit')?.args).toEqual([500]);
  });

  it('upserts reconciliation state by tenant primary key without crossing organizations', async () => {
    const state = {
      organizationId: 'org-a',
      cursor: 'finding-0500',
      cycleStartedAt: new Date('2026-07-26T11:59:00.000Z'),
      cycleCutoff: new Date('2026-07-26T12:00:00.000Z'),
      checked: 500,
      repaired: 3,
      failed: 0,
      lastCompletedAt: null,
      reconciledThrough: null,
    };
    const calls: { method: string; args: unknown[] }[] = [];
    const db = {
      insert: jest.fn((table) => {
        expect(table).toBe(findingProjectionReconciliationTable);
        return chainable([{ ...state, updatedAt: new Date() }], calls);
      }),
    };
    const repository = new FindingTriageRepository(db as never);

    await repository.saveProjectionReconciliationState(state);

    expect(calls.find((call) => call.method === 'values')?.args[0]).toEqual(state);
    expect(
      (
        calls.find((call) => call.method === 'onConflictDoUpdate')?.args[0] as {
          target: unknown;
        }
      ).target,
    ).toBe(findingProjectionReconciliationTable.organizationId);
  });
});
