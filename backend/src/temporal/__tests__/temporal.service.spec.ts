import { beforeEach, describe, expect, it, vi } from 'bun:test';
import { status as grpcStatus } from '@grpc/grpc-js';
import { ScheduleNotFoundError } from '@temporalio/client';

import { TemporalService } from '../temporal.service';
import type {
  CreateTemporalScheduleInput,
  StartWorkflowOptions,
  WorkflowRunReference,
} from '../temporal.service';

// ── Mock Handles ────────────────────────────────────────────────────
function makeMockWorkflowHandle(overrides: Record<string, unknown> = {}) {
  return {
    workflowId: 'wf-123',
    firstExecutionRunId: 'run-abc',
    describe: vi.fn().mockResolvedValue({
      workflowId: 'wf-123',
      runId: 'run-abc',
      status: { name: 'RUNNING' },
      startTime: new Date('2024-06-01T00:00:00Z'),
      closeTime: null,
      historyLength: 10,
      taskQueue: 'sentris',
    }),
    result: vi.fn().mockResolvedValue({ ok: true }),
    cancel: vi.fn().mockResolvedValue(undefined),
    terminate: vi.fn().mockResolvedValue(undefined),
    signal: vi.fn().mockResolvedValue(undefined),
    query: vi.fn().mockResolvedValue({ count: 42 }),
    executeUpdate: vi.fn().mockResolvedValue({ status: 'completed' }),
    ...overrides,
  };
}

function makeMockScheduleHandle(overrides: Record<string, unknown> = {}) {
  return {
    update: vi.fn().mockImplementation(async (updater: (prev: any) => any) => {
      updater({ state: { paused: false, note: '', remainingActions: 0 } });
    }),
    delete: vi.fn().mockResolvedValue(undefined),
    pause: vi.fn().mockResolvedValue(undefined),
    unpause: vi.fn().mockResolvedValue(undefined),
    trigger: vi.fn().mockResolvedValue(undefined),
    describe: vi.fn().mockResolvedValue({ scheduleId: 'sched-1' }),
    ...overrides,
  };
}

function makeGrpcError(code: number, message = 'gRPC error'): Error & { code: number } {
  const err = new Error(message) as Error & { code: number };
  err.code = code;
  return err;
}

// ── Module-level mocks ──────────────────────────────────────────────
const mockWorkflowHandle = makeMockWorkflowHandle();
const mockScheduleHandle = makeMockScheduleHandle();

const mockWorkflowClient = {
  start: vi.fn().mockResolvedValue(mockWorkflowHandle),
  getHandle: vi.fn().mockReturnValue(mockWorkflowHandle),
};
const mockScheduleClient = {
  create: vi.fn().mockResolvedValue(undefined),
  getHandle: vi.fn().mockReturnValue(mockScheduleHandle),
};
const mockWorkflowService = {
  describeNamespace: vi.fn().mockResolvedValue({}),
  registerNamespace: vi.fn().mockResolvedValue({}),
};
const mockConnection = {
  close: vi.fn().mockResolvedValue(undefined),
  workflowService: mockWorkflowService,
};

vi.mock('@temporalio/client', () => ({
  Connection: { connect: vi.fn().mockResolvedValue(mockConnection) },
  WorkflowClient: vi.fn().mockImplementation(() => mockWorkflowClient),
  ScheduleClient: vi.fn().mockImplementation(() => mockScheduleClient),
  ScheduleOverlapPolicy: { SKIP: 1, BUFFER_ONE: 2, ALLOW_ALL: 3 },
}));

const mockConfigService = {
  get: vi.fn().mockReturnValue({
    address: 'localhost:7233',
    namespace: 'test-namespace',
    taskQueue: 'test-queue',
  }),
};

// ── Tests ───────────────────────────────────────────────────────────
describe('TemporalService', () => {
  let service: TemporalService;

  beforeEach(() => {
    vi.clearAllMocks();
    mockWorkflowService.describeNamespace.mockResolvedValue({});
    mockWorkflowClient.start.mockResolvedValue(mockWorkflowHandle);
    mockWorkflowClient.getHandle.mockReturnValue(mockWorkflowHandle);
    mockScheduleClient.getHandle.mockReturnValue(mockScheduleHandle);
    service = new TemporalService(mockConfigService as any);
  });

  it('reads temporal config from ConfigService', () => {
    expect(mockConfigService.get).toHaveBeenCalledWith('temporalTask');
    expect(service.getDefaultTaskQueue()).toBe('test-queue');
  });

  // ── onModuleDestroy ─────────────────────────────────────────────
  describe('onModuleDestroy', () => {
    it('closes connection when one exists', async () => {
      await service.startWorkflow({ workflowType: 'testMinimalWorkflow' });
      await service.onModuleDestroy();
      expect(mockConnection.close).toHaveBeenCalledTimes(1);
    });

    it('is safe to call when no connection exists', async () => {
      await service.onModuleDestroy();
      expect(mockConnection.close).not.toHaveBeenCalled();
    });
  });

  // ── startWorkflow ───────────────────────────────────────────────
  describe('startWorkflow', () => {
    it('starts a workflow with default taskQueue', async () => {
      const result = await service.startWorkflow({
        workflowType: 'sentrisWorkflowRun',
        args: [{ runId: 'r-1' }],
      });
      expect(result.workflowId).toBe('wf-123');
      expect(result.runId).toBe('run-abc');
      expect(result.taskQueue).toBe('test-queue');
      expect(mockWorkflowClient.start).toHaveBeenCalledTimes(1);
      expect(mockWorkflowClient.start).toHaveBeenCalledWith(
        'sentrisWorkflowRun',
        expect.any(Object),
      );
      const startOptions = mockWorkflowClient.start.mock.calls[0][1];
      expect(startOptions).not.toHaveProperty('workflowExecutionTimeout');
    });

    it('uses provided workflowId and taskQueue', async () => {
      const opts: StartWorkflowOptions = {
        workflowType: 'testMinimalWorkflow',
        workflowId: 'custom-id',
        taskQueue: 'custom-queue',
      };
      const result = await service.startWorkflow(opts);
      expect(result.taskQueue).toBe('custom-queue');
      const args = mockWorkflowClient.start.mock.calls[0][1];
      expect(args.workflowId).toBe('custom-id');
      expect(args.taskQueue).toBe('custom-queue');
    });

    it('preserves an explicitly supplied workflow execution timeout', async () => {
      await service.startWorkflow({
        workflowType: 'sentrisWorkflowRun',
        workflowExecutionTimeout: '6 hours',
      });

      const args = mockWorkflowClient.start.mock.calls[0][1];
      expect(args.workflowExecutionTimeout).toBe('6 hours');
    });

    it('passes memo and searchAttributes', async () => {
      await service.startWorkflow({
        workflowType: 'sentrisWorkflowRun',
        memo: { source: 'test' },
        searchAttributes: { CustomField: ['v'] },
      });
      const args = mockWorkflowClient.start.mock.calls[0][1];
      expect(args.memo).toEqual({ source: 'test' });
      expect(args.searchAttributes).toEqual({ CustomField: ['v'] });
    });

    it('throws for unknown workflow type', async () => {
      await expect(service.startWorkflow({ workflowType: 'nonExistent' })).rejects.toThrow(
        'Unknown workflow type: nonExistent',
      );
    });

    it('propagates client errors', async () => {
      mockWorkflowClient.start.mockRejectedValueOnce(new Error('Temporal unavailable'));
      await expect(service.startWorkflow({ workflowType: 'sentrisWorkflowRun' })).rejects.toThrow(
        'Temporal unavailable',
      );
    });
  });

  // ── describeWorkflow ────────────────────────────────────────────
  describe('describeWorkflow', () => {
    it('returns mapped workflow status', async () => {
      const ref: WorkflowRunReference = { workflowId: 'wf-123', runId: 'run-abc' };
      const result = await service.describeWorkflow(ref);
      expect(result).toEqual({
        workflowId: 'wf-123',
        runId: 'run-abc',
        status: 'RUNNING',
        startTime: '2024-06-01T00:00:00.000Z',
        closeTime: undefined,
        historyLength: 10,
        taskQueue: 'sentris',
        failure: undefined,
      });
      expect(mockWorkflowClient.getHandle).toHaveBeenCalledWith('wf-123', 'run-abc');
    });

    it('includes closeTime and failure when present', async () => {
      mockWorkflowHandle.describe.mockResolvedValueOnce({
        workflowId: 'wf-123',
        runId: 'run-abc',
        status: { name: 'FAILED', failure: { message: 'timeout' } },
        startTime: new Date('2024-06-01T00:00:00Z'),
        closeTime: new Date('2024-06-01T01:00:00Z'),
        historyLength: 25,
        taskQueue: 'sentris',
      });
      const result = await service.describeWorkflow({ workflowId: 'wf-123' });
      expect(result.status).toBe('FAILED');
      expect(result.closeTime).toBe('2024-06-01T01:00:00.000Z');
      expect(result.failure).toEqual({ message: 'timeout' });
    });

    it('propagates gRPC NOT_FOUND errors', async () => {
      mockWorkflowHandle.describe.mockRejectedValueOnce(
        makeGrpcError(grpcStatus.NOT_FOUND, 'workflow not found'),
      );
      await expect(service.describeWorkflow({ workflowId: 'missing' })).rejects.toThrow(
        'workflow not found',
      );
    });
  });

  // ── getWorkflowResult ───────────────────────────────────────────
  it('getWorkflowResult returns the workflow result', async () => {
    const result = await service.getWorkflowResult({ workflowId: 'wf-123' });
    expect(result).toEqual({ ok: true });
    expect(mockWorkflowHandle.result).toHaveBeenCalledTimes(1);
  });

  // ── cancelWorkflow ──────────────────────────────────────────────
  describe('cancelWorkflow', () => {
    it('requests cooperative cancellation without force-terminating the workflow', async () => {
      await service.cancelWorkflow({ workflowId: 'wf-123', runId: 'run-abc' });
      expect(mockWorkflowHandle.cancel).toHaveBeenCalledTimes(1);
      expect(mockWorkflowHandle.terminate).not.toHaveBeenCalled();
    });

    it('propagates errors from cancellation', async () => {
      mockWorkflowHandle.cancel.mockRejectedValueOnce(
        makeGrpcError(grpcStatus.NOT_FOUND, 'workflow not found'),
      );
      await expect(service.cancelWorkflow({ workflowId: 'gone' })).rejects.toThrow(
        'workflow not found',
      );
    });
  });

  // ── signalWorkflow ──────────────────────────────────────────────
  describe('signalWorkflow', () => {
    it('sends a signal to a running workflow', async () => {
      await service.signalWorkflow({
        workflowId: 'wf-123',
        signalName: 'humanApproval',
        args: { approved: true },
      });
      expect(mockWorkflowHandle.signal).toHaveBeenCalledWith('humanApproval', { approved: true });
    });

    it('propagates errors when workflow not found', async () => {
      mockWorkflowHandle.signal.mockRejectedValueOnce(
        makeGrpcError(grpcStatus.NOT_FOUND, 'not found'),
      );
      await expect(
        service.signalWorkflow({ workflowId: 'x', signalName: 'test', args: {} }),
      ).rejects.toThrow('not found');
    });

    it('does not log signal arguments that may contain credentials', async () => {
      const log = vi.fn();
      (service as unknown as { logger: { log: typeof log } }).logger.log = log;

      await service.signalWorkflow({
        workflowId: 'wf-123',
        signalName: 'executeToolCall',
        args: { credentials: { token: 'secret-value' } },
      });

      expect(log).toHaveBeenCalledWith('Sending signal executeToolCall to workflow wf-123');
      expect(JSON.stringify(log.mock.calls)).not.toContain('secret-value');
    });
  });

  describe('executeWorkflowUpdate', () => {
    it('executes a keyed Update on the requested Workflow run without signaling', async () => {
      const request = {
        invocationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        input: { package: 'lodash' },
      };

      const result = await service.executeWorkflowUpdate<{ status: string }>({
        workflowId: 'wf-123',
        temporalRunId: 'run-abc',
        updateName: 'executeToolInvocation',
        updateId: request.invocationId,
        args: request,
      });

      expect(result).toEqual({ status: 'completed' });
      expect(mockWorkflowClient.getHandle).toHaveBeenCalledWith('wf-123', 'run-abc');
      expect(mockWorkflowHandle.executeUpdate).toHaveBeenCalledWith('executeToolInvocation', {
        args: [request],
        updateId: request.invocationId,
      });
      expect(mockWorkflowHandle.signal).not.toHaveBeenCalled();
    });

    it('propagates Update failures without falling back to a signal', async () => {
      mockWorkflowHandle.executeUpdate.mockRejectedValueOnce(new Error('Update rejected'));

      await expect(
        service.executeWorkflowUpdate({
          workflowId: 'wf-123',
          updateName: 'executeToolInvocation',
          updateId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          args: {},
        }),
      ).rejects.toThrow('Update rejected');

      expect(mockWorkflowHandle.signal).not.toHaveBeenCalled();
    });
  });

  // ── queryWorkflow ───────────────────────────────────────────────
  describe('queryWorkflow', () => {
    it('queries workflow state with args', async () => {
      const result = await service.queryWorkflow({
        workflowId: 'wf-123',
        queryType: 'getProgress',
        args: ['step-1'],
      });
      expect(result).toEqual({ count: 42 });
      expect(mockWorkflowHandle.query).toHaveBeenCalledWith('getProgress', 'step-1');
    });

    it('queries with no args', async () => {
      await service.queryWorkflow({ workflowId: 'wf-123', queryType: 'getStatus' });
      expect(mockWorkflowHandle.query).toHaveBeenCalledWith('getStatus');
    });
  });

  // ── Connection management ───────────────────────────────────────
  describe('connection management', () => {
    it('creates namespace when NOT_FOUND', async () => {
      mockWorkflowService.describeNamespace.mockRejectedValueOnce(
        makeGrpcError(grpcStatus.NOT_FOUND),
      );
      await service.startWorkflow({ workflowType: 'testMinimalWorkflow' });
      expect(mockWorkflowService.registerNamespace).toHaveBeenCalledWith(
        expect.objectContaining({ namespace: 'test-namespace' }),
      );
    });

    it('propagates non-NOT_FOUND namespace errors', async () => {
      mockWorkflowService.describeNamespace.mockRejectedValueOnce(
        makeGrpcError(grpcStatus.INTERNAL, 'internal error'),
      );
      await expect(service.startWorkflow({ workflowType: 'testMinimalWorkflow' })).rejects.toThrow(
        /internal error/,
      );
    });

    it('resets client promise on connection failure', async () => {
      const { Connection } = await import('@temporalio/client');
      (Connection.connect as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error('connection refused'),
      );
      await expect(service.startWorkflow({ workflowType: 'testMinimalWorkflow' })).rejects.toThrow(
        /connection refused/,
      );

      (Connection.connect as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockConnection);
      const result = await service.startWorkflow({ workflowType: 'testMinimalWorkflow' });
      expect(result.workflowId).toBe('wf-123');
    });
  });

  // ── Schedule operations ─────────────────────────────────────────
  describe('schedule operations', () => {
    const scheduleInput: CreateTemporalScheduleInput = {
      scheduleId: 'sched-daily',
      organizationId: 'org-1',
      cronExpression: '0 9 * * *',
      timezone: 'America/New_York',
      overlapPolicy: 'skip',
      catchupWindowSeconds: 3600,
      memo: { owner: 'test' },
      dispatchArgs: { workflowId: 'wf-1', workflowVersionId: 'v-1', organizationId: 'org-1' },
    };

    it('createSchedule sends correct parameters', async () => {
      await service.createSchedule(scheduleInput);
      expect(mockScheduleClient.create).toHaveBeenCalledTimes(1);
      const args = mockScheduleClient.create.mock.calls[0][0];
      expect(args.scheduleId).toBe('sched-daily');
      expect(args.spec.cronExpressions).toEqual(['0 9 * * *']);
      expect(args.action.type).toBe('startWorkflow');
      expect(args.action.taskQueue).toBe('test-queue');
      expect(args.action.workflowId).toBe('schedule-sched-daily');
    });

    it('maps overlap policy "allow" → ALLOW_ALL', async () => {
      await service.createSchedule({ ...scheduleInput, overlapPolicy: 'allow' });
      expect(mockScheduleClient.create.mock.calls[0][0].policies.overlap).toBe(3);
    });

    it('maps overlap policy "buffer" → BUFFER_ONE', async () => {
      await service.createSchedule({ ...scheduleInput, overlapPolicy: 'buffer' });
      expect(mockScheduleClient.create.mock.calls[0][0].policies.overlap).toBe(2);
    });

    it('updateSchedule calls handle.update', async () => {
      await service.updateSchedule({
        ...scheduleInput,
        cronExpression: '0 10 * * *',
        timezone: 'UTC',
      });
      expect(mockScheduleClient.getHandle).toHaveBeenCalledWith('sched-daily');
      expect(mockScheduleHandle.update).toHaveBeenCalledTimes(1);
    });

    it('deleteSchedule deletes by id', async () => {
      await service.deleteSchedule('sched-daily');
      expect(mockScheduleClient.getHandle).toHaveBeenCalledWith('sched-daily');
      expect(mockScheduleHandle.delete).toHaveBeenCalledTimes(1);
    });

    it('treats an already-absent schedule as an idempotent deletion', async () => {
      mockScheduleHandle.delete.mockRejectedValueOnce(
        new ScheduleNotFoundError('schedule not found', 'sched-missing'),
      );

      await expect(service.deleteSchedule('sched-missing')).resolves.toBeUndefined();
    });

    it('pauseSchedule uses default note', async () => {
      await service.pauseSchedule('sched-1');
      expect(mockScheduleHandle.pause).toHaveBeenCalledWith('Paused via API');
    });

    it('resumeSchedule uses default note', async () => {
      await service.resumeSchedule('sched-1');
      expect(mockScheduleHandle.unpause).toHaveBeenCalledWith('Resumed via API');
    });

    it('triggerSchedule triggers immediate execution', async () => {
      await service.triggerSchedule('sched-1');
      expect(mockScheduleHandle.trigger).toHaveBeenCalledTimes(1);
    });

    it('describeSchedule returns description', async () => {
      const result = await service.describeSchedule('sched-1');
      expect((result as any).scheduleId).toBe('sched-1');
    });
  });
});
