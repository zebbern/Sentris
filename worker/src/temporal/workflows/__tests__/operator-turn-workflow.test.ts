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
const operatorAwaitRunActivity = vi.fn();
const operatorCompleteTurnActivity = vi.fn();
const operatorFailTurnActivity = vi.fn();
const operatorCancelTurnActivity = vi.fn();
const operatorLoadPlanActivity = vi.fn();
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
  operatorAwaitRunActivity,
  operatorCompleteTurnActivity,
  operatorFailTurnActivity,
  operatorCancelTurnActivity,
  operatorLoadPlanActivity,
  prepareMcpOperationActivity,
  dispatchMcpOperationActivity,
  reconcileMcpOperationActivity,
};

let earlyDecision:
  | { actionId: string; decision: 'approved' | 'rejected'; expectedVersion: number }
  | undefined;
let detachedRunFollowing = true;
let automaticDraftRepair = true;
let runFollowUpQuestions = true;
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
  patched: vi.fn((patchId: string) => {
    if (patchId === 'operator-automatic-draft-repair-v1') return automaticDraftRepair;
    if (patchId === 'operator-run-follow-up-question-v1') return runFollowUpQuestions;
    return detachedRunFollowing;
  }),
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

function workflowDraft(draftId: string, valid: boolean, parentDraftId?: string) {
  return {
    kind: 'workflow-draft' as const,
    draftId,
    ...(parentDraftId ? { parentDraftId } : {}),
    mode: 'create' as const,
    workflowId: null,
    baseVersionId: null,
    name: 'Subdomain workflow',
    digest: `digest-${draftId}`,
    validation: {
      valid,
      errors: valid ? [] : ['[subfinder] inputMappings: text cannot connect to list<text>'],
    },
    diff: {
      metadataChanged: [],
      addedNodeIds: ['entry', 'subfinder'],
      removedNodeIds: [],
      changedNodeIds: [],
      addedEdgeIds: ['entry-subfinder'],
      removedEdgeIds: [],
      changedEdgeIds: [],
    },
  };
}

function toolStep(...toolCalls: unknown[]) {
  return { text: '', finishReason: 'tool-calls', toolCalls };
}

function mockSuccessfulActionResults(...results: unknown[]): void {
  operatorPrepareActionActivity.mockResolvedValue({
    actionId: '66666666-6666-4666-8666-666666666666',
    actionVersion: 0,
    disposition: 'execute',
  });
  for (const [index, result] of results.entries()) {
    operatorExecuteActionActivity.mockResolvedValueOnce({
      actionId: `action-${index}`,
      actionStatus: 'succeeded',
      result,
    });
  }
}

beforeAll(async () => {
  ({ operatorTurnWorkflow } = await import('../operator-turn-workflow'));
});

beforeEach(() => {
  vi.clearAllMocks();
  for (const activity of Object.values(activityImplementations)) activity.mockReset();
  events.length = 0;
  earlyDecision = undefined;
  detachedRunFollowing = true;
  automaticDraftRepair = true;
  runFollowUpQuestions = true;
  operatorSetTurnStatusActivity.mockImplementation(async () => {
    events.push('status');
  });
  operatorCompleteTurnActivity.mockResolvedValue(undefined);
  operatorFailTurnActivity.mockResolvedValue(undefined);
  operatorCancelTurnActivity.mockResolvedValue(undefined);
  operatorSettleMcpActionActivity.mockResolvedValue(undefined);
  operatorAwaitRunActivity.mockResolvedValue({
    runId: 'sentris-run-candidate',
    workflowId: '55555555-5555-4555-8555-555555555555',
    status: 'COMPLETED',
    terminal: true,
  });
});

describe('operatorTurnWorkflow', () => {
  test('completes a structured plan proposal without asking the model to restate it', async () => {
    const actionId = '44444444-4444-4444-8444-444444444444';
    operatorModelStepActivity.mockResolvedValue({
      text: '',
      finishReason: 'tool-calls',
      toolCalls: [
        {
          toolCallId: `${input.turnId}:0:0`,
          commandName: 'propose_operator_plan',
          arguments: {},
        },
      ],
    });
    operatorPrepareActionActivity.mockResolvedValue({
      actionId,
      actionVersion: 0,
      disposition: 'execute',
    });
    operatorExecuteActionActivity.mockResolvedValue({
      actionId,
      actionStatus: 'succeeded',
      result: {
        kind: 'operator-plan',
        planId: actionId,
        title: 'Inspect workflow activity',
        steps: [
          {
            id: 'list-workflows',
            label: 'List workflows',
            commandName: 'list_workflows',
            arguments: { limit: 1 },
            effect: 'read',
          },
          {
            id: 'list-runs',
            label: 'List recent runs',
            commandName: 'list_runs',
            arguments: { limit: 5 },
            effect: 'read',
          },
          {
            id: 'list-findings',
            label: 'List recent findings',
            commandName: 'list_findings',
            arguments: { limit: 20 },
            effect: 'read',
          },
        ],
      },
    });

    await operatorTurnWorkflow(input);

    expect(operatorModelStepActivity).toHaveBeenCalledTimes(1);
    expect(operatorCompleteTurnActivity).toHaveBeenCalledWith({
      ...input,
      message: 'Plan ready for review. Select Run plan or Revise.',
    });
  });

  test('automatically inspects and revises one invalid workflow draft', async () => {
    const draftId = '44444444-4444-4444-8444-444444444444';
    const revisedDraftId = '55555555-5555-4555-8555-555555555555';
    const proposalCall = {
      toolCallId: `${input.turnId}:0:0`,
      commandName: 'propose_workflow_draft' as const,
      arguments: {},
    };
    const componentCall = {
      toolCallId: `${input.turnId}:8:0`,
      commandName: 'get_component' as const,
      arguments: { componentId: 'core.array.pack' },
    };
    const reviseCall = {
      toolCallId: `${input.turnId}:9:0`,
      commandName: 'revise_workflow_draft' as const,
      arguments: {
        draftId,
        operations: [{ operation: 'add_node', node: { id: 'pack' } }],
      },
    };
    operatorModelStepActivity
      .mockResolvedValueOnce(toolStep(proposalCall))
      .mockResolvedValueOnce(toolStep(componentCall))
      .mockResolvedValueOnce(toolStep(reviseCall));
    mockSuccessfulActionResults(
      workflowDraft(draftId, false),
      { ...workflowDraft(draftId, false), proposedGraph: { nodes: [], edges: [] } },
      { id: 'core.array.pack' },
      workflowDraft(revisedDraftId, true, draftId),
    );

    await operatorTurnWorkflow(input);

    expect(operatorPrepareActionActivity).toHaveBeenCalledWith({
      ...input,
      toolCallId: `${input.turnId}:auto-repair:inspect:${draftId}`,
      commandName: 'get_workflow_draft',
      arguments: { draftId },
      userConfirmed: true,
    });
    expect(operatorModelStepActivity).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        ...input,
        step: 8,
        mode: 'workflow_draft_repair',
        sourceDraftId: draftId,
        toolCallHistory: [proposalCall],
      }),
    );
    expect(operatorModelStepActivity).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        step: 9,
        mode: 'workflow_draft_repair',
        sourceDraftId: draftId,
        toolCallHistory: [proposalCall, componentCall],
      }),
    );
    expect(operatorCompleteTurnActivity).toHaveBeenCalledWith({
      ...input,
      message: 'Workflow draft ready for review. Select Save version when it is ready.',
    });
  });

  test('stops automatic repair after one invalid revision attempt', async () => {
    const draftId = '44444444-4444-4444-8444-444444444444';
    const revisedDraftId = '55555555-5555-4555-8555-555555555555';
    operatorModelStepActivity
      .mockResolvedValueOnce(
        toolStep({
          toolCallId: `${input.turnId}:0:0`,
          commandName: 'propose_workflow_draft',
          arguments: {},
        }),
      )
      .mockResolvedValueOnce(
        toolStep({
          toolCallId: `${input.turnId}:8:0`,
          commandName: 'revise_workflow_draft',
          arguments: { draftId, operations: [] },
        }),
      );
    mockSuccessfulActionResults(
      workflowDraft(draftId, false),
      { ...workflowDraft(draftId, false), proposedGraph: { nodes: [], edges: [] } },
      workflowDraft(revisedDraftId, false, draftId),
    );

    await operatorTurnWorkflow(input);

    expect(operatorModelStepActivity).toHaveBeenCalledTimes(2);
    expect(operatorExecuteActionActivity).toHaveBeenCalledTimes(3);
    expect(operatorCompleteTurnActivity).toHaveBeenCalledWith({
      ...input,
      message: 'Workflow draft needs revision. Review the validation errors shown in the card.',
    });
  });

  test('keeps pre-patch invalid draft histories on their original completion path', async () => {
    automaticDraftRepair = false;
    const draftId = '44444444-4444-4444-8444-444444444444';
    operatorModelStepActivity.mockResolvedValue(
      toolStep({
        toolCallId: `${input.turnId}:0:0`,
        commandName: 'propose_workflow_draft',
        arguments: {},
      }),
    );
    mockSuccessfulActionResults(workflowDraft(draftId, false));

    await operatorTurnWorkflow(input);

    expect(operatorModelStepActivity).toHaveBeenCalledTimes(1);
    expect(operatorExecuteActionActivity).toHaveBeenCalledTimes(1);
    expect(operatorCompleteTurnActivity).toHaveBeenCalledWith({
      ...input,
      message: 'Workflow draft needs revision. Review the validation errors shown in the card.',
    });
  });

  test('inspects and summarizes an automatic terminal-run follow-up without asking unnecessarily', async () => {
    const runId = 'sentris-run-finished';
    const actionId = '44444444-4444-4444-8444-444444444444';
    operatorPrepareActionActivity.mockResolvedValue({
      actionId,
      actionVersion: 0,
      disposition: 'execute',
    });
    operatorExecuteActionActivity.mockResolvedValue({
      actionId,
      actionStatus: 'succeeded',
      result: { terminal: true, status: { status: 'COMPLETED' } },
    });
    operatorModelStepActivity.mockResolvedValue({
      text: 'The workflow completed successfully with no trace failures.',
      finishReason: 'stop',
      toolCalls: [],
    });

    await operatorTurnWorkflow({
      ...input,
      journey: { kind: 'run_follow_up', runId },
    });

    expect(operatorPrepareActionActivity).toHaveBeenCalledWith({
      ...input,
      toolCallId: `${input.turnId}:journey:inspect-run`,
      commandName: 'get_run',
      arguments: { runId },
      userConfirmed: true,
    });
    expect(operatorExecuteActionActivity).toHaveBeenCalledTimes(1);
    expect(operatorModelStepActivity).toHaveBeenCalledWith({
      ...input,
      step: 1,
      mode: 'run_follow_up_review',
      sourceRunId: runId,
    });
    expect(operatorCompleteTurnActivity).toHaveBeenCalledWith({
      ...input,
      message: 'The workflow completed successfully with no trace failures.',
    });
  });

  test('asks at most one durable terminal follow-up question and resumes with the answer', async () => {
    const runId = 'sentris-run-needs-input';
    const inspectionActionId = '44444444-4444-4444-8444-444444444444';
    const questionActionId = '55555555-5555-4555-8555-555555555555';
    const questionCall = {
      toolCallId: `${input.turnId}:1:0`,
      modelToolCallId: 'provider-question',
      providerOptions: { google: { thoughtSignature: 'question-signature' } },
      commandName: 'request_user_input' as const,
      arguments: {
        question: 'Should I focus the recommendation on fixing the TLS input or skipping TLS?',
        options: ['Fix the TLS input', 'Skip TLS for now'],
      },
    };
    earlyDecision = {
      actionId: questionActionId,
      decision: 'approved',
      expectedVersion: 0,
    };
    operatorPrepareActionActivity
      .mockResolvedValueOnce({
        actionId: inspectionActionId,
        actionVersion: 0,
        disposition: 'execute',
      })
      .mockResolvedValueOnce({
        actionId: questionActionId,
        actionVersion: 0,
        disposition: 'wait_for_approval',
      });
    operatorExecuteActionActivity
      .mockResolvedValueOnce({
        actionId: inspectionActionId,
        actionStatus: 'succeeded',
        result: { terminal: true, status: { status: 'FAILED' } },
      })
      .mockResolvedValueOnce({
        actionId: questionActionId,
        actionStatus: 'succeeded',
        result: {
          kind: 'operator-user-input',
          response: 'Fix the TLS input',
          selectedOption: 'Fix the TLS input',
        },
      });
    operatorModelStepActivity
      .mockResolvedValueOnce({
        text: '',
        finishReason: 'tool-calls',
        toolCalls: [questionCall],
      })
      .mockResolvedValueOnce({
        text: 'The run failed at TLS setup. Update the TLS input, then use Run again.',
        finishReason: 'stop',
        toolCalls: [],
      });

    await operatorTurnWorkflow({
      ...input,
      journey: { kind: 'run_follow_up', runId },
    });

    expect(operatorPrepareActionActivity).toHaveBeenNthCalledWith(2, {
      ...input,
      ...questionCall,
    });
    expect(operatorExecuteActionActivity).toHaveBeenCalledTimes(2);
    expect(operatorModelStepActivity).toHaveBeenNthCalledWith(2, {
      ...input,
      step: 2,
      mode: 'run_follow_up_summary',
      sourceRunId: runId,
      toolCallHistory: [questionCall],
    });
    expect(operatorCompleteTurnActivity).toHaveBeenCalledWith({
      ...input,
      message: 'The run failed at TLS setup. Update the TLS input, then use Run again.',
    });
  });

  test('keeps pre-patch terminal follow-ups on the original text-only summary path', async () => {
    runFollowUpQuestions = false;
    const runId = 'sentris-run-pre-patch';
    operatorPrepareActionActivity.mockResolvedValue({
      actionId: '44444444-4444-4444-8444-444444444444',
      actionVersion: 0,
      disposition: 'execute',
    });
    operatorExecuteActionActivity.mockResolvedValue({
      actionId: '44444444-4444-4444-8444-444444444444',
      actionStatus: 'succeeded',
      result: { terminal: true, status: { status: 'COMPLETED' } },
    });
    operatorModelStepActivity.mockResolvedValue({
      text: 'The workflow completed.',
      finishReason: 'stop',
      toolCalls: [],
    });

    await operatorTurnWorkflow({
      ...input,
      journey: { kind: 'run_follow_up', runId },
    });

    expect(operatorModelStepActivity).toHaveBeenCalledTimes(1);
    expect(operatorModelStepActivity).toHaveBeenCalledWith({
      ...input,
      step: 1,
      mode: 'run_follow_up_summary',
      sourceRunId: runId,
    });
  });

  test('executes an immutable plan sequentially through the canonical action boundary', async () => {
    const planActionId = '44444444-4444-4444-8444-444444444444';
    const workflowId = '55555555-5555-4555-8555-555555555555';
    operatorLoadPlanActivity.mockResolvedValue({
      kind: 'operator-plan',
      planId: planActionId,
      title: 'Inspect workflow activity',
      steps: [
        {
          id: 'list-workflows',
          label: 'List workflows',
          commandName: 'list_workflows',
          arguments: { limit: 1 },
          effect: 'read',
        },
        {
          id: 'inspect-workflow',
          label: 'Inspect the workflow',
          commandName: 'get_workflow',
          arguments: {},
          bindings: [
            {
              sourceStepId: 'list-workflows',
              sourcePointer: '/0/id',
              targetPointer: '/workflowId',
            },
          ],
          effect: 'read',
        },
        {
          id: 'list-runs',
          label: 'List its runs',
          commandName: 'list_runs',
          arguments: { limit: 5 },
          bindings: [
            {
              sourceStepId: 'list-workflows',
              sourcePointer: '/0/id',
              targetPointer: '/workflowId',
            },
          ],
          effect: 'read',
        },
      ],
    });
    operatorPrepareActionActivity.mockImplementation(async ({ toolCallId }) => ({
      actionId: toolCallId,
      actionVersion: 0,
      disposition: 'execute',
    }));
    operatorExecuteActionActivity.mockImplementation(async ({ actionId }) => ({
      actionId,
      actionStatus: 'succeeded',
      result: actionId.endsWith(':list-workflows')
        ? [{ id: workflowId }]
        : actionId.endsWith(':list-runs')
          ? {
              runs: [
                {
                  id: 'sentris-run-12345678-verified',
                  workflowId,
                },
              ],
            }
          : { id: workflowId },
    }));
    operatorModelStepActivity.mockResolvedValue({
      text: 'The workflow activity was inspected successfully.',
      finishReason: 'stop',
      toolCalls: [],
    });

    await operatorTurnWorkflow({
      ...input,
      journey: { kind: 'execute_plan', planActionId },
    });

    expect(operatorModelStepActivity).toHaveBeenCalledWith({
      ...input,
      step: 3,
      mode: 'plan_summary',
      planTitle: 'Inspect workflow activity',
    });
    expect(operatorPrepareActionActivity.mock.calls.map(([call]) => call.toolCallId)).toEqual([
      `${input.turnId}:plan:${planActionId}:list-workflows`,
      `${input.turnId}:plan:${planActionId}:inspect-workflow`,
      `${input.turnId}:plan:${planActionId}:list-runs`,
    ]);
    expect(operatorPrepareActionActivity.mock.calls[1]?.[0].arguments).toEqual({ workflowId });
    expect(operatorPrepareActionActivity.mock.calls[2]?.[0].arguments).toEqual({
      limit: 5,
      workflowId,
    });
    expect(operatorExecuteActionActivity).toHaveBeenCalledTimes(3);
    expect(operatorCompleteTurnActivity).toHaveBeenCalledWith({
      ...input,
      message: `The workflow activity was inspected successfully.\n\n[Open workflow](/workflows/${workflowId}) · [Open run 12345678](/workflows/${workflowId}/runs/sentris-run-12345678-verified)`,
    });
  });

  test('stops a plan on an authoritative failed action and does not run later steps', async () => {
    const planActionId = '46464646-4646-4646-8646-464646464646';
    operatorLoadPlanActivity.mockResolvedValue({
      kind: 'operator-plan',
      planId: planActionId,
      title: 'Inspect and run a workflow',
      steps: [
        {
          id: 'inspect',
          label: 'Inspect workflow',
          commandName: 'get_workflow',
          arguments: { workflowId: '55555555-5555-4555-8555-555555555555' },
          effect: 'read',
        },
        {
          id: 'run',
          label: 'Run workflow',
          commandName: 'run_workflow',
          arguments: { workflowId: '55555555-5555-4555-8555-555555555555' },
          effect: 'consequential',
        },
        {
          id: 'list-runs',
          label: 'List runs',
          commandName: 'list_runs',
          arguments: { limit: 5 },
          effect: 'read',
        },
      ],
    });
    operatorPrepareActionActivity.mockImplementation(async ({ toolCallId }) => ({
      actionId: toolCallId,
      actionVersion: 0,
      actionStatus: 'approved',
      disposition: 'execute',
    }));
    operatorExecuteActionActivity
      .mockResolvedValueOnce({
        actionId: 'inspect-action',
        actionStatus: 'succeeded',
        result: { workflowId: '55555555-5555-4555-8555-555555555555' },
      })
      .mockResolvedValueOnce({
        actionId: 'run-action',
        actionStatus: 'failed',
        actionError: 'Required runtime input packageSpec was not provided.\nTry again.',
        result: { error: 'Required runtime input packageSpec was not provided.' },
      });

    await operatorTurnWorkflow({
      ...input,
      journey: { kind: 'execute_plan', planActionId },
    });

    expect(operatorPrepareActionActivity).toHaveBeenCalledTimes(2);
    expect(operatorExecuteActionActivity).toHaveBeenCalledTimes(2);
    expect(operatorModelStepActivity).not.toHaveBeenCalled();
    expect(operatorCompleteTurnActivity).toHaveBeenCalledWith({
      ...input,
      message:
        'Plan "Inspect and run a workflow" stopped at step 2 of 3 because "Run workflow" failed. Error: Required runtime input packageSpec was not provided. Try again. Earlier completed actions remain recorded; later steps were not run.',
    });
  });

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

  test('retains an early approval and releases the turn after launching a live-followed run', async () => {
    const actionId = '44444444-4444-4444-8444-444444444444';
    earlyDecision = { actionId, decision: 'approved', expectedVersion: 3 };
    operatorModelStepActivity.mockResolvedValueOnce({
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
    });
    operatorPrepareActionActivity.mockResolvedValue({
      actionId,
      actionVersion: 3,
      disposition: 'wait_for_approval',
    });
    operatorExecuteActionActivity.mockResolvedValue({
      actionId,
      actionStatus: 'succeeded',
      result: { accepted: true },
      launchedRunId: 'sentris-run-1',
    });
    await operatorTurnWorkflow(input);

    expect(operatorExecuteActionActivity).toHaveBeenCalledTimes(1);
    expect(operatorObserveRunActivity).not.toHaveBeenCalled();
    expect(operatorModelStepActivity).toHaveBeenCalledTimes(1);
    expect(operatorCompleteTurnActivity).toHaveBeenCalledWith({
      ...input,
      message: 'Workflow run started. Follow progress in the run card.',
    });
  });

  test('retains blocking run observation only for pre-patch histories', async () => {
    detachedRunFollowing = false;
    const actionId = '45454545-4545-4545-8545-454545454545';
    operatorModelStepActivity
      .mockResolvedValueOnce({
        text: '',
        finishReason: 'tool-calls',
        toolCalls: [
          {
            toolCallId: `${input.turnId}:0:0`,
            commandName: 'run_workflow',
            arguments: { workflowId: '55555555-5555-4555-8555-555555555555' },
          },
        ],
      })
      .mockResolvedValueOnce({ text: 'The run completed.', finishReason: 'stop', toolCalls: [] });
    operatorPrepareActionActivity.mockResolvedValue({
      actionId,
      actionVersion: 0,
      disposition: 'execute',
    });
    operatorExecuteActionActivity.mockResolvedValue({
      actionId,
      actionStatus: 'succeeded',
      result: { status: 'RUNNING' },
      launchedRunId: 'sentris-run-legacy',
    });
    operatorObserveRunActivity.mockResolvedValue({
      runId: 'sentris-run-legacy',
      workflowId: '55555555-5555-4555-8555-555555555555',
      status: 'COMPLETED',
      terminal: true,
    });

    await operatorTurnWorkflow(input);

    expect(operatorObserveRunActivity).toHaveBeenCalledWith({
      ...input,
      runId: 'sentris-run-legacy',
    });
  });

  test('durably applies, reruns, and compares one evidence-supported improvement', async () => {
    const workflowId = '55555555-5555-4555-8555-555555555555';
    const baseVersionId = '66666666-6666-4666-8666-666666666666';
    const candidateVersionId = '77777777-7777-4777-8777-777777777777';
    const draftId = '88888888-8888-4888-8888-888888888888';
    const sourceRunId = 'sentris-run-source';
    const candidateRunId = 'sentris-run-candidate';
    const getWorkflowCall = {
      toolCallId: `${input.turnId}:0:0`,
      commandName: 'get_workflow' as const,
      arguments: { workflowId, versionId: baseVersionId },
    };
    const proposalCall = {
      toolCallId: `${input.turnId}:1:0`,
      commandName: 'propose_workflow_edits' as const,
      arguments: {
        workflowId,
        baseVersionId,
        sourceRunId,
        operations: [
          { operation: 'patch_node', nodeId: 'agent', label: 'Clarify agent instructions' },
        ],
      },
    };
    operatorModelStepActivity
      .mockResolvedValueOnce({ text: '', finishReason: 'tool-calls', toolCalls: [getWorkflowCall] })
      .mockResolvedValueOnce({ text: '', finishReason: 'tool-calls', toolCalls: [proposalCall] })
      .mockResolvedValueOnce({
        text: 'The candidate passed the recorded criteria. You can run another revision if needed.',
        finishReason: 'stop',
        toolCalls: [],
      });
    operatorPrepareActionActivity.mockImplementation(async ({ toolCallId }) => ({
      actionId: toolCallId
        .replace(/[^a-f0-9]/gi, '')
        .padEnd(32, 'a')
        .slice(0, 32),
      actionVersion: 0,
      disposition: 'execute',
    }));
    operatorExecuteActionActivity
      .mockResolvedValueOnce({
        actionId: 'inspect',
        actionStatus: 'succeeded',
        result: { runId: sourceRunId },
      })
      .mockResolvedValueOnce({
        actionId: 'workflow',
        actionStatus: 'succeeded',
        result: { workflowId, versionId: baseVersionId },
      })
      .mockResolvedValueOnce({
        actionId: 'proposal',
        actionStatus: 'succeeded',
        result: {
          kind: 'workflow-draft',
          draftId,
          mode: 'update',
          workflowId,
          baseVersionId,
          sourceRunId,
          name: 'Improved workflow',
          digest: 'draft-digest',
          validation: { valid: true, errors: [] },
          diff: {
            metadataChanged: [],
            addedNodeIds: [],
            removedNodeIds: [],
            changedNodeIds: ['agent'],
            addedEdgeIds: [],
            removedEdgeIds: [],
            changedEdgeIds: [],
          },
        },
      })
      .mockResolvedValueOnce({
        actionId: 'apply',
        actionStatus: 'succeeded',
        result: {
          kind: 'workflow-applied',
          draftId,
          workflowId,
          versionId: candidateVersionId,
          version: 2,
          created: false,
          name: 'Improved workflow',
          sourceRunId,
        },
      })
      .mockResolvedValueOnce({
        actionId: 'run',
        actionStatus: 'succeeded',
        result: { status: 'RUNNING' },
        launchedRunId: candidateRunId,
      })
      .mockResolvedValueOnce({
        actionId: 'compare',
        actionStatus: 'succeeded',
        result: {
          kind: 'run-comparison',
          assessment: 'improved',
          comparable: true,
          source: {
            runId: sourceRunId,
            workflowId,
            workflowVersionId: baseVersionId,
            status: 'FAILED',
            durationMs: 1_000,
            trace: { availability: 'available', failedEventCount: 1 },
            findings: { availability: 'available', total: 0 },
          },
          candidate: {
            runId: candidateRunId,
            workflowId,
            workflowVersionId: candidateVersionId,
            status: 'COMPLETED',
            durationMs: 900,
            trace: { availability: 'available', failedEventCount: 0 },
            findings: { availability: 'available', total: 1 },
          },
          changes: {
            statusChanged: true,
            failedEventCountDelta: -1,
            findingTotalDelta: 1,
            durationDeltaMs: -100,
          },
          successCriteria: null,
          caveats: ['Finding totals and duration are observations only.'],
        },
      });
    operatorAwaitRunActivity.mockResolvedValue({
      runId: candidateRunId,
      workflowId,
      status: 'COMPLETED',
      terminal: true,
    });

    await operatorTurnWorkflow({
      ...input,
      journey: { kind: 'improve_run', sourceRunId },
    });

    expect(operatorAwaitRunActivity).toHaveBeenCalledWith({ ...input, runId: candidateRunId });
    expect(operatorPrepareActionActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        toolCallId: `${input.turnId}:journey:apply`,
        commandName: 'apply_workflow_draft',
        arguments: { draftId },
      }),
    );
    expect(operatorPrepareActionActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        toolCallId: `${input.turnId}:journey:compare`,
        commandName: 'compare_runs',
        arguments: { sourceRunId, candidateRunId },
      }),
    );
    expect(operatorModelStepActivity).toHaveBeenLastCalledWith(
      expect.objectContaining({
        mode: 'improve_run_summary',
        sourceRunId,
      }),
    );
    expect(operatorCompleteTurnActivity).toHaveBeenCalledWith({
      ...input,
      message:
        'The candidate passed the recorded criteria. You can run another revision if needed.',
    });
  });

  test('executes a user-confirmed direct run control without approval or model restatement', async () => {
    const actionId = '56565656-5656-4656-8656-565656565656';
    operatorPrepareActionActivity.mockResolvedValue({
      actionId,
      actionVersion: 0,
      disposition: 'execute',
    });
    operatorExecuteActionActivity.mockResolvedValue({
      actionId,
      actionStatus: 'succeeded',
      result: { cancelled: true },
    });
    await operatorTurnWorkflow({
      ...input,
      directCommand: {
        toolCallId: `${input.turnId}:direct`,
        commandName: 'cancel_run',
        arguments: { runId: 'sentris-run-direct' },
      },
    });

    expect(operatorPrepareActionActivity).toHaveBeenCalledWith({
      ...input,
      toolCallId: `${input.turnId}:direct`,
      commandName: 'cancel_run',
      arguments: { runId: 'sentris-run-direct' },
      userConfirmed: true,
    });
    expect(operatorExecuteActionActivity).toHaveBeenCalledTimes(1);
    expect(operatorModelStepActivity).not.toHaveBeenCalled();
    expect(operatorCompleteTurnActivity).toHaveBeenCalledWith({
      ...input,
      message: 'Cancellation requested. Follow the run card for its terminal status.',
    });
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
    operatorExecuteActionActivity.mockResolvedValue({
      actionId,
      actionStatus: 'succeeded',
      result: { cancelled: true },
    });

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

  test('preserves mutation deduplication for pre-compact turn histories', async () => {
    const actionId = '99999999-9999-4999-8999-999999999999';
    detachedRunFollowing = false;
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
      actionStatus: 'succeeded',
      result: { status: 'RUNNING' },
      launchedRunId: 'sentris-run-deduped',
    });
    operatorObserveRunActivity.mockResolvedValue({
      runId: 'sentris-run-deduped',
      workflowId: '55555555-5555-4555-8555-555555555555',
      status: 'COMPLETED',
      terminal: true,
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
      actionStatus: 'executing',
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
