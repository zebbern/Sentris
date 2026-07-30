import { describe, expect, it } from 'bun:test';
import { readFile } from 'node:fs/promises';

import { resolveWorkerRuntimeTimeouts } from '../runtime-timeouts';

describe('worker runtime timeout policy', () => {
  it('bounds PostgreSQL and terminal Redis waits by default', () => {
    expect(resolveWorkerRuntimeTimeouts({})).toEqual({
      databaseConnectionTimeoutMs: 10_000,
      databaseQueryTimeoutMs: 30_000,
      terminalRedisCommandTimeoutMs: 10_000,
    });
  });

  it('accepts positive operator overrides and rejects unbounded values', () => {
    expect(
      resolveWorkerRuntimeTimeouts({
        WORKER_DATABASE_CONNECTION_TIMEOUT_MS: '2500',
        WORKER_DATABASE_QUERY_TIMEOUT_MS: '15000',
        TERMINAL_REDIS_COMMAND_TIMEOUT_MS: '4000',
      }),
    ).toEqual({
      databaseConnectionTimeoutMs: 2_500,
      databaseQueryTimeoutMs: 15_000,
      terminalRedisCommandTimeoutMs: 4_000,
    });

    expect(
      resolveWorkerRuntimeTimeouts({
        WORKER_DATABASE_CONNECTION_TIMEOUT_MS: '0',
        WORKER_DATABASE_QUERY_TIMEOUT_MS: 'Infinity',
        TERMINAL_REDIS_COMMAND_TIMEOUT_MS: '-1',
      }),
    ).toEqual({
      databaseConnectionTimeoutMs: 10_000,
      databaseQueryTimeoutMs: 30_000,
      terminalRedisCommandTimeoutMs: 10_000,
    });
  });

  it('wires the bounds into PostgreSQL and terminal Redis clients', async () => {
    const source = await readFile(new URL('../service-factory.ts', import.meta.url), 'utf8');

    expect(source).toContain('connectionTimeoutMillis: timeouts.databaseConnectionTimeoutMs');
    expect(source).toContain('query_timeout: timeouts.databaseQueryTimeoutMs');
    expect(source).toContain('statement_timeout: timeouts.databaseQueryTimeoutMs');
    expect(source).toContain('commandTimeout: timeouts.terminalRedisCommandTimeoutMs');
  });
});
