import { beforeEach, describe, expect, it, vi } from 'bun:test';

import '@sentris/worker/components'; // Register components
import type { TemporalService, WorkflowRunStatus } from '../../temporal/temporal.service';
import { WorkflowDefinition } from '../../dsl/types';
import { TraceService } from '../../trace/trace.service';
import { WorkflowGraphDto, WorkflowGraphSchema } from '../dto/workflow-graph.dto';
import { WorkflowRecord, WorkflowRepository } from '../repository/workflow.repository';
import { WorkflowsService } from '../workflows.service';
import { WorkflowRunService } from '../workflow-run.service';
import { WorkflowVersionService } from '../workflow-version.service';
import { WorkflowsController } from '../workflows.controller';
import { WorkflowRunsController } from '../workflow-runs.controller';
import { WorkflowRunObservabilityController } from '../workflow-run-observability.controller';
import type { AuthContext } from '../../auth/types';

const TEST_ORG = 'test-org';
interface RepositoryOptions {
  organizationId?: string | null;
}

const baseGraph: WorkflowGraphDto = WorkflowGraphSchema.parse({
  name: 'Controller workflow',
  description: 'controller test',
  nodes: [
    {
      id: 'trigger',
      type: 'core.workflow.entrypoint',
      position: { x: 0, y: 0 },
      data: {
        label: 'Trigger',
        config: {
          params: {
            runtimeInputs: [{ id: 'fileId', label: 'File ID', type: 'file', required: true }],
          },
          inputOverrides: {},
        },
      },
    },
    {
      id: 'loader',
      type: 'core.file.loader',
      position: { x: 0, y: 100 },
      data: {
        label: 'Loader',
        config: {
          params: {},
          inputOverrides: {
            fileId: '11111111-1111-4111-8111-111111111111',
          },
        },
      },
    },
  ],
  edges: [
    {
      id: 'edge',
      source: 'trigger',
      target: 'loader',
      sourceHandle: 'fileId',
      targetHandle: 'fileId',
    },
  ],
  viewport: { x: 0, y: 0, zoom: 1 },
});

describe('WorkflowsController', () => {
  let controller: WorkflowsController;
  let runsController: WorkflowRunsController;
  let observabilityController: WorkflowRunObservabilityController;
  let repositoryStore: Map<string, WorkflowRecord>;
  let runStore: Map<string, any>;
  let lastCancelledRun: { workflowId: string; runId?: string } | null = null;
  interface MockWorkflowVersion {
    id: string;
    workflowId: string;
    version: number;
    graph: WorkflowGraphDto;
    compiledDefinition: WorkflowDefinition | null;
    createdAt: Date;
    organizationId: string | null;
  }

  let versionSeq = 0;
  let versionStore: Map<string, MockWorkflowVersion>;
  const versionsByWorkflow = new Map<string, MockWorkflowVersion[]>();
  const authContext: AuthContext = {
    userId: 'user-1',
    organizationId: TEST_ORG,
    roles: ['ADMIN'],
    isAuthenticated: true,
    provider: 'test',
  };

  const resetVersions = () => {
    versionSeq = 0;
    versionStore = new Map();
    versionsByWorkflow.clear();
  };

  const createVersionRecord = (
    workflowId: string,
    graph: WorkflowGraphDto,
    organizationId: string | null = TEST_ORG,
  ): MockWorkflowVersion => {
    versionSeq += 1;
    const record: MockWorkflowVersion = {
      id: `wf-version-${versionSeq}`,
      workflowId,
      version: versionSeq,
      graph,
      compiledDefinition: null,
      createdAt: new Date(),
      organizationId,
    };
    versionStore.set(record.id, record);
    const list = versionsByWorkflow.get(workflowId) ?? [];
    versionsByWorkflow.set(workflowId, [...list, record]);
    return record;
  };

  const versionRepositoryStub = {
    async create(
      input: { workflowId: string; graph: WorkflowGraphDto },
      options: { organizationId?: string | null } = {},
    ) {
      return createVersionRecord(input.workflowId, input.graph, options.organizationId ?? TEST_ORG);
    },
    async findLatestByWorkflowId(
      workflowId: string,
      options: { organizationId?: string | null } = {},
    ) {
      const list = versionsByWorkflow.get(workflowId) ?? [];
      const filtered = options.organizationId
        ? list.filter((record) => record.organizationId === options.organizationId)
        : list;
      return filtered.length > 0 ? filtered[filtered.length - 1] : undefined;
    },
    async findById(id: string, options: { organizationId?: string | null } = {}) {
      const record = versionStore.get(id);
      if (!record) return undefined;
      if (options.organizationId && record.organizationId !== options.organizationId) {
        return undefined;
      }
      return record;
    },
    async findByWorkflowAndVersion(input: {
      workflowId: string;
      version: number;
      organizationId?: string | null;
    }) {
      const list = versionsByWorkflow.get(input.workflowId) ?? [];
      return list.find(
        (record) =>
          record.version === input.version &&
          (!input.organizationId || record.organizationId === input.organizationId),
      );
    },
    async setCompiledDefinition(
      id: string,
      definition: WorkflowDefinition,
      options: { organizationId?: string | null } = {},
    ) {
      const record = versionStore.get(id);
      if (!record) {
        return undefined;
      }
      if (options.organizationId && record.organizationId !== options.organizationId) {
        return undefined;
      }
      record.compiledDefinition = definition;
      return record;
    },
    async findLatestByWorkflowIds(
      workflowIds: string[],
      options: { organizationId?: string | null } = {},
    ) {
      return workflowIds
        .map((wfId) => {
          const list = versionsByWorkflow.get(wfId) ?? [];
          const filtered = options.organizationId
            ? list.filter((r) => r.organizationId === options.organizationId)
            : list;
          return filtered.length > 0 ? filtered[filtered.length - 1] : undefined;
        })
        .filter(Boolean);
    },
  };
  const now = new Date().toISOString();

  const repositoryStub: Partial<WorkflowRepository> = {
    async transaction(callback) {
      return callback(repositoryStub as never);
    },
    async create(input, options: RepositoryOptions = {}) {
      const { organizationId = TEST_ORG } = options;
      const id = `wf-${repositoryStore.size + 1}`;
      const record: WorkflowRecord = {
        id,
        name: input.name,
        description: input.description ?? null,
        graph: input,
        compiledDefinition: null,
        lastRun: null,
        runCount: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
        organizationId,
        currentVersionId: null,
        mutationIdempotencyKey: null,
      };
      repositoryStore.set(id, record);
      return record;
    },
    async update(id, input, options: RepositoryOptions = {}) {
      const existing = repositoryStore.get(id);
      if (!existing) {
        throw new Error(`Workflow ${id} not found`);
      }
      if (options.organizationId && existing.organizationId !== options.organizationId) {
        throw new Error('Forbidden');
      }
      const updated: WorkflowRecord = {
        ...existing,
        name: input.name,
        description: input.description ?? null,
        graph: input,
        updatedAt: new Date(),
        compiledDefinition: existing.compiledDefinition,
      };
      repositoryStore.set(id, updated);
      return updated;
    },
    async activateVersion(id, version, options: RepositoryOptions = {}) {
      const existing = repositoryStore.get(id);
      if (!existing) {
        throw new Error(`Workflow ${id} not found`);
      }
      if (options.organizationId && existing.organizationId !== options.organizationId) {
        throw new Error('Forbidden');
      }
      const updated: WorkflowRecord = {
        ...existing,
        name: version.graph.name,
        description: version.graph.description ?? null,
        graph: version.graph,
        currentVersionId: version.id,
        compiledDefinition: version.compiledDefinition,
        updatedAt: new Date(),
      };
      repositoryStore.set(id, updated);
      return updated;
    },
    async findById(id, options: RepositoryOptions = {}) {
      const record = repositoryStore.get(id);
      if (!record) return undefined;
      if (options.organizationId && record.organizationId !== options.organizationId) {
        return undefined;
      }
      return record;
    },
    async findByIdForUpdate(id, options: RepositoryOptions = {}) {
      const record = repositoryStore.get(id);
      if (!record) return undefined;
      if (options.organizationId && record.organizationId !== options.organizationId) {
        return undefined;
      }
      return record;
    },
    async delete(id, options: RepositoryOptions = {}) {
      const record = repositoryStore.get(id);
      if (!record) return;
      if (options.organizationId && record.organizationId !== options.organizationId) {
        return;
      }
      repositoryStore.delete(id);
    },
    async list(options: RepositoryOptions = {}) {
      const list = Array.from(repositoryStore.values());
      if (options.organizationId) {
        return list.filter((record) => record.organizationId === options.organizationId);
      }
      return list;
    },
    async saveCompiledDefinition(id, definition, options: RepositoryOptions = {}) {
      const existing = repositoryStore.get(id);
      if (!existing) {
        throw new Error(`Workflow ${id} not found`);
      }
      if (options.organizationId && existing.organizationId !== options.organizationId) {
        throw new Error('Forbidden');
      }
      const updated: WorkflowRecord = {
        ...existing,
        compiledDefinition: definition,
        updatedAt: new Date(),
      };
      repositoryStore.set(id, updated);
      return updated;
    },
    async incrementRunCount(id, options: RepositoryOptions = {}) {
      const existing = repositoryStore.get(id);
      if (!existing) {
        throw new Error(`Workflow ${id} not found`);
      }
      if (options.organizationId && existing.organizationId !== options.organizationId) {
        throw new Error('Forbidden');
      }
      const updated: WorkflowRecord = {
        ...existing,
        runCount: (existing.runCount ?? 0) + 1,
        lastRun: new Date(),
      };
      repositoryStore.set(id, updated);
      return updated;
    },
  };

  beforeEach(() => {
    repositoryStore = new Map();
    runStore = new Map();
    lastCancelledRun = null;
    resetVersions();

    const runRepositoryStub = {
      async prepare(
        data: {
          runId: string;
          workflowId: string;
          workflowVersionId: string;
          workflowVersion: number;
          totalActions: number;
          inputs?: Record<string, unknown>;
          organizationId?: string | null;
          triggerType?: string;
          triggerSource?: string | null;
          triggerLabel?: string | null;
          inputPreview?: Record<string, unknown>;
          parentRunId?: string | null;
          parentNodeRef?: string | null;
          scopeId?: string | null;
        },
        onPrepared?: (executor: unknown, record: any) => Promise<void>,
      ) {
        const existing = runStore.get(data.runId);
        if (existing) {
          return { record: existing, created: false };
        }
        const record = {
          runId: data.runId,
          workflowId: data.workflowId,
          workflowVersionId: data.workflowVersionId,
          workflowVersion: data.workflowVersion,
          temporalRunId: null,
          totalActions: data.totalActions,
          inputs: data.inputs ?? {},
          createdAt: new Date(now),
          updatedAt: new Date(now),
          organizationId: data.organizationId ?? TEST_ORG,
          triggerType: data.triggerType ?? 'manual',
          triggerSource: data.triggerSource ?? null,
          triggerLabel: data.triggerLabel ?? null,
          inputPreview: data.inputPreview ?? { runtimeInputs: {}, nodeOverrides: {} },
          parentRunId: data.parentRunId ?? null,
          parentNodeRef: data.parentNodeRef ?? null,
          scopeId: data.scopeId ?? null,
        };
        runStore.set(data.runId, record);
        await onPrepared?.({}, record);
        return { record, created: true };
      },
      async markStarted(
        data: {
          runId: string;
          workflowId: string;
          organizationId: string | null;
          temporalRunId: string;
        },
        onTransition?: (executor: unknown, record: any) => Promise<void>,
      ) {
        const existing = runStore.get(data.runId);
        if (
          !existing ||
          existing.workflowId !== data.workflowId ||
          existing.organizationId !== data.organizationId
        ) {
          throw new Error('Prepared workflow run not found');
        }
        if (existing.temporalRunId) {
          if (existing.temporalRunId !== data.temporalRunId) {
            throw new Error('Workflow run points at a different Temporal execution');
          }
          return { record: existing, transitioned: false };
        }
        const record = {
          ...existing,
          temporalRunId: data.temporalRunId,
          updatedAt: new Date(now),
        };
        runStore.set(data.runId, record);
        await onTransition?.({}, record);
        return { record, transitioned: true };
      },
      async findByRunId(runId: string, options: { organizationId?: string | null } = {}) {
        const record = runStore.get(runId);
        if (!record) {
          return undefined;
        }
        if (options.organizationId && record.organizationId !== options.organizationId) {
          return undefined;
        }
        return record;
      },
      async hasPendingInputs() {
        return false;
      },
      async scopeBelongsToOrganization() {
        return true;
      },
    };

    const traceRepositoryStub = {
      async countByType() {
        return 1;
      },
      async getEventTimeRange() {
        const base = Date.now();
        return {
          earliest: base - 100,
          latest: base,
        };
      },
    };

    const workflowRoleRepositoryStub = {
      async upsert() {
        return;
      },
      async hasRole() {
        return false;
      },
    };

    const analyticsServiceMock = {
      trackWorkflowStarted: vi.fn(),
      trackWorkflowCompleted: vi.fn(),
      trackComponentExecuted: vi.fn(),
      trackApiCall: vi.fn(),
      track: vi.fn(),
      isEnabled: vi.fn().mockReturnValue(true),
    };

    const temporalStub: Pick<
      TemporalService,
      | 'startWorkflow'
      | 'describeWorkflow'
      | 'getWorkflowResult'
      | 'cancelWorkflow'
      | 'getDefaultTaskQueue'
    > = {
      async startWorkflow(options) {
        return {
          workflowId: options.workflowId ?? 'sentris-run-controller',
          runId: 'temporal-run-controller',
          taskQueue: options.taskQueue ?? 'sentris-default',
        };
      },
      async describeWorkflow(ref) {
        const status: WorkflowRunStatus = {
          workflowId: ref.workflowId,
          runId: ref.runId ?? 'temporal-run-controller',
          status: 'RUNNING',
          startTime: now,
          closeTime: undefined,
          historyLength: 0,
          taskQueue: 'sentris-default',
          failure: undefined,
        };
        return status;
      },
      async getWorkflowResult(ref) {
        return { workflowId: ref.workflowId, success: true };
      },
      async cancelWorkflow(ref) {
        lastCancelledRun = ref;
      },
      getDefaultTaskQueue() {
        return 'sentris-default';
      },
    };

    const auditLogMock = {
      record: vi.fn(),
      recordDurable: vi.fn().mockResolvedValue(undefined),
      recordDurableWithExecutor: vi.fn().mockResolvedValue(undefined),
    } as any;
    const workflowVersionService = new WorkflowVersionService(
      repositoryStub as WorkflowRepository,
      workflowRoleRepositoryStub as any,
      versionRepositoryStub as any,
      auditLogMock,
    );
    const workflowRunService = new WorkflowRunService(
      repositoryStub as any,
      runRepositoryStub as any,
      versionRepositoryStub as any,
      traceRepositoryStub as any,
      temporalStub as TemporalService,
      analyticsServiceMock as any,
      auditLogMock,
      workflowVersionService,
    );
    const workflowsService = new WorkflowsService(
      repositoryStub as WorkflowRepository,
      workflowRoleRepositoryStub as any,
      versionRepositoryStub as any,
      runRepositoryStub as any,
      temporalStub as TemporalService,
      auditLogMock,
      {} as any,
      workflowVersionService,
      workflowRunService,
      {
        get: vi.fn().mockResolvedValue(null),
        set: vi.fn().mockResolvedValue(undefined),
        delete: vi.fn().mockResolvedValue(undefined),
      } as any,
    );
    const traceService = new TraceService({
      listByRunId: async () => [],
    } as any);
    const logStreamService = {
      fetch: async () => ({ runId: 'sentris-run-controller', streams: [] }),
    };
    const artifactsService = {
      listRunArtifacts: vi
        .fn()
        .mockResolvedValue({ runId: 'sentris-run-controller', artifacts: [] }),
    };
    const _terminalStreamService = {
      fetchChunks: vi.fn().mockResolvedValue({ cursor: '{}', chunks: [] }),
    };
    const nodeIOService = {
      listDetails: vi.fn().mockResolvedValue([]),
      getNodeIO: vi.fn().mockResolvedValue(null),
    };
    controller = new WorkflowsController(workflowsService, {} as any, workflowVersionService, {
      get: (key: string) => {
        if (key === 'app') return { nodeEnv: 'test' };
        return undefined;
      },
    } as any);
    runsController = new WorkflowRunsController(
      new WorkflowRunService(
        repositoryStub as any,
        runRepositoryStub as any,
        versionRepositoryStub as any,
        traceRepositoryStub as any,
        temporalStub as TemporalService,
        analyticsServiceMock as any,
        auditLogMock,
        workflowVersionService,
      ),
    );
    observabilityController = new WorkflowRunObservabilityController(
      traceService,
      workflowsService,
      artifactsService as any,
      nodeIOService as any,
      logStreamService as any,
    );
  });

  it('creates, lists, updates, and retrieves workflows', async () => {
    const created = await controller.create(authContext, baseGraph);
    expect(created.id).toBeDefined();
    expect(created.name).toBe('Controller workflow');
    expect(created.currentVersion).toBe(1);
    expect(created.currentVersionId).toBeDefined();

    const list = await controller.findAll(authContext);
    expect(list).toHaveLength(1);
    expect(list[0].currentVersion).toBe(1);

    if (!created.currentVersionId) {
      throw new Error('Expected the created workflow to have a current version');
    }
    const baseVersionId = created.currentVersionId;

    const updated = await controller.update(authContext, created.id, {
      ...baseGraph,
      name: 'Updated workflow',
      expectedVersionId: baseVersionId,
    });
    expect(updated.name).toBe('Updated workflow');
    expect(updated.currentVersion).toBeGreaterThanOrEqual(2);

    await expect(
      controller.update(authContext, created.id, {
        ...baseGraph,
        name: 'Stale workflow update',
        expectedVersionId: baseVersionId,
      }),
    ).rejects.toThrow('changed since version');

    const fetched = await controller.findOne(authContext, created.id);
    expect(fetched.id).toBe(created.id);
    expect(fetched.currentVersion).toBe(updated.currentVersion);

    const response = await controller.remove(authContext, created.id);
    expect(response).toEqual({ status: 'deleted', id: created.id });
  });

  it('commits, starts, and inspects workflow runs', async () => {
    const created = await controller.create(authContext, baseGraph);

    const definition = await controller.commit(created.id, authContext);
    expect(definition.actions).toHaveLength(2);

    const run = await controller.run(authContext, created.id, {
      inputs: { fileId: '11111111-1111-4111-8111-111111111111' },
    });
    expect(run.runId).toMatch(/^sentris-run-/);
    expect(run.temporalRunId).toBe('temporal-run-controller');
    expect(run.status).toBe('RUNNING');
    expect(run.taskQueue).toBe('sentris-default');
    expect(run.workflowVersion).toBeDefined();
    expect(run.workflowVersionId).toBeDefined();

    const status = await runsController.status(
      run.runId,
      { temporalRunId: run.temporalRunId },
      authContext,
    );
    expect(status.runId).toBe(run.runId);
    expect(status.workflowId).toBe(created.id);
    expect(status.status).toBe('RUNNING');
    expect(status.progress).toEqual({ completedActions: 1, totalActions: 2 });

    const result = await runsController.result(
      run.runId,
      { temporalRunId: run.temporalRunId },
      authContext,
    );
    expect(result).toEqual({
      runId: run.runId,
      result: { workflowId: run.runId, success: true },
    });

    const cancelResponse = await runsController.cancel(
      run.runId,
      { temporalRunId: run.temporalRunId },
      authContext,
    );
    expect(cancelResponse).toEqual({ status: 'cancelled', runId: run.runId });
    expect(lastCancelledRun).toEqual({
      workflowId: run.runId,
      runId: run.temporalRunId,
    });

    const trace = await observabilityController.trace(run.runId, authContext);
    expect(trace.runId).toBe(run.runId);
    expect(trace.events).toHaveLength(0);
    expect(trace.cursor).toBeUndefined();
  });

  it('returns run metadata for direct run lookup', async () => {
    const created = await controller.create(authContext, baseGraph);
    await controller.commit(created.id, authContext);
    const run = await controller.run(authContext, created.id, {
      inputs: { fileId: '11111111-1111-4111-8111-111111111111' },
    });

    const summary = await runsController.getRun(authContext, run.runId);
    expect(summary.id).toBe(run.runId);
    expect(summary.workflowId).toBe(created.id);
    expect(summary.workflowName).toBeDefined();
    expect(summary.nodeCount).toBeGreaterThan(0);
  });
});
