import { ConflictException, Inject, Injectable } from '@nestjs/common';
import { and, eq, inArray, max } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DRIZZLE_TOKEN } from '../database/database.module';
import {
  agentConversationTurnsTable,
  type AgentConversationTurnRecord,
  type AgentConversationTurnStatus,
} from '../database/schema';
import type { KafkaProjectionExecutor } from '../outbox/outbox.repository';

interface CreateAgentConversationTurnInput {
  id: string;
  conversationId: string;
  agentRunId: string;
  sourceAgentRunId: string;
  organizationId: string | null;
  workflowRunId: string;
  nodeRef: string;
  prompt: string;
  sourceStateFileId: string;
  sourceStateRootFileId: string;
  temporalWorkflowId: string;
}

@Injectable()
export class AgentConversationRepository {
  constructor(
    @Inject(DRIZZLE_TOKEN)
    private readonly db: NodePgDatabase,
  ) {}

  async createTurn(input: CreateAgentConversationTurnInput): Promise<AgentConversationTurnRecord> {
    try {
      return await this.db.transaction(async (tx) => {
        const [latest] = await tx
          .select({ turnIndex: max(agentConversationTurnsTable.turnIndex) })
          .from(agentConversationTurnsTable)
          .where(eq(agentConversationTurnsTable.conversationId, input.conversationId));
        const turnIndex = (latest?.turnIndex ?? 0) + 1;
        const [created] = await tx
          .insert(agentConversationTurnsTable)
          .values({ ...input, turnIndex })
          .returning();
        if (!created) throw new Error('Agent follow-up turn was not created');
        return created;
      });
    } catch (error: unknown) {
      if (isUniqueViolation(error)) {
        const existing = await this.findById(input.id);
        if (existing && matchesCreateInput(existing, input)) return existing;
        throw new ConflictException('Another follow-up turn is already active');
      }
      throw error;
    }
  }

  async findById(id: string): Promise<AgentConversationTurnRecord | null> {
    const [turn] = await this.db
      .select()
      .from(agentConversationTurnsTable)
      .where(eq(agentConversationTurnsTable.id, id))
      .limit(1);
    return turn ?? null;
  }

  async listTurns(conversationId: string): Promise<AgentConversationTurnRecord[]> {
    return this.db
      .select()
      .from(agentConversationTurnsTable)
      .where(eq(agentConversationTurnsTable.conversationId, conversationId))
      .orderBy(agentConversationTurnsTable.turnIndex);
  }

  async findByAgentRunId(agentRunId: string): Promise<AgentConversationTurnRecord | null> {
    const [turn] = await this.db
      .select()
      .from(agentConversationTurnsTable)
      .where(eq(agentConversationTurnsTable.agentRunId, agentRunId))
      .limit(1);
    return turn ?? null;
  }

  async markStarted(id: string, temporalRunId: string): Promise<void> {
    await this.db
      .update(agentConversationTurnsTable)
      .set({
        status: 'running',
        temporalRunId,
        startedAt: new Date(),
      })
      .where(
        and(
          eq(agentConversationTurnsTable.id, id),
          eq(agentConversationTurnsTable.status, 'queued'),
        ),
      );
  }

  async markStartFailed(id: string, error: string): Promise<void> {
    await this.db
      .update(agentConversationTurnsTable)
      .set({ status: 'failed', error, completedAt: new Date() })
      .where(
        and(
          eq(agentConversationTurnsTable.id, id),
          eq(agentConversationTurnsTable.status, 'queued'),
        ),
      );
  }

  async markTerminalWithExecutor(
    executor: KafkaProjectionExecutor,
    input: {
      agentRunId: string;
      status: Extract<AgentConversationTurnStatus, 'completed' | 'failed'>;
      responseText?: string;
      error?: string;
      completedAt: Date;
    },
  ): Promise<void> {
    await executor
      .update(agentConversationTurnsTable)
      .set({
        status: input.status,
        responseText: input.responseText ?? null,
        error: input.error ?? null,
        completedAt: input.completedAt,
      })
      .where(
        and(
          eq(agentConversationTurnsTable.agentRunId, input.agentRunId),
          inArray(agentConversationTurnsTable.status, ['queued', 'running']),
        ),
      );
  }
}

function isUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const code = (error as { code?: unknown }).code;
  if (code === '23505') return true;
  const cause = (error as { cause?: unknown }).cause;
  return Boolean(
    cause && typeof cause === 'object' && (cause as { code?: unknown }).code === '23505',
  );
}

function matchesCreateInput(
  turn: AgentConversationTurnRecord,
  input: CreateAgentConversationTurnInput,
): boolean {
  return (
    turn.conversationId === input.conversationId &&
    turn.agentRunId === input.agentRunId &&
    turn.sourceAgentRunId === input.sourceAgentRunId &&
    turn.organizationId === input.organizationId &&
    turn.workflowRunId === input.workflowRunId &&
    turn.nodeRef === input.nodeRef &&
    turn.prompt === input.prompt &&
    turn.sourceStateFileId === input.sourceStateFileId &&
    turn.sourceStateRootFileId === input.sourceStateRootFileId &&
    turn.temporalWorkflowId === input.temporalWorkflowId
  );
}
