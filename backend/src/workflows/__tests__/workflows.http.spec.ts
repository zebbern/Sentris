import 'reflect-metadata';

import { beforeEach, describe, expect, it, vi } from 'bun:test';
import { WorkflowRunStatusSchema, TraceStreamEnvelopeSchema } from '@sentris/shared';

import { WorkflowRunsController } from '../workflow-runs.controller';
import { WorkflowRunObservabilityController } from '../workflow-run-observability.controller';
import { WorkflowLogsQuerySchema } from '../dto/workflow-graph.dto';

const sampleStatus = WorkflowRunStatusSchema.parse({
  runId: 'sentris-run-123',
  workflowId: 'workflow-id-123',
  status: 'RUNNING',
  startedAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  taskQueue: 'sentris-default',
  historyLength: 42,
});

const sampleTrace = TraceStreamEnvelopeSchema.parse({
  runId: 'sentris-run-123',
  events: [
    {
      id: '1',
      runId: 'sentris-run-123',
      nodeId: 'node-1',
      type: 'STARTED',
      level: 'info',
      timestamp: new Date().toISOString(),
    },
  ],
  cursor: '1',
});

const sampleLogs = {
  runId: 'sentris-run-123',
  logs: [
    {
      id: 'log-1',
      runId: 'sentris-run-123',
      nodeId: 'node-1',
      level: 'info',
      message: 'line one',
      timestamp: new Date().toISOString(),
    },
  ],
  totalCount: 1,
  hasMore: false,
  nextCursor: undefined,
};

const authContext = {
  userId: 'user-123',
  organizationId: 'org-123',
  roles: ['ADMIN'] as const,
  isAuthenticated: true,
  provider: 'local',
};

describe('WorkflowsController contract coverage', () => {
  let runsController: WorkflowRunsController;
  let observabilityController: WorkflowRunObservabilityController;
  const workflowService = {
    getRunStatus: vi.fn().mockResolvedValue(sampleStatus),
    getRunResult: vi.fn(),
    cancelRun: vi.fn(),
  } as const;

  const traceService = {
    list: vi.fn().mockResolvedValue(sampleTrace),
  } as const;

  const logStreamService = {
    fetch: vi.fn().mockResolvedValue(sampleLogs),
  } as const;
  const artifactsService = {
    listRunArtifacts: vi.fn().mockResolvedValue({ runId: sampleStatus.runId, artifacts: [] }),
  } as const;

  const nodeIOService = {
    listDetails: vi.fn().mockResolvedValue([]),
    getNodeIO: vi.fn().mockResolvedValue(null),
  } as const;

  beforeEach(() => {
    runsController = new WorkflowRunsController(
      workflowService as any,
      { archiveRun: vi.fn() } as any,
    );
    observabilityController = new WorkflowRunObservabilityController(
      traceService as any,
      workflowService as any,
      artifactsService as any,
      nodeIOService as any,
      logStreamService as any,
    );
    vi.clearAllMocks();
  });

  it('returns status payload matching the shared contract', async () => {
    const result = await runsController.status(
      'sentris-run-123',
      { temporalRunId: undefined },
      authContext as any,
    );
    const parsed = WorkflowRunStatusSchema.parse(result);
    expect(parsed.runId).toBe(sampleStatus.runId);
    expect(parsed.workflowId).toBe(sampleStatus.workflowId);
    expect(workflowService.getRunStatus).toHaveBeenCalledWith(
      'sentris-run-123',
      undefined,
      authContext,
    );
  });

  it('returns trace payload matching the shared contract', async () => {
    const result = await observabilityController.trace('sentris-run-123', authContext as any);
    const parsed = TraceStreamEnvelopeSchema.parse(result);
    expect(parsed.events).toHaveLength(1);
    expect(traceService.list).toHaveBeenCalledWith('sentris-run-123', authContext);
  });

  it('retrieves logs with validated query parameters', async () => {
    const query = WorkflowLogsQuerySchema.parse({ nodeRef: 'node-1', stream: 'stdout', limit: 10 });
    const result = await observabilityController.logs('sentris-run-123', query, authContext as any);
    expect(result).toEqual(sampleLogs);
    expect(logStreamService.fetch).toHaveBeenCalledWith('sentris-run-123', authContext, {
      nodeRef: 'node-1',
      stream: 'stdout',
      level: undefined,
      limit: 10,
      cursor: undefined,
      startTime: undefined,
      endTime: undefined,
    });
  });
});
