import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'bun:test';

import { DEFAULT_ORGANIZATION_ID } from '../../auth/constants';
import type { AuthContext } from '../../auth/types';
import type { NodeIORepository } from '../../node-io/node-io.repository';
import type { ScopesService } from '../../scopes/scopes.service';
import type { StorageService } from '../../storage/storage.service';
import type { WorkflowRunRepository } from '../../workflows/repository/workflow-run.repository';
import type { AssetInventoryRepository } from '../assets.repository';
import { AssetInventoryService } from '../assets.service';

const authContext: AuthContext = {
  userId: 'tester',
  organizationId: DEFAULT_ORGANIZATION_ID,
  roles: ['ADMIN'],
  isAuthenticated: true,
  provider: 'test',
};

function makeSubfinderRow(overrides: Record<string, unknown> = {}) {
  return {
    runId: 'run-1',
    nodeRef: 'n1',
    componentId: 'sentris.subfinder.run',
    organizationId: DEFAULT_ORGANIZATION_ID,
    outputs: { subdomains: ['a.example.com'] },
    outputsSpilled: false,
    outputsStorageRef: null,
    ...overrides,
  };
}

describe('AssetInventoryService', () => {
  let repository: Record<string, ReturnType<typeof vi.fn>>;
  let nodeIORepository: Record<string, ReturnType<typeof vi.fn>>;
  let workflowRunRepository: Record<string, ReturnType<typeof vi.fn>>;
  let storage: Record<string, ReturnType<typeof vi.fn>>;
  let scopesService: Record<string, ReturnType<typeof vi.fn>>;
  let service: AssetInventoryService;

  beforeEach(() => {
    repository = { upsertMany: vi.fn(), listByScope: vi.fn() };
    nodeIORepository = { findByRunAndNode: vi.fn() };
    workflowRunRepository = { findByRunId: vi.fn() };
    storage = { downloadFile: vi.fn() };
    scopesService = { getScope: vi.fn() };
    service = new AssetInventoryService(
      repository as unknown as AssetInventoryRepository,
      nodeIORepository as unknown as NodeIORepository,
      workflowRunRepository as unknown as WorkflowRunRepository,
      storage as unknown as StorageService,
      scopesService as unknown as ScopesService,
    );
  });

  describe('onNodeIoCompleted', () => {
    it('extracts and upserts subdomain assets from inline outputs', async () => {
      nodeIORepository.findByRunAndNode.mockResolvedValue(makeSubfinderRow());
      workflowRunRepository.findByRunId.mockResolvedValue({
        organizationId: DEFAULT_ORGANIZATION_ID,
        scopeId: 'scope-1',
      });

      await service.onNodeIoCompleted({
        runId: 'run-1',
        nodeRef: 'n1',
        componentId: 'sentris.subfinder.run',
      });

      expect(nodeIORepository.findByRunAndNode).toHaveBeenCalledWith('run-1', 'n1');
      expect(repository.upsertMany).toHaveBeenCalledTimes(1);
      const records = repository.upsertMany.mock.calls[0]?.[0];
      expect(records).toHaveLength(1);
      expect(records[0]).toMatchObject({
        organizationId: DEFAULT_ORGANIZATION_ID,
        scopeId: 'scope-1',
        assetType: 'subdomain',
        assetValue: 'a.example.com',
        firstSeenRunId: 'run-1',
        lastSeenRunId: 'run-1',
        sourceComponentId: 'sentris.subfinder.run',
      });
    });

    it('does not upsert when the run has no scopeId', async () => {
      nodeIORepository.findByRunAndNode.mockResolvedValue(makeSubfinderRow());
      workflowRunRepository.findByRunId.mockResolvedValue({
        organizationId: DEFAULT_ORGANIZATION_ID,
        scopeId: null,
      });

      await service.onNodeIoCompleted({
        runId: 'run-1',
        nodeRef: 'n1',
        componentId: 'sentris.subfinder.run',
      });

      expect(repository.upsertMany).not.toHaveBeenCalled();
    });

    it('does not upsert when the run has no organizationId', async () => {
      nodeIORepository.findByRunAndNode.mockResolvedValue(makeSubfinderRow());
      workflowRunRepository.findByRunId.mockResolvedValue({
        organizationId: null,
        scopeId: 'scope-1',
      });

      await service.onNodeIoCompleted({
        runId: 'run-1',
        nodeRef: 'n1',
        componentId: 'sentris.subfinder.run',
      });

      expect(repository.upsertMany).not.toHaveBeenCalled();
    });

    it('returns early for a non-recon component without touching the DB', async () => {
      await service.onNodeIoCompleted({
        runId: 'run-1',
        nodeRef: 'n1',
        componentId: 'sentris.nuclei.scan',
      });

      expect(nodeIORepository.findByRunAndNode).not.toHaveBeenCalled();
      expect(repository.upsertMany).not.toHaveBeenCalled();
    });

    it('fetches spilled outputs from storage and extracts from the parsed payload', async () => {
      nodeIORepository.findByRunAndNode.mockResolvedValue(
        makeSubfinderRow({
          outputs: null,
          outputsSpilled: true,
          outputsStorageRef: 'ref-1',
        }),
      );
      workflowRunRepository.findByRunId.mockResolvedValue({
        organizationId: DEFAULT_ORGANIZATION_ID,
        scopeId: 'scope-1',
      });
      storage.downloadFile.mockResolvedValue(
        Buffer.from(JSON.stringify({ subdomains: ['spilled.example.com'] })),
      );

      await service.onNodeIoCompleted({
        runId: 'run-1',
        nodeRef: 'n1',
        componentId: 'sentris.subfinder.run',
      });

      expect(storage.downloadFile).toHaveBeenCalledWith('ref-1');
      expect(repository.upsertMany).toHaveBeenCalledTimes(1);
      const records = repository.upsertMany.mock.calls[0]?.[0];
      expect(records[0]).toMatchObject({ assetValue: 'spilled.example.com' });
    });

    it('never throws even when a dependency rejects', async () => {
      nodeIORepository.findByRunAndNode.mockRejectedValue(new Error('db down'));

      await expect(
        service.onNodeIoCompleted({
          runId: 'run-1',
          nodeRef: 'n1',
          componentId: 'sentris.subfinder.run',
        }),
      ).resolves.toBeUndefined();
      expect(repository.upsertMany).not.toHaveBeenCalled();
    });
  });

  describe('listAssets', () => {
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

      await expect(service.listAssets(authContext, 'missing', {})).rejects.toThrow(
        NotFoundException,
      );
      expect(repository.listByScope).not.toHaveBeenCalled();
    });

    it('throws ForbiddenException when auth is null', async () => {
      await expect(service.listAssets(null, 'scope-1', {})).rejects.toThrow(ForbiddenException);
      expect(scopesService.getScope).not.toHaveBeenCalled();
      expect(repository.listByScope).not.toHaveBeenCalled();
    });
  });
});
