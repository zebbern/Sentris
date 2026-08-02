import { describe, expect, it, mock } from 'bun:test';
import { PgDialect } from 'drizzle-orm/pg-core';

import type { WorkflowTraceRecord } from '../../database/schema';
import { TraceRepository } from '../trace.repository';

const SENTRIS_RUN_ID = 'sentris-run-123e4567-e89b-12d3-a456-426614174000';
const UUID_RUN_ID = '123e4567-e89b-12d3-a456-426614174000';
const DETERMINISTIC_RUN_ID = `sentris-run-${'a'.repeat(64)}`;
const DETERMINISTIC_CHANNEL = 'trace_events_h_d6ed1d9f2dd4092a8434c9bf1e75891a8ea392eab0569875';

function makeRepository(pool: unknown, db: unknown = {}) {
  const repository = new TraceRepository(
    db as any,
    {
      get: mock(() => 'postgres://sentris:test@localhost:5432/sentris_test'),
    } as any,
  );

  (repository as any).pool = pool;
  return repository;
}

interface QueryCall {
  query: number;
  method: string;
  args: unknown[];
}

function summaryDb(selectResults: unknown[][]) {
  const calls: QueryCall[] = [];
  let query = 0;

  const db = {
    select: mock((...selectArgs: unknown[]) => {
      const queryIndex = query++;
      calls.push({ query: queryIndex, method: 'select', args: selectArgs });
      const rows = selectResults[queryIndex] ?? [];
      const builder = new Proxy(
        {},
        {
          get(_target, property: string) {
            if (property === 'then') {
              return (resolve: (value: unknown) => void) => resolve(rows);
            }
            return (...args: unknown[]) => {
              calls.push({ query: queryIndex, method: property, args });
              return builder;
            };
          },
        },
      );
      return builder;
    }),
  };

  return { db, calls };
}

function traceRecord(sequence: number, type: WorkflowTraceRecord['type']): WorkflowTraceRecord {
  return {
    id: sequence,
    runId: 'run-summary',
    workflowId: 'workflow-id',
    organizationId: 'org-summary',
    type,
    nodeRef: `node-${sequence}`,
    timestamp: new Date(`2026-08-02T10:00:${String(sequence).padStart(2, '0')}.000Z`),
    message: null,
    error: null,
    outputSummary: null,
    level: type === 'NODE_FAILED' ? 'error' : 'info',
    data: null,
    sequence,
    createdAt: new Date('2026-08-02T10:01:00.000Z'),
  };
}

describe('TraceRepository run notification channels', () => {
  it('notifies sentris-prefixed run IDs', async () => {
    const query = mock(async () => undefined);
    const repository = makeRepository({ query });

    await repository.notifyRun(SENTRIS_RUN_ID, '{"sequence":1}');

    expect(query).toHaveBeenCalledWith('SELECT pg_notify($1, $2)', [
      `trace_events_${SENTRIS_RUN_ID}`,
      '{"sequence":1}',
    ]);
  });

  it('subscribes to sentris-prefixed run IDs', async () => {
    const query = mock(async () => undefined);
    const on = mock(() => undefined);
    const release = mock(() => undefined);
    const connect = mock(async () => ({ query, on, release }));
    const repository = makeRepository({ connect });

    const unsubscribe = await repository.subscribeToRun(SENTRIS_RUN_ID, () => undefined);

    expect(query).toHaveBeenCalledWith(`LISTEN "trace_events_${SENTRIS_RUN_ID}"`);

    await unsubscribe();

    expect(query).toHaveBeenCalledWith(`UNLISTEN "trace_events_${SENTRIS_RUN_ID}"`);
    expect(release).toHaveBeenCalled();
  });

  it('keeps accepting legacy UUID run IDs', async () => {
    const query = mock(async () => undefined);
    const repository = makeRepository({ query });

    await repository.notifyRun(UUID_RUN_ID, '{"sequence":1}');

    expect(query).toHaveBeenCalledWith('SELECT pg_notify($1, $2)', [
      `trace_events_${UUID_RUN_ID}`,
      '{"sequence":1}',
    ]);
  });

  it('uses the same bounded channel for deterministic run notifications and subscriptions', async () => {
    const notifyQuery = mock(async () => undefined);
    const repository = makeRepository({ query: notifyQuery });

    await repository.notifyRun(DETERMINISTIC_RUN_ID, '{"sequence":1}');

    expect(notifyQuery).toHaveBeenCalledWith('SELECT pg_notify($1, $2)', [
      DETERMINISTIC_CHANNEL,
      '{"sequence":1}',
    ]);
    expect(Buffer.byteLength(DETERMINISTIC_CHANNEL, 'utf8')).toBeLessThanOrEqual(63);

    const subscriptionQuery = mock(async () => undefined);
    const on = mock(() => undefined);
    const release = mock(() => undefined);
    const connect = mock(async () => ({ query: subscriptionQuery, on, release }));
    (repository as any).pool = { connect };

    const unsubscribe = await repository.subscribeToRun(DETERMINISTIC_RUN_ID, () => undefined);

    expect(subscriptionQuery).toHaveBeenCalledWith(`LISTEN "${DETERMINISTIC_CHANNEL}"`);
    await unsubscribe();
    expect(subscriptionQuery).toHaveBeenCalledWith(`UNLISTEN "${DETERMINISTIC_CHANNEL}"`);
  });

  it('hashes unsafe run IDs instead of interpolating them into SQL identifiers', async () => {
    const query = mock(async () => undefined);
    const repository = makeRepository({ query });
    const unsafeRunId = `${SENTRIS_RUN_ID}";DROP TABLE traces;--`;

    const clientQuery = mock(async (_sql: string) => undefined);
    const connect = mock(async () => ({
      query: clientQuery,
      on: mock(() => undefined),
      release: mock(() => undefined),
    }));
    (repository as any).pool = { connect };

    await repository.subscribeToRun(unsafeRunId, () => undefined);

    const listenSql = String(clientQuery.mock.calls[0]?.[0]);
    expect(listenSql).toMatch(/^LISTEN "trace_events_h_[a-f0-9]{48}"$/);
    expect(listenSql).not.toContain(unsafeRunId);
  });

  it('derives distinct channels for distinct non-UUID run IDs', async () => {
    const query = mock(async (_sql: string, _params?: unknown[]) => undefined);
    const repository = makeRepository({ query });

    await repository.notifyRun(DETERMINISTIC_RUN_ID, '{}');
    await repository.notifyRun(`sentris-run-${'b'.repeat(64)}`, '{}');

    const firstChannel = query.mock.calls[0]?.[1]?.[0];
    const secondChannel = query.mock.calls[1]?.[1]?.[0];
    expect(firstChannel).not.toBe(secondChannel);
  });

  it('rejects an empty run ID', async () => {
    const query = mock(async () => undefined);
    const repository = makeRepository({ query });

    await expect(repository.notifyRun('', '{}')).rejects.toThrow('runId must not be empty');
    expect(query).not.toHaveBeenCalled();
  });
});

describe('TraceRepository bounded run summaries', () => {
  it('counts the run while fetching only the requested latest failed and recent rows', async () => {
    const failedNewestFirst = [traceRecord(25, 'NODE_FAILED'), traceRecord(20, 'NODE_FAILED')];
    const recentNewestFirst = [
      traceRecord(25, 'NODE_FAILED'),
      traceRecord(24, 'NODE_COMPLETED'),
      traceRecord(23, 'NODE_PROGRESS'),
    ];
    const { db, calls } = summaryDb([
      [{ value: 25 }],
      [{ value: 11 }],
      failedNewestFirst,
      recentNewestFirst,
    ]);
    const repository = makeRepository({ end: mock(async () => undefined) }, db);

    const summary = await repository.summarizeRun(
      'run-summary',
      { failedLimit: 2, recentLimit: 3 },
      'org-summary',
    );

    expect(summary.totalEvents).toBe(25);
    expect(summary.failedEventCount).toBe(11);
    expect(summary.failed.map((event) => event.sequence)).toEqual([20, 25]);
    expect(summary.recent.map((event) => event.sequence)).toEqual([23, 24, 25]);
    expect(
      calls
        .filter((call) => call.method === 'limit')
        .map((call) => ({ query: call.query, limit: call.args[0] })),
    ).toEqual([
      { query: 2, limit: 2 },
      { query: 3, limit: 3 },
    ]);

    const failedWhere = calls.find((call) => call.query === 2 && call.method === 'where');
    const compiled = new PgDialect().sqlToQuery(
      (failedWhere?.args[0] as { getSQL(): unknown }).getSQL() as never,
    );
    expect(compiled.sql).toContain('"workflow_traces"."run_id" = $');
    expect(compiled.sql).toContain('"workflow_traces"."organization_id" = $');
    expect(compiled.sql).toContain('"workflow_traces"."level" = $');
    expect(compiled.sql).toMatch(/"workflow_traces"\."type" in \(\$\d+, \$\d+\)/);
    expect(compiled.params).toEqual(
      expect.arrayContaining([
        'run-summary',
        'org-summary',
        'error',
        'NODE_FAILED',
        'HTTP_REQUEST_ERROR',
      ]),
    );
  });

  it('rejects limits that could turn a diagnostic request into an unbounded read', async () => {
    const { db, calls } = summaryDb([]);
    const repository = makeRepository({ end: mock(async () => undefined) }, db);

    await expect(
      repository.summarizeRun('run-summary', { failedLimit: 101, recentLimit: 3 }, 'org-summary'),
    ).rejects.toThrow('failedLimit must be an integer between 1 and 100');
    expect(calls).toHaveLength(0);
  });
});
