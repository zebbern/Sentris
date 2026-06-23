import { describe, expect, it, mock } from 'bun:test';

import { TraceRepository } from '../trace.repository';

const SENTRIS_RUN_ID = 'sentris-run-123e4567-e89b-12d3-a456-426614174000';
const UUID_RUN_ID = '123e4567-e89b-12d3-a456-426614174000';

function makeRepository(pool: unknown) {
  const repository = new TraceRepository({} as any, {
    get: mock(() => 'postgres://sentris:test@localhost:5432/sentris_test'),
  } as any);

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

  it('rejects unsafe run IDs before constructing a notification channel', async () => {
    const query = mock(async () => undefined);
    const repository = makeRepository({ query });

    await expect(repository.notifyRun(`${SENTRIS_RUN_ID}";DROP TABLE traces;--`, '{}')).rejects.toThrow(
      'Invalid runId format',
    );
    expect(query).not.toHaveBeenCalled();
  });
});
