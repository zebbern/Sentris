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
function createMockDb(rows: unknown[] = []): { db: never; calls: MockCall[] } {
  const calls: MockCall[] = [];

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
    select: (...args: unknown[]) => {
      calls.push({ method: 'select', args });
      return chainable(rows);
    },
    insert: (...args: unknown[]) => {
      calls.push({ method: 'insert', args });
      return chainable(rows);
    },
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
  describe('upsert', () => {
    it('sets scopeId in both the insert values and the conflict update values', async () => {
      const { db, calls } = createMockDb([makeRunRecord({ scopeId: 'scope-1' })]);
      const repository = new WorkflowRunRepository(db);

      await repository.upsert({
        runId: 'run-1',
        workflowId: 'wf-1',
        workflowVersionId: 'ver-1',
        workflowVersion: 1,
        totalActions: 1,
        inputs: {},
        organizationId: 'org-1',
        triggerType: 'manual',
        scopeId: 'scope-1',
      });

      const valuesCall = calls.find((c) => c.method === 'values');
      const conflictCall = calls.find((c) => c.method === 'onConflictDoUpdate');
      expect(valuesCall?.args[0]).toMatchObject({ scopeId: 'scope-1' });
      expect((conflictCall?.args[0] as { set: Record<string, unknown> }).set).toMatchObject({
        scopeId: 'scope-1',
      });
    });

    it('nulls scopeId in both blocks when explicitly passed null', async () => {
      const { db, calls } = createMockDb([makeRunRecord()]);
      const repository = new WorkflowRunRepository(db);

      await repository.upsert({
        runId: 'run-1',
        workflowId: 'wf-1',
        workflowVersionId: 'ver-1',
        workflowVersion: 1,
        totalActions: 1,
        inputs: {},
        organizationId: 'org-1',
        triggerType: 'manual',
        scopeId: null,
      });

      const valuesCall = calls.find((c) => c.method === 'values');
      const conflictCall = calls.find((c) => c.method === 'onConflictDoUpdate');
      expect(valuesCall?.args[0]).toMatchObject({ scopeId: null });
      expect((conflictCall?.args[0] as { set: Record<string, unknown> }).set).toMatchObject({
        scopeId: null,
      });
    });

    it('omits scopeId from both blocks when not provided', async () => {
      const { db, calls } = createMockDb([makeRunRecord()]);
      const repository = new WorkflowRunRepository(db);

      await repository.upsert({
        runId: 'run-1',
        workflowId: 'wf-1',
        workflowVersionId: 'ver-1',
        workflowVersion: 1,
        totalActions: 1,
        inputs: {},
        organizationId: 'org-1',
        triggerType: 'manual',
      });

      const valuesCall = calls.find((c) => c.method === 'values');
      const conflictCall = calls.find((c) => c.method === 'onConflictDoUpdate');
      expect(valuesCall?.args[0]).not.toHaveProperty('scopeId');
      expect((conflictCall?.args[0] as { set: Record<string, unknown> }).set).not.toHaveProperty(
        'scopeId',
      );
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
