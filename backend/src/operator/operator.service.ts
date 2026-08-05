import { createHash } from 'node:crypto';
import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import {
  OPERATOR_COMMAND_DEFINITIONS,
  OperatorPlanProposalResultSchema,
  TERMINAL_STATUSES,
  type McpOperationInvocationRequest,
  type McpOperationResult,
  type OperatorActionDecision,
  type OperatorActionView,
  type OperatorCommandName,
  type OperatorCreateSession,
  type OperatorCreateTurn,
  type OperatorMessageView,
  type OperatorModelContext,
  type OperatorPreparedAction,
  type OperatorPlanProposalResult,
  type OperatorRunObservation,
  type OperatorRunImprovementLookup,
  type OperatorRetryTurn,
  type OperatorSessionDetail,
  type OperatorSessionSummary,
  type OperatorTurnAccepted,
  type OperatorTurnStatus,
  type OperatorTurnView,
  type OperatorUpdateSession,
  type OperatorWorkflowDraftDetail,
} from '@sentris/shared';

import type { AuthContext } from '../auth/types';
import type {
  OperatorActionRecord,
  OperatorMessageRecord,
  OperatorSessionRecord,
  OperatorTurnRecord,
} from '../database/schema';
import { SecretsService } from '../secrets/secrets.service';
import { TemporalService } from '../temporal/temporal.service';
import { WorkflowRuntimeInputValidationException } from '../workflows/workflow-run.service';
import { WorkflowsService } from '../workflows/workflows.service';
import { boundOperatorCommandResult, OperatorCommandService } from './operator-command.service';
import { OperatorRepository } from './operator.repository';
import { readOperatorTurnPayload } from './operator-turn-payload';
import { OperatorWorkflowAuthoringService } from './operator-workflow-authoring.service';

const OPERATOR_WORKFLOW_TYPE = 'operatorTurnWorkflow';
const DEFAULT_SESSION_TITLE = 'New Operator session';

@Injectable()
export class OperatorService {
  /** Per-backend-process throttle; Postgres and Temporal remain the canonical state owners. */
  private readonly decisionReconciliationChecks = new Map<string, number>();

  constructor(
    private readonly repository: OperatorRepository,
    private readonly commandService: OperatorCommandService,
    private readonly workflowsService: WorkflowsService,
    private readonly secretsService: SecretsService,
    private readonly temporalService: TemporalService,
    private readonly workflowAuthoringService: OperatorWorkflowAuthoringService,
  ) {}

  async createSession(
    auth: AuthContext | null,
    input: OperatorCreateSession,
  ): Promise<OperatorSessionSummary> {
    const user = this.requireUserAuth(auth);
    await this.secretsService.getSecret(user, input.model.apiKeySecretId);
    const session = await this.repository.createSession({
      organizationId: user.organizationId,
      userId: user.userId,
      approvalMode: input.approvalMode,
      model: input.model,
      auth: user,
    });
    return this.toSessionSummary(session, null, []);
  }

  async listSessions(auth: AuthContext | null): Promise<OperatorSessionSummary[]> {
    const user = this.requireUserAuth(auth);
    const sessions = await this.repository.listSessions({
      organizationId: user.organizationId,
      userId: user.userId,
    });
    const latestTurns = await this.repository.listLatestTurns(
      sessions.map((session) => session.id),
    );
    const latestTurnActions = await this.repository.listActionsForTurns(
      latestTurns.map((turn) => turn.id),
    );
    const latestTurnBySessionId = new Map(latestTurns.map((turn) => [turn.sessionId, turn]));
    const actionsByTurnId = new Map<string, OperatorActionRecord[]>();
    for (const action of latestTurnActions) {
      const turnActions = actionsByTurnId.get(action.turnId) ?? [];
      turnActions.push(action);
      actionsByTurnId.set(action.turnId, turnActions);
    }
    return sessions.map((session) => {
      const latestTurn = latestTurnBySessionId.get(session.id) ?? null;
      return this.toSessionSummary(
        session,
        latestTurn,
        latestTurn ? (actionsByTurnId.get(latestTurn.id) ?? []) : [],
      );
    });
  }

  async getRunImprovement(
    auth: AuthContext | null,
    sourceRunId: string,
  ): Promise<OperatorRunImprovementLookup> {
    const user = this.requireUserAuth(auth);
    const match = await this.repository.findLatestRunImprovement({
      organizationId: user.organizationId,
      userId: user.userId,
      sourceRunId,
    });
    return {
      improvement: match
        ? {
            sourceRunId,
            sessionId: match.session.id,
            turnId: match.turn.id,
            createdAt: match.turn.createdAt.toISOString(),
          }
        : null,
    };
  }

  async getSession(auth: AuthContext | null, sessionId: string): Promise<OperatorSessionDetail> {
    const user = this.requireUserAuth(auth);
    const session = await this.requireOwnedSession(sessionId, user);
    let [turns, messages, actions] = await Promise.all([
      this.repository.listTurns(session.id),
      this.repository.listMessages(session.id),
      this.repository.listActions(session.id),
    ]);
    if (await this.reconcileStaleApprovedAction(session, turns, actions, user)) {
      [turns, messages, actions] = await Promise.all([
        this.repository.listTurns(session.id),
        this.repository.listMessages(session.id),
        this.repository.listActions(session.id),
      ]);
    }
    const latestTurn = turns.at(-1) ?? null;
    return {
      ...this.toSessionSummary(
        session,
        latestTurn,
        latestTurn ? actions.filter((action) => action.turnId === latestTurn.id) : [],
      ),
      turns: turns.map((turn) => this.toTurnView(turn)),
      messages: messages.map((message) => this.toMessageView(message)),
      actions: actions.map((action) => this.toActionView(action)),
    };
  }

  async listWorkflowDrafts(
    auth: AuthContext | null,
    sessionId: string,
  ): Promise<OperatorWorkflowDraftDetail[]> {
    const user = this.requireUserAuth(auth);
    const session = await this.requireOwnedSession(sessionId, user);
    const actions = await this.repository.listActions(session.id);
    return this.workflowAuthoringService.listDraftDetails(actions, user);
  }

  async updateSession(
    auth: AuthContext | null,
    sessionId: string,
    input: OperatorUpdateSession,
  ): Promise<OperatorSessionSummary> {
    const user = this.requireUserAuth(auth);
    if (input.model) {
      await this.secretsService.getSecret(user, input.model.apiKeySecretId);
    }
    const updated = await this.repository.updateSession({
      sessionId,
      owner: { organizationId: user.organizationId, userId: user.userId },
      values: input,
      auth: user,
    });
    if (!updated) throw new NotFoundException('Operator session not found');
    const latestTurn = await this.repository.findLatestTurn(updated.id);
    const latestTurnActions = latestTurn
      ? await this.repository.listActionsForTurns([latestTurn.id])
      : [];
    return this.toSessionSummary(updated, latestTurn ?? null, latestTurnActions);
  }

  async deleteSession(auth: AuthContext | null, sessionId: string): Promise<void> {
    const user = this.requireUserAuth(auth);
    const deleted = await this.repository.deleteSession({
      sessionId,
      owner: { organizationId: user.organizationId, userId: user.userId },
      auth: user,
    });
    if (!deleted) throw new NotFoundException('Operator session not found');
  }

  async createTurn(
    auth: AuthContext | null,
    sessionId: string,
    input: OperatorCreateTurn,
  ): Promise<OperatorTurnAccepted> {
    const user = this.requireUserAuth(auth);
    const session = await this.requireOwnedSession(sessionId, user);
    return this.createTurnForSession(session, input, user, true);
  }

  async decideAction(
    auth: AuthContext | null,
    actionId: string,
    input: OperatorActionDecision,
  ): Promise<OperatorActionView> {
    const user = this.requireUserAuth(auth);
    const action = await this.repository.decideAction({
      actionId,
      owner: { organizationId: user.organizationId, userId: user.userId },
      expectedVersion: input.expectedVersion,
      decision: input.decision,
      ...(input.response ? { response: input.response } : {}),
      auth: user,
    });
    const context = await this.repository.getActionWithTurnSession(action.id);
    if (!context?.turn.temporalWorkflowId) {
      throw new ConflictException('Operator turn has not started');
    }
    try {
      await this.temporalService.executeWorkflowUpdate({
        workflowId: context.turn.temporalWorkflowId,
        temporalRunId: context.turn.temporalRunId ?? undefined,
        updateName: 'operatorActionDecision',
        updateId: `operator-decision:${action.id}:${action.version}`,
        args: {
          actionId: action.id,
          decision: input.decision,
          expectedVersion: input.expectedVersion,
        },
      });
    } catch (error: unknown) {
      const described = await this.temporalService.describeWorkflow({
        workflowId: context.turn.temporalWorkflowId,
        runId: context.turn.temporalRunId ?? undefined,
      });
      if (described.status === 'RUNNING') throw error;
      const reconciliationError = `Operator durable turn closed as ${described.status} before the approval could be applied.`;
      await this.repository.failTurn({
        turn: context.turn,
        session: context.session,
        error: reconciliationError,
        auth: user,
      });
      throw new ConflictException('Operator turn is no longer running; start a new turn');
    }
    return this.toActionView(action);
  }

  async cancelTurn(auth: AuthContext | null, turnId: string): Promise<OperatorTurnView> {
    const user = this.requireUserAuth(auth);
    const context = await this.repository.getTurnWithSession(turnId);
    if (
      !context ||
      context.session.organizationId !== user.organizationId ||
      context.session.userId !== user.userId
    ) {
      throw new NotFoundException('Operator turn not found');
    }
    if (['completed', 'failed', 'cancelled'].includes(context.turn.status)) {
      return this.toTurnView(context.turn);
    }
    if (!context.turn.temporalWorkflowId) {
      await this.repository.cancelTurn({
        ...context,
        message: 'Operator turn stopped. Completed actions remain recorded.',
        auth: user,
      });
      return this.toTurnView({ ...context.turn, status: 'cancelled' });
    }

    try {
      await this.temporalService.cancelWorkflow({
        workflowId: context.turn.temporalWorkflowId,
        ...(context.turn.temporalRunId ? { runId: context.turn.temporalRunId } : {}),
      });
    } catch (error: unknown) {
      const described = await this.temporalService.describeWorkflow({
        workflowId: context.turn.temporalWorkflowId,
        runId: context.turn.temporalRunId ?? undefined,
      });
      if (described.status === 'RUNNING') throw error;
    }
    return this.toTurnView(context.turn);
  }

  async retryTurn(
    auth: AuthContext | null,
    turnId: string,
    input: OperatorRetryTurn,
  ): Promise<OperatorTurnAccepted> {
    const user = this.requireUserAuth(auth);
    const context = await this.repository.getTurnWithSession(turnId);
    if (
      !context ||
      context.session.organizationId !== user.organizationId ||
      context.session.userId !== user.userId
    ) {
      throw new NotFoundException('Operator turn not found');
    }
    if (context.turn.status !== 'failed' && context.turn.status !== 'cancelled') {
      throw new ConflictException(`Operator turn cannot be retried from ${context.turn.status}`);
    }

    const message = await this.repository.findUserMessageForTurn(context.turn.id);
    if (!message) throw new ConflictException('Operator turn has no stored user request to retry');
    const payload = readOperatorTurnPayload(context.turn.context);
    return this.createTurnForSession(
      context.session,
      {
        clientTurnId: input.clientTurnId,
        message: message.content,
        ...(payload.routeContext ? { context: payload.routeContext } : {}),
        ...(payload.directCommand ? { directCommand: payload.directCommand } : {}),
        ...(payload.journey ? { journey: payload.journey } : {}),
      },
      user,
      false,
    );
  }

  private async reconcileStaleApprovedAction(
    session: OperatorSessionRecord,
    turns: OperatorTurnRecord[],
    actions: OperatorActionRecord[],
    auth: AuthContext,
  ): Promise<boolean> {
    const activeTurnIds = new Set(
      turns
        .filter((turn) => ['queued', 'running', 'awaiting_approval'].includes(turn.status))
        .map((turn) => turn.id),
    );
    const action = [...actions]
      .reverse()
      .find((candidate) => candidate.status === 'approved' && activeTurnIds.has(candidate.turnId));
    if (!action) return false;

    const turn = turns.find((candidate) => candidate.id === action.turnId);
    if (!turn?.temporalWorkflowId) return false;

    const reconciliationKey = `${action.id}:${action.version}`;
    const now = Date.now();
    const previousCheck = this.decisionReconciliationChecks.get(reconciliationKey);
    if (previousCheck && now - previousCheck < 15_000) return false;
    if (!previousCheck && this.decisionReconciliationChecks.size >= 2_048) {
      const oldestKey = this.decisionReconciliationChecks.keys().next().value;
      if (oldestKey) this.decisionReconciliationChecks.delete(oldestKey);
    }
    this.decisionReconciliationChecks.set(reconciliationKey, now);

    let described: Awaited<ReturnType<TemporalService['describeWorkflow']>>;
    try {
      described = await this.temporalService.describeWorkflow({
        workflowId: turn.temporalWorkflowId,
        runId: turn.temporalRunId ?? undefined,
      });
    } catch {
      return false;
    }
    if (described.status === 'RUNNING') return false;

    await this.repository.failTurn({
      turn,
      session,
      error: `Operator durable turn closed as ${described.status} before the approved action could execute.`,
      auth,
    });
    this.decisionReconciliationChecks.delete(reconciliationKey);
    return true;
  }

  async createInternalRunFollowUp(input: {
    organizationId: string;
    sourceActionId: string;
    sourceSessionId: string;
    sourceTurnId: string;
    runId: string;
    workflowId: string;
  }): Promise<{ disposition: 'started' | 'ignored'; turnId?: string }> {
    const source = await this.repository.getActionWithTurnSession(input.sourceActionId);
    if (
      !source ||
      source.session.organizationId !== input.organizationId ||
      source.session.id !== input.sourceSessionId ||
      source.turn.id !== input.sourceTurnId ||
      source.session.status !== 'active' ||
      (source.action.commandName !== 'run_workflow' && source.action.commandName !== 'retry_run') ||
      readOperatorTurnPayload(source.turn.context).journey?.kind === 'improve_run'
    ) {
      return { disposition: 'ignored' };
    }
    if (source.action.status === 'failed' || source.action.status === 'rejected') {
      return { disposition: 'ignored' };
    }
    if (source.action.status !== 'succeeded') {
      throw new ConflictException('Operator run action has not finished recording its result');
    }
    if (source.action.runId !== input.runId) {
      return { disposition: 'ignored' };
    }

    const actor = this.authForTurn(source.session, source.turn);
    const run = await this.workflowsService.getRun(input.runId, actor);
    if (run.workflowId !== input.workflowId) {
      return { disposition: 'ignored' };
    }

    const turnId = operatorRunFollowUpTurnId(source.action.id);
    await this.createTurnForSession(
      source.session,
      {
        clientTurnId: turnId,
        message: `Automatic follow-up for workflow run ${input.runId}: inspect the terminal outcome, trace, and findings, then summarize what happened and suggest the most useful next actions.`,
        context: {
          path: `/workflows/${input.workflowId}/runs/${input.runId}`,
          workflowId: input.workflowId,
          runId: input.runId,
        },
        journey: { kind: 'run_follow_up', runId: input.runId },
      },
      actor,
      false,
    );
    return { disposition: 'started', turnId };
  }

  async getInternalContext(turnId: string, organizationId: string): Promise<OperatorModelContext> {
    const { turn, session } = await this.requireInternalTurn(turnId, organizationId);
    const [messages, actions] = await Promise.all([
      this.repository.listMessages(session.id),
      this.repository.listActions(session.id),
    ]);
    return {
      session: {
        ...this.toSessionSummary(
          session,
          turn,
          actions.filter((action) => action.turnId === turn.id),
        ),
        organizationId: session.organizationId,
        userId: session.userId,
      },
      turn: this.toTurnView(turn),
      messages: messages.slice(-30).map((message) => this.toMessageView(message)),
      actions: actions
        .filter((action) => action.turnId === turn.id)
        .map((action) => this.toActionView(action)),
    };
  }

  async getInternalPlan(
    turnId: string,
    planActionId: string,
    organizationId: string,
  ): Promise<OperatorPlanProposalResult> {
    const current = await this.requireInternalTurn(turnId, organizationId);
    const source = await this.repository.getActionWithTurnSession(planActionId);
    if (
      !source ||
      source.session.id !== current.session.id ||
      source.action.commandName !== 'propose_operator_plan' ||
      source.action.status !== 'succeeded'
    ) {
      throw new NotFoundException('Operator plan not found');
    }
    const plan = OperatorPlanProposalResultSchema.parse(source.action.result);
    if (plan.planId !== source.action.id) {
      throw new ConflictException('Operator plan identity does not match its proposal action');
    }
    return plan;
  }

  async setInternalTurnStatus(
    turnId: string,
    organizationId: string,
    status: OperatorTurnStatus,
  ): Promise<OperatorTurnView> {
    await this.requireInternalTurn(turnId, organizationId);
    const turn = await this.repository.setTurnStatus({ turnId, status });
    if (!turn) throw new NotFoundException('Operator turn not found');
    return this.toTurnView(turn);
  }

  async prepareInternalAction(input: {
    turnId: string;
    organizationId: string;
    toolCallId: string;
    commandName: OperatorCommandName;
    arguments: Record<string, unknown>;
    userConfirmed?: boolean;
  }): Promise<OperatorPreparedAction> {
    const { turn, session } = await this.requireInternalTurn(input.turnId, input.organizationId);
    const definition = OPERATOR_COMMAND_DEFINITIONS[input.commandName];
    const parsedArguments = definition.inputSchema.safeParse(input.arguments);
    const validationError = parsedArguments.success
      ? undefined
      : formatOperatorArgumentValidationError(input.commandName, parsedArguments.error.issues);
    const approvalRequired =
      parsedArguments.success &&
      (input.commandName === 'request_user_input' ||
        (definition.effect === 'consequential' &&
          session.approvalMode === 'ask' &&
          !input.userConfirmed));
    const actor = this.authForTurn(session, turn);
    const { action } = await this.repository.createAction({
      session,
      turn,
      toolCallId: input.toolCallId,
      commandName: input.commandName,
      effect: definition.effect,
      approvalMode: session.approvalMode,
      approvalRequired,
      arguments: parsedArguments.success
        ? (parsedArguments.data as Record<string, unknown>)
        : input.arguments,
      validationError,
      auth: actor,
    });
    const disposition =
      action.status === 'pending_approval'
        ? 'wait_for_approval'
        : action.status === 'succeeded'
          ? 'already_completed'
          : action.status === 'rejected' || action.status === 'failed'
            ? 'rejected'
            : 'execute';
    return { action: this.toActionView(action), disposition };
  }

  async executeInternalAction(
    actionId: string,
    organizationId: string,
  ): Promise<{
    action: OperatorActionView;
    result: unknown;
    launchedRunId?: string;
    mcpOperationRequest?: McpOperationInvocationRequest;
  }> {
    const context = await this.repository.getActionWithTurnSession(actionId);
    if (!context || context.session.organizationId !== organizationId) {
      throw new NotFoundException('Operator action not found');
    }
    const actor = this.authForTurn(context.session, context.turn);
    if (context.action.status === 'failed') {
      return {
        action: this.toActionView(context.action),
        result: { error: context.action.error ?? 'Operator action failed' },
      };
    }
    const executing = await this.repository.markActionExecuting(actionId, actor);
    if (executing.status === 'succeeded') {
      return {
        action: this.toActionView(executing),
        result: executing.result,
        ...(executing.runId && { launchedRunId: executing.runId }),
      };
    }

    await this.repository.setTurnStatus({ turnId: context.turn.id, status: 'running' });
    let execution: Awaited<ReturnType<OperatorCommandService['execute']>>;
    try {
      execution = await this.commandService.execute({
        commandName: executing.commandName,
        arguments: executing.arguments,
        auth: actor,
        sessionId: context.session.id,
        turnId: context.turn.id,
        turnCreatedAt: context.turn.createdAt.toISOString(),
        actionId: executing.id,
        actionRequestedAt: (
          executing.startedAt ??
          executing.decidedAt ??
          executing.createdAt
        ).toISOString(),
        storedResult: executing.result,
      });
    } catch (error: unknown) {
      if (!(error instanceof WorkflowRuntimeInputValidationException)) throw error;
      const failed = await this.repository.failAction({
        actionId: executing.id,
        error: error.message,
        auth: actor,
      });
      return {
        action: this.toActionView(failed),
        result: { error: error.message },
      };
    }
    if (execution.mcpOperationRequest) {
      return {
        action: this.toActionView(executing),
        result: execution.result,
        mcpOperationRequest: execution.mcpOperationRequest,
      };
    }
    const completed = await this.repository.completeAction({
      actionId: executing.id,
      result: execution.result,
      runId: execution.runId,
      auth: actor,
    });
    return {
      action: this.toActionView(completed),
      result: execution.result,
      ...(execution.runId && { launchedRunId: execution.runId }),
    };
  }

  async settleInternalMcpAction(input: {
    actionId: string;
    organizationId: string;
    result: McpOperationResult;
  }): Promise<OperatorActionView> {
    if (input.result.operationId !== input.actionId) {
      throw new ConflictException('MCP operation result belongs to a different Operator action');
    }
    const context = await this.repository.getActionWithTurnSession(input.actionId);
    if (!context || context.session.organizationId !== input.organizationId) {
      throw new NotFoundException('Operator action not found');
    }
    if (
      context.action.commandName !== 'invoke_mcp_tool' &&
      context.action.commandName !== 'read_mcp_resource' &&
      context.action.commandName !== 'get_mcp_prompt'
    ) {
      throw new ConflictException('Operator action is not a durable MCP operation');
    }
    const settled = await this.repository.settleMcpAction({
      actionId: input.actionId,
      result: input.result,
      auth: this.authForTurn(context.session, context.turn),
    });
    return this.toActionView(settled);
  }

  async observeInternalRun(input: {
    runId: string;
    turnId: string;
    organizationId: string;
  }): Promise<OperatorRunObservation> {
    const { turn, session } = await this.requireInternalTurn(input.turnId, input.organizationId);
    const auth = this.authForTurn(session, turn);
    const run = await this.workflowsService.getRun(input.runId, auth);
    const status = await this.workflowsService.getRunStatus(input.runId, run.temporalRunId, auth);
    const terminal = (TERMINAL_STATUSES as readonly string[]).includes(status.status);
    const result = terminal
      ? await this.workflowsService.getRunResult(input.runId, run.temporalRunId, auth)
      : undefined;
    const observation: OperatorRunObservation = {
      runId: input.runId,
      workflowId: run.workflowId,
      status: status.status,
      terminal,
      ...(terminal && { result: boundOperatorCommandResult(result) }),
    };
    if (terminal) {
      const recorded = await this.repository.recordRunObservation({
        turnId: input.turnId,
        runId: input.runId,
        observation,
      });
      if (!recorded) {
        throw new NotFoundException('Operator run action not found');
      }
    }
    return observation;
  }

  async completeInternalTurn(input: {
    turnId: string;
    organizationId: string;
    message: string;
  }): Promise<void> {
    const { turn, session } = await this.requireInternalTurn(input.turnId, input.organizationId);
    await this.repository.completeTurn({
      turn,
      session,
      message: input.message,
      auth: this.authForTurn(session, turn),
    });
  }

  async failInternalTurn(input: {
    turnId: string;
    organizationId: string;
    error: string;
  }): Promise<void> {
    const { turn, session } = await this.requireInternalTurn(input.turnId, input.organizationId);
    await this.repository.failTurn({
      turn,
      session,
      error: input.error,
      auth: this.authForTurn(session, turn),
    });
  }

  async cancelInternalTurn(input: {
    turnId: string;
    organizationId: string;
    message: string;
  }): Promise<void> {
    const { turn, session } = await this.requireInternalTurn(input.turnId, input.organizationId);
    await this.repository.cancelTurn({
      turn,
      session,
      message: input.message,
      auth: this.authForTurn(session, turn),
    });
  }

  private async createTurnForSession(
    initialSession: OperatorSessionRecord,
    input: OperatorCreateTurn,
    actor: AuthContext,
    renameDefaultSession: boolean,
  ): Promise<OperatorTurnAccepted> {
    let session = initialSession;
    const { turn, created } = await this.repository.createTurn({
      id: input.clientTurnId,
      session,
      message: input.message,
      context: input.context,
      directCommand: input.directCommand,
      journey: input.journey,
      auth: actor,
    });
    const persistedPayload = readOperatorTurnPayload(turn.context);

    if (renameDefaultSession && created && session.title === DEFAULT_SESSION_TITLE) {
      const title = input.message.replace(/\s+/g, ' ').trim().slice(0, 72);
      const renamed = await this.repository.updateSession({
        sessionId: session.id,
        owner: { organizationId: session.organizationId, userId: session.userId },
        values: { title },
        auth: actor,
      });
      session = renamed ?? session;
    }

    if (turn.temporalWorkflowId) {
      return { turnId: turn.id, status: turn.status };
    }

    const temporalWorkflowId = `operator-turn:${session.id}:${turn.id}`;
    try {
      const temporal = await this.temporalService.startWorkflow({
        workflowType: OPERATOR_WORKFLOW_TYPE,
        workflowId: temporalWorkflowId,
        args: [
          {
            sessionId: session.id,
            turnId: turn.id,
            organizationId: session.organizationId,
            ...(persistedPayload.directCommand
              ? {
                  directCommand: {
                    toolCallId: `${turn.id}:direct`,
                    commandName: persistedPayload.directCommand.commandName,
                    arguments: persistedPayload.directCommand.arguments,
                  },
                }
              : {}),
            ...(persistedPayload.journey ? { journey: persistedPayload.journey } : {}),
          },
        ],
        workflowExecutionTimeout: '24 hours',
      });
      await this.repository.attachTemporal({
        turnId: turn.id,
        sessionId: session.id,
        workflowId: temporal.workflowId,
        runId: temporal.runId,
      });
    } catch (error: unknown) {
      if (!this.isAlreadyStarted(error)) {
        await this.repository.failTurn({
          turn,
          session,
          error: this.errorMessage(error),
          auth: actor,
        });
        throw error;
      }
      const recovered = await this.temporalService.describeWorkflow({
        workflowId: temporalWorkflowId,
      });
      await this.repository.attachTemporal({
        turnId: turn.id,
        sessionId: session.id,
        workflowId: temporalWorkflowId,
        runId: recovered.runId,
      });
    }

    return { turnId: turn.id, status: turn.status };
  }

  private async requireOwnedSession(
    sessionId: string,
    auth: AuthContext & { organizationId: string; userId: string },
  ): Promise<OperatorSessionRecord> {
    const session = await this.repository.findSession(sessionId, {
      organizationId: auth.organizationId,
      userId: auth.userId,
    });
    if (!session) throw new NotFoundException('Operator session not found');
    return session;
  }

  private async requireInternalTurn(
    turnId: string,
    organizationId: string,
  ): Promise<{ turn: OperatorTurnRecord; session: OperatorSessionRecord }> {
    const context = await this.repository.getTurnWithSession(turnId);
    if (!context || context.session.organizationId !== organizationId) {
      throw new NotFoundException('Operator turn not found');
    }
    return context;
  }

  private requireUserAuth(auth: AuthContext | null): AuthContext & {
    organizationId: string;
    userId: string;
  } {
    if (
      !auth?.isAuthenticated ||
      !auth.organizationId ||
      !auth.userId ||
      auth.provider === 'internal' ||
      auth.provider === 'api-key'
    ) {
      throw new ForbiddenException('Operator requires an authenticated user session');
    }
    return auth as AuthContext & { organizationId: string; userId: string };
  }

  private authForTurn(session: OperatorSessionRecord, turn: OperatorTurnRecord): AuthContext {
    return {
      userId: session.userId,
      organizationId: session.organizationId,
      roles: turn.actorRoles,
      isAuthenticated: true,
      provider: 'operator',
    };
  }

  private toSessionSummary(
    session: OperatorSessionRecord,
    latestTurn: OperatorTurnRecord | null,
    latestTurnActions: OperatorActionRecord[],
  ): OperatorSessionSummary {
    let currentAction: OperatorActionRecord | null = null;
    for (let index = latestTurnActions.length - 1; index >= 0; index -= 1) {
      const action = latestTurnActions[index];
      if (!['succeeded', 'failed', 'rejected'].includes(action.status)) {
        currentAction = action;
        break;
      }
    }
    return {
      id: session.id,
      title: session.title,
      approvalMode: session.approvalMode,
      status: session.status,
      model: {
        provider: session.modelProvider as OperatorSessionSummary['model']['provider'],
        modelId: session.modelId,
        apiKeySecretId: session.apiKeySecretId,
        baseUrl: session.baseUrl,
      },
      latestTurn: latestTurn
        ? {
            id: latestTurn.id,
            status: latestTurn.status,
            error: latestTurn.error,
            actionCount: latestTurnActions.length,
            settledActionCount: latestTurnActions.filter((action) =>
              ['succeeded', 'failed', 'rejected'].includes(action.status),
            ).length,
            currentAction: currentAction
              ? {
                  id: currentAction.id,
                  commandName: currentAction.commandName,
                  status: currentAction.status,
                  version: currentAction.version,
                }
              : null,
            createdAt: latestTurn.createdAt.toISOString(),
            completedAt: latestTurn.completedAt?.toISOString() ?? null,
          }
        : null,
      createdAt: session.createdAt.toISOString(),
      updatedAt: session.updatedAt.toISOString(),
    };
  }

  private toTurnView(turn: OperatorTurnRecord): OperatorTurnView {
    const persistedPayload = readOperatorTurnPayload(turn.context);
    return {
      id: turn.id,
      sessionId: turn.sessionId,
      status: turn.status,
      temporalWorkflowId: turn.temporalWorkflowId,
      temporalRunId: turn.temporalRunId,
      context: persistedPayload.routeContext,
      journey: persistedPayload.journey,
      error: turn.error,
      createdAt: turn.createdAt.toISOString(),
      startedAt: turn.startedAt?.toISOString() ?? null,
      completedAt: turn.completedAt?.toISOString() ?? null,
    };
  }

  private toMessageView(message: OperatorMessageRecord): OperatorMessageView {
    return {
      id: message.id,
      sessionId: message.sessionId,
      turnId: message.turnId,
      sequence: message.sequence,
      role: message.role,
      content: message.content,
      createdAt: message.createdAt.toISOString(),
    };
  }

  private toActionView(action: OperatorActionRecord): OperatorActionView {
    return {
      id: action.id,
      sessionId: action.sessionId,
      turnId: action.turnId,
      toolCallId: action.toolCallId,
      commandName: action.commandName,
      effect: action.effect,
      approvalMode: action.approvalMode,
      approvalRequired: action.approvalRequired,
      status: action.status,
      version: action.version,
      arguments: action.arguments,
      result: action.result,
      error: action.error,
      runId: action.runId,
      createdAt: action.createdAt.toISOString(),
      decidedAt: action.decidedAt?.toISOString() ?? null,
      completedAt: action.completedAt?.toISOString() ?? null,
    };
  }

  private isAlreadyStarted(error: unknown): boolean {
    return error instanceof Error && error.message.includes('Workflow execution already started');
  }

  private errorMessage(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error);
    return message.slice(0, 8_000);
  }
}

function formatOperatorArgumentValidationError(
  commandName: OperatorCommandName,
  issues: readonly { path: readonly PropertyKey[]; message: string }[],
): string {
  const details = issues
    .slice(0, 3)
    .map((issue) => `${issue.path.map(String).join('.') || 'arguments'}: ${issue.message}`)
    .join('; ');
  return `Invalid arguments for ${commandName}: ${details}`.slice(0, 1_000);
}

function operatorRunFollowUpTurnId(actionId: string): string {
  const hex = createHash('sha256')
    .update(`sentris:operator-run-follow-up:v1:${actionId}`)
    .digest('hex')
    .slice(0, 32)
    .split('');
  hex[12] = '8';
  hex[16] = ((Number.parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16);
  const value = hex.join('');
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}
