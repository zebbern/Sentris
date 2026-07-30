import { describe, expect, it, vi } from 'bun:test';

import { createDatabasePool } from '../service-factory';

describe('worker service factory', () => {
  it('keeps the worker alive when an idle PostgreSQL client reports an error', async () => {
    const previousDatabaseUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL = 'postgresql://sentris:sentris@postgres:5432/sentris';
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { pool } = createDatabasePool();
    const idleClientError = Object.assign(
      new Error('Connection terminated unexpectedly for postgresql://sentris:secret@postgres'),
      {
        code: '57P01',
        client: {
          connectionParameters: {
            password: 'secret',
          },
        },
      },
    );
    const idleClient = {
      connectionParameters: {
        password: 'secret',
      },
    };

    try {
      expect(() => pool.emit('error', idleClientError, idleClient)).not.toThrow();
      expect(consoleError).toHaveBeenCalledWith(
        'PostgreSQL idle client error; the pool will replace the failed connection (code=57P01)',
      );
      expect(JSON.stringify(consoleError.mock.calls)).not.toContain('secret');
    } finally {
      await pool.end();
      consoleError.mockRestore();
      if (previousDatabaseUrl === undefined) {
        delete process.env.DATABASE_URL;
      } else {
        process.env.DATABASE_URL = previousDatabaseUrl;
      }
    }
  });
});
