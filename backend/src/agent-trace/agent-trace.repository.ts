import { Inject, Injectable } from '@nestjs/common';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { and, asc, desc, eq, gt, inArray } from 'drizzle-orm';

import { DRIZZLE_TOKEN } from '../database/database.module';
import { agentTraceEventsTable, type AgentTraceEventRecord } from '../database/schema';
import type { OutboxExecutor } from '../outbox/enqueue-outbox-event';

export interface AgentTraceEventInput {
  eventId: string;
  agentRunId: string;
  workflowRunId: string;
  workflowId?: string | null;
  organizationId?: string | null;
  nodeRef: string;
  sequence: number;
  timestamp: string;
  part: Record<string, unknown>;
}

const AGENT_ACTIVITY_PART_TYPES = [
  'message-start',
  'finish',
  'tool-input-available',
  'tool-output-available',
  'tool-input-error',
  'tool-output-error',
  'data-tool-error',
] as const;

@Injectable()
export class AgentTraceRepository {
  constructor(
    @Inject(DRIZZLE_TOKEN)
    private readonly db: NodePgDatabase,
  ) {}

  async append(event: AgentTraceEventInput): Promise<void> {
    await this.appendWithExecutor(this.db, event);
  }

  async appendWithExecutor(executor: OutboxExecutor, event: AgentTraceEventInput): Promise<void> {
    await executor.insert(agentTraceEventsTable).values({
      agentRunId: event.agentRunId,
      workflowRunId: event.workflowRunId,
      nodeRef: event.nodeRef,
      sequence: event.sequence,
      timestamp: new Date(event.timestamp),
      partType: typeof event.part?.type === 'string' ? String(event.part.type) : 'data',
      payload: event.part,
    });
  }

  async list(agentRunId: string): Promise<AgentTraceEventRecord[]> {
    return this.db
      .select()
      .from(agentTraceEventsTable)
      .where(eq(agentTraceEventsTable.agentRunId, agentRunId))
      .orderBy(asc(agentTraceEventsTable.sequence));
  }

  async listAfter(agentRunId: string, sequence: number): Promise<AgentTraceEventRecord[]> {
    return this.db
      .select()
      .from(agentTraceEventsTable)
      .where(
        and(
          eq(agentTraceEventsTable.agentRunId, agentRunId),
          gt(agentTraceEventsTable.sequence, sequence),
        ),
      )
      .orderBy(asc(agentTraceEventsTable.sequence));
  }

  async listMany(agentRunIds: readonly string[]): Promise<AgentTraceEventRecord[]> {
    if (agentRunIds.length === 0) return [];
    return this.db
      .select()
      .from(agentTraceEventsTable)
      .where(inArray(agentTraceEventsTable.agentRunId, [...agentRunIds]))
      .orderBy(asc(agentTraceEventsTable.timestamp), asc(agentTraceEventsTable.id));
  }

  async getLatestFinish(agentRunId: string): Promise<AgentTraceEventRecord | null> {
    const [event] = await this.db
      .select()
      .from(agentTraceEventsTable)
      .where(
        and(
          eq(agentTraceEventsTable.agentRunId, agentRunId),
          eq(agentTraceEventsTable.partType, 'finish'),
        ),
      )
      .orderBy(desc(agentTraceEventsTable.sequence), desc(agentTraceEventsTable.id))
      .limit(1);
    return event ?? null;
  }

  async listRunActivityEvents(
    workflowRunId: string,
    limit: number,
  ): Promise<AgentTraceEventRecord[]> {
    return this.db
      .select()
      .from(agentTraceEventsTable)
      .where(
        and(
          eq(agentTraceEventsTable.workflowRunId, workflowRunId),
          inArray(agentTraceEventsTable.partType, [...AGENT_ACTIVITY_PART_TYPES]),
        ),
      )
      .orderBy(desc(agentTraceEventsTable.timestamp), desc(agentTraceEventsTable.id))
      .limit(limit);
  }

  async getRunMetadata(
    agentRunId: string,
  ): Promise<{ workflowRunId: string; nodeRef: string } | null> {
    const rows = await this.db
      .select({
        workflowRunId: agentTraceEventsTable.workflowRunId,
        nodeRef: agentTraceEventsTable.nodeRef,
      })
      .from(agentTraceEventsTable)
      .where(eq(agentTraceEventsTable.agentRunId, agentRunId))
      .orderBy(asc(agentTraceEventsTable.sequence))
      .limit(1);

    if (!rows.length) {
      return null;
    }

    return rows[0];
  }
}
