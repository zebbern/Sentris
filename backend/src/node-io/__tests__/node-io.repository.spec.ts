import { describe, expect, it, mock } from 'bun:test';

import { nodeIOTable, outboxEventsTable, type NodeIORecord } from '../../database/schema';
import { NodeIORepository } from '../node-io.repository';

interface Call {
  table?: unknown;
  method: string;
  args: unknown[];
}

function chainable(rows: unknown[], calls: Call[], table?: unknown) {
  const chain = new Proxy(
    {},
    {
      get(_target, property: string) {
        if (property === 'then') {
          return (resolve: (value: unknown) => void) => resolve(rows);
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

function sqlContains(node: unknown, expected: unknown): boolean {
  if (node === expected) return true;
  if (Array.isArray(node)) return node.some((entry) => sqlContains(entry, expected));
  if (!node || typeof node !== 'object') return false;
  const candidate = node as {
    value?: unknown;
    name?: unknown;
    queryChunks?: unknown[];
  };
  if (candidate.value === expected || candidate.name === expected) return true;
  if (Array.isArray(candidate.value)) {
    if (candidate.value.some((entry) => String(entry).includes(String(expected)))) return true;
  }
  return candidate.queryChunks?.some((chunk) => sqlContains(chunk, expected)) ?? false;
}

function existingNode(overrides: Partial<NodeIORecord> = {}): NodeIORecord {
  const now = new Date('2026-07-26T12:00:00.000Z');
  return {
    id: 1,
    runId: 'run-1',
    nodeRef: 'scanner',
    workflowId: 'workflow-1',
    organizationId: 'org-1',
    componentId: 'sentris.subfinder.run',
    inputs: {},
    inputsSize: 2,
    inputsSpilled: false,
    inputsStorageRef: null,
    outputs: null,
    outputsSize: 0,
    outputsSpilled: false,
    outputsStorageRef: null,
    startedAt: now,
    completedAt: null,
    durationMs: null,
    status: 'running',
    errorMessage: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe('NodeIORepository.recordCompletion', () => {
  it('commits recon completion and its idempotent asset projection event in one transaction', async () => {
    const calls: Call[] = [];
    const tx = {
      select: (...args: unknown[]) => {
        calls.push({ method: 'select', args });
        return chainable([existingNode()], calls);
      },
      insert: (table: unknown) => {
        calls.push({ table, method: 'insert', args: [] });
        return chainable([], calls, table);
      },
    };
    const transaction = mock(async (callback: (executor: typeof tx) => Promise<void>) =>
      callback(tx),
    );
    const db = {
      ...tx,
      transaction,
    };
    const repository = new NodeIORepository(db as never);

    await repository.recordCompletion({
      runId: 'run-1',
      nodeRef: 'scanner',
      componentId: 'sentris.subfinder.run',
      organizationId: 'org-1',
      outputs: { subdomains: ['a.example.com'] },
      status: 'completed',
      projectAssets: true,
      completionEventId: '2026-07-26T12:01:00.000Z',
      completedAt: new Date('2026-07-26T12:01:00.000Z'),
    });

    expect(transaction).toHaveBeenCalledTimes(1);
    expect(calls.some((call) => call.table === nodeIOTable && call.method === 'values')).toBe(true);
    const outboxValues = calls.find(
      (call) => call.table === outboxEventsTable && call.method === 'values',
    )?.args[0];
    expect(outboxValues).toMatchObject({
      eventType: 'asset.nodeio.completed',
      organizationId: 'org-1',
      aggregateType: 'node_io',
      aggregateId: 'run-1:scanner',
      dedupeKey: 'asset.nodeio.completed:run-1:scanner:2026-07-26T12:01:00.000Z',
      payload: {
        runId: 'run-1',
        nodeRef: 'scanner',
        componentId: 'sentris.subfinder.run',
      },
    });
    expect(
      calls.some(
        (call) => call.table === outboxEventsTable && call.method === 'onConflictDoNothing',
      ),
    ).toBe(true);
  });

  it('keeps non-recon completions off the transactional outbox path', async () => {
    const calls: Call[] = [];
    const db = {
      select: (...args: unknown[]) => {
        calls.push({ method: 'select', args });
        return chainable(
          [
            existingNode({
              nodeRef: 'notify',
              componentId: 'sentris.slack.send',
            }),
          ],
          calls,
        );
      },
      insert: (table: unknown) => {
        calls.push({ table, method: 'insert', args: [] });
        return chainable([], calls, table);
      },
      transaction: mock(async () => undefined),
    };
    const repository = new NodeIORepository(db as never);

    await repository.recordCompletion({
      runId: 'run-1',
      nodeRef: 'notify',
      componentId: 'sentris.slack.send',
      organizationId: 'org-1',
      outputs: { delivered: true },
      status: 'completed',
      projectAssets: false,
    });

    expect(db.transaction).not.toHaveBeenCalled();
    expect(calls.some((call) => call.table === nodeIOTable && call.method === 'values')).toBe(true);
    expect(calls.some((call) => call.table === outboxEventsTable)).toBe(false);
  });

  it('preserves large inline outputs when no object-storage reference exists', async () => {
    const calls: Call[] = [];
    const db = {
      select: () => chainable([existingNode()], calls),
      insert: (table: unknown) => {
        calls.push({ table, method: 'insert', args: [] });
        return chainable([], calls, table);
      },
    };
    const repository = new NodeIORepository(db as never);
    const outputs = { subdomains: ['large-inline.example.com'] };

    await repository.recordCompletionWithExecutor(db as never, {
      runId: 'run-1',
      nodeRef: 'scanner',
      componentId: 'sentris.subfinder.run',
      outputs,
      outputsSize: 120_000,
      status: 'completed',
    });

    const values = calls.find((call) => call.table === nodeIOTable && call.method === 'values')
      ?.args[0];
    expect(values).toMatchObject({
      outputs,
      outputsSize: 120_000,
      outputsSpilled: false,
      outputsStorageRef: null,
    });
  });

  it('rejects an explicit spilled completion without a storage reference', async () => {
    const calls: Call[] = [];
    const db = {
      select: () => chainable([existingNode()], calls),
      insert: (table: unknown) => {
        calls.push({ table, method: 'insert', args: [] });
        return chainable([], calls, table);
      },
    };
    const repository = new NodeIORepository(db as never);

    await expect(
      repository.recordCompletionWithExecutor(db as never, {
        runId: 'run-1',
        nodeRef: 'scanner',
        componentId: 'sentris.subfinder.run',
        outputs: {},
        outputsSize: 120_000,
        outputsSpilled: true,
        outputsStorageRef: null,
        status: 'completed',
      }),
    ).rejects.toThrow('Spilled node outputs require a storage reference');
    expect(calls.some((call) => call.method === 'values')).toBe(false);
  });
});

describe('NodeIORepository.recordStart', () => {
  it('derives duration when a replayed start arrives after terminal completion', async () => {
    const calls: Call[] = [];
    const db = {
      insert: (table: unknown) => {
        calls.push({ table, method: 'insert', args: [] });
        return chainable([], calls, table);
      },
    };
    const repository = new NodeIORepository(db as never);
    const startedAt = new Date('2026-07-26T12:00:00.000Z');

    await repository.recordStart({
      runId: 'run-1',
      nodeRef: 'scanner',
      workflowId: 'workflow-1',
      organizationId: 'org-1',
      componentId: 'sentris.subfinder.run',
      inputs: { target: 'example.com' },
      startedAt,
    });

    const conflict = calls.find((call) => call.method === 'onConflictDoUpdate')?.args[0] as {
      set?: { durationMs?: unknown };
    };
    expect(conflict.set?.durationMs).toBeDefined();
    expect(sqlContains(conflict.set?.durationMs, 'completed_at')).toBe(true);
    expect(sqlContains(conflict.set?.durationMs, 'duration_ms')).toBe(true);
    expect(sqlContains(conflict.set?.durationMs, startedAt)).toBe(true);
  });

  it('preserves large inline inputs when no object-storage reference exists', async () => {
    const calls: Call[] = [];
    const db = {
      insert: (table: unknown) => {
        calls.push({ table, method: 'insert', args: [] });
        return chainable([], calls, table);
      },
    };
    const repository = new NodeIORepository(db as never);
    const inputs = { target: 'large-inline.example.com' };

    await repository.recordStart({
      runId: 'run-1',
      nodeRef: 'scanner',
      workflowId: 'workflow-1',
      organizationId: 'org-1',
      componentId: 'sentris.subfinder.run',
      inputs,
      inputsSize: 120_000,
    });

    const values = calls.find((call) => call.table === nodeIOTable && call.method === 'values')
      ?.args[0];
    expect(values).toMatchObject({
      inputs,
      inputsSize: 120_000,
      inputsSpilled: false,
      inputsStorageRef: null,
    });
  });
});
