import { ConflictException, NotFoundException } from '@nestjs/common';
import { describe, expect, it } from 'bun:test';

import type { ScopeRecord } from '../../database/schema';
import { ScopesRepository } from '../scopes.repository';

function makeScopeRecord(overrides: Partial<ScopeRecord> = {}): ScopeRecord {
  const now = new Date('2024-06-01T00:00:00.000Z');
  return {
    id: 'scope-1',
    organizationId: 'org-1',
    name: 'Production',
    description: 'Production scope',
    domains: ['example.com'],
    repos: ['org/repo'],
    ipRanges: ['10.0.0.0/8'],
    runtimeValues: { region: 'us-east-1' },
    createdBy: 'user-1',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeUniqueViolationError(): Error & { code: string } {
  const error = new Error(
    'duplicate key value violates unique constraint "scopes_org_name_uidx"',
  ) as Error & { code: string };
  error.code = '23505';
  return error;
}

/**
 * Creates a chainable Drizzle mock database. Any method call on a builder
 * proxy resolves to itself except when awaited, which resolves (or rejects,
 * if the configured result is an Error) to the configured result.
 */
function createMockDb(options: {
  selectRows?: unknown[];
  insertResult?: unknown[] | Error;
  updateResult?: unknown[] | Error;
  deleteResult?: unknown[];
}) {
  const calls: { method: string; args: unknown[] }[] = [];

  function build(resolvedValue: unknown) {
    const proxy = new Proxy(
      {},
      {
        get(_target, prop: string) {
          if (prop === 'then') {
            return (resolve: (v: unknown) => void, reject?: (e: unknown) => void) => {
              if (resolvedValue instanceof Error) {
                return reject ? reject(resolvedValue) : undefined;
              }
              return resolve(resolvedValue);
            };
          }
          return (...args: unknown[]) => {
            calls.push({ method: prop, args });
            return proxy;
          };
        },
      },
    );
    return proxy;
  }

  const db = {
    select: (...args: unknown[]) => {
      calls.push({ method: 'select', args });
      return build(options.selectRows ?? []);
    },
    insert: (...args: unknown[]) => {
      calls.push({ method: 'insert', args });
      return build(options.insertResult ?? []);
    },
    update: (...args: unknown[]) => {
      calls.push({ method: 'update', args });
      return build(options.updateResult ?? []);
    },
    delete: (...args: unknown[]) => {
      calls.push({ method: 'delete', args });
      return build(options.deleteResult ?? []);
    },
    _calls: calls,
  };

  return db as never;
}

describe('ScopesRepository', () => {
  describe('listByOrganization', () => {
    it('returns rows scoped to the organization', async () => {
      const record = makeScopeRecord();
      const db = createMockDb({ selectRows: [record] });
      const repository = new ScopesRepository(db);

      const result = await repository.listByOrganization('org-1');

      expect(result).toEqual([record]);
    });
  });

  describe('findById', () => {
    it('returns the matching record', async () => {
      const record = makeScopeRecord();
      const db = createMockDb({ selectRows: [record] });
      const repository = new ScopesRepository(db);

      const result = await repository.findById('scope-1', 'org-1');

      expect(result).toEqual(record);
    });

    it('returns null when no row matches', async () => {
      const db = createMockDb({ selectRows: [] });
      const repository = new ScopesRepository(db);

      const result = await repository.findById('missing', 'org-1');

      expect(result).toBeNull();
    });
  });

  describe('create', () => {
    it('inserts and returns the created record', async () => {
      const record = makeScopeRecord();
      const db = createMockDb({ insertResult: [record] });
      const repository = new ScopesRepository(db);

      const result = await repository.create({
        organizationId: 'org-1',
        name: 'Production',
        description: 'Production scope',
        domains: ['example.com'],
        repos: ['org/repo'],
        ipRanges: ['10.0.0.0/8'],
        runtimeValues: { region: 'us-east-1' },
        createdBy: 'user-1',
      });

      expect(result).toEqual(record);
    });

    it('throws ConflictException on unique violation', async () => {
      const db = createMockDb({ insertResult: makeUniqueViolationError() });
      const repository = new ScopesRepository(db);

      await expect(
        repository.create({
          organizationId: 'org-1',
          name: 'Production',
          description: null,
          domains: [],
          repos: [],
          ipRanges: [],
          runtimeValues: {},
          createdBy: 'user-1',
        }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('update', () => {
    it('updates and returns the record', async () => {
      const record = makeScopeRecord({ name: 'Renamed' });
      const db = createMockDb({ updateResult: [record] });
      const repository = new ScopesRepository(db);

      const result = await repository.update('scope-1', 'org-1', { name: 'Renamed' });

      expect(result).toEqual(record);
    });

    it('throws NotFoundException when no row matches', async () => {
      const db = createMockDb({ updateResult: [] });
      const repository = new ScopesRepository(db);

      await expect(repository.update('missing', 'org-1', { name: 'Renamed' })).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws ConflictException on unique violation', async () => {
      const db = createMockDb({ updateResult: makeUniqueViolationError() });
      const repository = new ScopesRepository(db);

      await expect(repository.update('scope-1', 'org-1', { name: 'Duplicate' })).rejects.toThrow(
        ConflictException,
      );
    });
  });

  describe('delete', () => {
    it('resolves when a row is deleted', async () => {
      const db = createMockDb({ deleteResult: [{ id: 'scope-1' }] });
      const repository = new ScopesRepository(db);

      await expect(repository.delete('scope-1', 'org-1')).resolves.toBeUndefined();
    });

    it('throws NotFoundException when no row matches', async () => {
      const db = createMockDb({ deleteResult: [] });
      const repository = new ScopesRepository(db);

      await expect(repository.delete('missing', 'org-1')).rejects.toThrow(NotFoundException);
    });
  });
});
