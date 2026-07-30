import { describe, expect, it } from 'bun:test';

import type { WorkflowRunRecord } from '../../../database/schema';
import { WorkflowRunRepository } from '../workflow-run.repository';

interface Call {
  method: string;
  args: unknown[];
}

function run(overrides: Partial<WorkflowRunRecord> = {}): WorkflowRunRecord {
  const now = new Date('2026-07-26T10:00:00.000Z');
  return {
    runId: 'run-1',
    workflowId: '00000000-0000-4000-8000-000000000001',
    workflowVersionId: null,
    workflowVersion: 1,
    temporalRunId: 'temporal-run-1',
    parentRunId: null,
    parentNodeRef: null,
    scopeId: null,
    totalActions: 1,
    inputs: {},
    triggerType: 'manual',
    triggerSource: null,
    triggerLabel: 'Manual run',
    inputPreview: { runtimeInputs: {}, nodeOverrides: {} },
    organizationId: 'org-1',
    status: null,
    closeTime: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function fakeTransaction(selectRows: WorkflowRunRecord[], updateRows: WorkflowRunRecord[]) {
  const calls: Call[] = [];
  const chain = (rows: unknown[]) => {
    const proxy = new Proxy(
      {},
      {
        get(_target, property: string) {
          if (property === 'then') {
            return (resolve: (value: unknown) => void) => resolve(rows);
          }
          return (...args: unknown[]) => {
            calls.push({ method: property, args });
            return proxy;
          };
        },
      },
    );
    return proxy;
  };
  const tx = {
    select: (...args: unknown[]) => {
      calls.push({ method: 'select', args });
      return chain(selectRows);
    },
    update: (...args: unknown[]) => {
      calls.push({ method: 'update', args });
      return chain(updateRows);
    },
    insert: (...args: unknown[]) => {
      calls.push({ method: 'insert', args });
      return chain([]);
    },
  };
  const db = {
    transaction: async (callback: (executor: typeof tx) => Promise<unknown>) => callback(tx),
  };
  return { db, calls };
}

function sqlContains(node: unknown, expected: unknown): boolean {
  if (!node || typeof node !== 'object') return false;
  const candidate = node as {
    name?: string;
    value?: unknown;
    queryChunks?: unknown[];
    constructor?: { name?: string };
  };
  if (candidate.name === expected) return true;
  if (candidate.constructor?.name === 'Param' && candidate.value === expected) return true;
  return candidate.queryChunks?.some((chunk) => sqlContains(chunk, expected)) ?? false;
}

describe('WorkflowRunRepository.finalizeTerminalRun', () => {
  it('updates the exact tenant and enqueues the stable terminal event in one transaction', async () => {
    const completedAt = new Date('2026-07-26T12:00:00.000Z');
    const existing = run();
    const updated = run({ status: 'COMPLETED', closeTime: completedAt });
    const { db, calls } = fakeTransaction([existing], [updated]);
    const repository = new WorkflowRunRepository(db as never);

    const result = await repository.finalizeTerminalRun({
      runId: 'run-1',
      organizationId: 'org-1',
      status: 'COMPLETED',
      completedAt,
    });

    expect(result).toEqual({ record: updated, duplicate: false });
    const whereCalls = calls.filter((call) => call.method === 'where');
    expect(whereCalls.some((call) => sqlContains(call.args[0], 'organization_id'))).toBe(true);
    expect(whereCalls.some((call) => sqlContains(call.args[0], 'org-1'))).toBe(true);
    const outboxValues = calls
      .filter((call) => call.method === 'values')
      .map((call) => call.args[0])
      .find((value) => (value as { dedupeKey?: string }).dedupeKey === 'run.status.terminal:run-1');
    expect(outboxValues).toMatchObject({
      organizationId: 'org-1',
      eventType: 'run.status.terminal',
      aggregateType: 'workflow_run',
      aggregateId: 'run-1',
      dedupeKey: 'run.status.terminal:run-1',
    });
  });

  it('does not expose or update a run outside the supplied tenant', async () => {
    const { db, calls } = fakeTransaction([], []);
    const repository = new WorkflowRunRepository(db as never);

    const result = await repository.finalizeTerminalRun({
      runId: 'run-1',
      organizationId: 'foreign-org',
      status: 'FAILED',
      completedAt: new Date(),
    });

    expect(result).toBeUndefined();
    expect(calls.some((call) => call.method === 'update')).toBe(false);
    expect(calls.some((call) => call.method === 'insert')).toBe(false);
  });

  it('keeps the first terminal state and deduplicates repeated callbacks', async () => {
    const completedAt = new Date('2026-07-26T12:00:00.000Z');
    const existing = run({ status: 'COMPLETED', closeTime: completedAt });
    const { db, calls } = fakeTransaction([existing], []);
    const repository = new WorkflowRunRepository(db as never);

    const result = await repository.finalizeTerminalRun({
      runId: 'run-1',
      organizationId: 'org-1',
      status: 'FAILED',
      completedAt: new Date('2026-07-26T12:01:00.000Z'),
    });

    expect(result).toEqual({ record: existing, duplicate: true });
    expect(calls.some((call) => call.method === 'update')).toBe(false);
    expect(calls.some((call) => call.method === 'onConflictDoNothing')).toBe(true);
    const values = calls.find((call) => call.method === 'values')?.args[0];
    expect(values).toMatchObject({
      dedupeKey: 'run.status.terminal:run-1',
      payload: expect.objectContaining({ status: 'COMPLETED' }),
    });
  });
});

describe('WorkflowRunRepository.listUnfinalized', () => {
  it('uses a bounded query for tenant-owned non-terminal runs', async () => {
    const calls: Call[] = [];
    const chain = new Proxy(
      {},
      {
        get(_target, property: string) {
          if (property === 'then') {
            return (resolve: (value: unknown) => void) => resolve([]);
          }
          return (...args: unknown[]) => {
            calls.push({ method: property, args });
            return chain;
          };
        },
      },
    );
    const db = {
      select: (...args: unknown[]) => {
        calls.push({ method: 'select', args });
        return chain;
      },
    };
    const repository = new WorkflowRunRepository(db as never);

    await repository.listUnfinalized({ limit: 40 });

    expect(calls.find((call) => call.method === 'limit')?.args[0]).toBe(40);
    const where = calls.find((call) => call.method === 'where')?.args[0];
    expect(sqlContains(where, 'organization_id')).toBe(true);
    expect(sqlContains(where, 'status')).toBe(true);
  });

  it('applies a stable created-at and run-id keyset cursor', async () => {
    const calls: Call[] = [];
    const chain = new Proxy(
      {},
      {
        get(_target, property: string) {
          if (property === 'then') {
            return (resolve: (value: unknown) => void) => resolve([]);
          }
          return (...args: unknown[]) => {
            calls.push({ method: property, args });
            return chain;
          };
        },
      },
    );
    const db = {
      select: (...args: unknown[]) => {
        calls.push({ method: 'select', args });
        return chain;
      },
    };
    const repository = new WorkflowRunRepository(db as never);
    const createdAt = new Date('2026-07-26T10:00:00.000Z');

    await repository.listUnfinalized({
      limit: 25,
      after: { createdAt, runId: 'run-50' },
    });

    const where = calls.find((call) => call.method === 'where')?.args[0];
    expect(sqlContains(where, createdAt)).toBe(true);
    expect(sqlContains(where, 'run-50')).toBe(true);
    expect(calls.filter((call) => call.method === 'orderBy')).toHaveLength(1);
  });
});
