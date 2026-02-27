import { beforeEach, describe, expect, it, mock, spyOn, vi } from 'bun:test';

// ── Module mocks (must precede service import) ─────────────────────────────
const mockBcryptHash = vi.fn();
const mockBcryptCompare = vi.fn();

mock.module('bcryptjs', () => ({
  hash: mockBcryptHash,
  compare: mockBcryptCompare,
  default: { hash: mockBcryptHash, compare: mockBcryptCompare },
}));

import { ApiKeysService } from '../api-keys.service';
import { InternalServerErrorException, NotFoundException } from '@nestjs/common';
import type { AuthContext } from '../../auth/types';

// ── Fixtures ────────────────────────────────────────────────────────────────

const authContext: AuthContext = {
  userId: 'user-1',
  organizationId: 'org-1',
  roles: ['ADMIN'],
  isAuthenticated: true,
  provider: 'test',
};

const noOrgAuth: AuthContext = {
  userId: 'user-1',
  organizationId: null,
  roles: ['ADMIN'],
  isAuthenticated: true,
  provider: 'test',
};

const samplePermissions = {
  workflows: { run: true, list: true, read: true },
  runs: { read: true, cancel: false },
  audit: { read: true },
};

const now = new Date('2025-06-01T00:00:00Z');

const sampleApiKey = {
  id: 'key-1',
  name: 'Test Key',
  description: 'A test API key',
  keyHash: 'hashed-key',
  keyPrefix: 'sk_live_',
  keyHint: 'abc12345',
  permissions: samplePermissions,
  organizationId: 'org-1',
  createdBy: 'user-1',
  isActive: true,
  expiresAt: null as Date | null,
  lastUsedAt: null as Date | null,
  usageCount: 0,
  rateLimit: null as number | null,
  scopes: [] as string[],
  createdAt: now,
  updatedAt: now,
};

// ── Drizzle chainable query-builder mock ────────────────────────────────────

function createChain(result: unknown) {
  const chain: Record<string, unknown> = {};
  for (const method of ['from', 'values', 'set', 'where', 'orderBy', 'limit', 'offset']) {
    chain[method] = vi.fn().mockReturnValue(chain);
  }
  chain.returning = vi.fn().mockResolvedValue(result);
  // Makes the chain thenable so `await chain` resolves to `result`
  chain.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);
  return chain;
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('ApiKeysService', () => {
  let db: {
    select: ReturnType<typeof vi.fn>;
    insert: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
  };
  let auditLogService: { record: ReturnType<typeof vi.fn> };
  let service: ApiKeysService;

  beforeEach(() => {
    mockBcryptHash.mockReset();
    mockBcryptCompare.mockReset();
    mockBcryptHash.mockResolvedValue('hashed-key');
    mockBcryptCompare.mockResolvedValue(false);

    db = {
      select: vi.fn(),
      insert: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    };

    auditLogService = { record: vi.fn() };

    service = new ApiKeysService(db as any, auditLogService as any);
  });

  // ── create() ──────────────────────────────────────────────────────────

  describe('create', () => {
    const createDto = {
      name: 'My API Key',
      description: 'For testing',
      permissions: samplePermissions,
    };

    it('hashes the key, inserts the record, records audit, and returns { apiKey, plainKey }', async () => {
      db.insert.mockReturnValue(createChain([sampleApiKey]));

      const result = await service.create(authContext, createDto as any);

      expect(result.plainKey).toMatch(/^sk_live_/);
      expect(result.apiKey).toEqual(sampleApiKey);
      expect(mockBcryptHash).toHaveBeenCalledWith(result.plainKey, 10);
      expect(db.insert).toHaveBeenCalled();
      expect(auditLogService.record).toHaveBeenCalledWith(
        authContext,
        expect.objectContaining({
          action: 'api_key.create',
          resourceType: 'api_key',
          resourceId: sampleApiKey.id,
          resourceName: sampleApiKey.name,
        }),
      );
    });

    it('throws InternalServerErrorException when organizationId is missing', async () => {
      await expect(service.create(noOrgAuth, createDto as any)).rejects.toThrow(
        InternalServerErrorException,
      );
    });
  });

  // ── list() ────────────────────────────────────────────────────────────

  describe('list', () => {
    it('returns results filtered by organizationId', async () => {
      db.select.mockReturnValue(createChain([sampleApiKey]));

      const result = await service.list(authContext, { limit: 50, offset: 0 } as any);

      expect(result).toEqual([sampleApiKey]);
      expect(db.select).toHaveBeenCalled();
    });

    it('includes isActive condition when query.isActive is provided', async () => {
      const chain = createChain([sampleApiKey]);
      db.select.mockReturnValue(chain);

      const result = await service.list(authContext, {
        limit: 50,
        offset: 0,
        isActive: true,
      } as any);

      expect(result).toEqual([sampleApiKey]);
      expect(chain.where as ReturnType<typeof vi.fn>).toHaveBeenCalled();
    });

    it('returns empty array when organizationId is falsy without querying DB', async () => {
      const result = await service.list(noOrgAuth, { limit: 50, offset: 0 } as any);

      expect(result).toEqual([]);
      expect(db.select).not.toHaveBeenCalled();
    });
  });

  // ── get() ─────────────────────────────────────────────────────────────

  describe('get', () => {
    it('returns the API key when found', async () => {
      db.select.mockReturnValue(createChain([sampleApiKey]));

      const result = await service.get(authContext, 'key-1');

      expect(result).toEqual(sampleApiKey);
    });

    it('throws NotFoundException when key not found', async () => {
      db.select.mockReturnValue(createChain([]));

      await expect(service.get(authContext, 'missing')).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException when organizationId is falsy', async () => {
      await expect(service.get(noOrgAuth, 'key-1')).rejects.toThrow(NotFoundException);
    });
  });

  // ── update() ──────────────────────────────────────────────────────────

  describe('update', () => {
    it('returns updated key and records api_key.update for generic field changes', async () => {
      const updated = { ...sampleApiKey, name: 'Renamed' };
      db.update.mockReturnValue(createChain([updated]));

      const result = await service.update(authContext, 'key-1', { name: 'Renamed' } as any);

      expect(result).toEqual(updated);
      expect(auditLogService.record).toHaveBeenCalledWith(
        authContext,
        expect.objectContaining({ action: 'api_key.update' }),
      );
    });

    it('records api_key.revoke audit action when isActive is set to false', async () => {
      db.update.mockReturnValue(createChain([{ ...sampleApiKey, isActive: false }]));

      await service.update(authContext, 'key-1', { isActive: false } as any);

      expect(auditLogService.record).toHaveBeenCalledWith(
        authContext,
        expect.objectContaining({ action: 'api_key.revoke' }),
      );
    });

    it('records api_key.reactivate audit action when isActive is set to true', async () => {
      db.update.mockReturnValue(createChain([{ ...sampleApiKey, isActive: true }]));

      await service.update(authContext, 'key-1', { isActive: true } as any);

      expect(auditLogService.record).toHaveBeenCalledWith(
        authContext,
        expect.objectContaining({ action: 'api_key.reactivate' }),
      );
    });

    it('throws NotFoundException when key not found', async () => {
      db.update.mockReturnValue(createChain([]));

      await expect(service.update(authContext, 'key-1', { name: 'X' } as any)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ── delete() ──────────────────────────────────────────────────────────

  describe('delete', () => {
    it('deletes the key and records api_key.delete audit with name', async () => {
      db.select.mockReturnValue(createChain([sampleApiKey]));
      db.delete.mockReturnValue(createChain({ rowCount: 1 }));

      await service.delete(authContext, 'key-1');

      expect(db.delete).toHaveBeenCalled();
      expect(auditLogService.record).toHaveBeenCalledWith(
        authContext,
        expect.objectContaining({
          action: 'api_key.delete',
          resourceId: 'key-1',
          resourceName: sampleApiKey.name,
        }),
      );
    });

    it('throws NotFoundException when rowCount is 0', async () => {
      db.select.mockReturnValue(createChain([sampleApiKey]));
      db.delete.mockReturnValue(createChain({ rowCount: 0 }));

      await expect(service.delete(authContext, 'key-1')).rejects.toThrow(NotFoundException);
    });
  });

  // ── validateKey() ─────────────────────────────────────────────────────

  describe('validateKey', () => {
    const validKey = 'sk_live_abc12345_somesecretvalue32chars00';

    it('returns null for key not starting with sk_live_', async () => {
      expect(await service.validateKey('pk_test_abc_secret')).toBeNull();
      expect(db.select).not.toHaveBeenCalled();
    });

    it('returns null for key with wrong number of underscore-separated parts', async () => {
      expect(await service.validateKey('sk_live_tooFew')).toBeNull();
      expect(await service.validateKey('sk_live_a_b_c')).toBeNull();
    });

    it('returns the key record when bcrypt matches, key is active, and not expired', async () => {
      db.select.mockReturnValue(createChain([sampleApiKey]));
      db.update.mockReturnValue(createChain(undefined));
      mockBcryptCompare.mockResolvedValue(true);

      const result = await service.validateKey(validKey);

      expect(result).toEqual(sampleApiKey);
      expect(mockBcryptCompare).toHaveBeenCalledWith(validKey, sampleApiKey.keyHash);
    });

    it('returns null when key is expired', async () => {
      const expiredKey = { ...sampleApiKey, expiresAt: new Date(Date.now() - 86_400_000) };
      db.select.mockReturnValue(createChain([expiredKey]));
      mockBcryptCompare.mockResolvedValue(true);

      expect(await service.validateKey(validKey)).toBeNull();
    });

    it('fires updateUsage asynchronously after a successful match', async () => {
      db.select.mockReturnValue(createChain([sampleApiKey]));
      db.update.mockReturnValue(createChain(undefined));
      mockBcryptCompare.mockResolvedValue(true);

      const result = await service.validateKey(validKey);
      expect(result).toEqual(sampleApiKey);

      // Let the fire-and-forget updateUsage promise settle
      await new Promise((r) => setTimeout(r, 10));

      expect(db.update).toHaveBeenCalled();
    });

    it('catches updateUsage errors without propagating (logs silently)', async () => {
      db.select.mockReturnValue(createChain([sampleApiKey]));
      mockBcryptCompare.mockResolvedValue(true);

      // Build a chain that rejects when awaited
      const rejectChain: Record<string, unknown> = {};
      for (const m of ['from', 'values', 'set', 'where', 'orderBy', 'limit', 'offset']) {
        rejectChain[m] = vi.fn().mockReturnValue(rejectChain);
      }
      const dbError = new Error('DB connection lost');
      rejectChain.returning = vi.fn().mockRejectedValue(dbError);
      rejectChain.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
        Promise.reject(dbError).then(resolve, reject);
      db.update.mockReturnValue(rejectChain);

      const loggerSpy = spyOn((service as any).logger, 'error').mockImplementation(() => {});

      const result = await service.validateKey(validKey);
      expect(result).toEqual(sampleApiKey);

      // Let the fire-and-forget promise settle
      await new Promise((r) => setTimeout(r, 10));

      expect(loggerSpy).toHaveBeenCalled();
      loggerSpy.mockRestore();
    });
  });
});
