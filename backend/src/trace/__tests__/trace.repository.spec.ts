import { describe, expect, it, mock } from 'bun:test';

import { TraceRepository } from '../trace.repository';

const SENTRIS_RUN_ID = 'sentris-run-123e4567-e89b-12d3-a456-426614174000';
const UUID_RUN_ID = '123e4567-e89b-12d3-a456-426614174000';
const DETERMINISTIC_RUN_ID = `sentris-run-${'a'.repeat(64)}`;
const DETERMINISTIC_CHANNEL = 'trace_events_h_d6ed1d9f2dd4092a8434c9bf1e75891a8ea392eab0569875';

function makeRepository(pool: unknown) {
  const repository = new TraceRepository(
    {} as any,
    {
      get: mock(() => 'postgres://sentris:test@localhost:5432/sentris_test'),
    } as any,
  );

  (repository as any).pool = pool;
  return repository;
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
