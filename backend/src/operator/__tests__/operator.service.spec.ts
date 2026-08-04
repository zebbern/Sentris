import { ForbiddenException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'bun:test';

import type { OperatorDirectCommand, OperatorJourney, OperatorRouteContext } from '@sentris/shared';

import type { AuthContext } from '../../auth/types';
import type {
  OperatorActionRecord,
  OperatorSessionRecord,
  OperatorTurnRecord,
} from '../../database/schema';
import type { SecretsService } from '../../secrets/secrets.service';
import type { TemporalService } from '../../temporal/temporal.service';
import type { WorkflowsService } from '../../workflows/workflows.service';
import { WorkflowRuntimeInputValidationException } from '../../workflows/workflow-run.service';
import type { OperatorCommandService } from '../operator-command.service';
import type { OperatorRepository } from '../operator.repository';
import { OperatorService } from '../operator.service';
import type { OperatorWorkflowAuthoringService } from '../operator-workflow-authoring.service';

const SESSION_ID = '11111111-1111-4111-8111-111111111111';
const TURN_ID = '22222222-2222-4222-8222-222222222222';
const ACTION_ID = '33333333-3333-4333-8333-333333333333';
const SECRET_ID = '44444444-4444-4444-8444-444444444444';

const auth: AuthContext = {
  userId: 'operator-user',
  organizationId: 'operator-org',
  roles: ['MEMBER'],
  isAuthenticated: true,
  provider: 'local',
};

function sessionRecord(approvalMode: 'ask' | 'auto' = 'ask'): OperatorSessionRecord {
  return {
    id: SESSION_ID,
    organizationId: 'operator-org',
    userId: 'operator-user',
    title: 'Session',
    approvalMode,
    status: 'active',
    modelProvider: 'gemini',
    modelId: 'gemini-3.5-flash',
    apiKeySecretId: SECRET_ID,
    baseUrl: null,
    createdAt: new Date('2026-08-02T10:00:00Z'),
    updatedAt: new Date('2026-08-02T10:00:00Z'),
  };
}

function turnRecord(overrides: Partial<OperatorTurnRecord> = {}): OperatorTurnRecord {
  return {
    id: TURN_ID,
    sessionId: SESSION_ID,
    actorRoles: ['MEMBER'],
    status: 'running',
    temporalWorkflowId: 'operator-turn:session:turn',
    temporalRunId: 'temporal-run',
    context: null,
    error: null,
    createdAt: new Date('2026-08-02T10:01:00Z'),
    startedAt: new Date('2026-08-02T10:01:01Z'),
    completedAt: null,
    ...overrides,
  };
}

function actionRecord(
  approvalMode: 'ask' | 'auto',
  status: OperatorActionRecord['status'],
): OperatorActionRecord {
  return {
    id: ACTION_ID,
    sessionId: SESSION_ID,
    turnId: TURN_ID,
    toolCallId: 'tool-1',
    commandName: 'cancel_run',
    effect: 'consequential',
    approvalMode,
    approvalRequired: approvalMode === 'ask',
    status,
    version: 0,
    arguments: { runId: 'sentris-run-1' },
    result: null,
    error: null,
    runId: null,
    decidedBy: null,
    createdAt: new Date('2026-08-02T10:02:00Z'),
    decidedAt: null,
    startedAt:
      status === 'executing' || status === 'succeeded' ? new Date('2026-08-02T10:02:01Z') : null,
    completedAt: null,
  };
}

describe('OperatorService', () => {
  let repository: Record<string, ReturnType<typeof vi.fn>>;
  let commands: Record<string, ReturnType<typeof vi.fn>>;
  let secrets: Record<string, ReturnType<typeof vi.fn>>;
  let temporal: Record<string, ReturnType<typeof vi.fn>>;
  let workflows: Record<string, ReturnType<typeof vi.fn>>;
  let workflowAuthoring: Record<string, ReturnType<typeof vi.fn>>;
  let service: OperatorService;

  beforeEach(() => {
    repository = {
      createSession: vi.fn().mockResolvedValue(sessionRecord()),
      findSession: vi.fn().mockResolvedValue(sessionRecord()),
      createTurn: vi
        .fn()
        .mockImplementation(
          async (input: {
            context?: OperatorRouteContext;
            directCommand?: OperatorDirectCommand;
            journey?: OperatorJourney;
          }) => ({
            turn: turnRecord({
              status: 'queued',
              temporalWorkflowId: null,
              temporalRunId: null,
              context: {
                version: 1,
                routeContext: input.context ?? null,
                directCommand: input.directCommand ?? null,
                journey: input.journey ?? null,
              },
              startedAt: null,
            }),
            created: true,
          }),
        ),
      listTurns: vi.fn().mockResolvedValue([]),
      listMessages: vi.fn().mockResolvedValue([]),
      listActions: vi.fn().mockResolvedValue([]),
      findLatestRunImprovement: vi.fn().mockResolvedValue(null),
      attachTemporal: vi.fn().mockResolvedValue(undefined),
      getTurnWithSession: vi
        .fn()
        .mockResolvedValue({ turn: turnRecord(), session: sessionRecord() }),
      createAction: vi.fn(),
      decideAction: vi.fn(),
      getActionWithTurnSession: vi.fn(),
      recordRunObservation: vi.fn(),
      markActionExecuting: vi.fn(),
      setTurnStatus: vi.fn(),
      completeAction: vi.fn(),
      failAction: vi.fn(),
      failTurn: vi.fn(),
      cancelTurn: vi.fn(),
      settleMcpAction: vi.fn(),
    };
    commands = { execute: vi.fn() };
    secrets = { getSecret: vi.fn().mockResolvedValue({ id: SECRET_ID }) };
    temporal = {
      executeWorkflowUpdate: vi.fn().mockResolvedValue(undefined),
      describeWorkflow: vi.fn(),
      startWorkflow: vi.fn().mockResolvedValue({
        workflowId: `operator-turn:${SESSION_ID}:${TURN_ID}`,
        runId: 'temporal-operator-run',
      }),
      cancelWorkflow: vi.fn().mockResolvedValue(undefined),
    };
    workflows = {
      getRun: vi.fn(),
      getRunStatus: vi.fn(),
      getRunResult: vi.fn(),
    };
    workflowAuthoring = { listDraftDetails: vi.fn().mockResolvedValue([]) };
    service = new OperatorService(
      repository as unknown as OperatorRepository,
      commands as unknown as OperatorCommandService,
      workflows as unknown as WorkflowsService,
      secrets as unknown as SecretsService,
      temporal as unknown as TemporalService,
      workflowAuthoring as unknown as OperatorWorkflowAuthoringService,
    );
  });

  it('loads a succeeded immutable plan only from the executing session', async () => {
    const plan = {
      kind: 'operator-plan' as const,
      planId: ACTION_ID,
      title: 'Review and triage',
      steps: [
        {
          id: 'inspect-run',
          label: 'Inspect run',
          commandName: 'get_run' as const,
          arguments: { runId: 'sentris-run-source' },
          effect: 'read' as const,
        },
        {
          id: 'inspect-finding',
          label: 'Inspect finding',
          commandName: 'get_finding' as const,
          arguments: { findingId: 'finding-1' },
          effect: 'read' as const,
        },
        {
          id: 'triage-finding',
          label: 'Triage finding',
          commandName: 'update_finding_triage' as const,
          arguments: { findingId: 'finding-1', status: 'triaged' },
          effect: 'execute' as const,
        },
      ],
    };
    repository.getActionWithTurnSession.mockResolvedValue({
      action: {
        ...actionRecord('ask', 'succeeded'),
        commandName: 'propose_operator_plan',
        effect: 'execute',
        approvalRequired: false,
        result: plan,
      },
      turn: turnRecord(),
      session: sessionRecord(),
    });

    await expect(service.getInternalPlan(TURN_ID, ACTION_ID, 'operator-org')).resolves.toEqual(
      plan,
    );
  });

  it('requests cancellation of the exact owned durable turn', async () => {
    await service.cancelTurn(auth, TURN_ID);

    expect(temporal.cancelWorkflow).toHaveBeenCalledWith({
      workflowId: 'operator-turn:session:turn',
      runId: 'temporal-run',
    });
    expect(repository.cancelTurn).not.toHaveBeenCalled();
  });

  it('returns the latest user-owned Operator improvement reference for a source run', async () => {
    repository.findLatestRunImprovement.mockResolvedValue({
      turn: turnRecord({ createdAt: new Date('2026-08-03T08:15:00Z') }),
      session: sessionRecord(),
    });

    await expect(service.getRunImprovement(auth, 'sentris-run-source')).resolves.toEqual({
      improvement: {
        sourceRunId: 'sentris-run-source',
        sessionId: SESSION_ID,
        turnId: TURN_ID,
        createdAt: '2026-08-03T08:15:00.000Z',
      },
    });
    expect(repository.findLatestRunImprovement).toHaveBeenCalledWith({
      organizationId: 'operator-org',
      userId: 'operator-user',
      sourceRunId: 'sentris-run-source',
    });
  });

  it('rejects API-key and internal actors before touching session state', async () => {
    for (const provider of ['api-key', 'internal']) {
      await expect(
        service.createSession(
          { ...auth, provider },
          {
            approvalMode: 'ask',
            model: {
              provider: 'gemini',
              modelId: 'gemini-3.5-flash',
              apiKeySecretId: SECRET_ID,
            },
          },
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
    }
    expect(secrets.getSecret).not.toHaveBeenCalled();
    expect(repository.createSession).not.toHaveBeenCalled();
  });

  it('validates the stored credential in the authenticated organization before creating', async () => {
    await service.createSession(auth, {
      approvalMode: 'ask',
      model: {
        provider: 'gemini',
        modelId: 'gemini-3.5-flash',
        apiKeySecretId: SECRET_ID,
      },
    });

    expect(secrets.getSecret).toHaveBeenCalledWith(auth, SECRET_ID);
    expect(repository.createSession).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: 'operator-org',
        userId: 'operator-user',
        auth,
      }),
    );
  });

  it('keeps legacy route-only turn rows readable in the public session projection', async () => {
    const legacyContext = {
      path: '/workflows/55555555-5555-4555-8555-555555555555',
      workflowId: '55555555-5555-4555-8555-555555555555',
    };
    repository.listTurns.mockResolvedValueOnce([turnRecord({ context: legacyContext })]);

    const result = await service.getSession(auth, SESSION_ID);

    expect(result.turns[0]?.context).toEqual(legacyContext);
  });

  it('exposes the persisted journey in the public session projection', async () => {
    const journey = { kind: 'improve_run', sourceRunId: 'sentris-run-source' } as const;
    repository.listTurns.mockResolvedValueOnce([
      turnRecord({
        context: {
          version: 2,
          routeContext: { path: '/runs/sentris-run-source' },
          directCommand: null,
          journey,
        },
      }),
    ]);

    const result = await service.getSession(auth, SESSION_ID);

    expect(result.turns[0]?.journey).toEqual(journey);
  });

  it('unlocks a session whose approved action belongs to an already-closed durable turn', async () => {
    const staleTurn = turnRecord({ status: 'awaiting_approval' });
    const failedTurn = turnRecord({
      status: 'failed',
      error: 'Operator durable turn closed as COMPLETED before the approved action could execute.',
      completedAt: new Date('2026-08-02T10:03:01Z'),
    });
    const approved = { ...actionRecord('ask', 'approved'), version: 1 };
    const failedAction = {
      ...approved,
      status: 'failed' as const,
      error: failedTurn.error,
      completedAt: failedTurn.completedAt,
    };
    repository.listTurns.mockResolvedValueOnce([staleTurn]).mockResolvedValueOnce([failedTurn]);
    repository.listActions.mockResolvedValueOnce([approved]).mockResolvedValueOnce([failedAction]);
    repository.listMessages.mockResolvedValue([]);
    temporal.describeWorkflow.mockResolvedValue({
      workflowId: staleTurn.temporalWorkflowId,
      runId: staleTurn.temporalRunId,
      status: 'COMPLETED',
      startTime: '2026-08-02T10:01:00.000Z',
      closeTime: '2026-08-02T10:03:00.000Z',
      historyLength: 42,
      taskQueue: 'sentris-default',
    });

    const result = await service.getSession(auth, SESSION_ID);

    expect(repository.failTurn).toHaveBeenCalledWith({
      turn: staleTurn,
      session: sessionRecord(),
      error: 'Operator durable turn closed as COMPLETED before the approved action could execute.',
      auth,
    });
    expect(result.turns[0]?.status).toBe('failed');
    expect(result.actions[0]?.status).toBe('failed');
  });

  it('places a structured direct command in the durable turn input', async () => {
    await service.createTurn(auth, SESSION_ID, {
      clientTurnId: TURN_ID,
      message: 'Cancel this run',
      directCommand: {
        commandName: 'cancel_run',
        arguments: { runId: 'sentris-run-1' },
      },
    });

    expect(temporal.startWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({
        workflowType: 'operatorTurnWorkflow',
        workflowId: `operator-turn:${SESSION_ID}:${TURN_ID}`,
        args: [
          {
            sessionId: SESSION_ID,
            turnId: TURN_ID,
            organizationId: 'operator-org',
            directCommand: {
              toolCallId: `${TURN_ID}:direct`,
              commandName: 'cancel_run',
              arguments: { runId: 'sentris-run-1' },
            },
          },
        ],
      }),
    );
    expect(repository.createTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        directCommand: {
          commandName: 'cancel_run',
          arguments: { runId: 'sentris-run-1' },
        },
      }),
    );
  });

  it('places an improve-run journey in the durable turn input', async () => {
    await service.createTurn(auth, SESSION_ID, {
      clientTurnId: TURN_ID,
      message: 'Improve this run and compare the candidate',
      journey: { kind: 'improve_run', sourceRunId: 'sentris-run-source' },
    });

    expect(repository.createTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        journey: { kind: 'improve_run', sourceRunId: 'sentris-run-source' },
      }),
    );
    expect(temporal.startWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({
        args: [
          expect.objectContaining({
            journey: { kind: 'improve_run', sourceRunId: 'sentris-run-source' },
          }),
        ],
      }),
    );
  });

  it('starts Temporal from the persisted direct command instead of retry request data', async () => {
    repository.createTurn.mockResolvedValueOnce({
      turn: turnRecord({
        status: 'queued',
        temporalWorkflowId: null,
        temporalRunId: null,
        context: {
          version: 1,
          routeContext: null,
          directCommand: {
            commandName: 'cancel_run',
            arguments: { runId: 'sentris-run-stored' },
          },
        },
        startedAt: null,
      }),
      created: false,
    });

    await service.createTurn(auth, SESSION_ID, {
      clientTurnId: TURN_ID,
      message: 'Inspect this run',
      directCommand: {
        commandName: 'get_run',
        arguments: { runId: 'sentris-run-request' },
      },
    });

    expect(temporal.startWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({
        args: [
          expect.objectContaining({
            directCommand: {
              toolCallId: `${TURN_ID}:direct`,
              commandName: 'cancel_run',
              arguments: { runId: 'sentris-run-stored' },
            },
          }),
        ],
      }),
    );
  });

  it.each([
    ['ask', true, 'pending_approval', 'wait_for_approval'],
    ['auto', false, 'approved', 'execute'],
  ] as const)(
    'applies %s mode to consequential commands',
    async (approvalMode, approvalRequired, status, disposition) => {
      const session = sessionRecord(approvalMode);
      repository.getTurnWithSession.mockResolvedValue({ turn: turnRecord(), session });
      repository.createAction.mockImplementation(async (input: { approvalRequired: boolean }) => ({
        action: actionRecord(
          approvalMode,
          input.approvalRequired ? 'pending_approval' : 'approved',
        ),
        created: true,
      }));

      const result = await service.prepareInternalAction({
        turnId: TURN_ID,
        organizationId: 'operator-org',
        toolCallId: 'tool-1',
        commandName: 'cancel_run',
        arguments: { runId: 'sentris-run-1' },
      });

      expect(repository.createAction).toHaveBeenCalledWith(
        expect.objectContaining({ approvalMode, approvalRequired }),
      );
      expect(result.action.status).toBe(status);
      expect(result.disposition).toBe(disposition);
    },
  );

  it('treats a structured run-control click as the user confirmation', async () => {
    const session = sessionRecord('ask');
    repository.getTurnWithSession.mockResolvedValue({ turn: turnRecord(), session });
    repository.createAction.mockImplementation(async (input: { approvalRequired: boolean }) => ({
      action: actionRecord('ask', input.approvalRequired ? 'pending_approval' : 'approved'),
      created: true,
    }));

    const result = await service.prepareInternalAction({
      turnId: TURN_ID,
      organizationId: 'operator-org',
      toolCallId: 'direct-cancel',
      commandName: 'cancel_run',
      arguments: { runId: 'sentris-run-1' },
      userConfirmed: true,
    });

    expect(repository.createAction).toHaveBeenCalledWith(
      expect.objectContaining({ approvalRequired: false }),
    );
    expect(result.disposition).toBe('execute');
  });

  it('persists invalid model arguments as a failed action for the next model step', async () => {
    repository.createAction.mockImplementation(
      async (input: { arguments: Record<string, unknown>; validationError?: string }) => ({
        action: {
          ...actionRecord('ask', 'failed'),
          commandName: 'run_workflow',
          effect: 'execute',
          approvalRequired: false,
          arguments: input.arguments,
          error: input.validationError ?? null,
          completedAt: new Date('2026-08-02T10:02:01Z'),
        },
        created: true,
      }),
    );

    const result = await service.prepareInternalAction({
      turnId: TURN_ID,
      organizationId: 'operator-org',
      toolCallId: 'invalid-tool-1',
      commandName: 'run_workflow',
      arguments: { inputs: 'not-an-object' },
    });

    expect(repository.createAction).toHaveBeenCalledWith(
      expect.objectContaining({
        toolCallId: 'invalid-tool-1',
        approvalRequired: false,
        arguments: { inputs: 'not-an-object' },
        validationError: expect.stringContaining('Invalid arguments for run_workflow'),
      }),
    );
    expect(result.disposition).toBe('rejected');
    expect(result.action.status).toBe('failed');
    expect(result.action.error).toContain('Invalid arguments for run_workflow');
  });

  it('reuses an already completed equivalent mutation instead of executing it again', async () => {
    repository.createAction.mockResolvedValue({
      action: actionRecord('ask', 'succeeded'),
      created: false,
    });

    const result = await service.prepareInternalAction({
      turnId: TURN_ID,
      organizationId: 'operator-org',
      toolCallId: 'tool-repeat',
      commandName: 'cancel_run',
      arguments: { runId: 'sentris-run-1' },
    });

    expect(result.disposition).toBe('already_completed');
    expect(result.action.id).toBe(ACTION_ID);
  });

  it('executes commands with the ADMIN authority persisted on the durable turn', async () => {
    const turn = turnRecord({ actorRoles: ['ADMIN', 'MEMBER'] });
    const approved = {
      ...actionRecord('auto', 'approved'),
      commandName: 'apply_workflow_draft' as const,
      arguments: { draftId: '55555555-5555-4555-8555-555555555555' },
    };
    const executing = { ...approved, status: 'executing' as const };
    repository.getActionWithTurnSession.mockResolvedValue({
      action: approved,
      turn,
      session: sessionRecord('auto'),
    });
    repository.markActionExecuting.mockResolvedValue(executing);
    commands.execute.mockResolvedValue({ result: { applied: true } });
    repository.completeAction.mockResolvedValue({
      ...executing,
      status: 'succeeded',
      result: { applied: true },
    });

    await service.executeInternalAction(ACTION_ID, 'operator-org');

    expect(commands.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        commandName: 'apply_workflow_draft',
        auth: {
          userId: 'operator-user',
          organizationId: 'operator-org',
          roles: ['ADMIN', 'MEMBER'],
          isAuthenticated: true,
          provider: 'operator',
        },
      }),
    );
  });

  it('signals the exact turn with the pre-decision version expected by the workflow', async () => {
    const approved = { ...actionRecord('ask', 'approved'), version: 1 };
    repository.decideAction.mockResolvedValue(approved);
    repository.getActionWithTurnSession.mockResolvedValue({
      action: approved,
      turn: turnRecord(),
      session: sessionRecord(),
    });

    const result = await service.decideAction(auth, ACTION_ID, {
      decision: 'approved',
      expectedVersion: 0,
    });

    expect(temporal.executeWorkflowUpdate).toHaveBeenCalledWith({
      workflowId: 'operator-turn:session:turn',
      temporalRunId: 'temporal-run',
      updateName: 'operatorActionDecision',
      updateId: `operator-decision:${ACTION_ID}:1`,
      args: { actionId: ACTION_ID, decision: 'approved', expectedVersion: 0 },
    });
    expect(result.status).toBe('approved');
  });

  it('reconciles a stale approval when the durable turn is already closed', async () => {
    const approved = { ...actionRecord('ask', 'approved'), version: 1 };
    const context = {
      action: approved,
      turn: turnRecord(),
      session: sessionRecord(),
    };
    repository.decideAction.mockResolvedValue(approved);
    repository.getActionWithTurnSession.mockResolvedValue(context);
    temporal.executeWorkflowUpdate.mockRejectedValue(
      new Error('workflow execution already completed'),
    );
    temporal.describeWorkflow.mockResolvedValue({
      workflowId: context.turn.temporalWorkflowId,
      runId: context.turn.temporalRunId,
      status: 'COMPLETED',
      startTime: '2026-08-02T10:01:00.000Z',
      closeTime: '2026-08-02T10:03:00.000Z',
      historyLength: 42,
      taskQueue: 'sentris-default',
    });

    await expect(
      service.decideAction(auth, ACTION_ID, {
        decision: 'approved',
        expectedVersion: 0,
      }),
    ).rejects.toThrow('Operator turn is no longer running');

    expect(repository.failTurn).toHaveBeenCalledWith({
      turn: context.turn,
      session: context.session,
      error: 'Operator durable turn closed as COMPLETED before the approval could be applied.',
      auth,
    });
  });

  it('persists a terminal launched-run observation for durable reloads', async () => {
    workflows.getRun.mockResolvedValue({
      runId: 'sentris-run-1',
      workflowId: '55555555-5555-4555-8555-555555555555',
      temporalRunId: 'temporal-child-run',
    });
    workflows.getRunStatus.mockResolvedValue({ status: 'COMPLETED' });
    workflows.getRunResult.mockResolvedValue({ findings: 5 });
    repository.recordRunObservation.mockResolvedValue(actionRecord('ask', 'succeeded'));

    const result = await service.observeInternalRun({
      runId: 'sentris-run-1',
      turnId: TURN_ID,
      organizationId: 'operator-org',
    });

    expect(result).toEqual({
      runId: 'sentris-run-1',
      workflowId: '55555555-5555-4555-8555-555555555555',
      status: 'COMPLETED',
      terminal: true,
      result: { findings: 5 },
    });
    expect(repository.recordRunObservation).toHaveBeenCalledWith({
      turnId: TURN_ID,
      runId: 'sentris-run-1',
      observation: result,
    });
  });

  it('keeps a deferred MCP action executing until the durable result is settled', async () => {
    const executing = {
      ...actionRecord('ask', 'executing'),
      commandName: 'invoke_mcp_tool' as const,
      arguments: {
        capabilitySnapshotId: '55555555-5555-4555-8555-555555555555',
        sourceId: 'server-1',
        name: 'search',
        arguments: {},
      },
    };
    repository.getActionWithTurnSession.mockResolvedValue({
      action: executing,
      turn: turnRecord(),
      session: sessionRecord(),
    });
    repository.markActionExecuting.mockResolvedValue(executing);
    const request = {
      invocationId: ACTION_ID,
      scope: {
        kind: 'operator' as const,
        organizationId: 'operator-org',
        sessionId: SESSION_ID,
        turnId: TURN_ID,
        capabilityGrantId: '66666666-6666-4666-8666-666666666666',
        expiresAt: '2099-08-02T11:00:00.000Z',
      },
      capabilitySnapshotId: '55555555-5555-4555-8555-555555555555',
      sourceId: 'server-1',
      authorizationTarget: 'search',
      operation: { kind: 'tool-call' as const, name: 'search', arguments: {} },
      requestedAt: '2099-08-02T10:00:00.000Z',
      deadlineAt: '2099-08-02T10:10:00.000Z',
    };
    commands.execute.mockResolvedValue({
      result: { kind: 'mcp-operation', state: 'ready_for_dispatch' },
      mcpOperationRequest: request,
    });

    const result = await service.executeInternalAction(ACTION_ID, 'operator-org');

    expect(result.mcpOperationRequest).toEqual(request);
    expect(result.action.status).toBe('executing');
    expect(repository.completeAction).not.toHaveBeenCalled();
  });

  it('returns runtime-input preflight failures to the model without failing the turn', async () => {
    const executing = {
      ...actionRecord('ask', 'executing'),
      commandName: 'run_workflow' as const,
      effect: 'execute' as const,
      approvalRequired: false,
      arguments: {
        workflowId: '55555555-5555-4555-8555-555555555555',
        inputs: {},
      },
    };
    const validationError = new WorkflowRuntimeInputValidationException({
      valid: false,
      issues: [
        {
          code: 'missing_required',
          inputId: 'packageSpec',
          label: 'npm package and optional version',
          expectedType: 'text',
          message:
            'Required workflow runtime input "npm package and optional version" (packageSpec) was not provided',
        },
      ],
      expectedInputs: [
        {
          id: 'packageSpec',
          label: 'npm package and optional version',
          type: 'text',
          required: true,
          hasDefaultValue: false,
        },
      ],
      receivedInputIds: [],
    });
    const failed = {
      ...executing,
      status: 'failed' as const,
      error: validationError.message,
      completedAt: new Date('2026-08-02T10:02:02Z'),
    };
    repository.getActionWithTurnSession
      .mockResolvedValueOnce({
        action: executing,
        turn: turnRecord(),
        session: sessionRecord(),
      })
      .mockResolvedValueOnce({
        action: failed,
        turn: turnRecord(),
        session: sessionRecord(),
      });
    repository.markActionExecuting.mockResolvedValue(executing);
    repository.failAction.mockResolvedValue(failed);
    commands.execute.mockRejectedValue(validationError);

    const result = await service.executeInternalAction(ACTION_ID, 'operator-org');

    expect(repository.failAction).toHaveBeenCalledWith(
      expect.objectContaining({
        actionId: ACTION_ID,
        error: expect.stringContaining('packageSpec'),
      }),
    );
    expect(result.action.status).toBe('failed');
    expect(result.result).toEqual({ error: expect.stringContaining('packageSpec') });

    const replayed = await service.executeInternalAction(ACTION_ID, 'operator-org');
    expect(replayed.action.status).toBe('failed');
    expect(commands.execute).toHaveBeenCalledTimes(1);
  });

  it('settles an MCP action through the idempotent repository transition', async () => {
    const executing = {
      ...actionRecord('ask', 'executing'),
      commandName: 'invoke_mcp_tool' as const,
    };
    const completed = { ...executing, status: 'succeeded' as const };
    repository.getActionWithTurnSession.mockResolvedValue({
      action: executing,
      turn: turnRecord(),
      session: sessionRecord(),
    });
    repository.settleMcpAction.mockResolvedValue(completed);
    const mcpResult = {
      operationId: ACTION_ID,
      kind: 'completed' as const,
      output: { matches: 2 },
      completedAt: '2026-08-02T10:03:00.000Z',
    };

    const result = await service.settleInternalMcpAction({
      actionId: ACTION_ID,
      organizationId: 'operator-org',
      result: mcpResult,
    });

    expect(repository.settleMcpAction).toHaveBeenCalledWith(
      expect.objectContaining({ actionId: ACTION_ID, result: mcpResult }),
    );
    expect(result.status).toBe('succeeded');
  });
});
