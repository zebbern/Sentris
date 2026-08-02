import { beforeAll, beforeEach, describe, expect, mock, test, vi } from 'bun:test';

const workflowAgentModelStepActivity = vi.fn();
const workflowAgentPrepareToolActivity = vi.fn();
const workflowAgentDispatchToolActivity = vi.fn();
const workflowAgentReconcileToolActivity = vi.fn();
const workflowAgentCheckpointActivity = vi.fn();
const workflowAgentFinalizeActivity = vi.fn();
const workflowAgentFailActivity = vi.fn();

const activities = {
  workflowAgentModelStepActivity,
  workflowAgentPrepareToolActivity,
  workflowAgentDispatchToolActivity,
  workflowAgentReconcileToolActivity,
  workflowAgentCheckpointActivity,
  workflowAgentFinalizeActivity,
  workflowAgentFailActivity,
};

const proxyActivities = vi.fn(
  () =>
    new Proxy(
      {},
      {
        get: (_target, property) => activities[property as keyof typeof activities],
      },
    ),
);

let uuidSequence = 0;
let cancellation = false;

mock.module('@temporalio/workflow', () => ({
  ActivityCancellationType: { WAIT_CANCELLATION_COMPLETED: 'WAIT_CANCELLATION_COMPLETED' },
  ApplicationFailure: {
    nonRetryable: (message: string, type: string) =>
      Object.assign(new Error(message), { name: type }),
  },
  CancellationScope: {
    nonCancellable: (callback: () => unknown) => callback(),
    withTimeout: (_timeout: number, callback: () => unknown) => callback(),
  },
  isCancellation: vi.fn(() => cancellation),
  proxyActivities,
  uuid4: vi.fn(() => `00000000-0000-4000-8000-${String(++uuidSequence).padStart(12, '0')}`),
}));

let durableAiAgentWorkflow: typeof import('../durable-ai-agent-workflow').durableAiAgentWorkflow;

const input = {
  agentRunId: 'run-1:agent-1:turn-1',
  component: {
    runId: 'run-1',
    workflowId: 'workflow-1',
    organizationId: 'org-1',
    action: { ref: 'agent-1', componentId: 'core.ai.agent' },
    inputs: {},
    params: { executionProfile: 'investigate' },
  },
  setup: {
    state: { fileId: 'root', rootFileId: 'root' },
    stepLimit: 3,
    toolTimeoutMs: 60_000,
    modelActivityTimeout: '135 minutes' as const,
    toolStatus: {
      requested: false,
      status: 'not-requested' as const,
      connectedNodeCount: 0,
    },
  },
};

beforeAll(async () => {
  ({ durableAiAgentWorkflow } = await import('../durable-ai-agent-workflow'));
});

beforeEach(() => {
  vi.clearAllMocks();
  uuidSequence = 0;
  cancellation = false;
  workflowAgentFailActivity.mockResolvedValue(undefined);
});

describe('durableAiAgentWorkflow', () => {
  test('checkpoints model and tool steps as separate durable operations', async () => {
    const authority = {
      scope: {
        kind: 'run' as const,
        organizationId: 'org-1',
        runId: 'run-1',
        capabilityGrantId: '11111111-1111-4111-8111-111111111111',
        invokingNodeId: 'agent-1',
      },
      capabilitySnapshotId: '22222222-2222-4222-8222-222222222222',
    };
    const durableInput = {
      ...input,
      setup: {
        ...input.setup,
        toolStatus: {
          requested: true,
          status: 'configured' as const,
          connectedNodeCount: 1,
          availableToolCount: 2,
        },
        authority,
      },
    };
    workflowAgentModelStepActivity
      .mockResolvedValueOnce({
        state: { fileId: 'model-0', rootFileId: 'root' },
        finishReason: 'tool-calls',
        toolCalls: [
          { modelToolCallId: 'provider-call-1', toolName: 'lookup' },
          { modelToolCallId: 'provider-call-2', toolName: 'scan' },
        ],
      })
      .mockResolvedValueOnce({
        state: { fileId: 'model-1', rootFileId: 'root' },
        finishReason: 'stop',
        toolCalls: [],
      });
    workflowAgentPrepareToolActivity
      .mockResolvedValueOnce({
        kind: 'prepared',
        planFileId: 'plan-1',
        resultFileId: 'result-1',
      })
      .mockResolvedValueOnce({
        kind: 'prepared',
        planFileId: 'plan-2',
        resultFileId: 'result-2',
      });
    workflowAgentDispatchToolActivity
      .mockResolvedValueOnce({ resultFileId: 'result-1', kind: 'completed' })
      .mockResolvedValueOnce({ resultFileId: 'result-2', kind: 'completed' });
    workflowAgentCheckpointActivity.mockResolvedValue({
      fileId: 'tool-0',
      rootFileId: 'root',
    });
    workflowAgentFinalizeActivity.mockResolvedValue({
      output: { responseText: 'Investigation complete' },
    });

    const output = await durableAiAgentWorkflow(durableInput);

    expect(output).toEqual({ output: { responseText: 'Investigation complete' } });
    expect(workflowAgentPrepareToolActivity).toHaveBeenCalledTimes(2);
    expect(workflowAgentPrepareToolActivity.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        state: { fileId: 'model-0', rootFileId: 'root' },
        authority,
        step: 0,
        toolIndex: 0,
      }),
    );
    expect(workflowAgentPrepareToolActivity.mock.calls[1]?.[0]).toEqual(
      expect.objectContaining({ step: 0, toolIndex: 1 }),
    );
    expect(workflowAgentDispatchToolActivity).toHaveBeenCalledTimes(2);
    expect(workflowAgentReconcileToolActivity).not.toHaveBeenCalled();
    expect(workflowAgentCheckpointActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        state: { fileId: 'model-0', rootFileId: 'root' },
        executions: [
          { resultFileId: 'result-1', kind: 'completed' },
          { resultFileId: 'result-2', kind: 'completed' },
        ],
      }),
    );
    expect(workflowAgentModelStepActivity).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ state: { fileId: 'tool-0', rootFileId: 'root' }, step: 1 }),
    );
    expect(proxyActivities).toHaveBeenCalledWith(
      expect.objectContaining({
        startToCloseTimeout: '135 minutes',
        retry: expect.objectContaining({ maximumAttempts: 1 }),
      }),
    );
    expect(workflowAgentFailActivity).not.toHaveBeenCalled();
  });

  test('keeps the historical investigate timeout when replaying setup without a timeout', async () => {
    workflowAgentModelStepActivity.mockResolvedValue({
      state: { fileId: 'model-final', rootFileId: 'root' },
      finishReason: 'stop',
      toolCalls: [],
    });
    workflowAgentFinalizeActivity.mockResolvedValue({ output: { responseText: 'done' } });

    const legacyInput = {
      ...input,
      setup: { ...input.setup, modelActivityTimeout: undefined },
    };
    await durableAiAgentWorkflow(legacyInput);

    expect(proxyActivities).toHaveBeenCalledWith(
      expect.objectContaining({ startToCloseTimeout: '45 minutes' }),
    );
  });

  test('reconciles an unconfirmed tool dispatch before checkpointing the model result', async () => {
    const authority = {
      scope: {
        kind: 'run' as const,
        organizationId: 'org-1',
        runId: 'run-1',
        capabilityGrantId: '11111111-1111-4111-8111-111111111111',
        invokingNodeId: 'agent-1',
      },
      capabilitySnapshotId: '22222222-2222-4222-8222-222222222222',
    };
    const durableInput = {
      ...input,
      setup: {
        ...input.setup,
        authority,
        toolStatus: {
          requested: true,
          status: 'configured' as const,
          connectedNodeCount: 1,
          availableToolCount: 1,
        },
      },
    };
    workflowAgentModelStepActivity
      .mockResolvedValueOnce({
        state: { fileId: 'model-0', rootFileId: 'root' },
        finishReason: 'tool-calls',
        toolCalls: [{ modelToolCallId: 'provider-call-1', toolName: 'lookup' }],
      })
      .mockResolvedValueOnce({
        state: { fileId: 'model-1', rootFileId: 'root' },
        finishReason: 'stop',
        toolCalls: [],
      });
    workflowAgentPrepareToolActivity.mockResolvedValue({
      kind: 'prepared',
      planFileId: 'plan-1',
      resultFileId: 'result-1',
    });
    workflowAgentDispatchToolActivity.mockRejectedValue(new Error('worker lost after dispatch'));
    workflowAgentReconcileToolActivity.mockResolvedValue({
      resultFileId: 'result-1',
      kind: 'ambiguous',
      message: 'result unknown',
    });
    workflowAgentCheckpointActivity.mockResolvedValue({ fileId: 'tool-0', rootFileId: 'root' });
    workflowAgentFinalizeActivity.mockResolvedValue({ output: { responseText: 'done' } });

    await durableAiAgentWorkflow(durableInput);

    expect(workflowAgentReconcileToolActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        planFileId: 'plan-1',
        resultFileId: 'result-1',
        cause: 'failure',
      }),
    );
    expect(workflowAgentCheckpointActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        executions: [{ resultFileId: 'result-1', kind: 'ambiguous', message: 'result unknown' }],
      }),
    );
  });

  test('records a node failure when a non-cancellation escapes the durable turn', async () => {
    workflowAgentModelStepActivity.mockRejectedValue(new Error('provider unavailable'));

    await expect(durableAiAgentWorkflow(input)).rejects.toThrow('provider unavailable');

    expect(workflowAgentFailActivity).toHaveBeenCalledWith({
      ...input,
      error: 'provider unavailable',
    });
    expect(workflowAgentFinalizeActivity).not.toHaveBeenCalled();
  });

  test('publishes a terminal lifecycle record when the durable turn is cancelled', async () => {
    cancellation = true;
    workflowAgentModelStepActivity.mockRejectedValue(new Error('cancelled'));

    await expect(durableAiAgentWorkflow(input)).rejects.toThrow('cancelled');

    expect(workflowAgentFailActivity).toHaveBeenCalledWith({
      ...input,
      error: 'AI Agent turn cancelled.',
      cancelled: true,
    });
  });

  test('waits for every sibling tool reconciliation before closing a cancelled turn', async () => {
    cancellation = true;
    const authority = {
      scope: {
        kind: 'run' as const,
        organizationId: 'org-1',
        runId: 'run-1',
        capabilityGrantId: '11111111-1111-4111-8111-111111111111',
        invokingNodeId: 'agent-1',
      },
      capabilitySnapshotId: '22222222-2222-4222-8222-222222222222',
    };
    workflowAgentModelStepActivity.mockResolvedValue({
      state: { fileId: 'model-0', rootFileId: 'root' },
      finishReason: 'tool-calls',
      toolCalls: [
        { modelToolCallId: 'provider-call-1', toolName: 'lookup' },
        { modelToolCallId: 'provider-call-2', toolName: 'scan' },
      ],
    });
    workflowAgentPrepareToolActivity
      .mockResolvedValueOnce({ kind: 'prepared', planFileId: 'plan-1', resultFileId: 'result-1' })
      .mockResolvedValueOnce({ kind: 'prepared', planFileId: 'plan-2', resultFileId: 'result-2' });
    workflowAgentDispatchToolActivity.mockRejectedValue(new Error('cancelled'));

    let releaseSecondReconciliation!: (value: {
      resultFileId: string;
      kind: 'ambiguous';
      message: string;
    }) => void;
    const secondReconciliation = new Promise<{
      resultFileId: string;
      kind: 'ambiguous';
      message: string;
    }>((resolve) => {
      releaseSecondReconciliation = resolve;
    });
    let firstReconciliationFinished!: () => void;
    const firstReconciliation = new Promise<void>((resolve) => {
      firstReconciliationFinished = resolve;
    });
    workflowAgentReconcileToolActivity
      .mockImplementationOnce(async () => {
        firstReconciliationFinished();
        return { resultFileId: 'result-1', kind: 'ambiguous', message: 'cancelled' };
      })
      .mockImplementationOnce(() => secondReconciliation);

    const execution = durableAiAgentWorkflow({
      ...input,
      setup: { ...input.setup, authority },
    });
    const outcome = execution.then(
      (value) => ({ status: 'fulfilled' as const, value }),
      (reason: unknown) => ({ status: 'rejected' as const, reason }),
    );

    await firstReconciliation;
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(workflowAgentReconcileToolActivity).toHaveBeenCalledTimes(2);
    expect(workflowAgentFailActivity).not.toHaveBeenCalled();

    releaseSecondReconciliation({
      resultFileId: 'result-2',
      kind: 'ambiguous',
      message: 'cancelled',
    });
    expect((await outcome).status).toBe('rejected');
    expect(workflowAgentFailActivity).toHaveBeenCalledWith(
      expect.objectContaining({ cancelled: true }),
    );
  });
});
