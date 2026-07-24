import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'bun:test';

import { DEFAULT_ORGANIZATION_ID } from '../../auth/constants';
import type { AuthContext } from '../../auth/types';
import type { ScopesService } from '../../scopes/scopes.service';
import type { AssetInventoryRepository } from '../assets.repository';
import { AssetsService } from '../assets.service';

const authContext: AuthContext = {
  userId: 'tester',
  organizationId: DEFAULT_ORGANIZATION_ID,
  roles: ['ADMIN'],
  isAuthenticated: true,
  provider: 'test',
};

describe('AssetsService', () => {
  let repository: Record<string, ReturnType<typeof vi.fn>>;
  let scopesService: Record<string, ReturnType<typeof vi.fn>>;
  let service: AssetsService;

  beforeEach(() => {
    repository = { upsertMany: vi.fn(), listByScope: vi.fn() };
    scopesService = { getScope: vi.fn() };
    service = new AssetsService(
      repository as unknown as AssetInventoryRepository,
      scopesService as unknown as ScopesService,
    );
  });

  it('validates the scope belongs to the org, then lists assets', async () => {
    scopesService.getScope.mockResolvedValue({ id: 'scope-1' });
    const now = new Date('2024-06-01T00:00:00.000Z');
    repository.listByScope.mockResolvedValue([
      {
        id: 'asset-1',
        organizationId: DEFAULT_ORGANIZATION_ID,
        scopeId: 'scope-1',
        assetType: 'subdomain',
        assetValue: 'a.example.com',
        firstSeenAt: now,
        lastSeenAt: now,
        firstSeenRunId: 'run-1',
        lastSeenRunId: 'run-1',
        sourceComponentId: 'sentris.subfinder.run',
        metadata: {},
        createdAt: now,
        updatedAt: now,
      },
    ]);

    const result = await service.listAssets(authContext, 'scope-1', {});

    expect(scopesService.getScope).toHaveBeenCalledWith(authContext, 'scope-1');
    expect(repository.listByScope).toHaveBeenCalledWith('scope-1', DEFAULT_ORGANIZATION_ID, {});
    expect(result).toHaveLength(1);
    expect(result[0]?.assetValue).toBe('a.example.com');
    expect(result[0]?.firstSeenAt).toBe(now.toISOString());
  });

  it('forwards the assetType filter', async () => {
    scopesService.getScope.mockResolvedValue({ id: 'scope-1' });
    repository.listByScope.mockResolvedValue([]);

    await service.listAssets(authContext, 'scope-1', { assetType: 'subdomain' });

    expect(repository.listByScope).toHaveBeenCalledWith('scope-1', DEFAULT_ORGANIZATION_ID, {
      assetType: 'subdomain',
    });
  });

  it('propagates NotFoundException when the scope does not belong to the org', async () => {
    scopesService.getScope.mockRejectedValue(new NotFoundException('Scope missing not found'));

    await expect(service.listAssets(authContext, 'missing', {})).rejects.toThrow(NotFoundException);
    expect(repository.listByScope).not.toHaveBeenCalled();
  });

  it('throws ForbiddenException when auth is null', async () => {
    await expect(service.listAssets(null, 'scope-1', {})).rejects.toThrow(ForbiddenException);
    expect(scopesService.getScope).not.toHaveBeenCalled();
    expect(repository.listByScope).not.toHaveBeenCalled();
  });
});
