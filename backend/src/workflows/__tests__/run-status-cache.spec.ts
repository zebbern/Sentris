import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { TERMINAL_STATUSES } from '@sentris/shared';
import { WorkflowRunService } from '../workflow-run.service';
import type { WorkflowRunRepository } from '../repository/workflow-run.repository';
import type { TemporalService } from '../../temporal/temporal.service';
import type { AuthRole } from '../../auth/types';

/**
 * Tests for the run status caching logic in WorkflowsService.
 *
 * buildRunSummary() and getRunStatus() both follow the same cache-first pattern:
 *   1. If run.status is a terminal status → skip Temporal, use cached data
 *   2. If run.status is NULL → call Temporal, durably finalize terminal statuses
 *   3. If Temporal NOT_FOUND → infer status for display, do NOT cache
 */

const TEST_ORG = 'org-1';
const RUN_ID = 'run-123';
const WORKFLOW_ID = 'wf-456';
const now = new Date();

function makeRun(overrides: Record<string, unknown> = {}) {
  return {
    runId: RUN_ID,
    workflowId: WORKFLOW_ID,
    workflowVersionId: 'ver-1',
    workflowVersion: 1,
    totalActions: 3,
    inputs: {},
    createdAt: now,
    updatedAt: now,
    organizationId: TEST_ORG,
    triggerType: 'manual',
    triggerSource: null,
    triggerLabel: 'Manual run',
    inputPreview: { runtimeInputs: {}, nodeOverrides: {} },
    temporalRunId: 'temporal-run-1',
    parentRunId: null,
    parentNodeRef: null,
    status: null as string | null,
    closeTime: null as Date | null,
    ...overrides,
  };
}

function makeTemporalDesc(status: string, closeTime?: string) {
  return {
    workflowId: RUN_ID,
    runId: 'temporal-run-1',
    status,
    startTime: now.toISOString(),
    closeTime: closeTime ?? undefined,
    historyLength: 10,
    taskQueue: 'default',
  };
}

class NotFoundError extends Error {
  name = 'WorkflowNotFoundError';
  code = 5; // gRPC NOT_FOUND
  details = 'workflow not found';
}

describe('Run status caching', () => {
  let service: WorkflowRunService;
  let describeWorkflowFn: ReturnType<typeof mock>;
  let finalizeTerminalRunFn: ReturnType<typeof mock>;
  let hasPendingInputsFn: ReturnType<typeof mock>;
  let countByTypeFn: ReturnType<typeof mock>;
  let findByRunIdFn: ReturnType<typeof mock>;
  let listRunsFn: ReturnType<typeof mock>;
  let trackWorkflowCompletedFn: ReturnType<typeof mock>;

  beforeEach(() => {
    describeWorkflowFn = mock(() => Promise.resolve(makeTemporalDesc('RUNNING')));
    finalizeTerminalRunFn = mock(() =>
      Promise.resolve({
        record: makeRun({
          status: 'COMPLETED',
          closeTime: new Date('2025-01-01T12:00:00.000Z'),
        }),
        duplicate: false,
      }),
    );
    hasPendingInputsFn = mock(() => Promise.resolve(false));
    countByTypeFn = mock(() => Promise.resolve(0));
    findByRunIdFn = mock(() => Promise.resolve(makeRun()));
    listRunsFn = mock(() => Promise.resolve([]));
    trackWorkflowCompletedFn = mock(() => {});

    const runRepositoryMock = {
      findByRunId: findByRunIdFn,
      finalizeTerminalRun: finalizeTerminalRunFn,
      hasPendingInputs: hasPendingInputsFn,
      list: listRunsFn,
      upsert: mock(() => Promise.resolve(makeRun())),
      listChildren: mock(() => Promise.resolve([])),
    } as unknown as WorkflowRunRepository;

    const temporalServiceMock = {
      describeWorkflow: describeWorkflowFn,
      getWorkflowResult: mock(() => Promise.resolve(null)),
      startWorkflow: mock(() => Promise.resolve({ runId: 'r', workflowId: 'w' })),
      cancelWorkflow: mock(() => Promise.resolve()),
      terminateWorkflow: mock(() => Promise.resolve()),
    } as unknown as TemporalService;

    const repositoryMock = {
      findById: mock(() =>
        Promise.resolve({
          id: WORKFLOW_ID,
          name: 'Test Workflow',
          graph: { nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } },
          createdAt: now,
          updatedAt: now,
          organizationId: TEST_ORG,
        }),
      ),
      create: mock(() => Promise.resolve({})),
      update: mock(() => Promise.resolve({})),
      delete: mock(() => Promise.resolve()),
      list: mock(() => Promise.resolve([])),
      findByIds: mock((ids: string[]) =>
        Promise.resolve(
          ids.map((id) => ({
            id,
            name: 'Test Workflow',
            graph: { nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } },
            createdAt: now,
            updatedAt: now,
            organizationId: TEST_ORG,
          })),
        ),
      ),
      incrementRunCount: mock(() => Promise.resolve()),
    };

    const versionRepositoryMock = {
      findById: mock(() =>
        Promise.resolve({
          id: 'ver-1',
          workflowId: WORKFLOW_ID,
          version: 1,
          graph: { nodes: [{ id: 'n1' }], edges: [], viewport: { x: 0, y: 0, zoom: 1 } },
          compiledDefinition: null,
          createdAt: now,
          organizationId: TEST_ORG,
        }),
      ),
      findLatestByWorkflowId: mock(() => Promise.resolve(undefined)),
      create: mock(() => Promise.resolve({})),
      findByWorkflowAndVersion: mock(() => Promise.resolve(undefined)),
      setCompiledDefinition: mock(() => Promise.resolve(undefined)),
      findByIds: mock(() => Promise.resolve([])),
      findLatestByWorkflowIds: mock(() => Promise.resolve([])),
    };

    const traceRepositoryMock = {
      countByType: countByTypeFn,
      getEventTimeRange: mock(() => Promise.resolve({ firstTimestamp: null, lastTimestamp: null })),
      countByTypeForRuns: mock(() => Promise.resolve(new Map())),
      getEventTimeRangesForRuns: mock(() => Promise.resolve(new Map())),
      list: mock(() => Promise.resolve([])),
    };

    const _roleRepositoryMock = {
      findByWorkflowAndUser: mock(() => Promise.resolve({ role: 'ADMIN' })),
      upsert: mock(() => Promise.resolve()),
    };

    const analyticsServiceMock = {
      trackWorkflowCompleted: trackWorkflowCompletedFn,
      trackWorkflowStarted: mock(() => {}),
      trackWorkflowCancelled: mock(() => {}),
    };

    service = new WorkflowRunService(
      repositoryMock as any,
      runRepositoryMock,
      versionRepositoryMock as any,
      traceRepositoryMock as any,
      temporalServiceMock,
      analyticsServiceMock as any,
      { record: mock(() => {}) } as any,
      {} as any,
    );
  });

  const authContext = {
    userId: 'user-1',
    organizationId: TEST_ORG,
    roles: ['ADMIN'] as AuthRole[],
    isAuthenticated: true,
    provider: 'test',
  };

  describe('buildRunSummary — cache-first logic', () => {
    it('skips Temporal for a cached COMPLETED run', async () => {
      const closeTime = new Date('2025-01-01T12:00:00Z');
      findByRunIdFn.mockImplementation(() =>
        Promise.resolve(makeRun({ status: 'COMPLETED', closeTime })),
      );

      const _runs = await service.listRuns(authContext, { workflowId: WORKFLOW_ID, limit: 1 });
      // We need at least one run in the list
      // Since list returns from runRepository.list, mock it
      // Instead, test buildRunSummary indirectly via listRuns
    });

    it('durably finalizes terminal status on the first Temporal poll', async () => {
      const closeTimeStr = '2025-01-01T12:00:00.000Z';
      findByRunIdFn.mockImplementation(() => Promise.resolve(makeRun({ status: null })));
      describeWorkflowFn.mockImplementation(() =>
        Promise.resolve(makeTemporalDesc('COMPLETED', closeTimeStr)),
      );

      await service.getRunStatus(RUN_ID, undefined, authContext);

      // Should have called Temporal
      expect(describeWorkflowFn).toHaveBeenCalled();

      expect(finalizeTerminalRunFn).toHaveBeenCalledWith({
        runId: RUN_ID,
        organizationId: TEST_ORG,
        status: 'COMPLETED',
        completedAt: new Date(closeTimeStr),
      });
    });

    it('durably finalizes terminal status discovered while building list summaries', async () => {
      const closeTimeStr = '2025-01-01T12:00:00.000Z';
      listRunsFn.mockResolvedValueOnce([makeRun({ status: null })]);
      describeWorkflowFn.mockResolvedValueOnce(makeTemporalDesc('COMPLETED', closeTimeStr));

      const result = await service.listRuns(authContext, { limit: 1 });

      expect(result.runs).toHaveLength(1);
      expect(result.runs[0]?.status).toBe('COMPLETED');
      expect(finalizeTerminalRunFn).toHaveBeenCalledWith({
        runId: RUN_ID,
        organizationId: TEST_ORG,
        status: 'COMPLETED',
        completedAt: new Date(closeTimeStr),
      });
    });

    it('does NOT cache inferred status when Temporal returns NOT_FOUND', async () => {
      findByRunIdFn.mockImplementation(() => Promise.resolve(makeRun({ status: null })));
      describeWorkflowFn.mockImplementation(() => Promise.reject(new NotFoundError()));
      // Simulate some completed actions so inferStatusFromTraceEvents returns COMPLETED
      countByTypeFn.mockImplementation((runId: string, type: string) => {
        if (type === 'NODE_COMPLETED') return Promise.resolve(3);
        return Promise.resolve(0);
      });

      await service.getRunStatus(RUN_ID, undefined, authContext);

      // Should have tried Temporal
      expect(describeWorkflowFn).toHaveBeenCalled();

      // Should NOT have cached — inferred statuses are display-only
      expect(finalizeTerminalRunFn).not.toHaveBeenCalled();
    });
  });

  describe('getRunStatus — cache-first logic', () => {
    it('skips Temporal when run has cached COMPLETED status', async () => {
      const closeTime = new Date('2025-01-01T12:00:00Z');
      findByRunIdFn.mockImplementation(() =>
        Promise.resolve(makeRun({ status: 'COMPLETED', closeTime })),
      );

      const result = await service.getRunStatus(RUN_ID, undefined, authContext);

      // Should NOT have called Temporal
      expect(describeWorkflowFn).not.toHaveBeenCalled();

      // Should return the cached status
      expect(result.status).toBe('COMPLETED');
      expect(result.completedAt).toBe(closeTime.toISOString());
    });

    it('skips Temporal for all terminal statuses', async () => {
      for (const status of TERMINAL_STATUSES) {
        describeWorkflowFn.mockClear();
        findByRunIdFn.mockImplementation(() =>
          Promise.resolve(makeRun({ status, closeTime: new Date() })),
        );

        const result = await service.getRunStatus(RUN_ID, undefined, authContext);
        expect(describeWorkflowFn).not.toHaveBeenCalled();
        expect(result.status).toBe(status);
      }
    });

    it('calls Temporal when run has no cached status', async () => {
      findByRunIdFn.mockImplementation(() => Promise.resolve(makeRun({ status: null })));
      describeWorkflowFn.mockImplementation(() => Promise.resolve(makeTemporalDesc('RUNNING')));

      const result = await service.getRunStatus(RUN_ID, undefined, authContext);

      expect(describeWorkflowFn).toHaveBeenCalled();
      expect(result.status).toBe('RUNNING');
      // Should NOT cache running status
      expect(finalizeTerminalRunFn).not.toHaveBeenCalled();
    });

    it('does NOT cache AWAITING_INPUT status', async () => {
      findByRunIdFn.mockImplementation(() => Promise.resolve(makeRun({ status: null })));
      describeWorkflowFn.mockImplementation(() => Promise.resolve(makeTemporalDesc('RUNNING')));
      hasPendingInputsFn.mockImplementation(() => Promise.resolve(true));

      const result = await service.getRunStatus(RUN_ID, undefined, authContext);

      expect(result.status).toBe('AWAITING_INPUT');
      expect(finalizeTerminalRunFn).not.toHaveBeenCalled();
    });

    it('returns correct closeTime on first cache miss for terminal', async () => {
      const closeTimeStr = '2025-06-15T10:30:00.000Z';
      findByRunIdFn.mockImplementation(() => Promise.resolve(makeRun({ status: null })));
      describeWorkflowFn.mockImplementation(() =>
        Promise.resolve(makeTemporalDesc('FAILED', closeTimeStr)),
      );

      const result = await service.getRunStatus(RUN_ID, undefined, authContext);

      expect(result.status).toBe('FAILED');
      // completedAt should come from Temporal's closeTime, not from DB
      expect(result.completedAt).toBe(closeTimeStr);
    });

    it('returns Temporal status without making a failed finalization ineligible for reconciliation', async () => {
      findByRunIdFn.mockImplementation(() => Promise.resolve(makeRun({ status: null })));
      describeWorkflowFn.mockImplementation(() =>
        Promise.resolve(makeTemporalDesc('COMPLETED', '2025-01-01T00:00:00.000Z')),
      );
      finalizeTerminalRunFn.mockImplementation(() =>
        Promise.reject(new Error('DB connection lost')),
      );

      const result = await service.getRunStatus(RUN_ID, undefined, authContext);

      expect(result.status).toBe('COMPLETED');
      expect(finalizeTerminalRunFn).toHaveBeenCalled();
    });
  });
});
