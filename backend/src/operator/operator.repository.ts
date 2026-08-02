import { isDeepStrictEqual } from 'node:util';
import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import type {
  McpOperationResult,
  OperatorApprovalMode,
  OperatorCommandEffect,
  OperatorCommandName,
  OperatorDirectCommand,
  OperatorModelConfig,
  OperatorPersistedTurnPayload,
  OperatorRouteContext,
  OperatorRunObservation,
  OperatorTurnStatus,
} from '@sentris/shared';

import type { AuthContext } from '../auth/types';
import { AuditLogService } from '../audit/audit-log.service';
import { DRIZZLE_TOKEN } from '../database/database.module';
import {
  operatorActionsTable,
  operatorMessagesTable,
  operatorSessionsTable,
  operatorTurnsTable,
  type OperatorActionRecord,
  type OperatorMessageRecord,
  type OperatorSessionRecord,
  type OperatorTurnRecord,
} from '../database/schema';
import { buildOperatorTurnPayload, readOperatorTurnPayload } from './operator-turn-payload';

const ACTIVE_OPERATOR_TURN_STATUSES: readonly OperatorTurnStatus[] = [
  'queued',
  'running',
  'awaiting_approval',
];

function assertTurnReplayMatches(
  turn: OperatorTurnRecord,
  storedMessage: string | null,
  requestedMessage: string,
  requestedPayload: OperatorPersistedTurnPayload,
): void {
  const storedPayload = readOperatorTurnPayload(turn.context);
  if (storedMessage !== requestedMessage || !isDeepStrictEqual(storedPayload, requestedPayload)) {
    throw new ConflictException(
      'Turn identifier is already used with different message, context, or command',
    );
  }
}

@Injectable()
export class OperatorRepository {
  constructor(
    @Inject(DRIZZLE_TOKEN)
    private readonly db: NodePgDatabase,
    private readonly auditLogService: AuditLogService,
  ) {}

  async createSession(input: {
    organizationId: string;
    userId: string;
    approvalMode: OperatorApprovalMode;
    model: OperatorModelConfig;
    auth: AuthContext;
  }): Promise<OperatorSessionRecord> {
    return this.db.transaction(async (tx) => {
      const [session] = await tx
        .insert(operatorSessionsTable)
        .values({
          organizationId: input.organizationId,
          userId: input.userId,
          approvalMode: input.approvalMode,
          modelProvider: input.model.provider,
          modelId: input.model.modelId,
          apiKeySecretId: input.model.apiKeySecretId,
          baseUrl: input.model.baseUrl ?? null,
        })
        .returning();

      await this.auditLogService.recordDurableWithExecutor(tx, input.auth, {
        action: 'operator.session.create',
        resourceType: 'operator_session',
        resourceId: session.id,
        resourceName: session.title,
        metadata: {
          approvalMode: session.approvalMode,
          provider: session.modelProvider,
          modelId: session.modelId,
        },
      });
      return session;
    });
  }

  listSessions(owner: {
    organizationId: string;
    userId: string;
  }): Promise<OperatorSessionRecord[]> {
    return this.db
      .select()
      .from(operatorSessionsTable)
      .where(
        and(
          eq(operatorSessionsTable.organizationId, owner.organizationId),
          eq(operatorSessionsTable.userId, owner.userId),
        ),
      )
      .orderBy(desc(operatorSessionsTable.updatedAt));
  }

  async findSession(
    sessionId: string,
    owner: { organizationId: string; userId: string },
  ): Promise<OperatorSessionRecord | undefined> {
    const [session] = await this.db
      .select()
      .from(operatorSessionsTable)
      .where(
        and(
          eq(operatorSessionsTable.id, sessionId),
          eq(operatorSessionsTable.organizationId, owner.organizationId),
          eq(operatorSessionsTable.userId, owner.userId),
        ),
      )
      .limit(1);
    return session;
  }

  async findSessionById(sessionId: string): Promise<OperatorSessionRecord | undefined> {
    const [session] = await this.db
      .select()
      .from(operatorSessionsTable)
      .where(eq(operatorSessionsTable.id, sessionId))
      .limit(1);
    return session;
  }

  async updateSession(input: {
    sessionId: string;
    owner: { organizationId: string; userId: string };
    values: {
      title?: string;
      approvalMode?: OperatorApprovalMode;
      model?: OperatorModelConfig;
    };
    auth: AuthContext;
  }): Promise<OperatorSessionRecord | undefined> {
    return this.db.transaction(async (tx) => {
      const [session] = await tx
        .update(operatorSessionsTable)
        .set({
          ...(input.values.title !== undefined && { title: input.values.title }),
          ...(input.values.approvalMode !== undefined && {
            approvalMode: input.values.approvalMode,
          }),
          ...(input.values.model && {
            modelProvider: input.values.model.provider,
            modelId: input.values.model.modelId,
            apiKeySecretId: input.values.model.apiKeySecretId,
            baseUrl: input.values.model.baseUrl ?? null,
          }),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(operatorSessionsTable.id, input.sessionId),
            eq(operatorSessionsTable.organizationId, input.owner.organizationId),
            eq(operatorSessionsTable.userId, input.owner.userId),
          ),
        )
        .returning();

      if (!session) return undefined;
      await this.auditLogService.recordDurableWithExecutor(tx, input.auth, {
        action: 'operator.session.update',
        resourceType: 'operator_session',
        resourceId: session.id,
        resourceName: session.title,
        metadata: {
          changedFields: Object.keys(input.values),
          approvalMode: session.approvalMode,
          provider: session.modelProvider,
          modelId: session.modelId,
        },
      });
      return session;
    });
  }

  async listTurns(sessionId: string): Promise<OperatorTurnRecord[]> {
    return this.db
      .select()
      .from(operatorTurnsTable)
      .where(eq(operatorTurnsTable.sessionId, sessionId))
      .orderBy(asc(operatorTurnsTable.createdAt));
  }

  async listMessages(sessionId: string): Promise<OperatorMessageRecord[]> {
    return this.db
      .select()
      .from(operatorMessagesTable)
      .where(eq(operatorMessagesTable.sessionId, sessionId))
      .orderBy(asc(operatorMessagesTable.sequence));
  }

  async listActions(sessionId: string): Promise<OperatorActionRecord[]> {
    return this.db
      .select()
      .from(operatorActionsTable)
      .where(eq(operatorActionsTable.sessionId, sessionId))
      .orderBy(asc(operatorActionsTable.createdAt));
  }

  async createTurn(input: {
    id: string;
    session: OperatorSessionRecord;
    message: string;
    context?: OperatorRouteContext;
    directCommand?: OperatorDirectCommand;
    auth: AuthContext;
  }): Promise<{ turn: OperatorTurnRecord; created: boolean }> {
    const persistedPayload = buildOperatorTurnPayload({
      routeContext: input.context,
      directCommand: input.directCommand,
    });
    return this.db.transaction(async (tx) => {
      const [lockedSession] = await tx
        .select({ id: operatorSessionsTable.id })
        .from(operatorSessionsTable)
        .where(eq(operatorSessionsTable.id, input.session.id))
        .for('update')
        .limit(1);
      if (!lockedSession) throw new NotFoundException('Operator session not found');

      const [existing] = await tx
        .select({
          turn: operatorTurnsTable,
          message: operatorMessagesTable.content,
        })
        .from(operatorTurnsTable)
        .leftJoin(
          operatorMessagesTable,
          and(
            eq(operatorMessagesTable.turnId, operatorTurnsTable.id),
            eq(operatorMessagesTable.role, 'user'),
          ),
        )
        .where(eq(operatorTurnsTable.id, input.id))
        .limit(1);
      if (existing) {
        if (existing.turn.sessionId !== input.session.id) {
          throw new ConflictException('Turn identifier is already used by another session');
        }
        assertTurnReplayMatches(existing.turn, existing.message, input.message, persistedPayload);
        return { turn: existing.turn, created: false };
      }

      const [activeTurn] = await tx
        .select({ id: operatorTurnsTable.id })
        .from(operatorTurnsTable)
        .where(
          and(
            eq(operatorTurnsTable.sessionId, input.session.id),
            inArray(operatorTurnsTable.status, [...ACTIVE_OPERATOR_TURN_STATUSES]),
          ),
        )
        .limit(1);
      if (activeTurn) {
        throw new ConflictException('Wait for the active Operator turn to finish');
      }

      const [created] = await tx
        .insert(operatorTurnsTable)
        .values({
          id: input.id,
          sessionId: input.session.id,
          context: persistedPayload,
        })
        .onConflictDoNothing({ target: operatorTurnsTable.id })
        .returning();

      if (!created) {
        const [conflicting] = await tx
          .select({
            turn: operatorTurnsTable,
            message: operatorMessagesTable.content,
          })
          .from(operatorTurnsTable)
          .leftJoin(
            operatorMessagesTable,
            and(
              eq(operatorMessagesTable.turnId, operatorTurnsTable.id),
              eq(operatorMessagesTable.role, 'user'),
            ),
          )
          .where(eq(operatorTurnsTable.id, input.id))
          .limit(1);
        if (!conflicting || conflicting.turn.sessionId !== input.session.id) {
          throw new ConflictException('Turn identifier is already used by another session');
        }
        assertTurnReplayMatches(
          conflicting.turn,
          conflicting.message,
          input.message,
          persistedPayload,
        );
        return { turn: conflicting.turn, created: false };
      }

      await tx.insert(operatorMessagesTable).values({
        sessionId: input.session.id,
        turnId: created.id,
        role: 'user',
        content: input.message,
      });
      await tx
        .update(operatorSessionsTable)
        .set({ updatedAt: new Date() })
        .where(eq(operatorSessionsTable.id, input.session.id));
      await this.auditLogService.recordDurableWithExecutor(tx, input.auth, {
        action: 'operator.turn.submit',
        resourceType: 'operator_session',
        resourceId: input.session.id,
        resourceName: input.session.title,
        metadata: {
          turnId: created.id,
          hasRouteContext: Boolean(input.context),
          hasDirectCommand: Boolean(input.directCommand),
        },
      });
      return { turn: created, created: true };
    });
  }

  async attachTemporal(input: {
    turnId: string;
    sessionId: string;
    workflowId: string;
    runId: string;
  }): Promise<OperatorTurnRecord | undefined> {
    const [turn] = await this.db
      .update(operatorTurnsTable)
      .set({
        temporalWorkflowId: input.workflowId,
        temporalRunId: input.runId,
      })
      .where(
        and(
          eq(operatorTurnsTable.id, input.turnId),
          eq(operatorTurnsTable.sessionId, input.sessionId),
        ),
      )
      .returning();
    return turn;
  }

  async getTurnWithSession(turnId: string): Promise<{
    turn: OperatorTurnRecord;
    session: OperatorSessionRecord;
  } | null> {
    const [row] = await this.db
      .select({ turn: operatorTurnsTable, session: operatorSessionsTable })
      .from(operatorTurnsTable)
      .innerJoin(operatorSessionsTable, eq(operatorTurnsTable.sessionId, operatorSessionsTable.id))
      .where(eq(operatorTurnsTable.id, turnId))
      .limit(1);
    return row ?? null;
  }

  async setTurnStatus(input: {
    turnId: string;
    status: OperatorTurnStatus;
    error?: string | null;
  }): Promise<OperatorTurnRecord | undefined> {
    const now = new Date();
    const terminal = ['completed', 'failed', 'cancelled'].includes(input.status);
    const [turn] = await this.db
      .update(operatorTurnsTable)
      .set({
        status: input.status,
        error: input.error ?? null,
        ...(input.status === 'running' && { startedAt: now }),
        ...(terminal && { completedAt: now }),
      })
      .where(eq(operatorTurnsTable.id, input.turnId))
      .returning();
    return turn;
  }

  async findActionByTurnToolCall(
    turnId: string,
    toolCallId: string,
  ): Promise<OperatorActionRecord | undefined> {
    const [action] = await this.db
      .select()
      .from(operatorActionsTable)
      .where(
        and(
          eq(operatorActionsTable.turnId, turnId),
          eq(operatorActionsTable.toolCallId, toolCallId),
        ),
      )
      .limit(1);
    return action;
  }

  async createAction(input: {
    session: OperatorSessionRecord;
    turn: OperatorTurnRecord;
    toolCallId: string;
    commandName: OperatorCommandName;
    effect: OperatorCommandEffect;
    approvalMode: OperatorApprovalMode;
    approvalRequired: boolean;
    arguments: Record<string, unknown>;
    validationError?: string;
    auth: AuthContext;
  }): Promise<{ action: OperatorActionRecord; created: boolean }> {
    return this.db.transaction(async (tx) => {
      if (input.effect !== 'read') {
        const [lockedTurn] = await tx
          .select({ id: operatorTurnsTable.id })
          .from(operatorTurnsTable)
          .where(eq(operatorTurnsTable.id, input.turn.id))
          .for('update')
          .limit(1);
        if (!lockedTurn) throw new NotFoundException('Operator turn not found');

        const [equivalent] = await tx
          .select()
          .from(operatorActionsTable)
          .where(
            and(
              eq(operatorActionsTable.turnId, input.turn.id),
              eq(operatorActionsTable.commandName, input.commandName),
              eq(operatorActionsTable.arguments, input.arguments),
            ),
          )
          .orderBy(asc(operatorActionsTable.createdAt))
          .limit(1);
        if (equivalent) return { action: equivalent, created: false };
      }

      const [created] = await tx
        .insert(operatorActionsTable)
        .values({
          sessionId: input.session.id,
          turnId: input.turn.id,
          toolCallId: input.toolCallId,
          commandName: input.commandName,
          effect: input.effect,
          approvalMode: input.approvalMode,
          approvalRequired: input.approvalRequired,
          status: input.validationError
            ? 'failed'
            : input.approvalRequired
              ? 'pending_approval'
              : 'approved',
          arguments: input.arguments,
          error: input.validationError ?? null,
          completedAt: input.validationError ? new Date() : null,
        })
        .onConflictDoNothing({
          target: [operatorActionsTable.turnId, operatorActionsTable.toolCallId],
        })
        .returning();

      if (!created) {
        const [existing] = await tx
          .select()
          .from(operatorActionsTable)
          .where(
            and(
              eq(operatorActionsTable.turnId, input.turn.id),
              eq(operatorActionsTable.toolCallId, input.toolCallId),
            ),
          )
          .limit(1);
        if (!existing) throw new ConflictException('Operator action could not be recovered');
        return { action: existing, created: false };
      }

      if (input.approvalRequired) {
        await tx
          .update(operatorTurnsTable)
          .set({ status: 'awaiting_approval' })
          .where(eq(operatorTurnsTable.id, input.turn.id));
      }
      await this.auditLogService.recordDurableWithExecutor(tx, input.auth, {
        action: 'operator.action.propose',
        resourceType: 'operator_action',
        resourceId: created.id,
        resourceName: created.commandName,
        metadata: {
          sessionId: input.session.id,
          turnId: input.turn.id,
          commandName: created.commandName,
          effect: created.effect,
          approvalRequired: created.approvalRequired,
          validationFailed: Boolean(input.validationError),
        },
      });
      if (input.validationError) {
        await this.auditLogService.recordDurableWithExecutor(tx, input.auth, {
          action: 'operator.action.failed',
          resourceType: 'operator_action',
          resourceId: created.id,
          resourceName: created.commandName,
          metadata: {
            sessionId: input.session.id,
            turnId: input.turn.id,
            reason: 'invalid_arguments',
          },
        });
      }
      return { action: created, created: true };
    });
  }

  async findActionForOwner(
    actionId: string,
    owner: { organizationId: string; userId: string },
  ): Promise<OperatorActionRecord | undefined> {
    const [row] = await this.db
      .select({ action: operatorActionsTable })
      .from(operatorActionsTable)
      .innerJoin(
        operatorSessionsTable,
        eq(operatorActionsTable.sessionId, operatorSessionsTable.id),
      )
      .where(
        and(
          eq(operatorActionsTable.id, actionId),
          eq(operatorSessionsTable.organizationId, owner.organizationId),
          eq(operatorSessionsTable.userId, owner.userId),
        ),
      )
      .limit(1);
    return row?.action;
  }

  async getActionWithTurnSession(actionId: string): Promise<{
    action: OperatorActionRecord;
    turn: OperatorTurnRecord;
    session: OperatorSessionRecord;
  } | null> {
    const [row] = await this.db
      .select({
        action: operatorActionsTable,
        turn: operatorTurnsTable,
        session: operatorSessionsTable,
      })
      .from(operatorActionsTable)
      .innerJoin(operatorTurnsTable, eq(operatorActionsTable.turnId, operatorTurnsTable.id))
      .innerJoin(
        operatorSessionsTable,
        eq(operatorActionsTable.sessionId, operatorSessionsTable.id),
      )
      .where(eq(operatorActionsTable.id, actionId))
      .limit(1);
    return row ?? null;
  }

  async decideAction(input: {
    actionId: string;
    owner: { organizationId: string; userId: string };
    expectedVersion: number;
    decision: 'approved' | 'rejected';
    auth: AuthContext;
  }): Promise<OperatorActionRecord> {
    return this.db.transaction(async (tx) => {
      const [owned] = await tx
        .select({ action: operatorActionsTable })
        .from(operatorActionsTable)
        .innerJoin(
          operatorSessionsTable,
          eq(operatorActionsTable.sessionId, operatorSessionsTable.id),
        )
        .where(
          and(
            eq(operatorActionsTable.id, input.actionId),
            eq(operatorSessionsTable.organizationId, input.owner.organizationId),
            eq(operatorSessionsTable.userId, input.owner.userId),
          ),
        )
        .limit(1);
      if (!owned) throw new NotFoundException('Operator action not found');

      if (owned.action.status === input.decision) return owned.action;
      if (owned.action.status !== 'pending_approval') {
        throw new ConflictException(`Operator action is already ${owned.action.status}`);
      }

      const [updated] = await tx
        .update(operatorActionsTable)
        .set({
          status: input.decision,
          version: input.expectedVersion + 1,
          decidedBy: input.owner.userId,
          decidedAt: new Date(),
          ...(input.decision === 'rejected' && { completedAt: new Date() }),
        })
        .where(
          and(
            eq(operatorActionsTable.id, input.actionId),
            eq(operatorActionsTable.version, input.expectedVersion),
            eq(operatorActionsTable.status, 'pending_approval'),
          ),
        )
        .returning();
      if (!updated) {
        throw new ConflictException('Operator action changed; refresh before deciding');
      }

      await this.auditLogService.recordDurableWithExecutor(tx, input.auth, {
        action: `operator.action.${input.decision}`,
        resourceType: 'operator_action',
        resourceId: updated.id,
        resourceName: updated.commandName,
        metadata: { sessionId: updated.sessionId, turnId: updated.turnId },
      });
      return updated;
    });
  }

  async markActionExecuting(actionId: string, auth: AuthContext): Promise<OperatorActionRecord> {
    return this.db.transaction(async (tx) => {
      const [updated] = await tx
        .update(operatorActionsTable)
        .set({
          status: 'executing',
          version: sql`${operatorActionsTable.version} + 1`,
          startedAt: new Date(),
        })
        .where(
          and(eq(operatorActionsTable.id, actionId), eq(operatorActionsTable.status, 'approved')),
        )
        .returning();
      if (updated) {
        await this.auditLogService.recordDurableWithExecutor(tx, auth, {
          action: 'operator.action.execute',
          resourceType: 'operator_action',
          resourceId: updated.id,
          resourceName: updated.commandName,
          metadata: { sessionId: updated.sessionId, turnId: updated.turnId },
        });
        return updated;
      }

      const [existing] = await tx
        .select()
        .from(operatorActionsTable)
        .where(eq(operatorActionsTable.id, actionId))
        .limit(1);
      if (!existing) throw new NotFoundException('Operator action not found');
      if (['executing', 'succeeded'].includes(existing.status)) return existing;
      throw new ConflictException(`Operator action cannot execute from ${existing.status}`);
    });
  }

  async completeAction(input: {
    actionId: string;
    result: unknown;
    runId?: string;
    auth: AuthContext;
  }): Promise<OperatorActionRecord> {
    return this.db.transaction(async (tx) => {
      const [updated] = await tx
        .update(operatorActionsTable)
        .set({
          status: 'succeeded',
          result: input.result,
          runId: input.runId ?? null,
          error: null,
          completedAt: new Date(),
        })
        .where(
          and(
            eq(operatorActionsTable.id, input.actionId),
            eq(operatorActionsTable.status, 'executing'),
          ),
        )
        .returning();
      if (updated) {
        await this.auditLogService.recordDurableWithExecutor(tx, input.auth, {
          action: 'operator.action.succeeded',
          resourceType: 'operator_action',
          resourceId: updated.id,
          resourceName: updated.commandName,
          metadata: {
            sessionId: updated.sessionId,
            turnId: updated.turnId,
            runId: updated.runId,
          },
        });
        return updated;
      }
      const [existing] = await tx
        .select()
        .from(operatorActionsTable)
        .where(eq(operatorActionsTable.id, input.actionId))
        .limit(1);
      if (existing?.status === 'succeeded') return existing;
      throw new ConflictException('Operator action is not executing');
    });
  }

  async recordRunObservation(input: {
    turnId: string;
    runId: string;
    observation: OperatorRunObservation;
  }): Promise<OperatorActionRecord | undefined> {
    const [action] = await this.db
      .update(operatorActionsTable)
      .set({
        result: input.observation,
        version: sql`${operatorActionsTable.version} + 1`,
      })
      .where(
        and(
          eq(operatorActionsTable.turnId, input.turnId),
          eq(operatorActionsTable.runId, input.runId),
          eq(operatorActionsTable.status, 'succeeded'),
        ),
      )
      .returning();
    return action;
  }

  async failAction(input: {
    actionId: string;
    error: string;
    auth: AuthContext;
  }): Promise<OperatorActionRecord> {
    return this.db.transaction(async (tx) => {
      const [updated] = await tx
        .update(operatorActionsTable)
        .set({ status: 'failed', error: input.error, completedAt: new Date() })
        .where(eq(operatorActionsTable.id, input.actionId))
        .returning();
      if (!updated) throw new NotFoundException('Operator action not found');
      await this.auditLogService.recordDurableWithExecutor(tx, input.auth, {
        action: 'operator.action.failed',
        resourceType: 'operator_action',
        resourceId: updated.id,
        resourceName: updated.commandName,
        metadata: { sessionId: updated.sessionId, turnId: updated.turnId },
      });
      return updated;
    });
  }

  async settleMcpAction(input: {
    actionId: string;
    result: McpOperationResult;
    auth: AuthContext;
  }): Promise<OperatorActionRecord> {
    return this.db.transaction(async (tx) => {
      const succeeded = input.result.kind === 'completed';
      const error = input.result.kind === 'completed' ? null : input.result.message;
      const [updated] = await tx
        .update(operatorActionsTable)
        .set({
          status: succeeded ? 'succeeded' : 'failed',
          result: input.result,
          error,
          completedAt: new Date(input.result.completedAt),
          version: sql`${operatorActionsTable.version} + 1`,
        })
        .where(
          and(
            eq(operatorActionsTable.id, input.actionId),
            eq(operatorActionsTable.status, 'executing'),
          ),
        )
        .returning();
      if (updated) {
        await this.auditLogService.recordDurableWithExecutor(tx, input.auth, {
          action: succeeded ? 'operator.action.succeeded' : 'operator.action.failed',
          resourceType: 'operator_action',
          resourceId: updated.id,
          resourceName: updated.commandName,
          metadata: {
            sessionId: updated.sessionId,
            turnId: updated.turnId,
            mcpResultKind: input.result.kind,
          },
        });
        return updated;
      }

      const [existing] = await tx
        .select()
        .from(operatorActionsTable)
        .where(eq(operatorActionsTable.id, input.actionId))
        .limit(1);
      if (!existing) throw new NotFoundException('Operator action not found');
      if (
        (existing.status === 'succeeded' || existing.status === 'failed') &&
        isDeepStrictEqual(existing.result, input.result)
      ) {
        return existing;
      }
      throw new ConflictException('Operator MCP action settlement conflicts with durable state');
    });
  }

  async completeTurn(input: {
    turn: OperatorTurnRecord;
    session: OperatorSessionRecord;
    message: string;
    auth: AuthContext;
  }): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx
        .insert(operatorMessagesTable)
        .values({
          sessionId: input.session.id,
          turnId: input.turn.id,
          role: 'assistant',
          content: input.message,
        })
        .onConflictDoNothing({
          target: [operatorMessagesTable.turnId, operatorMessagesTable.role],
        });
      await tx
        .update(operatorTurnsTable)
        .set({ status: 'completed', error: null, completedAt: new Date() })
        .where(eq(operatorTurnsTable.id, input.turn.id));
      await tx
        .update(operatorSessionsTable)
        .set({ updatedAt: new Date() })
        .where(eq(operatorSessionsTable.id, input.session.id));
      await this.auditLogService.recordDurableWithExecutor(tx, input.auth, {
        action: 'operator.turn.complete',
        resourceType: 'operator_session',
        resourceId: input.session.id,
        resourceName: input.session.title,
        metadata: { turnId: input.turn.id },
      });
    });
  }

  async failTurn(input: {
    turn: OperatorTurnRecord;
    session: OperatorSessionRecord;
    error: string;
    auth: AuthContext;
  }): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx
        .update(operatorTurnsTable)
        .set({ status: 'failed', error: input.error, completedAt: new Date() })
        .where(eq(operatorTurnsTable.id, input.turn.id));
      await tx
        .update(operatorActionsTable)
        .set({ status: 'failed', error: input.error, completedAt: new Date() })
        .where(
          and(
            eq(operatorActionsTable.turnId, input.turn.id),
            inArray(operatorActionsTable.status, [
              'proposed',
              'pending_approval',
              'approved',
              'executing',
            ]),
          ),
        );
      await tx
        .update(operatorSessionsTable)
        .set({ updatedAt: new Date() })
        .where(eq(operatorSessionsTable.id, input.session.id));
      await this.auditLogService.recordDurableWithExecutor(tx, input.auth, {
        action: 'operator.turn.failed',
        resourceType: 'operator_session',
        resourceId: input.session.id,
        resourceName: input.session.title,
        metadata: { turnId: input.turn.id },
      });
    });
  }
}
