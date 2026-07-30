import { Inject, Injectable } from '@nestjs/common';
import { eq, and, sql } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { nodeIOTable, type NodeIORecord, type NodeIOInsert } from '../database/schema';
import { DRIZZLE_TOKEN } from '../database/database.module';
import { enqueueOutboxEvent, type OutboxExecutor } from '../outbox/enqueue-outbox-event';

export interface NodeIOData {
  runId: string;
  nodeRef: string;
  workflowId?: string;
  organizationId?: string | null;
  componentId: string;
  inputs?: Record<string, unknown>;
  outputs?: Record<string, unknown>;
  startedAt?: Date;
  completedAt?: Date;
  status: 'running' | 'completed' | 'failed' | 'skipped';
  errorMessage?: string;
}

import { createSpilledMarker } from '@sentris/component-sdk';

interface NodeIOStartData {
  runId: string;
  nodeRef: string;
  workflowId?: string;
  organizationId?: string | null;
  componentId: string;
  inputs?: Record<string, unknown>;
  inputsSpilled?: boolean;
  inputsStorageRef?: string | null;
  inputsSize?: number;
  startedAt?: Date;
}

interface NodeIOCompletionData {
  runId: string;
  nodeRef: string;
  componentId?: string;
  organizationId?: string | null;
  outputs: Record<string, unknown>;
  status: 'completed' | 'failed' | 'skipped';
  errorMessage?: string;
  outputsSpilled?: boolean;
  outputsStorageRef?: string | null;
  outputsSize?: number;
  completedAt?: Date;
  completionEventId?: string;
  projectAssets?: boolean;
}

export type NodeIOTransactionExecutor = OutboxExecutor & Pick<NodePgDatabase, 'select'>;

@Injectable()
export class NodeIORepository {
  constructor(
    @Inject(DRIZZLE_TOKEN)
    private readonly db: NodePgDatabase,
  ) {}

  /**
   * Record node execution start (inputs captured)
   */
  async recordStart(data: NodeIOStartData): Promise<void> {
    await this.recordStartWithExecutor(this.db, data);
  }

  async recordStartWithExecutor(executor: OutboxExecutor, data: NodeIOStartData): Promise<void> {
    const inputsJson = data.inputs ? JSON.stringify(data.inputs) : null;
    const computedInputsSize = inputsJson ? Buffer.byteLength(inputsJson, 'utf8') : 0;

    const inputsSize = data.inputsSize ?? computedInputsSize;
    const inputsStorageRef = data.inputsStorageRef?.trim() || null;
    const inputsSpilled =
      data.inputsSpilled === true ||
      (data.inputsSpilled === undefined && inputsStorageRef !== null);
    if (inputsSpilled && !inputsStorageRef) {
      throw new Error('Spilled node inputs require a storage reference');
    }

    const insert: NodeIOInsert = {
      runId: data.runId,
      nodeRef: data.nodeRef,
      workflowId: data.workflowId ?? null,
      organizationId: data.organizationId ?? null,
      componentId: data.componentId,
      inputs: inputsSpilled ? createSpilledMarker(inputsStorageRef!, inputsSize) : data.inputs,
      inputsSize,
      inputsSpilled,
      inputsStorageRef,
      startedAt: data.startedAt ?? new Date(),
      status: 'running',
    };

    await executor
      .insert(nodeIOTable)
      .values(insert)
      .onConflictDoUpdate({
        target: [nodeIOTable.runId, nodeIOTable.nodeRef],
        set: {
          ...insert,
          // Only update status to 'running' if it's not already in a terminal state
          status: sql`CASE 
          WHEN ${nodeIOTable.status} IN ('completed', 'failed', 'skipped') 
          THEN ${nodeIOTable.status} 
          ELSE ${insert.status} 
        END`,
          durationMs: sql`CASE
          WHEN ${nodeIOTable.status} IN ('completed', 'failed', 'skipped')
            AND ${nodeIOTable.completedAt} IS NOT NULL
          THEN GREATEST(
            0,
            FLOOR(EXTRACT(EPOCH FROM (${nodeIOTable.completedAt} - ${insert.startedAt})) * 1000)
          )::integer
          ELSE ${nodeIOTable.durationMs}
        END`,
          updatedAt: new Date(),
        },
      });
  }

  /**
   * Update node execution with outputs (completion)
   */
  async recordCompletion(data: NodeIOCompletionData): Promise<void> {
    if (data.projectAssets) {
      await this.db.transaction(async (tx) => {
        await this.recordCompletionWithExecutor(tx, data);
      });
      return;
    }

    await this.recordCompletionWithExecutor(this.db, data);
  }

  async recordCompletionWithExecutor(
    executor: NodeIOTransactionExecutor,
    data: NodeIOCompletionData,
  ): Promise<void> {
    const outputsJson = JSON.stringify(data.outputs);
    const computedOutputsSize = Buffer.byteLength(outputsJson, 'utf8');

    const outputsSize = data.outputsSize ?? computedOutputsSize;
    const outputsStorageRef = data.outputsStorageRef?.trim() || null;
    const outputsSpilled =
      data.outputsSpilled === true ||
      (data.outputsSpilled === undefined && outputsStorageRef !== null);
    if (outputsSpilled && !outputsStorageRef) {
      throw new Error('Spilled node outputs require a storage reference');
    }

    const completedAt = data.completedAt ?? new Date();

    // Get existing record to calculate duration BEFORE upserting
    const [existing] = await executor
      .select()
      .from(nodeIOTable)
      .where(and(eq(nodeIOTable.runId, data.runId), eq(nodeIOTable.nodeRef, data.nodeRef)))
      .limit(1);
    const durationMs = existing?.startedAt
      ? completedAt.getTime() - new Date(existing.startedAt).getTime()
      : null;

    const insert: NodeIOInsert = {
      runId: data.runId,
      nodeRef: data.nodeRef,
      organizationId: data.organizationId ?? existing?.organizationId ?? null,
      componentId: data.componentId || existing?.componentId || 'unknown',
      outputs: outputsSpilled ? createSpilledMarker(outputsStorageRef!, outputsSize) : data.outputs,
      outputsSize,
      outputsSpilled,
      outputsStorageRef,
      completedAt,
      durationMs,
      status: data.status,
      errorMessage: data.errorMessage ?? null,
    };

    await executor
      .insert(nodeIOTable)
      .values(insert)
      .onConflictDoUpdate({
        target: [nodeIOTable.runId, nodeIOTable.nodeRef],
        set: {
          outputs: insert.outputs,
          outputsSize: insert.outputsSize,
          outputsSpilled: insert.outputsSpilled,
          outputsStorageRef: insert.outputsStorageRef,
          completedAt: insert.completedAt,
          durationMs: insert.durationMs,
          status: insert.status,
          errorMessage: insert.errorMessage,
          updatedAt: new Date(),
        },
      });

    if (data.projectAssets) {
      const componentId = data.componentId || existing?.componentId || 'unknown';
      const completionEventId = data.completionEventId ?? completedAt.toISOString();
      await enqueueOutboxEvent(executor, {
        eventType: 'asset.nodeio.completed',
        organizationId: data.organizationId ?? existing?.organizationId ?? null,
        aggregateType: 'node_io',
        aggregateId: `${data.runId}:${data.nodeRef}`,
        dedupeKey: `asset.nodeio.completed:${data.runId}:${data.nodeRef}:${completionEventId}`,
        payload: {
          runId: data.runId,
          nodeRef: data.nodeRef,
          componentId,
        },
      });
    }
  }

  /**
   * Get all node I/O records for a run
   */
  async listByRunId(runId: string, organizationId?: string | null): Promise<NodeIORecord[]> {
    const conditions = [eq(nodeIOTable.runId, runId)];
    if (organizationId) {
      conditions.push(eq(nodeIOTable.organizationId, organizationId));
    }

    return this.db
      .select()
      .from(nodeIOTable)
      .where(and(...conditions))
      .orderBy(nodeIOTable.startedAt);
  }

  /**
   * Get I/O for a specific node in a run
   */
  async findByRunAndNode(runId: string, nodeRef: string): Promise<NodeIORecord | null> {
    const [record] = await this.db
      .select()
      .from(nodeIOTable)
      .where(and(eq(nodeIOTable.runId, runId), eq(nodeIOTable.nodeRef, nodeRef)))
      .limit(1);

    return record ?? null;
  }
}
