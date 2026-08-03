import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import {
  OPERATOR_COMMAND_DEFINITIONS,
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
  type OperatorRunObservation,
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
    return this.toSessionSummary(session);
  }

  async listSessions(auth: AuthContext | null): Promise<OperatorSessionSummary[]> {
    const user = this.requireUserAuth(auth);
    const sessions = await this.repository.listSessions({
      organizationId: user.organizationId,
      userId: user.userId,
    });
    return sessions.map((session) => this.toSessionSummary(session));
  }

  async getSession(auth: AuthContext | null, sessionId: string): Promise<OperatorSessionDetail> {
    const user = this.requireUserAuth(auth);
    const session = await this.requireOwnedSession(sessionId, user);
    const [turns, messages, actions] = await Promise.all([
      this.repository.listTurns(session.id),
      this.repository.listMessages(session.id),
      this.repository.listActions(session.id),
    ]);
    return {
      ...this.toSessionSummary(session),
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
    return this.toSessionSummary(updated);
  }

  async createTurn(
    auth: AuthContext | null,
    sessionId: string,
    input: OperatorCreateTurn,
  ): Promise<OperatorTurnAccepted> {
    const user = this.requireUserAuth(auth);
    let session = await this.requireOwnedSession(sessionId, user);

    const { turn, created } = await this.repository.createTurn({
      id: input.clientTurnId,
      session,
      message: input.message,
      context: input.context,
      directCommand: input.directCommand,
      journey: input.journey,
      auth: user,
    });
    const persistedPayload = readOperatorTurnPayload(turn.context);

    if (created && session.title === DEFAULT_SESSION_TITLE) {
      const title = input.message.replace(/\s+/g, ' ').trim().slice(0, 72);
      const renamed = await this.repository.updateSession({
        sessionId: session.id,
        owner: { organizationId: user.organizationId, userId: user.userId },
        values: { title },
        auth: user,
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
          auth: user,
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
      auth: user,
    });
    const context = await this.repository.getActionWithTurnSession(action.id);
    if (!context?.turn.temporalWorkflowId) {
      throw new ConflictException('Operator turn has not started');
    }
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
    return this.toActionView(action);
  }

  async getInternalContext(turnId: string, organizationId: string): Promise<OperatorModelContext> {
    const { turn, session } = await this.requireInternalTurn(turnId, organizationId);
    const [messages, actions] = await Promise.all([
      this.repository.listMessages(session.id),
      this.repository.listActions(session.id),
    ]);
    return {
      session: {
        ...this.toSessionSummary(session),
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
      definition.effect === 'consequential' &&
      session.approvalMode === 'ask' &&
      !input.userConfirmed;
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

  private toSessionSummary(session: OperatorSessionRecord): OperatorSessionSummary {
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
