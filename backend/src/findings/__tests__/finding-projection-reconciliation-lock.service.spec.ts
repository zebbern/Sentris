import { describe, expect, it, jest } from 'bun:test';
import type { Pool } from 'pg';

import { FindingProjectionReconciliationLockService } from '../finding-projection-reconciliation-lock.service';

function mockPool(acquired: boolean) {
  const query = jest
    .fn()
    .mockResolvedValueOnce({ rows: [{ acquired }] })
    .mockResolvedValueOnce({ rows: [{ released: true }] });
  const release = jest.fn();
  const client = { query, release };
  const pool = {
    connect: jest.fn().mockResolvedValue(client),
  } as unknown as Pool;
  return { pool, query, release };
}

function queryText(query: unknown): string {
  if (typeof query === 'string') return query;
  return (query as { text?: string }).text ?? '';
}

describe('FindingProjectionReconciliationLockService', () => {
  it('holds a tenant advisory lock on one dedicated client for the callback', async () => {
    const { pool, query, release } = mockPool(true);
    const service = new FindingProjectionReconciliationLockService(pool);
    const callback = jest.fn().mockResolvedValue('complete');

    const result = await service.withOrganizationLock('org-1', callback);

    expect(result).toEqual({ acquired: true, value: 'complete' });
    expect(callback).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledTimes(2);
    expect(queryText(query.mock.calls[0]?.[0])).toContain('pg_try_advisory_lock');
    expect(queryText(query.mock.calls[1]?.[0])).toContain('pg_advisory_unlock');
    expect(query.mock.calls[0]?.[1]).toEqual(
      (query.mock.calls[1]?.[0] as { values?: unknown[] }).values,
    );
    expect(release).toHaveBeenCalledWith(false);
  });

  it('fails closed without invoking tenant work when the lock is held elsewhere', async () => {
    const { pool, query, release } = mockPool(false);
    const service = new FindingProjectionReconciliationLockService(pool);
    const callback = jest.fn();

    const result = await service.withOrganizationLock('org-1', callback);

    expect(result).toEqual({ acquired: false });
    expect(callback).not.toHaveBeenCalled();
    expect(query).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalledWith(false);
  });

  it('always unlocks and releases the client when tenant work fails', async () => {
    const { pool, query, release } = mockPool(true);
    const service = new FindingProjectionReconciliationLockService(pool);

    await expect(
      service.withOrganizationLock('org-1', async () => {
        throw new Error('projection failed');
      }),
    ).rejects.toThrow('projection failed');

    expect(query).toHaveBeenCalledTimes(2);
    expect(queryText(query.mock.calls[1]?.[0])).toContain('pg_advisory_unlock');
    expect(release).toHaveBeenCalledWith(false);
  });

  it('uses stable tenant-specific advisory keys', async () => {
    const first = mockPool(true);
    const second = mockPool(true);
    const third = mockPool(true);
    const firstService = new FindingProjectionReconciliationLockService(first.pool);
    const secondService = new FindingProjectionReconciliationLockService(second.pool);
    const thirdService = new FindingProjectionReconciliationLockService(third.pool);

    await firstService.withOrganizationLock('org-1', async () => undefined);
    await secondService.withOrganizationLock('org-1', async () => undefined);
    await thirdService.withOrganizationLock('org-2', async () => undefined);

    expect(first.query.mock.calls[0]?.[1]).toEqual(second.query.mock.calls[0]?.[1]);
    expect(first.query.mock.calls[0]?.[1]).not.toEqual(third.query.mock.calls[0]?.[1]);
  });

  it('checks an aborted signal after lock acquisition and still performs the bounded unlock', async () => {
    const controller = new AbortController();
    const release = jest.fn();
    const callback = jest.fn();
    const query = jest.fn(async (input: unknown) => {
      if (queryText(input).includes('pg_try_advisory_lock')) {
        controller.abort(new Error('recovery expired after lock acquisition'));
        return { rows: [{ acquired: true }] };
      }
      return { rows: [{ released: true }] };
    });
    const service = new FindingProjectionReconciliationLockService({
      connect: jest.fn().mockResolvedValue({ query, release }),
    } as unknown as Pool);

    await expect(
      service.withOrganizationLock('org-1', callback, controller.signal),
    ).rejects.toThrow('recovery expired after lock acquisition');
    expect(callback).not.toHaveBeenCalled();
    expect(query.mock.calls.map((call) => queryText(call[0]))).toEqual([
      expect.stringContaining('pg_try_advisory_lock'),
      expect.stringContaining('pg_advisory_unlock'),
    ]);
    expect((query.mock.calls[1]?.[0] as { query_timeout?: number }).query_timeout).toBe(5_000);
    expect(release).toHaveBeenCalledWith(false);
  });

  it('does not settle a timed-out unlock until the same query rejects after destruction', async () => {
    const release = jest.fn();
    let rejectUnlock: ((error: Error) => void) | undefined;
    const query = jest.fn((input: unknown) => {
      if (queryText(input).includes('pg_try_advisory_lock')) {
        return Promise.resolve({ rows: [{ acquired: true }] });
      }
      return new Promise((_resolve, reject) => {
        rejectUnlock = reject;
      });
    });
    const service = new FindingProjectionReconciliationLockService({
      connect: jest.fn().mockResolvedValue({ query, release }),
    } as unknown as Pool);
    let settled = false;
    const result = service
      .withOrganizationLock('org-1', async () => 'complete', undefined, 10)
      .then(
        (value) => {
          settled = true;
          return value;
        },
        (error: unknown) => {
          settled = true;
          throw error;
        },
      );

    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(release).toHaveBeenCalledWith(true);
    expect(settled).toBe(false);

    rejectUnlock?.(new Error('connection destroyed'));
    await expect(result).resolves.toEqual({ acquired: true, value: 'complete' });
    expect(settled).toBe(true);
    expect(release).toHaveBeenCalledTimes(1);
  });
});
