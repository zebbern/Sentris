import { describe, expect, it, vi } from 'bun:test';

import '@sentris/worker/components';

import type { AuthContext } from '../../auth/types';
import { WorkflowGraphSchema } from '../dto/workflow-graph.dto';
import { WorkflowTagsService } from '../workflow-tags.service';
import { WorkflowVersionService } from '../workflow-version.service';
import { WorkflowsService } from '../workflows.service';

const AUTH: AuthContext = {
  userId: 'user-1',
  organizationId: 'org-1',
  roles: ['ADMIN'],
  provider: 'test',
  isAuthenticated: true,
};

const GRAPH = WorkflowGraphSchema.parse({
  name: 'Transactional workflow',
  description: 'Tests durable audit coupling',
  nodes: [
    {
      id: 'trigger',
      type: 'core.workflow.entrypoint',
      position: { x: 0, y: 0 },
      data: {
        label: 'Trigger',
        config: { params: { runtimeInputs: [] }, inputOverrides: {} },
      },
    },
  ],
  edges: [],
  viewport: { x: 0, y: 0, zoom: 1 },
});

const NOW = new Date('2026-07-26T00:00:00.000Z');

function workflowRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: 'wf-1',
    name: GRAPH.name,
    description: GRAPH.description ?? null,
    graph: GRAPH,
    compiledDefinition: null,
    organizationId: AUTH.organizationId,
    currentVersionId: null,
    lastRun: null,
    runCount: 0,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function versionRecord() {
  return {
    id: 'version-1',
    workflowId: 'wf-1',
    version: 1,
    graph: GRAPH,
    compiledDefinition: null,
    organizationId: AUTH.organizationId,
    createdAt: NOW,
  };
}

function createTransactionTracker() {
  const executor = { id: 'workflow-transaction' };
  let commits = 0;
  let rollbacks = 0;
  const transaction = vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => {
    try {
      const result = await callback(executor);
      commits += 1;
      return result;
    } catch (error) {
      rollbacks += 1;
      throw error;
    }
  });

  return {
    executor,
    transaction,
    get commits() {
      return commits;
    },
    get rollbacks() {
      return rollbacks;
    },
  };
}

function makeWorkflowsHarness(auditError?: Error) {
  const tracker = createTransactionTracker();
  const repository = {
    transaction: tracker.transaction,
    create: vi.fn(async (..._args: unknown[]) => workflowRecord()),
    update: vi.fn(async (..._args: unknown[]) => workflowRecord()),
    activateVersion: vi.fn(
      async (_id: unknown, version: ReturnType<typeof versionRecord>, _options?: unknown) =>
        workflowRecord({
          name: version.graph.name,
          description: version.graph.description ?? null,
          graph: version.graph,
          compiledDefinition: version.compiledDefinition,
          currentVersionId: version.id,
        }),
    ),
    updateMetadata: vi.fn(async (_id: unknown, metadata: { name: string }, ..._args: unknown[]) =>
      workflowRecord({ name: metadata.name }),
    ),
    findById: vi.fn(async (..._args: unknown[]) => workflowRecord()),
    findByIdForUpdate: vi.fn(async (..._args: unknown[]) => workflowRecord()),
    delete: vi.fn(async (..._args: unknown[]) => undefined),
  };
  const versionRepository = {
    create: vi.fn(async (..._args: unknown[]) => versionRecord()),
    findLatestByWorkflowId: vi.fn(async (..._args: unknown[]) => versionRecord()),
  };
  const roleRepository = {
    hasRole: vi.fn(async () => true),
    upsert: vi.fn(async (..._args: unknown[]) => undefined),
  };
  const auditLogService = {
    recordDurableWithExecutor: vi.fn(async (..._args: unknown[]) => {
      if (auditError) throw auditError;
    }),
  };
  const service = new WorkflowsService(
    repository as never,
    roleRepository as never,
    versionRepository as never,
    {} as never,
    {} as never,
    auditLogService as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );

  return {
    service,
    tracker,
    repository,
    versionRepository,
    roleRepository,
    auditLogService,
  };
}

describe('workflow mutation durable audit transactions', () => {
  it('uses the same transaction for workflow.create, version, owner role, and audit', async () => {
    const harness = makeWorkflowsHarness();

    await harness.service.create(GRAPH, AUTH);

    expect(harness.repository.create.mock.calls[0]?.[1]).toMatchObject({
      organizationId: 'org-1',
      executor: harness.tracker.executor,
    });
    expect(harness.versionRepository.create.mock.calls[0]?.[1]).toEqual({
      executor: harness.tracker.executor,
    });
    expect(harness.repository.activateVersion.mock.calls[0]?.[2]).toMatchObject({
      organizationId: 'org-1',
      executor: harness.tracker.executor,
    });
    expect(harness.roleRepository.upsert.mock.calls[0]?.[1]).toEqual({
      executor: harness.tracker.executor,
    });
    expect(harness.auditLogService.recordDurableWithExecutor.mock.calls[0]?.[0]).toBe(
      harness.tracker.executor,
    );
    expect(harness.auditLogService.recordDurableWithExecutor.mock.calls[0]?.[2]).toMatchObject({
      action: 'workflow.create',
    });
    expect(harness.tracker.commits).toBe(1);
  });

  it('uses the same transaction for workflow.update, its version, and audit', async () => {
    const harness = makeWorkflowsHarness();

    await harness.service.update('wf-1', GRAPH, AUTH);

    expect(harness.repository.activateVersion.mock.calls[0]?.[2]).toMatchObject({
      organizationId: 'org-1',
      executor: harness.tracker.executor,
    });
    expect(harness.versionRepository.create.mock.calls[0]?.[1]).toEqual({
      executor: harness.tracker.executor,
    });
    expect(harness.auditLogService.recordDurableWithExecutor.mock.calls[0]?.[0]).toBe(
      harness.tracker.executor,
    );
    expect(harness.auditLogService.recordDurableWithExecutor.mock.calls[0]?.[2]).toMatchObject({
      action: 'workflow.update',
    });
  });

  it('uses the same transaction for workflow.update_metadata and audit', async () => {
    const harness = makeWorkflowsHarness();

    await harness.service.updateMetadata('wf-1', { name: 'Renamed' }, AUTH);

    expect(harness.repository.updateMetadata.mock.calls[0]?.[2]).toMatchObject({
      organizationId: 'org-1',
      executor: harness.tracker.executor,
    });
    expect(harness.auditLogService.recordDurableWithExecutor.mock.calls[0]?.[0]).toBe(
      harness.tracker.executor,
    );
    expect(harness.auditLogService.recordDurableWithExecutor.mock.calls[0]?.[2]).toMatchObject({
      action: 'workflow.update_metadata',
    });
  });

  it('uses the same transaction for workflow.delete and audit', async () => {
    const harness = makeWorkflowsHarness();

    await harness.service.delete('wf-1', AUTH);

    expect(harness.repository.delete.mock.calls[0]?.[1]).toMatchObject({
      organizationId: 'org-1',
      executor: harness.tracker.executor,
    });
    expect(harness.auditLogService.recordDurableWithExecutor.mock.calls[0]?.[0]).toBe(
      harness.tracker.executor,
    );
    expect(harness.auditLogService.recordDurableWithExecutor.mock.calls[0]?.[2]).toMatchObject({
      action: 'workflow.delete',
    });
  });

  for (const [action, invoke] of [
    ['workflow.create', (service: WorkflowsService) => service.create(GRAPH, AUTH)],
    ['workflow.update', (service: WorkflowsService) => service.update('wf-1', GRAPH, AUTH)],
    [
      'workflow.update_metadata',
      (service: WorkflowsService) => service.updateMetadata('wf-1', { name: 'Renamed' }, AUTH),
    ],
    ['workflow.delete', (service: WorkflowsService) => service.delete('wf-1', AUTH)],
  ] as const) {
    it(`rolls back ${action} when durable audit enqueue rejects`, async () => {
      const harness = makeWorkflowsHarness(new Error('audit enqueue unavailable'));

      await expect(invoke(harness.service)).rejects.toThrow('audit enqueue unavailable');

      expect(harness.tracker.commits).toBe(0);
      expect(harness.tracker.rollbacks).toBe(1);
    });
  }
});

describe('workflow.commit durable audit transaction', () => {
  function makeHarness(auditError?: Error) {
    const tracker = createTransactionTracker();
    const repository = {
      transaction: tracker.transaction,
      findById: vi.fn(async () => workflowRecord()),
      saveCompiledDefinition: vi.fn(async (..._args: unknown[]) => workflowRecord()),
    };
    const versionRepository = {
      findLatestByWorkflowId: vi.fn(async () => versionRecord()),
      setCompiledDefinition: vi.fn(async (..._args: unknown[]) => versionRecord()),
    };
    const auditLogService = {
      recordDurableWithExecutor: vi.fn(async (..._args: unknown[]) => {
        if (auditError) throw auditError;
      }),
    };
    const service = new WorkflowVersionService(
      repository as never,
      { hasRole: vi.fn(async () => true) } as never,
      versionRepository as never,
      auditLogService as never,
    );
    return { service, tracker, repository, versionRepository, auditLogService };
  }

  it('uses one transaction for both compiled definitions and audit', async () => {
    const harness = makeHarness();

    await harness.service.commit('wf-1', AUTH);

    expect(harness.repository.saveCompiledDefinition.mock.calls[0]?.[2]).toMatchObject({
      executor: harness.tracker.executor,
    });
    expect(harness.versionRepository.setCompiledDefinition.mock.calls[0]?.[2]).toMatchObject({
      executor: harness.tracker.executor,
    });
    expect(harness.auditLogService.recordDurableWithExecutor.mock.calls[0]?.[0]).toBe(
      harness.tracker.executor,
    );
    expect(harness.auditLogService.recordDurableWithExecutor.mock.calls[0]?.[2]).toMatchObject({
      action: 'workflow.commit',
    });
  });

  it('rolls back both compiled definitions when durable audit enqueue rejects', async () => {
    const harness = makeHarness(new Error('audit enqueue unavailable'));

    await expect(harness.service.commit('wf-1', AUTH)).rejects.toThrow('audit enqueue unavailable');

    expect(harness.tracker.commits).toBe(0);
    expect(harness.tracker.rollbacks).toBe(1);
  });
});

describe('workflow.tags.updated durable audit transaction', () => {
  function makeHarness(auditError?: Error) {
    const tracker = createTransactionTracker();
    const repository = {
      transaction: tracker.transaction,
      findById: vi.fn(async () => workflowRecord()),
    };
    const tagsRepository = {
      getTagsByWorkflowId: vi.fn(async () => ['old-tag']),
      setTags: vi.fn(async (..._args: unknown[]) => ['new-tag']),
    };
    const auditLogService = {
      recordDurableWithExecutor: vi.fn(async (..._args: unknown[]) => {
        if (auditError) throw auditError;
      }),
    };
    const service = new WorkflowTagsService(
      repository as never,
      { hasRole: vi.fn(async () => true) } as never,
      tagsRepository as never,
      auditLogService as never,
    );
    return { service, tracker, tagsRepository, auditLogService };
  }

  it('uses one transaction for replacing tags and audit', async () => {
    const harness = makeHarness();

    await harness.service.setWorkflowTags(AUTH, 'wf-1', ['new-tag']);

    expect(harness.tagsRepository.setTags.mock.calls[0]?.[2]).toEqual({
      executor: harness.tracker.executor,
    });
    expect(harness.auditLogService.recordDurableWithExecutor.mock.calls[0]?.[0]).toBe(
      harness.tracker.executor,
    );
    expect(harness.auditLogService.recordDurableWithExecutor.mock.calls[0]?.[2]).toMatchObject({
      action: 'workflow.tags.updated',
    });
  });

  it('rolls back tag replacement when durable audit enqueue rejects', async () => {
    const harness = makeHarness(new Error('audit enqueue unavailable'));

    await expect(harness.service.setWorkflowTags(AUTH, 'wf-1', ['new-tag'])).rejects.toThrow(
      'audit enqueue unavailable',
    );

    expect(harness.tracker.commits).toBe(0);
    expect(harness.tracker.rollbacks).toBe(1);
  });
});
