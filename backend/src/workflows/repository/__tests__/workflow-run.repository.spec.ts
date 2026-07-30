import { ConflictException } from '@nestjs/common';
import { describe, it, expect } from 'bun:test';

import { WorkflowRunRepository } from '../workflow-run.repository';
import type { WorkflowRunRecord } from '../../../database/schema';

function makeRunRecord(overrides: Partial<WorkflowRunRecord> = {}): WorkflowRunRecord {
  const now = new Date('2025-01-01T00:00:00Z');
  return {
    runId: 'run-1',
    workflowId: 'wf-1',
    workflowVersionId: 'ver-1',
    workflowVersion: 1,
    temporalRunId: null,
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
  } as WorkflowRunRecord;
}

interface MockCall {
  method: string;
  args: unknown[];
}

/**
 * Chainable Drizzle mock database. Every method call on the builder proxy
 * records itself and returns the proxy again, except when awaited — which
 * resolves to the configured rows. Returns the (untyped, constructor-ready)
 * db alongside a strongly-typed calls list for assertions.
 */
function createMockDb(
  rows: unknown[] | { insert?: unknown[]; select?: unknown[]; update?: unknown[] } = [],
): { db: never; calls: MockCall[] } {
  const calls: MockCall[] = [];
  const rowsFor = (operation: 'insert' | 'select' | 'update') =>
    Array.isArray(rows) ? rows : (rows[operation] ?? []);

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

  const db: Record<string, unknown> = {};
  db.select = (...args: unknown[]) => {
    calls.push({ method: 'select', args });
    return chainable(rowsFor('select'));
  };
  db.insert = (...args: unknown[]) => {
    calls.push({ method: 'insert', args });
    return chainable(rowsFor('insert'));
  };
  db.update = (...args: unknown[]) => {
    calls.push({ method: 'update', args });
    return chainable(rowsFor('update'));
  };
  db.transaction = async (callback: (executor: unknown) => Promise<unknown>) => {
    calls.push({ method: 'transaction', args: [callback] });
    return callback(db);
  };

  return { db: db as never, calls };
}

/** Recursively searches a Drizzle SQL node's queryChunks for a bound Param with the given value. */
function sqlContainsParamValue(node: unknown, value: unknown): boolean {
  if (!node || typeof node !== 'object') return false;
  const n = node as { constructor?: { name?: string }; value?: unknown; queryChunks?: unknown[] };
  if (n.constructor?.name === 'Param' && n.value === value) return true;
  if (Array.isArray(n.queryChunks)) {
    return n.queryChunks.some((chunk) => sqlContainsParamValue(chunk, value));
  }
  return false;
}

/** Recursively searches a Drizzle SQL node's queryChunks for a column reference with the given name. */
function sqlContainsColumn(node: unknown, name: string): boolean {
  if (!node || typeof node !== 'object') return false;
  const n = node as { name?: string; queryChunks?: unknown[] };
  if (n.name === name) return true;
  if (Array.isArray(n.queryChunks)) {
    return n.queryChunks.some((chunk) => sqlContainsColumn(chunk, name));
  }
  return false;
}

describe('WorkflowRunRepository', () => {
  describe('prepare', () => {
    const preparedInput: Parameters<WorkflowRunRepository['prepare']>[0] = {
      runId: 'run-1',
      workflowId: 'wf-1',
      workflowVersionId: 'ver-1',
      workflowVersion: 1,
      totalActions: 1,
      inputs: { target: 'example.com' },
      organizationId: 'org-1',
      triggerType: 'manual' as const,
      triggerSource: 'user-1',
      triggerLabel: 'Manual run',
      inputPreview: {
        runtimeInputs: { target: 'example.com' },
        nodeOverrides: {},
      },
      parentRunId: null,
      parentNodeRef: null,
      scopeId: '11111111-1111-4111-8111-111111111111',
    };
    const makePreparedRecord = (
      overrides: Partial<typeof preparedInput> = {},
    ): WorkflowRunRecord => {
      const input = { ...preparedInput, ...overrides };
      return makeRunRecord({
        runId: input.runId,
        workflowId: input.workflowId,
        workflowVersionId: input.workflowVersionId,
        workflowVersion: input.workflowVersion,
        temporalRunId: input.temporalRunId ?? null,
        parentRunId: input.parentRunId ?? null,
        parentNodeRef: input.parentNodeRef ?? null,
        scopeId: input.scopeId ?? null,
        totalActions: input.totalActions,
        inputs: input.inputs,
        triggerType: input.triggerType,
        triggerSource: input.triggerSource ?? null,
        triggerLabel: input.triggerLabel ?? 'Manual run',
        inputPreview: input.inputPreview ?? { runtimeInputs: {}, nodeOverrides: {} },
        organizationId: input.organizationId ?? null,
      });
    };

    it('inserts once, invokes the durable hook once, and reports creation', async () => {
      const inserted = makePreparedRecord();
      const { db, calls } = createMockDb({ insert: [inserted] });
      const repository = new WorkflowRunRepository(db);
      let hookCalls = 0;

      const result = await repository.prepare(preparedInput, async () => {
        hookCalls += 1;
      });

      expect(result).toEqual({ record: inserted, created: true });
      expect(hookCalls).toBe(1);
      expect(calls.some((call) => call.method === 'onConflictDoNothing')).toBe(true);
      expect(calls.some((call) => call.method === 'transaction')).toBe(true);
    });

    it('rolls back preparation when the durable hook rejects', async () => {
      const inserted = makePreparedRecord();
      const { db, calls } = createMockDb({ insert: [inserted] });
      const repository = new WorkflowRunRepository(db);

      await expect(
        repository.prepare(preparedInput, async () => {
          throw new Error('audit outbox unavailable');
        }),
      ).rejects.toThrow('audit outbox unavailable');

      expect(calls.some((call) => call.method === 'transaction')).toBe(true);
    });

    it('returns an exact concurrent replay without mutating or auditing it', async () => {
      const existing = makePreparedRecord();
      const { db, calls } = createMockDb({ insert: [], select: [existing] });
      const repository = new WorkflowRunRepository(db);
      let hookCalls = 0;

      const result = await repository.prepare(preparedInput, async () => {
        hookCalls += 1;
      });

      expect(result).toEqual({ record: existing, created: false });
      expect(hookCalls).toBe(0);
      expect(calls.some((call) => call.method === 'update')).toBe(false);
      expect(calls.some((call) => call.method === 'onConflictDoUpdate')).toBe(false);
    });

    it('rejects reuse when any execution-defining field differs', async () => {
      const mismatches: Partial<typeof preparedInput>[] = [
        { workflowVersionId: 'ver-2' },
        { workflowVersion: 2 },
        { totalActions: 2 },
        { inputs: { target: 'changed.example' } },
        { triggerType: 'schedule' as const },
        { triggerSource: 'schedule-1' },
        { triggerLabel: 'Scheduled run' },
        {
          inputPreview: {
            runtimeInputs: { target: 'changed.example' },
            nodeOverrides: {},
          },
        },
        { parentRunId: 'parent-2' },
        { parentNodeRef: 'node-2' },
        { scopeId: '22222222-2222-4222-8222-222222222222' },
        { organizationId: 'org-2' },
        { workflowId: 'wf-2' },
      ];

      for (const mismatch of mismatches) {
        const existing = makePreparedRecord(mismatch);
        const { db, calls } = createMockDb({ insert: [], select: [existing] });
        const repository = new WorkflowRunRepository(db);
        let hookCalls = 0;

        await expect(
          repository.prepare(preparedInput, async () => {
            hookCalls += 1;
          }),
        ).rejects.toBeInstanceOf(ConflictException);

        expect(hookCalls).toBe(0);
        expect(calls.some((call) => call.method === 'update')).toBe(false);
      }
    });
  });

  describe('markStarted', () => {
    it('reports the one prepared-to-started transition', async () => {
      const started = makeRunRecord({ temporalRunId: 'temporal-1' });
      const { db, calls } = createMockDb({ update: [started] });
      const repository = new WorkflowRunRepository(db);
      let hookExecutor: unknown;

      await expect(
        repository.markStarted(
          {
            runId: 'run-1',
            workflowId: 'wf-1',
            organizationId: 'org-1',
            temporalRunId: 'temporal-1',
          },
          async (executor) => {
            hookExecutor = executor;
          },
        ),
      ).resolves.toEqual({ record: started, transitioned: true });
      expect(hookExecutor).toBe(db);
      expect(calls.some((call) => call.method === 'transaction')).toBe(true);
    });

    it('rolls back the started transition when run-count persistence rejects', async () => {
      const started = makeRunRecord({ temporalRunId: 'temporal-1' });
      const { db } = createMockDb({ update: [started] });
      const repository = new WorkflowRunRepository(db);

      await expect(
        repository.markStarted(
          {
            runId: 'run-1',
            workflowId: 'wf-1',
            organizationId: 'org-1',
            temporalRunId: 'temporal-1',
          },
          async () => {
            throw new Error('workflow metrics unavailable');
          },
        ),
      ).rejects.toThrow('workflow metrics unavailable');
    });

    it('treats the same persisted Temporal run as an exact replay', async () => {
      const started = makeRunRecord({ temporalRunId: 'temporal-1' });
      const { db } = createMockDb({ update: [], select: [started] });
      const repository = new WorkflowRunRepository(db);

      await expect(
        repository.markStarted({
          runId: 'run-1',
          workflowId: 'wf-1',
          organizationId: 'org-1',
          temporalRunId: 'temporal-1',
        }),
      ).resolves.toEqual({ record: started, transitioned: false });
    });

    it('fails closed if the run belongs elsewhere or points at another Temporal execution', async () => {
      const conflicting = makeRunRecord({
        workflowId: 'wf-other',
        temporalRunId: 'temporal-other',
      });
      const { db } = createMockDb({ update: [], select: [conflicting] });
      const repository = new WorkflowRunRepository(db);

      await expect(
        repository.markStarted({
          runId: 'run-1',
          workflowId: 'wf-1',
          organizationId: 'org-1',
          temporalRunId: 'temporal-1',
        }),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('scopeBelongsToOrganization', () => {
    it('checks both scope id and organization id', async () => {
      const { db, calls } = createMockDb([{ id: 'scope-1' }]);
      const repository = new WorkflowRunRepository(db);

      expect(await repository.scopeBelongsToOrganization('scope-1', 'org-1')).toBe(true);

      const where = calls.find((call) => call.method === 'where')?.args[0];
      expect(sqlContainsColumn(where, 'id')).toBe(true);
      expect(sqlContainsParamValue(where, 'scope-1')).toBe(true);
      expect(sqlContainsColumn(where, 'organization_id')).toBe(true);
      expect(sqlContainsParamValue(where, 'org-1')).toBe(true);
    });
  });

  describe('list', () => {
    it('filters by scopeId when provided', async () => {
      const { db, calls } = createMockDb([]);
      const repository = new WorkflowRunRepository(db);

      await repository.list({ scopeId: 'scope-1' });

      const whereCall = calls.find((c) => c.method === 'where');
      expect(whereCall).toBeDefined();
      const condition = whereCall!.args[0];
      expect(sqlContainsColumn(condition, 'scope_id')).toBe(true);
      expect(sqlContainsParamValue(condition, 'scope-1')).toBe(true);
    });

    it('does not filter by scope when scopeId is omitted', async () => {
      const { db, calls } = createMockDb([]);
      const repository = new WorkflowRunRepository(db);

      await repository.list({});

      const whereCall = calls.find((c) => c.method === 'where');
      expect(whereCall).toBeUndefined();
    });
  });
});
