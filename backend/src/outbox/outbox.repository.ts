import { Inject, Injectable } from '@nestjs/common';
import { DURABLE_KAFKA_PUBLISH_EVENT } from '@sentris/shared';
import { and, desc, eq, inArray, lt, or, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { alias } from 'drizzle-orm/pg-core';
import { createHash } from 'node:crypto';

import { DRIZZLE_TOKEN } from '../database/database.module';
import {
  outboxEventsTable,
  type OutboxEventRecord,
  type OutboxEventStatus,
} from '../database/schema';
import {
  OUTBOX_LEASE_MS,
  OutboxRepositoryPort,
  type ClaimedOutboxEvent,
  type RescheduleOutboxEventInput,
} from './outbox-dispatcher.service';
import type { OutboxExecutor } from './enqueue-outbox-event';

const MAX_BATCH_SIZE = 200;
const MAX_RECEIPT_CLEANUP_BATCH_SIZE = 10_000;
const MAX_ERROR_LENGTH = 4_000;
export const KAFKA_INGEST_RECEIPT_EVENT_TYPE = 'telemetry.kafka.ingested.v1';
export const KAFKA_POISON_EVENT_TYPE = 'telemetry.kafka.poison.v1';

export interface KafkaMessageIdentity {
  topic: string;
  partition: number;
  offset: string;
}

export type KafkaProjectionExecutor = OutboxExecutor & Pick<NodePgDatabase, 'select' | 'update'>;

interface ClaimedOutboxRow {
  id: string;
  event_type: string;
  organization_id: string | null;
  aggregate_type: string;
  aggregate_id: string;
  dedupe_key: string;
  payload: Record<string, unknown>;
  attempts: number;
  max_attempts: number;
}

export interface EnsureAggregateEventScheduledInput {
  organizationId: string;
  eventType: string;
  aggregateType: string;
  aggregateId: string;
}

export interface DeadLetterCursor {
  createdAt: Date;
  id: string;
}

export interface DeadLetterPage {
  items: OutboxEventRecord[];
  nextCursor: DeadLetterCursor | null;
}

type DeadLetterRequeueExecutor = OutboxExecutor & Pick<NodePgDatabase, 'update'>;
type DeadLetterRequeueHook = (
  executor: DeadLetterRequeueExecutor,
  event: OutboxEventRecord,
) => Promise<void>;

function rowsFromExecuteResult<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  if (result && typeof result === 'object' && Array.isArray((result as { rows?: unknown }).rows)) {
    return (result as { rows: T[] }).rows;
  }
  return [];
}

/**
 * Requeues the oldest dead predecessor for the aggregate only when it is the
 * requested event type. Active events never authorize an operator
 * reconciliation mutation.
 */
export async function ensureAggregateEventScheduledWithExecutor(
  executor: Pick<NodePgDatabase, 'execute'>,
  input: EnsureAggregateEventScheduledInput,
): Promise<boolean> {
  const result = await executor.execute(sql`
    WITH oldest_dead AS (
      SELECT ${outboxEventsTable.id}
      FROM ${outboxEventsTable}
      WHERE
        ${outboxEventsTable.organizationId} = ${input.organizationId}
        AND ${outboxEventsTable.aggregateType} = ${input.aggregateType}
        AND ${outboxEventsTable.aggregateId} = ${input.aggregateId}
        AND ${outboxEventsTable.status} = 'dead'
      ORDER BY ${outboxEventsTable.createdAt} ASC, ${outboxEventsTable.id} ASC
      FOR UPDATE
      LIMIT 1
    ),
    requeued AS (
      UPDATE ${outboxEventsTable}
      SET
        status = 'pending',
        attempts = 0,
        available_at = NOW(),
        locked_at = NULL,
        locked_by = NULL,
        last_error = NULL,
        processed_at = NULL,
        updated_at = NOW()
      FROM oldest_dead
      WHERE ${outboxEventsTable.id} = oldest_dead.id
      RETURNING ${outboxEventsTable.id}, ${outboxEventsTable.eventType}
    )
    SELECT EXISTS (
      SELECT 1
      FROM requeued
      WHERE requeued.event_type = ${input.eventType}
    ) AS scheduled
  `);

  return rowsFromExecuteResult<{ scheduled: boolean }>(result)[0]?.scheduled === true;
}

@Injectable()
export class OutboxRepository extends OutboxRepositoryPort {
  constructor(
    @Inject(DRIZZLE_TOKEN)
    private readonly db: NodePgDatabase,
  ) {
    super();
  }

  /**
   * Atomically claims a Kafka message identity and persists its database
   * projection. A completed outbox row is used as the durable receipt so the
   * consumer can safely retry an unresolved Kafka offset without a new table.
   */
  async runKafkaMessageOnce(
    identity: KafkaMessageIdentity,
    organizationId: string | null,
    project: (executor: KafkaProjectionExecutor) => Promise<void>,
  ): Promise<boolean> {
    const aggregateId = this.kafkaAggregateId(identity);
    return this.runKafkaReceiptOnce(
      identity,
      organizationId,
      'kafka_message',
      aggregateId,
      this.kafkaReceiptDedupeKey(identity),
      {},
      project,
    );
  }

  async runKafkaEventOnce(
    identity: KafkaMessageIdentity,
    eventId: string,
    organizationId: string | null,
    project: (executor: KafkaProjectionExecutor) => Promise<void>,
  ): Promise<boolean> {
    return this.runKafkaReceiptOnce(
      identity,
      organizationId,
      'telemetry_event',
      eventId,
      `telemetry.event.ingested:${eventId}`,
      { eventId },
      project,
    );
  }

  private async runKafkaReceiptOnce(
    identity: KafkaMessageIdentity,
    organizationId: string | null,
    aggregateType: string,
    aggregateId: string,
    dedupeKey: string,
    extraPayload: Record<string, unknown>,
    project: (executor: KafkaProjectionExecutor) => Promise<void>,
  ): Promise<boolean> {
    const now = new Date();

    return this.db.transaction(async (tx) => {
      const receipts = await tx
        .insert(outboxEventsTable)
        .values({
          eventType: KAFKA_INGEST_RECEIPT_EVENT_TYPE,
          organizationId,
          aggregateType,
          aggregateId,
          dedupeKey,
          payload: {
            ...extraPayload,
            topic: identity.topic,
            partition: identity.partition,
            offset: identity.offset,
          },
          status: 'completed',
          attempts: 0,
          maxAttempts: 1,
          availableAt: now,
          processedAt: now,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoNothing({ target: outboxEventsTable.dedupeKey })
        .returning({ id: outboxEventsTable.id });

      if (receipts.length === 0) {
        return false;
      }

      await project(tx);
      return true;
    });
  }

  async hasKafkaMessageReceipt(identity: KafkaMessageIdentity): Promise<boolean> {
    const rows = await this.db
      .select({ id: outboxEventsTable.id })
      .from(outboxEventsTable)
      .where(eq(outboxEventsTable.dedupeKey, this.kafkaReceiptDedupeKey(identity)))
      .limit(1);
    return rows.length > 0;
  }

  async hasKafkaEventReceipt(eventId: string): Promise<boolean> {
    const rows = await this.db
      .select({ id: outboxEventsTable.id })
      .from(outboxEventsTable)
      .where(eq(outboxEventsTable.dedupeKey, `telemetry.event.ingested:${eventId}`))
      .limit(1);
    return rows.length > 0;
  }

  async recordKafkaPoisonMessage(
    identity: KafkaMessageIdentity,
    rawPayload: Buffer,
    error: unknown,
    organizationId: string | null,
  ): Promise<void> {
    const aggregateId = this.kafkaAggregateId(identity);
    const now = new Date();
    const errorMessage = (error instanceof Error ? error.message : String(error)).slice(
      0,
      MAX_ERROR_LENGTH,
    );

    await this.db
      .insert(outboxEventsTable)
      .values({
        eventType: KAFKA_POISON_EVENT_TYPE,
        organizationId,
        aggregateType: 'kafka_message',
        aggregateId,
        dedupeKey: `telemetry.kafka.poison:${aggregateId}`,
        payload: {
          topic: identity.topic,
          partition: identity.partition,
          offset: identity.offset,
          byteLength: rawPayload.byteLength,
          sha256: createHash('sha256').update(rawPayload).digest('hex'),
        },
        status: 'dead',
        attempts: 0,
        maxAttempts: 1,
        availableAt: now,
        lastError: errorMessage,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing({ target: outboxEventsTable.dedupeKey });
  }

  async purgeKafkaReceiptsBefore(cutoff: Date, limit: number): Promise<number> {
    const boundedLimit = Math.max(1, Math.min(Math.trunc(limit), MAX_RECEIPT_CLEANUP_BATCH_SIZE));
    const result = await this.db.execute(sql`
      WITH expired AS (
        SELECT ${outboxEventsTable.id}
        FROM ${outboxEventsTable}
        WHERE
          ${outboxEventsTable.eventType} = ${KAFKA_INGEST_RECEIPT_EVENT_TYPE}
          AND ${outboxEventsTable.status} = 'completed'
          AND ${outboxEventsTable.createdAt} < ${cutoff}
        ORDER BY ${outboxEventsTable.createdAt} ASC, ${outboxEventsTable.id} ASC
        LIMIT ${boundedLimit}
      )
      DELETE FROM ${outboxEventsTable}
      USING expired
      WHERE ${outboxEventsTable.id} = expired.id
      RETURNING ${outboxEventsTable.id}
    `);
    return rowsFromExecuteResult<{ id: string }>(result).length;
  }

  async purgeCompletedTelemetryPublicationsBefore(cutoff: Date, limit: number): Promise<number> {
    const boundedLimit = Math.max(1, Math.min(Math.trunc(limit), MAX_RECEIPT_CLEANUP_BATCH_SIZE));
    const result = await this.db.execute(sql`
      WITH expired AS (
        SELECT ${outboxEventsTable.id}
        FROM ${outboxEventsTable}
        WHERE
          ${outboxEventsTable.eventType} = ${DURABLE_KAFKA_PUBLISH_EVENT}
          AND ${outboxEventsTable.status} = 'completed'
          AND ${outboxEventsTable.createdAt} < ${cutoff}
        ORDER BY ${outboxEventsTable.createdAt} ASC, ${outboxEventsTable.id} ASC
        LIMIT ${boundedLimit}
      )
      DELETE FROM ${outboxEventsTable}
      USING expired
      WHERE ${outboxEventsTable.id} = expired.id
      RETURNING ${outboxEventsTable.id}
    `);
    return rowsFromExecuteResult<{ id: string }>(result).length;
  }

  async claimBatch(workerId: string, limit: number): Promise<ClaimedOutboxEvent[]> {
    const boundedLimit = Math.max(1, Math.min(Math.trunc(limit), MAX_BATCH_SIZE));
    const leaseExpiredBefore = new Date(Date.now() - OUTBOX_LEASE_MS);
    const candidate = alias(outboxEventsTable, 'claim_candidate');
    const predecessor = alias(outboxEventsTable, 'claim_predecessor');
    const result = await this.db.execute(sql`
      WITH claimable AS (
        SELECT ${candidate.id}
        FROM ${outboxEventsTable} AS ${candidate}
        WHERE (
          (
            ${candidate.status} = 'pending'
            AND ${candidate.availableAt} <= NOW()
          )
          OR (
            ${candidate.status} = 'processing'
            AND ${candidate.lockedAt} <= ${leaseExpiredBefore}
          )
        )
        AND NOT EXISTS (
          SELECT 1
          FROM ${outboxEventsTable} AS ${predecessor}
          WHERE
            ${predecessor.organizationId} IS NOT DISTINCT FROM ${candidate.organizationId}
            AND ${predecessor.aggregateType} = ${candidate.aggregateType}
            AND ${predecessor.aggregateId} = ${candidate.aggregateId}
            AND ${predecessor.status} IN ('pending', 'processing', 'dead')
            AND (
              ${predecessor.createdAt} < ${candidate.createdAt}
              OR (
                ${predecessor.createdAt} = ${candidate.createdAt}
                AND ${predecessor.id} < ${candidate.id}
              )
            )
        )
        ORDER BY ${candidate.createdAt} ASC, ${candidate.id} ASC
        FOR UPDATE SKIP LOCKED
        LIMIT ${boundedLimit}
      )
      UPDATE ${outboxEventsTable}
      SET
        status = 'processing',
        attempts = ${outboxEventsTable.attempts} + 1,
        locked_at = NOW(),
        locked_by = ${workerId},
        updated_at = NOW()
      FROM claimable
      WHERE ${outboxEventsTable.id} = claimable.id
      RETURNING
        ${outboxEventsTable.id},
        ${outboxEventsTable.eventType},
        ${outboxEventsTable.organizationId},
        ${outboxEventsTable.aggregateType},
        ${outboxEventsTable.aggregateId},
        ${outboxEventsTable.dedupeKey},
        ${outboxEventsTable.payload},
        ${outboxEventsTable.attempts},
        ${outboxEventsTable.maxAttempts}
    `);

    return rowsFromExecuteResult<ClaimedOutboxRow>(result).map((row) => ({
      id: row.id,
      eventType: row.event_type,
      organizationId: row.organization_id,
      aggregateType: row.aggregate_type,
      aggregateId: row.aggregate_id,
      dedupeKey: row.dedupe_key,
      payload: row.payload,
      attempts: row.attempts,
      maxAttempts: row.max_attempts,
    }));
  }

  async renewLease(eventId: string, workerId: string): Promise<boolean> {
    const now = new Date();
    const rows = await this.db
      .update(outboxEventsTable)
      .set({
        lockedAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(outboxEventsTable.id, eventId),
          eq(outboxEventsTable.status, 'processing'),
          eq(outboxEventsTable.lockedBy, workerId),
        ),
      )
      .returning({ id: outboxEventsTable.id });
    return rows.length > 0;
  }

  async markCompleted(eventId: string, workerId: string): Promise<void> {
    await this.db
      .update(outboxEventsTable)
      .set({
        status: 'completed',
        processedAt: new Date(),
        lockedAt: null,
        lockedBy: null,
        lastError: null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(outboxEventsTable.id, eventId),
          eq(outboxEventsTable.status, 'processing'),
          eq(outboxEventsTable.lockedBy, workerId),
        ),
      );
  }

  async reschedule(
    eventId: string,
    workerId: string,
    input: RescheduleOutboxEventInput,
  ): Promise<void> {
    const status: OutboxEventStatus = input.dead ? 'dead' : 'pending';
    await this.db
      .update(outboxEventsTable)
      .set({
        status,
        availableAt: new Date(Date.now() + input.delayMs),
        lockedAt: null,
        lockedBy: null,
        lastError: input.error,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(outboxEventsTable.id, eventId),
          eq(outboxEventsTable.status, 'processing'),
          eq(outboxEventsTable.lockedBy, workerId),
        ),
      );
  }

  async listDeadLetters(
    organizationId: string,
    limit = 50,
    cursor?: DeadLetterCursor,
  ): Promise<DeadLetterPage> {
    const pageSize = Math.max(1, Math.min(Math.trunc(limit), 100));
    const conditions = [
      eq(outboxEventsTable.organizationId, organizationId),
      eq(outboxEventsTable.status, 'dead'),
    ];
    if (cursor) {
      conditions.push(
        or(
          lt(outboxEventsTable.createdAt, cursor.createdAt),
          and(
            eq(outboxEventsTable.createdAt, cursor.createdAt),
            lt(outboxEventsTable.id, cursor.id),
          ),
        )!,
      );
    }

    const rows = await this.db
      .select()
      .from(outboxEventsTable)
      .where(and(...conditions))
      .orderBy(desc(outboxEventsTable.createdAt), desc(outboxEventsTable.id))
      .limit(pageSize + 1);

    const items = rows.slice(0, pageSize);
    const lastItem = items.at(-1);
    return {
      items,
      nextCursor:
        rows.length > pageSize && lastItem
          ? { createdAt: lastItem.createdAt, id: lastItem.id }
          : null,
    };
  }

  async requeueDeadLetter(
    eventId: string,
    organizationId: string,
    onRequeued?: DeadLetterRequeueHook,
  ): Promise<OutboxEventRecord | undefined> {
    const mutate = async (
      executor: OutboxExecutor & Pick<NodePgDatabase, 'update'>,
    ): Promise<OutboxEventRecord | undefined> => {
      const [event] = await executor
        .update(outboxEventsTable)
        .set({
          status: 'pending',
          attempts: 0,
          availableAt: new Date(),
          lockedAt: null,
          lockedBy: null,
          lastError: null,
          processedAt: null,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(outboxEventsTable.id, eventId),
            eq(outboxEventsTable.organizationId, organizationId),
            eq(outboxEventsTable.status, 'dead'),
          ),
        )
        .returning();
      if (!event) {
        return undefined;
      }
      await onRequeued?.(executor, event);
      return event;
    };

    return onRequeued ? this.db.transaction((tx) => mutate(tx)) : mutate(this.db);
  }

  async hasOutstandingEvent(organizationId: string, eventType: string): Promise<boolean> {
    const rows = await this.db
      .select({ id: outboxEventsTable.id })
      .from(outboxEventsTable)
      .where(
        and(
          eq(outboxEventsTable.organizationId, organizationId),
          eq(outboxEventsTable.eventType, eventType),
          inArray(outboxEventsTable.status, ['pending', 'processing', 'dead']),
        ),
      )
      .limit(1);
    return rows.length > 0;
  }

  private kafkaAggregateId(identity: KafkaMessageIdentity): string {
    return `${identity.topic}:${identity.partition}:${identity.offset}`;
  }

  private kafkaReceiptDedupeKey(identity: KafkaMessageIdentity): string {
    return `telemetry.kafka.ingested:${this.kafkaAggregateId(identity)}`;
  }
}
