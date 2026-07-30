import { beforeEach, describe, expect, it, vi } from 'bun:test';

import { DEFAULT_ORGANIZATION_ID } from '../../auth/constants';
import type { NodeIORepository } from '../../node-io/node-io.repository';
import type { StorageService } from '../../storage/storage.service';
import type { WorkflowRunRepository } from '../../workflows/repository/workflow-run.repository';
import { AssetInventoryService } from '../asset-inventory.service';
import type { AssetInventoryRepository } from '../assets.repository';

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
  let service: AssetInventoryService;

  beforeEach(() => {
    repository = { upsertMany: vi.fn(), listByScope: vi.fn() };
    nodeIORepository = { findByRunAndNode: vi.fn() };
    workflowRunRepository = { findByRunId: vi.fn() };
    storage = { downloadFile: vi.fn() };
    service = new AssetInventoryService(
      repository as unknown as AssetInventoryRepository,
      nodeIORepository as unknown as NodeIORepository,
      workflowRunRepository as unknown as WorkflowRunRepository,
      storage as unknown as StorageService,
    );
  });

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

  it('propagates spilled-output failures so the projection is retried', async () => {
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
    storage.downloadFile.mockRejectedValue(new Error('object storage unavailable'));

    await expect(
      service.onNodeIoCompleted({
        runId: 'run-1',
        nodeRef: 'n1',
        componentId: 'sentris.subfinder.run',
      }),
    ).rejects.toThrow('object storage unavailable');
    expect(repository.upsertMany).not.toHaveBeenCalled();
  });

  it('rejects spilled outputs without a storage reference instead of projecting a false empty result', async () => {
    nodeIORepository.findByRunAndNode.mockResolvedValue(
      makeSubfinderRow({
        outputs: { __sentrisSpilled: true, storageRef: 'unknown', originalSize: 120_000 },
        outputsSpilled: true,
        outputsStorageRef: null,
      }),
    );
    workflowRunRepository.findByRunId.mockResolvedValue({
      organizationId: DEFAULT_ORGANIZATION_ID,
      scopeId: 'scope-1',
    });

    await expect(
      service.onNodeIoCompleted({
        runId: 'run-1',
        nodeRef: 'n1',
        componentId: 'sentris.subfinder.run',
      }),
    ).rejects.toThrow('Spilled node outputs are missing a storage reference');
    expect(storage.downloadFile).not.toHaveBeenCalled();
    expect(repository.upsertMany).not.toHaveBeenCalled();
  });

  it('propagates dependency failures so the durable dispatcher retries the projection', async () => {
    nodeIORepository.findByRunAndNode.mockRejectedValue(new Error('db down'));

    await expect(
      service.onNodeIoCompleted({
        runId: 'run-1',
        nodeRef: 'n1',
        componentId: 'sentris.subfinder.run',
      }),
    ).rejects.toThrow('db down');
    expect(repository.upsertMany).not.toHaveBeenCalled();
  });
});
