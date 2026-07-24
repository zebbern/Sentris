import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'bun:test';

import { DEFAULT_ORGANIZATION_ID } from '../../auth/constants';
import type { AuthContext } from '../../auth/types';
import type { ScopeRecord } from '../../database/schema';
import { ScopesService } from '../scopes.service';
import type { ScopesRepository } from '../scopes.repository';

const now = new Date('2024-06-01T00:00:00.000Z');
const authContext: AuthContext = {
  userId: 'tester',
  organizationId: DEFAULT_ORGANIZATION_ID,
  roles: ['ADMIN'],
  isAuthenticated: true,
  provider: 'test',
};

function makeScopeRecord(overrides: Partial<ScopeRecord> = {}): ScopeRecord {
  return {
    id: 'scope-1',
    organizationId: DEFAULT_ORGANIZATION_ID,
    name: 'Production',
    description: 'Production scope',
    domains: ['example.com'],
    repos: ['org/repo'],
    ipRanges: ['10.0.0.0/8'],
    runtimeValues: { region: 'us-east-1' },
    createdBy: 'tester',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe('ScopesService', () => {
  let repo: Record<string, ReturnType<typeof vi.fn>>;
  let service: ScopesService;

  beforeEach(() => {
    repo = {
      listByOrganization: vi.fn(),
      findById: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    };
    service = new ScopesService(repo as unknown as ScopesRepository);
  });

  describe('listScopes', () => {
    it('lists scopes for organization', async () => {
      repo.listByOrganization.mockResolvedValue([makeScopeRecord()]);
      const result = await service.listScopes(authContext);
      expect(repo.listByOrganization).toHaveBeenCalledWith(DEFAULT_ORGANIZATION_ID);
      expect(result).toHaveLength(1);
      expect(result[0]?.name).toBe('Production');
      expect(result[0]?.createdAt).toBe(now.toISOString());
    });

    it('throws ForbiddenException when auth is null', async () => {
      await expect(service.listScopes(null)).rejects.toThrow(ForbiddenException);
    });
  });

  describe('getScope', () => {
    it('returns the mapped scope', async () => {
      repo.findById.mockResolvedValue(makeScopeRecord());
      const result = await service.getScope(authContext, 'scope-1');
      expect(repo.findById).toHaveBeenCalledWith('scope-1', DEFAULT_ORGANIZATION_ID);
      expect(result.id).toBe('scope-1');
    });

    it('throws NotFoundException when scope not found', async () => {
      repo.findById.mockResolvedValue(null);
      await expect(service.getScope(authContext, 'missing')).rejects.toThrow(NotFoundException);
    });

    it('throws ForbiddenException when auth is null', async () => {
      await expect(service.getScope(null, 'scope-1')).rejects.toThrow(ForbiddenException);
    });
  });

  describe('createScope', () => {
    it('creates a scope with createdBy from auth', async () => {
      repo.create.mockResolvedValue(makeScopeRecord());
      const result = await service.createScope(authContext, {
        name: 'Production',
        description: 'Production scope',
        domains: ['example.com'],
        repos: ['org/repo'],
        ipRanges: ['10.0.0.0/8'],
        runtimeValues: { region: 'us-east-1' },
      });
      expect(repo.create).toHaveBeenCalledWith({
        organizationId: DEFAULT_ORGANIZATION_ID,
        name: 'Production',
        description: 'Production scope',
        domains: ['example.com'],
        repos: ['org/repo'],
        ipRanges: ['10.0.0.0/8'],
        runtimeValues: { region: 'us-east-1' },
        createdBy: 'tester',
      });
      expect(result.name).toBe('Production');
    });

    it('defaults createdBy to null when auth has no userId', async () => {
      repo.create.mockResolvedValue(makeScopeRecord({ createdBy: null }));
      await service.createScope(
        { ...authContext, userId: null },
        { name: 'Production', domains: [], repos: [], ipRanges: [], runtimeValues: {} },
      );
      expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({ createdBy: null }));
    });

    it('propagates ConflictException on unique violation', async () => {
      repo.create.mockRejectedValue(new ConflictException('A scope with this name already exists'));
      await expect(
        service.createScope(authContext, {
          name: 'Production',
          domains: [],
          repos: [],
          ipRanges: [],
          runtimeValues: {},
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('throws ForbiddenException when auth is null', async () => {
      await expect(
        service.createScope(null, {
          name: 'Production',
          domains: [],
          repos: [],
          ipRanges: [],
          runtimeValues: {},
        }),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('updateScope', () => {
    it('only sets provided fields', async () => {
      repo.update.mockResolvedValue(makeScopeRecord({ name: 'Renamed' }));
      await service.updateScope(authContext, 'scope-1', { name: 'Renamed' });
      expect(repo.update).toHaveBeenCalledWith('scope-1', DEFAULT_ORGANIZATION_ID, {
        name: 'Renamed',
      });
    });

    it('includes description when explicitly set to null', async () => {
      repo.update.mockResolvedValue(makeScopeRecord({ description: null }));
      await service.updateScope(authContext, 'scope-1', { description: null });
      expect(repo.update).toHaveBeenCalledWith('scope-1', DEFAULT_ORGANIZATION_ID, {
        description: null,
      });
    });

    it('sets multiple provided fields together', async () => {
      repo.update.mockResolvedValue(makeScopeRecord());
      await service.updateScope(authContext, 'scope-1', {
        domains: ['new.example.com'],
        runtimeValues: { region: 'eu-west-1' },
      });
      expect(repo.update).toHaveBeenCalledWith('scope-1', DEFAULT_ORGANIZATION_ID, {
        domains: ['new.example.com'],
        runtimeValues: { region: 'eu-west-1' },
      });
    });

    it('propagates NotFoundException when scope does not exist', async () => {
      repo.update.mockRejectedValue(new NotFoundException('Scope missing not found'));
      await expect(
        service.updateScope(authContext, 'missing', { name: 'Renamed' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws ForbiddenException when auth is null', async () => {
      await expect(service.updateScope(null, 'scope-1', { name: 'x' })).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  describe('deleteScope', () => {
    it('deletes the scope', async () => {
      repo.delete.mockResolvedValue(undefined);
      await service.deleteScope(authContext, 'scope-1');
      expect(repo.delete).toHaveBeenCalledWith('scope-1', DEFAULT_ORGANIZATION_ID);
    });

    it('propagates NotFoundException when scope does not exist', async () => {
      repo.delete.mockRejectedValue(new NotFoundException('Scope missing not found'));
      await expect(service.deleteScope(authContext, 'missing')).rejects.toThrow(NotFoundException);
    });

    it('throws ForbiddenException when auth is null', async () => {
      await expect(service.deleteScope(null, 'scope-1')).rejects.toThrow(ForbiddenException);
    });
  });
});
