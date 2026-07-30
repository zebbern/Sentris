import { beforeEach, describe, expect, it, mock } from 'bun:test';

import type { TemporalService, WorkflowRunStatus } from '../../temporal/temporal.service';
import type { WorkflowRunRecord } from '../../database/schema';
import type { WorkflowRunRepository } from '../repository/workflow-run.repository';
import { RunTerminalReconcilerService } from '../run-terminal-reconciler.service';

function run(overrides: Partial<WorkflowRunRecord> = {}): WorkflowRunRecord {
  const now = new Date('2026-07-26T10:00:00.000Z');
  return {
    runId: 'run-1',
    workflowId: '00000000-0000-4000-8000-000000000001',
    workflowVersionId: null,
    workflowVersion: 1,
    temporalRunId: 'temporal-run-1',
    parentRunId: null,
    parentNodeRef: null,
    scopeId: null,
    totalActions: 1,
    inputs: {},
    triggerType: 'manual',
    triggerSource: null,
    triggerLabel: 'Manual run',
    inputPreview: { runtimeInputs: {}, nodeOverrides: {} },
    organizationId: 'org-1',
    status: null,
    closeTime: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe('RunTerminalReconcilerService', () => {
  const listUnfinalized = mock(async () => [run()]);
  const finalizeTerminalRun = mock(async () => ({
    record: run({ status: 'COMPLETED' }),
    duplicate: false,
  }));
  const describeWorkflow = mock(
    async (): Promise<WorkflowRunStatus> => ({
      workflowId: 'run-1',
      runId: 'temporal-run-1',
      status: 'COMPLETED' as const,
      startTime: '2026-07-26T10:00:00.000Z',
      closeTime: '2026-07-26T12:00:00.000Z',
      historyLength: 20,
      taskQueue: 'sentris-default',
    }),
  );

  let reconciler: RunTerminalReconcilerService;

  beforeEach(() => {
    listUnfinalized.mockClear();
    finalizeTerminalRun.mockClear();
    describeWorkflow.mockClear();
    listUnfinalized.mockResolvedValue([run()]);
    describeWorkflow.mockResolvedValue({
      workflowId: 'run-1',
      runId: 'temporal-run-1',
      status: 'COMPLETED',
      startTime: '2026-07-26T10:00:00.000Z',
      closeTime: '2026-07-26T12:00:00.000Z',
      historyLength: 20,
      taskQueue: 'sentris-default',
    });
    reconciler = new RunTerminalReconcilerService(
      { listUnfinalized, finalizeTerminalRun } as unknown as WorkflowRunRepository,
      { describeWorkflow } as unknown as TemporalService,
    );
  });

  it('finalizes a completed workflow even when no client polls status', async () => {
    await reconciler.reconcileOnce();

    expect(describeWorkflow).toHaveBeenCalledWith({
      workflowId: 'run-1',
      runId: 'temporal-run-1',
    });
    expect(finalizeTerminalRun).toHaveBeenCalledWith({
      runId: 'run-1',
      organizationId: 'org-1',
      status: 'COMPLETED',
      completedAt: new Date('2026-07-26T12:00:00.000Z'),
    });
  });

  it('maps Temporal cancellation, termination, and timeout terminal states', async () => {
    const cases = [
      ['CANCELLED', 'CANCELLED'],
      ['TERMINATED', 'TERMINATED'],
      ['TIMED_OUT', 'TIMED_OUT'],
    ] as const;

    for (const [temporalStatus, expectedStatus] of cases) {
      describeWorkflow.mockResolvedValueOnce({
        workflowId: 'run-1',
        runId: 'temporal-run-1',
        status: temporalStatus,
        startTime: '2026-07-26T10:00:00.000Z',
        closeTime: '2026-07-26T12:00:00.000Z',
        historyLength: 20,
        taskQueue: 'sentris-default',
      });
      await reconciler.reconcileOnce();
      expect(finalizeTerminalRun).toHaveBeenLastCalledWith(
        expect.objectContaining({ status: expectedStatus }),
      );
    }
  });

  it('does not finalize a still-running workflow', async () => {
    describeWorkflow.mockResolvedValueOnce({
      workflowId: 'run-1',
      runId: 'temporal-run-1',
      status: 'RUNNING',
      startTime: '2026-07-26T10:00:00.000Z',
      historyLength: 20,
      taskQueue: 'sentris-default',
    });

    await reconciler.reconcileOnce();

    expect(finalizeTerminalRun).not.toHaveBeenCalled();
  });

  it('isolates per-run Temporal failures and continues the bounded batch', async () => {
    listUnfinalized.mockResolvedValueOnce([run(), run({ runId: 'run-2' })]);
    describeWorkflow
      .mockRejectedValueOnce(new Error('Temporal unavailable for one run'))
      .mockResolvedValueOnce({
        workflowId: 'run-2',
        runId: 'temporal-run-2',
        status: 'FAILED',
        startTime: '2026-07-26T10:00:00.000Z',
        closeTime: '2026-07-26T12:00:00.000Z',
        historyLength: 20,
        taskQueue: 'sentris-default',
      });

    await reconciler.reconcileOnce(25);

    expect(listUnfinalized).toHaveBeenCalledWith({ limit: 25 });
    expect(finalizeTerminalRun).toHaveBeenCalledWith(
      expect.objectContaining({ runId: 'run-2', status: 'FAILED' }),
    );
  });

  it('advances a keyset cursor so an oldest full batch of running runs cannot starve newer terminals', async () => {
    const firstCreatedAt = new Date('2026-07-26T10:00:00.000Z');
    const secondCreatedAt = new Date('2026-07-26T10:01:00.000Z');
    const terminalCreatedAt = new Date('2026-07-26T10:02:00.000Z');
    listUnfinalized
      .mockResolvedValueOnce([
        run({ runId: 'run-1', createdAt: firstCreatedAt }),
        run({ runId: 'run-2', createdAt: secondCreatedAt }),
      ])
      .mockResolvedValueOnce([run({ runId: 'run-3', createdAt: terminalCreatedAt })]);
    describeWorkflow
      .mockResolvedValueOnce({
        workflowId: 'run-1',
        runId: 'temporal-run-1',
        status: 'RUNNING',
        startTime: firstCreatedAt.toISOString(),
        historyLength: 20,
        taskQueue: 'sentris-default',
      })
      .mockResolvedValueOnce({
        workflowId: 'run-2',
        runId: 'temporal-run-2',
        status: 'RUNNING',
        startTime: secondCreatedAt.toISOString(),
        historyLength: 20,
        taskQueue: 'sentris-default',
      })
      .mockResolvedValueOnce({
        workflowId: 'run-3',
        runId: 'temporal-run-3',
        status: 'COMPLETED',
        startTime: terminalCreatedAt.toISOString(),
        closeTime: '2026-07-26T12:00:00.000Z',
        historyLength: 20,
        taskQueue: 'sentris-default',
      });

    await reconciler.reconcileOnce(2);
    await reconciler.reconcileOnce(2);

    expect(listUnfinalized).toHaveBeenNthCalledWith(1, { limit: 2 });
    expect(listUnfinalized).toHaveBeenNthCalledWith(2, {
      limit: 2,
      after: { createdAt: secondCreatedAt, runId: 'run-2' },
    });
    expect(finalizeTerminalRun).toHaveBeenCalledWith(
      expect.objectContaining({ runId: 'run-3', status: 'COMPLETED' }),
    );
  });
});
