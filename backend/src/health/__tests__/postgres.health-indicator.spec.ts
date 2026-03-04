import { beforeEach, describe, expect, it, vi } from 'bun:test';

import { PostgresHealthIndicator } from '../indicators/postgres.health-indicator';

function createMockPool(opts: { shouldFail?: boolean; error?: Error } = {}) {
  const mockClient = {
    query: opts.shouldFail
      ? vi.fn().mockRejectedValue(opts.error ?? new Error('query failed'))
      : vi.fn().mockResolvedValue({ rows: [{ '?column?': 1 }] }),
    release: vi.fn(),
  };

  return {
    connect:
      opts.shouldFail && !opts.error
        ? vi.fn().mockRejectedValue(new Error('connection failed'))
        : vi.fn().mockResolvedValue(mockClient),
    mockClient,
  };
}

describe('PostgresHealthIndicator', () => {
  let indicator: PostgresHealthIndicator;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns healthy status when SELECT 1 succeeds', async () => {
    const pool = createMockPool();
    indicator = new PostgresHealthIndicator(pool as any);

    const result = await indicator.isHealthy();
    expect(result.postgres.status).toBe('up');
    expect(pool.mockClient.release).toHaveBeenCalled();
  });

  it('throws HealthCheckError when the pool cannot connect', async () => {
    const pool = createMockPool({ shouldFail: true });
    indicator = new PostgresHealthIndicator(pool as any);

    await expect(indicator.isHealthy()).rejects.toThrow();
  });

  it('throws HealthCheckError when the query fails', async () => {
    const queryError = new Error('relation does not exist');
    const mockClient = {
      query: vi.fn().mockRejectedValue(queryError),
      release: vi.fn(),
    };
    const pool = { connect: vi.fn().mockResolvedValue(mockClient) };
    indicator = new PostgresHealthIndicator(pool as any);

    await expect(indicator.isHealthy()).rejects.toThrow();
    expect(mockClient.release).toHaveBeenCalled();
  });

  it('uses the provided key name', async () => {
    const pool = createMockPool();
    indicator = new PostgresHealthIndicator(pool as any);

    const result = await indicator.isHealthy('db');
    expect(result.db).toBeDefined();
    expect(result.db.status).toBe('up');
  });
});
