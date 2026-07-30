import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'bun:test';

import { DEFAULT_ORGANIZATION_ID } from '../../auth/constants';
import type { AuthContext } from '../../auth/types';
import type { NodeIORepository } from '../../node-io/node-io.repository';
import type { ScopesService } from '../../scopes/scopes.service';
import type { StorageService } from '../../storage/storage.service';
import type { WorkflowRunRepository } from '../../workflows/repository/workflow-run.repository';
import type { WorkflowVersionRepository } from '../../workflows/repository/workflow-version.repository';
import { AssetRunComparisonService } from '../asset-run-comparison.service';

const authContext: AuthContext = {
  userId: 'tester',
  organizationId: DEFAULT_ORGANIZATION_ID,
  roles: ['ADMIN'],
  isAuthenticated: true,
  provider: 'test',
};

function nodeRow(
  runId: string,
  componentId: string,
  status: 'completed' | 'failed',
  outputs: Record<string, unknown> | null,
  options: {
    nodeRef?: string;
    inputs?: Record<string, unknown> | null;
    inputsSpilled?: boolean;
    inputsStorageRef?: string | null;
  } = {},
) {
  return {
    runId,
    nodeRef: options.nodeRef ?? componentId,
    componentId,
    organizationId: DEFAULT_ORGANIZATION_ID,
    status,
    inputs: options.inputs ?? {},
    inputsSpilled: options.inputsSpilled ?? false,
    inputsStorageRef: options.inputsStorageRef ?? null,
    outputs,
    outputsSpilled: false,
    outputsStorageRef: null,
  };
}

describe('AssetRunComparisonService', () => {
  let scopesService: Record<string, ReturnType<typeof vi.fn>>;
  let nodeIORepository: Record<string, ReturnType<typeof vi.fn>>;
  let workflowRunRepository: Record<string, ReturnType<typeof vi.fn>>;
  let workflowVersionRepository: Record<string, ReturnType<typeof vi.fn>>;
  let storage: Record<string, ReturnType<typeof vi.fn>>;
  let service: AssetRunComparisonService;

  beforeEach(() => {
    scopesService = { getScope: vi.fn().mockResolvedValue({ id: 'scope-1' }) };
    nodeIORepository = { listByRunId: vi.fn() };
    workflowRunRepository = { findByRunId: vi.fn() };
    workflowVersionRepository = { findByIds: vi.fn().mockResolvedValue([]) };
    storage = { downloadFile: vi.fn() };
    service = new AssetRunComparisonService(
      scopesService as unknown as ScopesService,
      nodeIORepository as unknown as NodeIORepository,
      workflowRunRepository as unknown as WorkflowRunRepository,
      workflowVersionRepository as unknown as WorkflowVersionRepository,
      storage as unknown as StorageService,
    );
  });

  it('distinguishes not-observed from not-scanned and reports new observations', async () => {
    workflowRunRepository.findByRunId.mockImplementation((runId: string) =>
      Promise.resolve({
        runId,
        workflowId: 'workflow-1',
        organizationId: DEFAULT_ORGANIZATION_ID,
        scopeId: 'scope-1',
        status: 'COMPLETED',
      }),
    );
    nodeIORepository.listByRunId.mockImplementation((runId: string) =>
      Promise.resolve(
        runId === 'baseline-run'
          ? [
              nodeRow('baseline-run', 'sentris.subfinder.run', 'completed', {
                subdomains: ['gone.example.com'],
              }),
              nodeRow('baseline-run', 'sentris.httpx.scan', 'completed', {
                responses: [{ url: 'https://unscanned.example.com', statusCode: 200 }],
              }),
            ]
          : [
              nodeRow('current-run', 'sentris.subfinder.run', 'completed', {
                subdomains: ['new.example.com'],
              }),
              nodeRow('current-run', 'sentris.httpx.scan', 'failed', {}),
            ],
      ),
    );

    const result = await service.compare(authContext, 'scope-1', {
      baselineRunId: 'baseline-run',
      currentRunId: 'current-run',
    });

    expect(result.summary).toEqual({
      observed: 1,
      notObserved: 1,
      notScanned: 1,
    });
    expect(result.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          assetValue: 'gone.example.com',
          observationStatus: 'not-observed',
          change: 'missing',
        }),
        expect.objectContaining({
          assetValue: 'https://unscanned.example.com',
          observationStatus: 'not-scanned',
          change: 'missing',
        }),
        expect.objectContaining({
          assetValue: 'new.example.com',
          observationStatus: 'observed',
          change: 'new',
        }),
      ]),
    );
    expect(result.currentCoverage).toEqual({
      completedComponents: ['sentris.subfinder.run'],
      failedComponents: ['sentris.httpx.scan'],
    });
  });

  it('rejects runs outside the selected target even when the IDs are valid', async () => {
    workflowRunRepository.findByRunId
      .mockResolvedValueOnce({
        runId: 'baseline-run',
        workflowId: 'workflow-1',
        organizationId: DEFAULT_ORGANIZATION_ID,
        scopeId: 'scope-1',
        status: 'COMPLETED',
      })
      .mockResolvedValueOnce({
        runId: 'current-run',
        workflowId: 'workflow-1',
        organizationId: DEFAULT_ORGANIZATION_ID,
        scopeId: 'scope-2',
        status: 'COMPLETED',
      });

    await expect(
      service.compare(authContext, 'scope-1', {
        baselineRunId: 'baseline-run',
        currentRunId: 'current-run',
      }),
    ).rejects.toThrow(BadRequestException);
    expect(nodeIORepository.listByRunId).not.toHaveBeenCalled();
  });

  it('reports a changed scanner target as not-scanned even when the same component completes', async () => {
    workflowRunRepository.findByRunId.mockImplementation((runId: string) =>
      Promise.resolve({
        runId,
        workflowId: 'workflow-1',
        organizationId: DEFAULT_ORGANIZATION_ID,
        scopeId: 'scope-1',
        status: 'COMPLETED',
      }),
    );
    nodeIORepository.listByRunId.mockImplementation((runId: string) =>
      Promise.resolve(
        runId === 'baseline-run'
          ? [
              nodeRow(
                'baseline-run',
                'sentris.httpx.scan',
                'completed',
                {
                  responses: [{ url: 'https://old.example.com', statusCode: 200 }],
                },
                {
                  nodeRef: 'httpx',
                  inputs: { targets: ['https://old.example.com'], threads: 1 },
                },
              ),
            ]
          : [
              nodeRow(
                'current-run',
                'sentris.httpx.scan',
                'completed',
                { responses: [] },
                {
                  nodeRef: 'httpx',
                  inputs: { targets: ['https://new.example.com'], threads: 1 },
                },
              ),
            ],
      ),
    );

    const result = await service.compare(authContext, 'scope-1', {
      baselineRunId: 'baseline-run',
      currentRunId: 'current-run',
    });

    expect(result.items).toContainEqual(
      expect.objectContaining({
        assetValue: 'https://old.example.com',
        observationStatus: 'not-scanned',
        change: 'missing',
      }),
    );
    expect(result.summary.notScanned).toBe(1);
    expect(result.summary.notObserved).toBe(0);
  });

  it('does not let a duplicate node using the same component establish scanner coverage', async () => {
    workflowRunRepository.findByRunId.mockImplementation((runId: string) =>
      Promise.resolve({
        runId,
        workflowId: 'workflow-1',
        organizationId: DEFAULT_ORGANIZATION_ID,
        scopeId: 'scope-1',
        status: 'COMPLETED',
      }),
    );
    nodeIORepository.listByRunId.mockImplementation((runId: string) =>
      Promise.resolve(
        runId === 'baseline-run'
          ? [
              nodeRow(
                'baseline-run',
                'sentris.subfinder.run',
                'completed',
                { subdomains: ['a.example.com'] },
                { nodeRef: 'subfinder-a', inputs: { domains: ['example.com'] } },
              ),
            ]
          : [
              nodeRow(
                'current-run',
                'sentris.subfinder.run',
                'completed',
                { subdomains: [] },
                { nodeRef: 'subfinder-b', inputs: { domains: ['example.com'] } },
              ),
            ],
      ),
    );

    const result = await service.compare(authContext, 'scope-1', {
      baselineRunId: 'baseline-run',
      currentRunId: 'current-run',
    });

    expect(result.items).toContainEqual(
      expect.objectContaining({
        assetValue: 'a.example.com',
        observationStatus: 'not-scanned',
      }),
    );
  });

  it('compares legacy runs without attempting to load an undefined workflow version', async () => {
    workflowRunRepository.findByRunId.mockImplementation((runId: string) =>
      Promise.resolve({
        runId,
        workflowId: 'workflow-1',
        organizationId: DEFAULT_ORGANIZATION_ID,
        scopeId: 'scope-1',
        status: 'COMPLETED',
      }),
    );
    workflowVersionRepository.findByIds.mockRejectedValue(
      new Error('undefined version IDs must not be queried'),
    );
    nodeIORepository.listByRunId.mockImplementation((runId: string) =>
      Promise.resolve([
        nodeRow(
          runId,
          'sentris.subfinder.run',
          'completed',
          runId === 'baseline-run' ? { subdomains: ['a.example.com'] } : { subdomains: [] },
          { nodeRef: 'subfinder', inputs: { domains: ['example.com'] } },
        ),
      ]),
    );

    const result = await service.compare(authContext, 'scope-1', {
      baselineRunId: 'baseline-run',
      currentRunId: 'current-run',
    });

    expect(result.summary.notObserved).toBe(1);
  });

  it('uses the full input fallback when a legacy workflow graph lacks parameter metadata', async () => {
    workflowRunRepository.findByRunId.mockImplementation((runId: string) =>
      Promise.resolve({
        runId,
        workflowId: 'workflow-1',
        workflowVersionId: `${runId}-version`,
        organizationId: DEFAULT_ORGANIZATION_ID,
        scopeId: 'scope-1',
        status: 'COMPLETED',
      }),
    );
    workflowVersionRepository.findByIds.mockResolvedValue([
      {
        id: 'baseline-run-version',
        graph: {
          nodes: [
            {
              id: 'httpx',
              type: 'sentris.httpx.scan',
              data: { config: { inputOverrides: { targets: ['https://old.example.com'] } } },
            },
          ],
        },
      },
      {
        id: 'current-run-version',
        graph: {
          nodes: [
            {
              id: 'httpx',
              type: 'sentris.httpx.scan',
              data: { config: { inputOverrides: { targets: ['https://new.example.com'] } } },
            },
          ],
        },
      },
    ]);
    nodeIORepository.listByRunId.mockImplementation((runId: string) =>
      Promise.resolve([
        nodeRow(
          runId,
          'sentris.httpx.scan',
          'completed',
          runId === 'baseline-run'
            ? { responses: [{ url: 'https://old.example.com', statusCode: 200 }] }
            : { responses: [] },
          {
            nodeRef: 'httpx',
            inputs: {
              targets: [
                runId === 'baseline-run' ? 'https://old.example.com' : 'https://new.example.com',
              ],
            },
          },
        ),
      ]),
    );

    const result = await service.compare(authContext, 'scope-1', {
      baselineRunId: 'baseline-run',
      currentRunId: 'current-run',
    });

    expect(result.summary.notScanned).toBe(1);
  });

  it('treats operational parameter changes as comparable coverage of the same target surface', async () => {
    workflowRunRepository.findByRunId.mockImplementation((runId: string) =>
      Promise.resolve({
        runId,
        workflowId: 'workflow-1',
        workflowVersionId: `${runId}-version`,
        organizationId: DEFAULT_ORGANIZATION_ID,
        scopeId: 'scope-1',
        status: 'COMPLETED',
      }),
    );
    workflowVersionRepository.findByIds.mockResolvedValue([
      {
        id: 'baseline-run-version',
        graph: {
          name: 'Baseline',
          nodes: [
            {
              id: 'httpx',
              type: 'sentris.httpx.scan',
              position: { x: 0, y: 0 },
              data: {
                label: 'HTTP probe',
                config: {
                  params: { statusCodes: '200', threads: 1 },
                  inputOverrides: { targets: ['https://example.com'] },
                },
              },
            },
          ],
          edges: [],
          viewport: { x: 0, y: 0, zoom: 1 },
        },
      },
      {
        id: 'current-run-version',
        graph: {
          name: 'Current',
          nodes: [
            {
              id: 'httpx',
              type: 'sentris.httpx.scan',
              position: { x: 0, y: 0 },
              data: {
                label: 'HTTP probe',
                config: {
                  params: { statusCodes: '418', threads: 50 },
                  inputOverrides: { targets: ['https://example.com'] },
                },
              },
            },
          ],
          edges: [],
          viewport: { x: 0, y: 0, zoom: 1 },
        },
      },
    ]);
    nodeIORepository.listByRunId.mockImplementation((runId: string) =>
      Promise.resolve(
        runId === 'baseline-run'
          ? [
              nodeRow(
                'baseline-run',
                'sentris.httpx.scan',
                'completed',
                {
                  responses: [{ url: 'https://example.com', statusCode: 200 }],
                },
                {
                  nodeRef: 'httpx',
                  inputs: {
                    targets: ['https://example.com'],
                    statusCodes: '200',
                    threads: 1,
                  },
                },
              ),
            ]
          : [
              nodeRow(
                'current-run',
                'sentris.httpx.scan',
                'completed',
                { responses: [] },
                {
                  nodeRef: 'httpx',
                  inputs: {
                    targets: ['https://example.com'],
                    statusCodes: '418',
                    threads: 50,
                  },
                },
              ),
            ],
      ),
    );

    const result = await service.compare(authContext, 'scope-1', {
      baselineRunId: 'baseline-run',
      currentRunId: 'current-run',
    });

    expect(result.items).toContainEqual(
      expect.objectContaining({
        assetValue: 'https://example.com',
        observationStatus: 'not-observed',
      }),
    );
  });

  it('does not claim comparable coverage when spilled effective inputs are unavailable', async () => {
    workflowRunRepository.findByRunId.mockImplementation((runId: string) =>
      Promise.resolve({
        runId,
        workflowId: 'workflow-1',
        organizationId: DEFAULT_ORGANIZATION_ID,
        scopeId: 'scope-1',
        status: 'COMPLETED',
      }),
    );
    nodeIORepository.listByRunId
      .mockResolvedValueOnce([
        nodeRow(
          'baseline-run',
          'sentris.httpx.scan',
          'completed',
          {
            responses: [{ url: 'https://example.com', statusCode: 200 }],
          },
          {
            nodeRef: 'httpx',
            inputs: null,
            inputsSpilled: true,
            inputsStorageRef: 'missing-inputs',
          },
        ),
      ])
      .mockResolvedValueOnce([
        nodeRow(
          'current-run',
          'sentris.httpx.scan',
          'completed',
          { responses: [] },
          { nodeRef: 'httpx', inputs: { targets: ['https://example.com'] } },
        ),
      ]);
    storage.downloadFile.mockRejectedValue(new Error('MinIO unavailable'));

    await expect(
      service.compare(authContext, 'scope-1', {
        baselineRunId: 'baseline-run',
        currentRunId: 'current-run',
      }),
    ).rejects.toThrow(ServiceUnavailableException);
  });

  it('reports spilled observation data as unavailable instead of a false empty comparison', async () => {
    workflowRunRepository.findByRunId.mockImplementation((runId: string) =>
      Promise.resolve({
        runId,
        workflowId: 'workflow-1',
        organizationId: DEFAULT_ORGANIZATION_ID,
        scopeId: 'scope-1',
        status: 'COMPLETED',
      }),
    );
    nodeIORepository.listByRunId
      .mockResolvedValueOnce([
        {
          ...nodeRow('baseline-run', 'sentris.subfinder.run', 'completed', null),
          outputsSpilled: true,
          outputsStorageRef: 'missing-object',
        },
      ])
      .mockResolvedValueOnce([
        nodeRow('current-run', 'sentris.subfinder.run', 'completed', {
          subdomains: [],
        }),
      ]);
    storage.downloadFile.mockRejectedValue(new Error('MinIO unavailable'));

    await expect(
      service.compare(authContext, 'scope-1', {
        baselineRunId: 'baseline-run',
        currentRunId: 'current-run',
      }),
    ).rejects.toThrow(ServiceUnavailableException);
  });
});
