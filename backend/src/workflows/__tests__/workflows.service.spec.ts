import { beforeEach, describe, expect, it, vi } from 'bun:test';

import '@sentris/worker/components'; // Register components
import { WorkflowGraphSchema } from '../dto/workflow-graph.dto';
import { compileWorkflowGraph } from '../../dsl/compiler';
import { WorkflowDefinition } from '../../dsl/types';
import type {
  StartWorkflowOptions,
  TemporalService,
  WorkflowRunStatus,
} from '../../temporal/temporal.service';
import { WorkflowRepository } from '../repository/workflow.repository';
import { WorkflowsService } from '../workflows.service';
import type { AuthContext } from '../../auth/types';
import type { ExecutionInputPreview, ExecutionTriggerType } from '@sentris/shared';

const TEST_ORG = 'test-org';
const authContext: AuthContext = {
  userId: 'service-user',
  organizationId: TEST_ORG,
  roles: ['ADMIN'],
  isAuthenticated: true,
  provider: 'test',
};

const sampleGraph = WorkflowGraphSchema.parse({
  name: 'Sample workflow',
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
      id: 'e1',
      source: 'trigger',
      target: 'loader',
      sourceHandle: 'fileId',
      targetHandle: 'fileId',
    },
  ],
  viewport: { x: 0, y: 0, zoom: 1 },
});

describe('WorkflowsService', () => {
  let service: WorkflowsService;
  let createCalls = 0;
  let startCalls: StartWorkflowOptions[] = [];
  let lastDescribeRef: { workflowId: string; runId?: string } | null = null;
  let lastCancelRef: { workflowId: string; runId?: string } | null = null;
  const now = new Date().toISOString();

  let savedDefinition: WorkflowDefinition | null = null;
  let storedRunMeta: any = null;
  let completedCount = 0;

  interface MockWorkflowVersion {
    id: string;
    workflowId: string;
    version: number;
    graph: typeof sampleGraph;
    compiledDefinition: WorkflowDefinition | null;
    createdAt: Date;
    organizationId: string | null;
  }

  let workflowVersionSeq = 0;
  let workflowVersionStore = new Map<string, MockWorkflowVersion>();
  const workflowVersionsByWorkflow = new Map<string, MockWorkflowVersion[]>();

  const resetWorkflowVersions = () => {
    workflowVersionSeq = 0;
    workflowVersionStore = new Map();
    workflowVersionsByWorkflow.clear();
  };

  const createWorkflowVersionRecord = (
    workflowId: string,
    graph: typeof sampleGraph = sampleGraph,
    organizationId: string | null = TEST_ORG,
  ): MockWorkflowVersion => {
    workflowVersionSeq += 1;
    const record: MockWorkflowVersion = {
      id: `version-${workflowVersionSeq}`,
      workflowId,
      version: workflowVersionSeq,
      graph,
      compiledDefinition: null,
      createdAt: new Date(now),
      organizationId,
    };
    workflowVersionStore.set(record.id, record);
    const list = workflowVersionsByWorkflow.get(workflowId) ?? [];
    workflowVersionsByWorkflow.set(workflowId, [...list, record]);
    return record;
  };

  const makeWorkflowRecord = (overrides: Record<string, unknown> = {}) => ({
    id: 'workflow-id',
    createdAt: new Date(now),
    updatedAt: new Date(now),
    name: sampleGraph.name,
    description: sampleGraph.description ?? null,
    graph: sampleGraph,
    compiledDefinition: null,
    organizationId: TEST_ORG,
    lastRun: null,
    runCount: 0,
    ...overrides,
  });

  const deleteCalls: string[] = [];
  const updateMetadataCalls: {
    id: string;
    metadata: { name: string; description?: string | null };
  }[] = [];

  const repositoryMock = {
    async create() {
      createCalls += 1;
      return makeWorkflowRecord();
    },
    async update() {
      return makeWorkflowRecord();
    },
    async findById() {
      return makeWorkflowRecord();
    },
    async delete(id: string) {
      deleteCalls.push(id);
      return;
    },
    async list() {
      return [];
    },
    async listSummary() {
      return [];
    },
    async updateMetadata(id: string, metadata: { name: string; description?: string | null }) {
      updateMetadataCalls.push({ id, metadata });
      return makeWorkflowRecord({ name: metadata.name, description: metadata.description ?? null });
    },
    async saveCompiledDefinition(_: string, definition: WorkflowDefinition) {
      savedDefinition = definition;
      return makeWorkflowRecord({ compiledDefinition: definition });
    },
    async incrementRunCount() {
      return;
    },
  } as unknown as WorkflowRepository;

  const versionRepositoryMock = {
    async create(
      input: { workflowId: string; graph: typeof sampleGraph },
      options: { organizationId?: string | null } = {},
    ) {
      return createWorkflowVersionRecord(
        input.workflowId,
        input.graph,
        options.organizationId ?? TEST_ORG,
      );
    },
    async findLatestByWorkflowId(
      workflowId: string,
      options: { organizationId?: string | null } = {},
    ) {
      const list = workflowVersionsByWorkflow.get(workflowId) ?? [];
      const filtered = options.organizationId
        ? list.filter((record) => record.organizationId === options.organizationId)
        : list;
      return filtered.length > 0 ? filtered[filtered.length - 1] : undefined;
    },
    async findById(id: string, options: { organizationId?: string | null } = {}) {
      const record = workflowVersionStore.get(id);
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
      const list = workflowVersionsByWorkflow.get(input.workflowId) ?? [];
      return list.find(
        (record) =>
          record.version === input.version &&
          (!input.organizationId || record.organizationId === input.organizationId),
      );
    },
    async findAllByWorkflowId(
      workflowId: string,
      options: { organizationId?: string | null } = {},
    ) {
      const list = workflowVersionsByWorkflow.get(workflowId) ?? [];
      const filtered = options.organizationId
        ? list.filter((record) => record.organizationId === options.organizationId)
        : list;
      return filtered.map((v) => ({
        id: v.id,
        workflowId: v.workflowId,
        version: v.version,
        createdAt: v.createdAt,
      }));
    },
    async setCompiledDefinition(
      id: string,
      definition: WorkflowDefinition,
      options: { organizationId?: string | null } = {},
    ) {
      const record = workflowVersionStore.get(id);
      if (!record) {
        return undefined;
      }
      if (options.organizationId && record.organizationId !== options.organizationId) {
        return undefined;
      }
      record.compiledDefinition = definition;
      return record;
    },
  };

  const runRepositoryMock = {
    async upsert(data: {
      runId: string;
      workflowId: string;
      workflowVersionId: string;
      workflowVersion: number;
      totalActions: number;
      inputs?: Record<string, unknown>;
      organizationId?: string | null;
      triggerType?: ExecutionTriggerType;
      triggerSource?: string | null;
      triggerLabel?: string | null;
      inputPreview?: ExecutionInputPreview;
    }) {
      storedRunMeta = {
        runId: data.runId,
        workflowId: data.workflowId,
        workflowVersionId: data.workflowVersionId,
        workflowVersion: data.workflowVersion,
        totalActions: data.totalActions,
        inputs: data.inputs ?? {},
        createdAt: new Date(now),
        updatedAt: new Date(now),
        organizationId: data.organizationId ?? TEST_ORG,
        triggerType: data.triggerType ?? 'manual',
        triggerSource: data.triggerSource ?? null,
        triggerLabel: data.triggerLabel ?? null,
        inputPreview: data.inputPreview ?? { runtimeInputs: {}, nodeOverrides: {} },
      };
      return storedRunMeta;
    },
    async findByRunId(runId: string, options: { organizationId?: string | null } = {}) {
      if (storedRunMeta && storedRunMeta.runId === runId) {
        if (options.organizationId && storedRunMeta.organizationId !== options.organizationId) {
          return undefined;
        }
        return storedRunMeta;
      }
      return undefined;
    },
    async list(options: { workflowId?: string; organizationId?: string | null } = {}) {
      if (!storedRunMeta) {
        return [];
      }
      if (options.workflowId && storedRunMeta.workflowId !== options.workflowId) {
        return [];
      }
      if (options.organizationId && storedRunMeta.organizationId !== options.organizationId) {
        return [];
      }
      return [storedRunMeta];
    },
    async hasPendingInputs() {
      return false;
    },
    async cacheTerminalStatus() {
      // no-op in tests
    },
  };

  const traceRepositoryMock = {
    async countByType(runId: string, type: string) {
      if (!storedRunMeta || storedRunMeta.runId !== runId) {
        return 0;
      }
      if (type === 'NODE_COMPLETED') {
        return completedCount;
      }
      if (type === 'NODE_STARTED') {
        return storedRunMeta.totalActions ?? 0;
      }
      return 0;
    },
    async getEventTimeRange(runId: string) {
      if (!storedRunMeta || storedRunMeta.runId !== runId) {
        return null;
      }
      const base = Date.now();
      return {
        earliest: base - 1000,
        latest: base,
      };
    },
  };

  const workflowRoleRepositoryMock = {
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

  const buildTemporalStub = (overrides?: Partial<WorkflowRunStatus>) => {
    const temporalStub: Pick<
      TemporalService,
      | 'startWorkflow'
      | 'describeWorkflow'
      | 'getWorkflowResult'
      | 'cancelWorkflow'
      | 'getDefaultTaskQueue'
    > = {
      async startWorkflow(options) {
        startCalls.push(options);
        return {
          workflowId: options.workflowId ?? 'sentris-run-mock',
          runId: 'temporal-run-mock',
          taskQueue: options.taskQueue ?? 'sentris-default',
        };
      },
      async describeWorkflow(ref) {
        lastDescribeRef = ref;
        const base: WorkflowRunStatus = {
          workflowId: ref.workflowId,
          runId: ref.runId ?? 'temporal-run-mock',
          status: 'RUNNING',
          startTime: now,
          closeTime: undefined,
          historyLength: 0,
          taskQueue: 'sentris-default',
          failure: undefined,
        };
        return { ...base, ...overrides };
      },
      async getWorkflowResult(ref) {
        return { workflowId: ref.workflowId, completed: true };
      },
      async cancelWorkflow(ref) {
        lastCancelRef = ref;
      },
      getDefaultTaskQueue() {
        return 'sentris-default';
      },
    };

    return temporalStub as TemporalService;
  };

  beforeEach(() => {
    createCalls = 0;
    startCalls = [];
    lastDescribeRef = null;
    lastCancelRef = null;
    savedDefinition = null;
    storedRunMeta = null;
    completedCount = 0;
    deleteCalls.length = 0;
    updateMetadataCalls.length = 0;
    resetWorkflowVersions();

    const temporalService = buildTemporalStub();
    service = new WorkflowsService(
      repositoryMock,
      workflowRoleRepositoryMock as any,
      versionRepositoryMock as any,
      runRepositoryMock as any,
      traceRepositoryMock as any,
      temporalService,
      analyticsServiceMock as any,
      { record: vi.fn() } as any,
    );
  });

  it('creates a workflow using the repository', async () => {
    const created = await service.create(sampleGraph, authContext);
    expect(created.id).toBe('workflow-id');
    expect(createCalls).toBe(1);
    expect(created.currentVersion).toBe(1);
    expect(created.currentVersionId).toBeDefined();
  });

  it('commits a workflow definition', async () => {
    await service.create(sampleGraph, authContext);
    const definition = await service.commit('workflow-id', authContext);
    expect(definition.actions.length).toBeGreaterThan(0);
    expect(savedDefinition).toEqual(definition);
    const latestVersion = versionRepositoryMock.findLatestByWorkflowId
      ? await versionRepositoryMock.findLatestByWorkflowId('workflow-id')
      : undefined;
    expect(latestVersion?.compiledDefinition).toEqual(definition);
  });

  it('runs a workflow definition via the Temporal service', async () => {
    const created = await service.create(sampleGraph, authContext);
    const definition = compileWorkflowGraph(sampleGraph);
    repositoryMock.findById = async () => ({
      id: 'workflow-id',
      createdAt: new Date(now),
      updatedAt: new Date(now),
      name: sampleGraph.name,
      description: sampleGraph.description ?? null,
      graph: sampleGraph,
      compiledDefinition: definition,
      lastRun: null,
      runCount: 0,
      organizationId: TEST_ORG,
    });

    const run = await service.run('workflow-id', { inputs: { message: 'hi' } }, authContext);

    expect(run.runId).toMatch(/^sentris-run-/);
    expect(run.workflowId).toBe('workflow-id');
    expect(run.status).toBe('RUNNING');
    expect(run.taskQueue).toBe('sentris-default');
    expect(startCalls).toHaveLength(1);
    expect(startCalls[0].workflowType).toBe('sentrisWorkflowRun');
    expect(startCalls[0].args?.[0]).toMatchObject({
      runId: run.runId,
      workflowId: 'workflow-id',
      inputs: { message: 'hi' },
      organizationId: TEST_ORG,
    });
    expect(storedRunMeta).toMatchObject({
      runId: run.runId,
      workflowId: 'workflow-id',
      totalActions: definition.actions.length,
      organizationId: TEST_ORG,
    });
    if (created.currentVersionId === null || created.currentVersion === null) {
      throw new Error('Expected workflow version to be assigned');
    }
    const currentVersionId = created.currentVersionId;
    const currentVersionNumber = created.currentVersion;
    expect(run.workflowVersionId).toEqual(currentVersionId);
    expect(run.workflowVersion).toEqual(currentVersionNumber);
    expect(storedRunMeta).toMatchObject({
      runId: run.runId,
      workflowId: 'workflow-id',
      workflowVersionId: currentVersionId,
      workflowVersion: currentVersionNumber,
      totalActions: definition.actions.length,
      organizationId: TEST_ORG,
    });
  });

  it('returns run metadata via getRun', async () => {
    await service.create(sampleGraph, authContext);
    const definition = compileWorkflowGraph(sampleGraph);
    repositoryMock.findById = async () => ({
      id: 'workflow-id',
      createdAt: new Date(now),
      updatedAt: new Date(now),
      name: sampleGraph.name,
      description: sampleGraph.description ?? null,
      graph: sampleGraph,
      compiledDefinition: definition,
      lastRun: null,
      runCount: 0,
      organizationId: TEST_ORG,
    });

    const run = await service.run('workflow-id', { inputs: { foo: 'bar' } }, authContext);
    const summary = await service.getRun(run.runId, authContext);

    expect(summary.id).toBe(run.runId);
    expect(summary.workflowId).toBe('workflow-id');
    expect(summary.workflowName).toBe(sampleGraph.name);
    expect(summary.nodeCount).toBeGreaterThan(0);
    expect(summary.eventCount).toBeGreaterThanOrEqual(0);
    expect(summary.duration).toBeGreaterThanOrEqual(0);
    expect(summary.status).toBe('RUNNING');
  });

  it('prepares run payloads with trigger metadata and idempotent run ids', async () => {
    await service.create(sampleGraph, authContext);
    const definition = compileWorkflowGraph(sampleGraph);
    repositoryMock.findById = async () => ({
      id: 'workflow-id',
      createdAt: new Date(now),
      updatedAt: new Date(now),
      name: sampleGraph.name,
      description: sampleGraph.description ?? null,
      graph: sampleGraph,
      compiledDefinition: definition,
      lastRun: null,
      runCount: 0,
      organizationId: TEST_ORG,
    });

    const trigger = {
      type: 'schedule',
      sourceId: 'schedule-123',
      label: 'Nightly quick scan',
    } as const;

    const first = await service.prepareRunPayload(
      'workflow-id',
      { inputs: { domain: 'acme.com' } },
      authContext,
      { trigger, idempotencyKey: 'phase-8-key' },
    );

    expect(first.triggerMetadata).toEqual(trigger);
    expect(first.inputPreview.runtimeInputs).toEqual({ domain: 'acme.com' });
    expect(storedRunMeta).toMatchObject({
      triggerType: 'schedule',
      triggerSource: 'schedule-123',
      triggerLabel: 'Nightly quick scan',
    });

    const second = await service.prepareRunPayload(
      'workflow-id',
      { inputs: { domain: 'acme.com' } },
      authContext,
      { trigger, idempotencyKey: 'phase-8-key' },
    );

    expect(second.runId).toBe(first.runId);
  });

  it('delegates status, result, and cancel operations to the Temporal service', async () => {
    await service.create(sampleGraph, authContext);
    const run = await service.run('workflow-id', {}, authContext);
    completedCount = 1;
    const status = await service.getRunStatus(run.runId, run.temporalRunId, authContext);
    const result = await service.getRunResult(run.runId, run.temporalRunId, authContext);
    await service.cancelRun(run.runId, run.temporalRunId, authContext);

    expect(status.runId).toBe(run.runId);
    expect(status.workflowId).toBe('workflow-id');
    expect(status.status).toBe('RUNNING');
    expect(status.taskQueue).toBe('sentris-default');
    expect(status.progress).toEqual({ completedActions: 1, totalActions: 2 });
    expect(status.failure).toBeUndefined();
    expect(result).toMatchObject({ workflowId: run.runId, completed: true });
    expect(lastDescribeRef).toEqual({
      workflowId: run.runId,
      runId: run.temporalRunId,
    });
    expect(lastCancelRef).toEqual({
      workflowId: run.runId,
      runId: run.temporalRunId,
    });
  });

  it('returns stored inputs and version metadata via getRunConfig', async () => {
    await service.create(sampleGraph, authContext);
    const run = await service.run('workflow-id', { inputs: { answer: 42 } }, authContext);
    const config = await service.getRunConfig(run.runId, authContext);
    expect(config).toMatchObject({
      runId: run.runId,
      workflowId: run.workflowId,
      workflowVersionId: run.workflowVersionId,
      workflowVersion: run.workflowVersion,
      inputs: { answer: 42 },
    });
  });

  it('maps failure details into a failure summary', async () => {
    resetWorkflowVersions();
    const failureTemporalService = buildTemporalStub({
      status: 'FAILED',
      closeTime: now,
      failure: {
        message: 'Component crashed',
        stackTrace: 'Error: boom',
        applicationFailureInfo: {
          type: 'ComponentError',
          details: { node: 'node-1' },
        },
      },
    });

    service = new WorkflowsService(
      repositoryMock,
      workflowRoleRepositoryMock as any,
      versionRepositoryMock as any,
      runRepositoryMock as any,
      traceRepositoryMock as any,
      failureTemporalService,
      analyticsServiceMock as any,
      { record: vi.fn() } as any,
    );

    const versionRecord = createWorkflowVersionRecord('workflow-id');

    storedRunMeta = {
      runId: 'sentris-run-fail',
      workflowId: 'workflow-id',
      workflowVersionId: versionRecord.id,
      workflowVersion: versionRecord.version,
      temporalRunId: 'temporal-run-mock',
      totalActions: 2,
      createdAt: new Date(now),
      updatedAt: new Date(now),
      organizationId: TEST_ORG,
    };

    const status = await service.getRunStatus('sentris-run-fail', undefined, authContext);
    expect(status.status).toBe('FAILED');
    expect(status.failure).toEqual({
      reason: 'Component crashed',
      temporalCode: 'ComponentError',
      details: {
        stackTrace: 'Error: boom',
        applicationFailureDetails: { node: 'node-1' },
      },
    });
  });

  // ── findById ──────────────────────────────────────────────────────────────

  it('returns a workflow by id with version info', async () => {
    createWorkflowVersionRecord('workflow-id');
    const result = await service.findById('workflow-id', authContext);
    expect(result.id).toBe('workflow-id');
    expect(result.name).toBe(sampleGraph.name);
    expect(result.currentVersionId).toBeDefined();
    expect(result.currentVersion).toBe(1);
    expect(result.graph).toBeDefined();
  });

  it('throws NotFoundException when workflow does not exist', async () => {
    repositoryMock.findById = async () => undefined;
    await expect(service.findById('missing-id', authContext)).rejects.toThrow('not found');
  });

  it('scopes findById to the organization from auth context', async () => {
    let capturedOrgId: string | null | undefined;
    repositoryMock.findById = async (_id: string, options?: { organizationId?: string | null }) => {
      capturedOrgId = options?.organizationId;
      return makeWorkflowRecord();
    };
    createWorkflowVersionRecord('workflow-id');
    await service.findById('workflow-id', authContext);
    expect(capturedOrgId).toBe(TEST_ORG);
  });

  // ── list ───────────────────────────────────────────────────────────────────

  it('returns an empty list when no workflows exist', async () => {
    const result = await service.list(authContext);
    expect(result).toEqual([]);
  });

  it('returns workflows with version information', async () => {
    const records = [
      makeWorkflowRecord({ id: 'wf-1', name: 'Workflow One' }),
      makeWorkflowRecord({ id: 'wf-2', name: 'Workflow Two' }),
    ];
    repositoryMock.list = async () => records as any;
    createWorkflowVersionRecord('wf-1');
    createWorkflowVersionRecord('wf-2');

    const result = await service.list(authContext);
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe('wf-1');
    expect(result[0].currentVersionId).toBeDefined();
    expect(result[1].id).toBe('wf-2');
    expect(result[1].currentVersionId).toBeDefined();
  });

  it('scopes list to the organization from auth context', async () => {
    let capturedOrgId: string | null | undefined;
    repositoryMock.list = async (options?: { organizationId?: string | null }) => {
      capturedOrgId = options?.organizationId;
      return [];
    };
    await service.list(authContext);
    expect(capturedOrgId).toBe(TEST_ORG);
  });

  // ── listSummary ────────────────────────────────────────────────────────────

  it('returns workflow summaries with serialized dates', async () => {
    const lastRunDate = new Date('2025-06-15T10:00:00Z');
    const createdDate = new Date('2025-01-01T00:00:00Z');
    const updatedDate = new Date('2025-06-15T10:00:00Z');
    (repositoryMock as any).listSummary = async () => [
      {
        id: 'wf-1',
        name: 'Summary Workflow',
        description: 'desc',
        organizationId: TEST_ORG,
        lastRun: lastRunDate,
        latestRunStatus: 'COMPLETED',
        runCount: 5,
        nodeCount: 3,
        createdAt: createdDate,
        updatedAt: updatedDate,
      },
    ];

    const summaries = await service.listSummary(authContext);
    expect(summaries).toHaveLength(1);
    expect(summaries[0].id).toBe('wf-1');
    expect(summaries[0].name).toBe('Summary Workflow');
    expect(summaries[0].lastRun).toBe(lastRunDate.toISOString());
    expect(summaries[0].latestRunStatus).toBe('COMPLETED');
    expect(summaries[0].runCount).toBe(5);
    expect(summaries[0].nodeCount).toBe(3);
    expect(summaries[0].createdAt).toBe(createdDate.toISOString());
    expect(summaries[0].updatedAt).toBe(updatedDate.toISOString());
  });

  it('returns null lastRun when workflow has never been run', async () => {
    (repositoryMock as any).listSummary = async () => [
      {
        id: 'wf-no-runs',
        name: 'No Runs',
        description: null,
        organizationId: TEST_ORG,
        lastRun: null,
        latestRunStatus: null,
        runCount: 0,
        nodeCount: 2,
        createdAt: new Date(now),
        updatedAt: new Date(now),
      },
    ];

    const summaries = await service.listSummary(authContext);
    expect(summaries[0].lastRun).toBeNull();
    expect(summaries[0].latestRunStatus).toBeNull();
  });

  // ── update ─────────────────────────────────────────────────────────────────

  it('updates a workflow and creates a new version', async () => {
    const updated = await service.update('workflow-id', sampleGraph, authContext);
    expect(updated.id).toBe('workflow-id');
    expect(updated.currentVersionId).toBeDefined();
    expect(updated.currentVersion).toBe(1);
  });

  it('validates the graph on update and throws on invalid graph', async () => {
    const invalidGraph = WorkflowGraphSchema.parse({
      name: 'Bad workflow',
      nodes: [
        {
          id: 'trigger',
          type: 'core.workflow.entrypoint',
          position: { x: 0, y: 0 },
          data: { label: 'Trigger', config: { params: {}, inputOverrides: {} } },
        },
      ],
      edges: [
        {
          id: 'bad-edge',
          source: 'trigger',
          target: 'nonexistent',
          sourceHandle: 'out',
          targetHandle: 'in',
        },
      ],
      viewport: { x: 0, y: 0, zoom: 1 },
    });

    await expect(service.update('workflow-id', invalidGraph, authContext)).rejects.toThrow();
  });

  // ── delete ─────────────────────────────────────────────────────────────────

  it('deletes a workflow via the repository', async () => {
    await service.delete('workflow-id', authContext);
    expect(deleteCalls).toContain('workflow-id');
  });

  it('requires admin access to delete a workflow', async () => {
    const nonAdminAuth: AuthContext = {
      userId: 'regular-user',
      organizationId: TEST_ORG,
      roles: ['MEMBER'],
      isAuthenticated: true,
      provider: 'test',
    };

    await expect(service.delete('workflow-id', nonAdminAuth)).rejects.toThrow(
      'Administrator role required',
    );
  });

  // ── updateMetadata ─────────────────────────────────────────────────────────

  it('updates workflow metadata without recompiling the graph', async () => {
    createWorkflowVersionRecord('workflow-id');
    const result = await service.updateMetadata(
      'workflow-id',
      { name: 'New Name', description: 'New description' },
      authContext,
    );
    expect(result.id).toBe('workflow-id');
    expect(result.name).toBe('New Name');
    expect(updateMetadataCalls).toHaveLength(1);
    expect(updateMetadataCalls[0].metadata.name).toBe('New Name');
    expect(updateMetadataCalls[0].metadata.description).toBe('New description');
    // compiledDefinition should remain null — no recompilation
    expect(savedDefinition).toBeNull();
  });

  // ── listVersions ───────────────────────────────────────────────────────────

  it('returns versions for a workflow', async () => {
    createWorkflowVersionRecord('workflow-id');
    createWorkflowVersionRecord('workflow-id');

    const versions = await service.listVersions('workflow-id', authContext);
    expect(versions).toHaveLength(2);
    expect(versions[0].workflowId).toBe('workflow-id');
    expect(versions[0].id).toBeDefined();
    expect(versions[0].version).toBeDefined();
    expect(typeof versions[0].createdAt).toBe('string');
  });

  it('throws NotFoundException when listing versions for non-existent workflow', async () => {
    repositoryMock.findById = async () => undefined;
    await expect(service.listVersions('missing-id', authContext)).rejects.toThrow('not found');
  });

  // ── listRuns ───────────────────────────────────────────────────────────────

  it('returns run summaries for a workflow', async () => {
    await service.create(sampleGraph, authContext);
    const definition = compileWorkflowGraph(sampleGraph);
    repositoryMock.findById = async () =>
      makeWorkflowRecord({ compiledDefinition: definition }) as any;

    const run = await service.run('workflow-id', { inputs: {} }, authContext);

    const { runs } = await service.listRuns(authContext, { workflowId: 'workflow-id' });
    expect(runs.length).toBeGreaterThanOrEqual(1);
    expect(runs[0].id).toBe(run.runId);
    expect(runs[0].workflowId).toBe('workflow-id');
    expect(runs[0].workflowName).toBe(sampleGraph.name);
  });

  it('returns empty runs list when no runs exist', async () => {
    const { runs } = await service.listRuns(authContext, { workflowId: 'workflow-id' });
    expect(runs).toHaveLength(0);
  });
});
