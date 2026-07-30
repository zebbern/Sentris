import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DRIZZLE_TOKEN } from '../../database/database.module';
import {
  type NotificationDeliveryRecord,
  type NotificationDeliveryInsert,
  notificationDeliveriesTable,
  outboxEventsTable,
} from '../../database/schema';
import type { OutboxExecutor } from '../../outbox/enqueue-outbox-event';

type ManualResendStatus = Extract<NotificationDeliveryRecord['status'], 'failed' | 'unknown'>;
type DeliveryMutationHook = (
  executor: OutboxExecutor,
  record: NotificationDeliveryRecord,
) => Promise<void>;

@Injectable()
export class NotificationDeliveryRepository {
  constructor(
    @Inject(DRIZZLE_TOKEN)
    private readonly db: NodePgDatabase,
  ) {}

  async create(
    values: Omit<NotificationDeliveryInsert, 'id'>,
  ): Promise<NotificationDeliveryRecord> {
    const [record] = await this.db.insert(notificationDeliveriesTable).values(values).returning();
    return record;
  }

  async createWithHook(
    values: NotificationDeliveryInsert,
    onCreated: DeliveryMutationHook,
  ): Promise<NotificationDeliveryRecord> {
    return this.db.transaction(async (tx) => {
      const [record] = await tx.insert(notificationDeliveriesTable).values(values).returning();
      if (!record) {
        throw new Error('Unable to create notification delivery');
      }
      await onCreated(tx, record);
      return record;
    });
  }

  async findOrCreateForOutbox(
    values: Omit<NotificationDeliveryInsert, 'id'> & { outboxEventId: string },
  ): Promise<NotificationDeliveryRecord> {
    const [created] = await this.db
      .insert(notificationDeliveriesTable)
      .values(values)
      .onConflictDoNothing({
        target: [notificationDeliveriesTable.channelId, notificationDeliveriesTable.outboxEventId],
      })
      .returning();
    if (created) return created;

    const [existing] = await this.db
      .select()
      .from(notificationDeliveriesTable)
      .where(
        and(
          eq(notificationDeliveriesTable.channelId, values.channelId),
          eq(notificationDeliveriesTable.outboxEventId, values.outboxEventId),
        ),
      )
      .limit(1);
    if (!existing) {
      throw new Error('Failed to resolve deduplicated notification delivery');
    }
    return existing;
  }

  async update(
    id: string,
    values: Partial<NotificationDeliveryInsert>,
  ): Promise<NotificationDeliveryRecord | undefined> {
    const [record] = await this.db
      .update(notificationDeliveriesTable)
      .set(values)
      .where(eq(notificationDeliveriesTable.id, id))
      .returning();
    return record;
  }

  async claimForSend(id: string): Promise<boolean> {
    const sendingStartedAt = new Date();
    const rows = await this.db
      .update(notificationDeliveriesTable)
      .set({ status: 'sending', sendingStartedAt })
      .where(
        and(
          eq(notificationDeliveriesTable.id, id),
          inArray(notificationDeliveriesTable.status, ['pending', 'failed']),
        ),
      )
      .returning({ id: notificationDeliveriesTable.id });
    return rows.length > 0;
  }

  async reserveManualResend(
    id: string,
    channelId: string,
    expectedStatus: ManualResendStatus,
    reservation: string,
    child: NotificationDeliveryInsert,
    onReserved: DeliveryMutationHook,
  ): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      const [record] = await tx
        .update(notificationDeliveriesTable)
        .set({
          status: 'sending',
          errorMessage: reservation,
          sendingStartedAt: new Date(),
        })
        .where(
          and(
            eq(notificationDeliveriesTable.id, id),
            eq(notificationDeliveriesTable.channelId, channelId),
            eq(notificationDeliveriesTable.status, expectedStatus),
          ),
        )
        .returning();
      if (!record) {
        return false;
      }
      const [createdChild] = await tx.insert(notificationDeliveriesTable).values(child).returning();
      if (!createdChild) {
        throw new Error('Unable to create manual notification delivery attempt');
      }
      await onReserved(tx, record);
      return true;
    });
  }

  async completeManualResend(
    id: string,
    channelId: string,
    reservation: string,
    values: Partial<NotificationDeliveryInsert>,
    executor: Pick<NodePgDatabase, 'update'> = this.db,
  ): Promise<boolean> {
    const rows = await executor
      .update(notificationDeliveriesTable)
      .set({ ...values, sendingStartedAt: null })
      .where(
        and(
          eq(notificationDeliveriesTable.id, id),
          eq(notificationDeliveriesTable.channelId, channelId),
          eq(notificationDeliveriesTable.status, 'sending'),
          eq(notificationDeliveriesTable.errorMessage, reservation),
        ),
      )
      .returning({ id: notificationDeliveriesTable.id });
    return rows.length > 0;
  }

  async finalizeManualResend(
    id: string,
    channelId: string,
    reservation: string,
    values: Partial<NotificationDeliveryInsert>,
    onFinalized: DeliveryMutationHook,
  ): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      const [record] = await tx
        .update(notificationDeliveriesTable)
        .set({ ...values, sendingStartedAt: null })
        .where(
          and(
            eq(notificationDeliveriesTable.id, id),
            eq(notificationDeliveriesTable.channelId, channelId),
            eq(notificationDeliveriesTable.status, 'sending'),
            eq(notificationDeliveriesTable.errorMessage, reservation),
          ),
        )
        .returning();
      if (!record) {
        return false;
      }
      await onFinalized(tx, record);
      return true;
    });
  }

  async findById(id: string): Promise<NotificationDeliveryRecord | undefined> {
    const [record] = await this.db
      .select()
      .from(notificationDeliveriesTable)
      .where(eq(notificationDeliveriesTable.id, id))
      .limit(1);
    return record;
  }

  async markStaleSendingUnknown(
    id: string,
    channelId: string,
    startedBefore: Date,
    errorMessage: string,
  ): Promise<NotificationDeliveryRecord | undefined> {
    const [record] = await this.db
      .update(notificationDeliveriesTable)
      .set({ status: 'unknown', errorMessage, sendingStartedAt: null })
      .where(
        and(
          eq(notificationDeliveriesTable.id, id),
          eq(notificationDeliveriesTable.channelId, channelId),
          eq(notificationDeliveriesTable.status, 'sending'),
          or(
            lte(notificationDeliveriesTable.sendingStartedAt, startedBefore),
            and(
              isNull(notificationDeliveriesTable.sendingStartedAt),
              lte(notificationDeliveriesTable.createdAt, startedBefore),
            ),
          ),
        ),
      )
      .returning();
    return record;
  }

  async purgeResolvedBefore(cutoff: Date, limit: number): Promise<number> {
    const boundedLimit = Math.max(1, Math.min(Math.trunc(limit), 10_000));
    const result = await this.db.execute(sql`
      WITH expired AS (
        SELECT ${notificationDeliveriesTable.id}
        FROM ${notificationDeliveriesTable}
        LEFT JOIN ${outboxEventsTable}
          ON ${outboxEventsTable.id} = ${notificationDeliveriesTable.outboxEventId}
        WHERE
          ${notificationDeliveriesTable.createdAt} < ${cutoff}
          AND ${notificationDeliveriesTable.status} IN ('sent', 'failed')
          AND (
            ${notificationDeliveriesTable.outboxEventId} IS NULL
            OR ${outboxEventsTable.status} = 'completed'
          )
        ORDER BY ${notificationDeliveriesTable.createdAt} ASC, ${notificationDeliveriesTable.id} ASC
        LIMIT ${boundedLimit}
      )
      DELETE FROM ${notificationDeliveriesTable}
      USING expired
      WHERE ${notificationDeliveriesTable.id} = expired.id
      RETURNING ${notificationDeliveriesTable.id}
    `);
    const rows = Array.isArray(result) ? result : ((result as { rows?: unknown[] }).rows ?? []);
    return rows.length;
  }

  async listByChannelId(
    channelId: string,
    limit = 100,
    offset = 0,
  ): Promise<NotificationDeliveryRecord[]> {
    return this.db
      .select()
      .from(notificationDeliveriesTable)
      .where(eq(notificationDeliveriesTable.channelId, channelId))
      .orderBy(desc(notificationDeliveriesTable.createdAt))
      .limit(limit)
      .offset(offset);
  }

  async listByRunId(runId: string): Promise<NotificationDeliveryRecord[]> {
    return this.db
      .select()
      .from(notificationDeliveriesTable)
      .where(eq(notificationDeliveriesTable.runId, runId))
      .orderBy(desc(notificationDeliveriesTable.createdAt));
  }
}
