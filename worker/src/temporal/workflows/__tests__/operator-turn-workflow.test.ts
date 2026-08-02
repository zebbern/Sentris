import { beforeAll, beforeEach, describe, expect, mock, test, vi } from 'bun:test';

const events: string[] = [];
const operatorSetTurnStatusActivity = vi.fn(async () => {
  events.push('status');
});
const operatorModelStepActivity = vi.fn();
const operatorPrepareActionActivity = vi.fn();
const operatorExecuteActionActivity = vi.fn();
const operatorSettleMcpActionActivity = vi.fn();
const operatorObserveRunActivity = vi.fn();
const operatorCompleteTurnActivity = vi.fn();
const operatorFailTurnActivity = vi.fn();
const prepareMcpOperationActivity = vi.fn();
const dispatchMcpOperationActivity = vi.fn();
const reconcileMcpOperationActivity = vi.fn();

const activityImplementations = {
  operatorSetTurnStatusActivity,
  operatorModelStepActivity,
  operatorPrepareActionActivity,
  operatorExecuteActionActivity,
  operatorSettleMcpActionActivity,
  operatorObserveRunActivity,
  operatorCompleteTurnActivity,
  operatorFailTurnActivity,
  prepareMcpOperationActivity,
  dispatchMcpOperationActivity,
  reconcileMcpOperationActivity,
};

let earlyDecision:
  | { actionId: string; decision: 'approved' | 'rejected'; expectedVersion: number }
  | undefined;
const allHandlersFinished = vi.fn(() => true);
const condition = vi.fn(async (predicate: () => boolean, timeout?: string) => {
  if (predicate()) return true;
  if (timeout) return false;
  throw new Error('Test workflow reached an unsatisfied condition');
});
const setHandler = vi.fn((definition: string, handler: (input: any) => unknown) => {
  events.push(`handler:${definition}`);
  if (definition === 'operatorActionDecision' && earlyDecision) handler(earlyDecision);
});

mock.module('@temporalio/workflow', () => ({
  ApplicationFailure: { nonRetryable: (message: string) => new Error(message) },
  ActivityCancellationType: { WAIT_CANCELLATION_COMPLETED: 'WAIT_CANCELLATION_COMPLETED' },
  CancellationScope: {
    nonCancellable: (callback: () => unknown) => callback(),
    withTimeout: (_timeout: number, callback: () => unknown) => callback(),
  },
  allHandlersFinished,
  condition,
  currentUpdateInfo: vi.fn(() => undefined),
  defineUpdate: vi.fn((name: string) => name),
  isCancellation: vi.fn(() => false),
  proxyActivities: vi.fn(
    () =>
      new Proxy(
        {},
        {
          get: (_target, property) =>
            activityImplementations[property as keyof typeof activityImplementations],
        },
      ),
  ),
  setHandler,
}));

let operatorTurnWorkflow: typeof import('../operator-turn-workflow').operatorTurnWorkflow;

const input = {
  sessionId: '11111111-1111-4111-8111-111111111111',
  turnId: '22222222-2222-4222-8222-222222222222',
  organizationId: '33333333-3333-4333-8333-333333333333',
};

beforeAll(async () => {
  ({ operatorTurnWorkflow } = await import('../operator-turn-workflow'));
});

beforeEach(() => {
  vi.clearAllMocks();
  events.length = 0;
  earlyDecision = undefined;
  operatorSetTurnStatusActivity.mockImplementation(async () => {
    events.push('status');
  });
  operatorCompleteTurnActivity.mockResolvedValue(undefined);
  operatorFailTurnActivity.mockResolvedValue(undefined);
  operatorSettleMcpActionActivity.mockResolvedValue(undefined);
});

describe('operatorTurnWorkflow', () => {
  test('installs the keyed decision Update before starting activities', async () => {
    operatorModelStepActivity.mockResolvedValue({
      text: 'The latest run completed successfully.',
      finishReason: 'stop',
      toolCalls: [],
    });

    await operatorTurnWorkflow(input);

    expect(events.slice(0, 2)).toEqual(['handler:operatorActionDecision', 'status']);
    expect(operatorCompleteTurnActivity).toHaveBeenCalledWith({
      ...input,
      message: 'The latest run completed successfully.',
    });
    expect(condition).toHaveBeenCalledWith(allHandlersFinished);
  });

  test('retains an early approval, executes once, and observes a launched run', async () => {
    const actionId = '44444444-4444-4444-8444-444444444444';
    earlyDecision = { actionId, decision: 'approved', expectedVersion: 3 };
    operatorModelStepActivity
      .mockResolvedValueOnce({
        text: '',
        finishReason: 'tool-calls',
        toolCalls: [
          {
            toolCallId: `${input.turnId}:0:0`,
            modelToolCallId: 'provider-run-call',
            providerOptions: {
              google: { thoughtSignature: 'signed-run-thought' },
            },
            commandName: 'run_workflow',
            arguments: { workflowId: '55555555-5555-4555-8555-555555555555' },
          },
        ],
      })
      .mockResolvedValueOnce({
        text: 'The workflow completed and returned one finding.',
        finishReason: 'stop',
        toolCalls: [],
      });
    operatorPrepareActionActivity.mockResolvedValue({
      actionId,
      actionVersion: 3,
      disposition: 'wait_for_approval',
    });
    operatorExecuteActionActivity.mockResolvedValue({
      actionId,
      result: { accepted: true },
      launchedRunId: 'sentris-run-1',
    });
    operatorObserveRunActivity.mockResolvedValue({
      runId: 'sentris-run-1',
      workflowId: '55555555-5555-4555-8555-555555555555',
      status: 'COMPLETED',
      terminal: true,
      result: { findings: 1 },
    });

    await operatorTurnWorkflow(input);

    expect(operatorExecuteActionActivity).toHaveBeenCalledTimes(1);
    expect(operatorObserveRunActivity).toHaveBeenCalledWith({
      ...input,
      runId: 'sentris-run-1',
    });
    expect(operatorModelStepActivity).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        ...input,
        step: 1,
        observations: [expect.objectContaining({ runId: 'sentris-run-1', terminal: true })],
        toolCallHistory: [
          expect.objectContaining({
            toolCallId: `${input.turnId}:0:0`,
            modelToolCallId: 'provider-run-call',
            providerOptions: {
              google: { thoughtSignature: 'signed-run-thought' },
            },
          }),
        ],
      }),
    );
  });

  test('does not execute an action rejected through an early decision', async () => {
    const actionId = '66666666-6666-4666-8666-666666666666';
    earlyDecision = { actionId, decision: 'rejected', expectedVersion: 1 };
    operatorModelStepActivity
      .mockResolvedValueOnce({
        text: '',
        finishReason: 'tool-calls',
        toolCalls: [
          {
            toolCallId: `${input.turnId}:0:0`,
            commandName: 'cancel_run',
            arguments: { runId: 'sentris-run-2' },
          },
        ],
      })
      .mockResolvedValueOnce({
        text: 'The run was left active.',
        finishReason: 'stop',
        toolCalls: [],
      });
    operatorPrepareActionActivity.mockResolvedValue({
      actionId,
      actionVersion: 1,
      disposition: 'wait_for_approval',
    });

    await operatorTurnWorkflow(input);

    expect(operatorExecuteActionActivity).not.toHaveBeenCalled();
    expect(operatorCompleteTurnActivity).toHaveBeenCalledWith({
      ...input,
      message: 'The run was left active.',
    });
  });

  test('reconciles an approved DB decision when its Workflow Update was not delivered', async () => {
    const actionId = '77777777-7777-4777-8777-777777777777';
    const toolCall = {
      toolCallId: `${input.turnId}:0:0`,
      commandName: 'cancel_run' as const,
      arguments: { runId: 'sentris-run-3' },
    };
    operatorModelStepActivity
      .mockResolvedValueOnce({ text: '', finishReason: 'tool-calls', toolCalls: [toolCall] })
      .mockResolvedValueOnce({
        text: 'The run was cancelled.',
        finishReason: 'stop',
        toolCalls: [],
      });
    operatorPrepareActionActivity
      .mockResolvedValueOnce({
        actionId,
        actionVersion: 0,
        disposition: 'wait_for_approval',
      })
      .mockResolvedValueOnce({
        actionId,
        actionVersion: 1,
        disposition: 'execute',
      });
    operatorExecuteActionActivity.mockResolvedValue({ actionId, result: { cancelled: true } });

    await operatorTurnWorkflow(input);

    expect(condition).toHaveBeenCalledWith(expect.any(Function), '5 seconds');
    expect(operatorPrepareActionActivity).toHaveBeenCalledTimes(2);
    expect(operatorPrepareActionActivity).toHaveBeenNthCalledWith(2, {
      ...input,
      ...toolCall,
    });
    expect(operatorExecuteActionActivity).toHaveBeenCalledTimes(1);
  });

  test('reconciles a rejected DB decision when its Workflow Update was not delivered', async () => {
    const actionId = '88888888-8888-4888-8888-888888888888';
    const toolCall = {
      toolCallId: `${input.turnId}:0:0`,
      commandName: 'cancel_run' as const,
      arguments: { runId: 'sentris-run-4' },
    };
    operatorModelStepActivity
      .mockResolvedValueOnce({ text: '', finishReason: 'tool-calls', toolCalls: [toolCall] })
      .mockResolvedValueOnce({
        text: 'The run was left active.',
        finishReason: 'stop',
        toolCalls: [],
      });
    operatorPrepareActionActivity
      .mockResolvedValueOnce({
        actionId,
        actionVersion: 0,
        disposition: 'wait_for_approval',
      })
      .mockResolvedValueOnce({
        actionId,
        actionVersion: 1,
        disposition: 'rejected',
      });

    await operatorTurnWorkflow(input);

    expect(operatorPrepareActionActivity).toHaveBeenCalledTimes(2);
    expect(operatorExecuteActionActivity).not.toHaveBeenCalled();
    expect(operatorCompleteTurnActivity).toHaveBeenCalledWith({
      ...input,
      message: 'The run was left active.',
    });
  });

  test('does not execute an identical completed mutation again on a later model step', async () => {
    const actionId = '99999999-9999-4999-8999-999999999999';
    const firstToolCall = {
      toolCallId: `${input.turnId}:0:0`,
      commandName: 'run_workflow' as const,
      arguments: { workflowId: '55555555-5555-4555-8555-555555555555', inputs: {} },
    };
    const repeatedToolCall = { ...firstToolCall, toolCallId: `${input.turnId}:1:0` };
    operatorModelStepActivity
      .mockResolvedValueOnce({
        text: '',
        finishReason: 'tool-calls',
        toolCalls: [firstToolCall],
      })
      .mockResolvedValueOnce({
        text: '',
        finishReason: 'tool-calls',
        toolCalls: [repeatedToolCall],
      });
    operatorPrepareActionActivity
      .mockResolvedValueOnce({ actionId, actionVersion: 0, disposition: 'execute' })
      .mockResolvedValueOnce({
        actionId,
        actionVersion: 2,
        disposition: 'already_completed',
      });
    operatorExecuteActionActivity.mockResolvedValue({
      actionId,
      result: { status: 'RUNNING' },
      launchedRunId: 'sentris-run-deduped',
    });
    operatorObserveRunActivity.mockResolvedValue({
      runId: 'sentris-run-deduped',
      workflowId: '55555555-5555-4555-8555-555555555555',
      status: 'COMPLETED',
      terminal: true,
      result: { findings: 5 },
    });

    await operatorTurnWorkflow(input);

    expect(operatorExecuteActionActivity).toHaveBeenCalledTimes(1);
    expect(operatorObserveRunActivity).toHaveBeenCalledTimes(1);
    expect(operatorModelStepActivity).toHaveBeenCalledTimes(2);
    expect(operatorCompleteTurnActivity).toHaveBeenCalledWith({
      ...input,
      message:
        'Workflow run sentris-run-deduped completed with status COMPLETED. Its durable result is available above.',
    });
  });

  test('dispatches a deferred MCP operation once and settles the Operator action afterward', async () => {
    const actionId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const snapshotId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    const request = {
      invocationId: actionId,
      scope: {
        kind: 'operator' as const,
        organizationId: input.organizationId,
        sessionId: input.sessionId,
        turnId: input.turnId,
        capabilityGrantId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        expiresAt: '2099-08-02T11:00:00.000Z',
      },
      capabilitySnapshotId: snapshotId,
      sourceId: 'saved-server-1',
      authorizationTarget: 'search',
      operation: { kind: 'tool-call' as const, name: 'search', arguments: { query: 'npm' } },
      requestedAt: '2099-08-02T10:00:00.000Z',
      deadlineAt: '2099-08-02T10:10:00.000Z',
    };
    const plan = {
      ref: { invocationId: actionId },
      deadlineAt: request.deadlineAt,
    };
    const mcpResult = {
      operationId: actionId,
      kind: 'completed' as const,
      output: { matches: 3 },
      completedAt: '2099-08-02T10:00:03.000Z',
    };
    operatorModelStepActivity
      .mockResolvedValueOnce({
        text: '',
        finishReason: 'tool-calls',
        toolCalls: [
          {
            toolCallId: `${input.turnId}:0:0`,
            commandName: 'invoke_mcp_tool',
            arguments: {
              capabilitySnapshotId: snapshotId,
              sourceId: 'saved-server-1',
              name: 'search',
              arguments: { query: 'npm' },
            },
          },
        ],
      })
      .mockResolvedValueOnce({
        text: 'The MCP search completed with three matches.',
        finishReason: 'stop',
        toolCalls: [],
      });
    operatorPrepareActionActivity.mockResolvedValue({
      actionId,
      actionVersion: 0,
      disposition: 'execute',
    });
    operatorExecuteActionActivity.mockResolvedValue({
      actionId,
      result: { kind: 'mcp-operation', state: 'ready_for_dispatch' },
      mcpOperationRequest: request,
    });
    prepareMcpOperationActivity.mockResolvedValue({ kind: 'prepared', plan });
    dispatchMcpOperationActivity.mockResolvedValue(mcpResult);

    await operatorTurnWorkflow(input);

    expect(prepareMcpOperationActivity).toHaveBeenCalledWith(request);
    expect(dispatchMcpOperationActivity).toHaveBeenCalledTimes(1);
    expect(operatorSettleMcpActionActivity).toHaveBeenCalledWith({
      ...input,
      actionId,
      result: mcpResult,
    });
    expect(reconcileMcpOperationActivity).not.toHaveBeenCalled();
  });
});
