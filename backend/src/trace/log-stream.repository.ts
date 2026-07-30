import { Inject, Injectable } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { workflowLogStreamsTable, type WorkflowLogStreamRecord } from '../database/schema';
import { DRIZZLE_TOKEN } from '../database/database.module';
import type { OutboxExecutor } from '../outbox/enqueue-outbox-event';

export interface LogStreamMetadataInput {
  runId: string;
  nodeRef: string;
  stream: 'stdout' | 'stderr' | 'console';
  labels: Record<string, string>;
  firstTimestamp: Date;
  lastTimestamp: Date;
  lineCount: number;
  organizationId?: string | null;
}

@Injectable()
export class LogStreamRepository {
  constructor(
    @Inject(DRIZZLE_TOKEN)
    private readonly db: NodePgDatabase,
  ) {}

  async listByRunId(
    runId: string,
    organizationId?: string | null,
    nodeRef?: string,
    stream?: 'stdout' | 'stderr' | 'console',
  ): Promise<WorkflowLogStreamRecord[]> {
    const conditions: ReturnType<typeof eq>[] = [eq(workflowLogStreamsTable.runId, runId)];

    if (organizationId) {
      conditions.push(eq(workflowLogStreamsTable.organizationId, organizationId));
    }

    if (nodeRef) {
      conditions.push(eq(workflowLogStreamsTable.nodeRef, nodeRef));
    }

    if (stream) {
      conditions.push(eq(workflowLogStreamsTable.stream, stream));
    }

    const whereClause = conditions.length > 1 ? and(...conditions) : conditions[0];

    return this.db
      .select()
      .from(workflowLogStreamsTable)
      .where(whereClause)
      .orderBy(workflowLogStreamsTable.firstTimestamp);
  }

  async upsertMetadata(input: LogStreamMetadataInput): Promise<void> {
    await this.upsertMetadataWithExecutor(this.db, input);
  }

  async upsertMetadataWithExecutor(
    executor: OutboxExecutor,
    input: LogStreamMetadataInput,
  ): Promise<void> {
    const values = {
      runId: input.runId,
      nodeRef: input.nodeRef,
      stream: input.stream,
      labels: input.labels,
      firstTimestamp: input.firstTimestamp,
      lastTimestamp: input.lastTimestamp,
      lineCount: input.lineCount,
      organizationId: input.organizationId ?? null,
      updatedAt: new Date(),
    };

    await executor
      .insert(workflowLogStreamsTable)
      .values(values)
      .onConflictDoUpdate({
        target: [
          workflowLogStreamsTable.runId,
          workflowLogStreamsTable.nodeRef,
          workflowLogStreamsTable.stream,
        ],
        set: {
          labels: sql`excluded.labels`,
          organizationId: sql`excluded.organization_id`,
          firstTimestamp: sql`LEAST(${workflowLogStreamsTable.firstTimestamp}, excluded.first_timestamp)`,
          lastTimestamp: sql`GREATEST(${workflowLogStreamsTable.lastTimestamp}, excluded.last_timestamp)`,
          lineCount: sql`${workflowLogStreamsTable.lineCount} + excluded.line_count`,
          updatedAt: sql`excluded.updated_at`,
        },
      });
  }
}
