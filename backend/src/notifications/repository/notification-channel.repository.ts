import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, sql, type SQL } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DRIZZLE_TOKEN } from '../../database/database.module';
import {
  type NotificationChannelRecord,
  type NotificationChannelInsert,
  notificationChannelsTable,
} from '../../database/schema';
import type { OutboxExecutor } from '../../outbox/enqueue-outbox-event';

type ChannelMutationHook<T = void> = (executor: OutboxExecutor, result: T) => Promise<void>;

@Injectable()
export class NotificationChannelRepository {
  constructor(
    @Inject(DRIZZLE_TOKEN)
    private readonly db: NodePgDatabase,
  ) {}

  async create(
    values: Omit<NotificationChannelInsert, 'id'>,
    onMutated?: ChannelMutationHook<NotificationChannelRecord>,
  ): Promise<NotificationChannelRecord> {
    const mutate = async (executor: Pick<NodePgDatabase, 'insert'>) => {
      const [record] = await executor.insert(notificationChannelsTable).values(values).returning();
      await onMutated?.(executor, record);
      return record;
    };
    return onMutated ? this.db.transaction((tx) => mutate(tx)) : mutate(this.db);
  }

  async findById(
    id: string,
    options: { organizationId?: string } = {},
  ): Promise<NotificationChannelRecord | undefined> {
    const [record] = await this.db
      .select()
      .from(notificationChannelsTable)
      .where(this.buildIdFilter(id, options.organizationId))
      .limit(1);
    return record;
  }

  async list(filters: { organizationId: string }): Promise<NotificationChannelRecord[]> {
    return this.db
      .select()
      .from(notificationChannelsTable)
      .where(eq(notificationChannelsTable.organizationId, filters.organizationId))
      .orderBy(desc(notificationChannelsTable.createdAt));
  }

  async update(
    id: string,
    values: Partial<NotificationChannelInsert>,
    options: { organizationId?: string } = {},
    onMutated?: ChannelMutationHook<NotificationChannelRecord>,
  ): Promise<NotificationChannelRecord | undefined> {
    const mutate = async (executor: Pick<NodePgDatabase, 'insert' | 'update'>) => {
      const [record] = await executor
        .update(notificationChannelsTable)
        .set({
          ...values,
          updatedAt: new Date(),
        })
        .where(this.buildIdFilter(id, options.organizationId))
        .returning();
      if (record) {
        await onMutated?.(executor, record);
      }
      return record;
    };
    return onMutated ? this.db.transaction((tx) => mutate(tx)) : mutate(this.db);
  }

  async delete(
    id: string,
    options: { organizationId?: string } = {},
    onMutated?: ChannelMutationHook,
  ): Promise<boolean> {
    const mutate = async (executor: Pick<NodePgDatabase, 'delete' | 'insert'>) => {
      const [deleted] = await executor
        .delete(notificationChannelsTable)
        .where(this.buildIdFilter(id, options.organizationId))
        .returning({ id: notificationChannelsTable.id });
      if (!deleted) {
        return false;
      }
      await onMutated?.(executor, undefined);
      return true;
    };
    return onMutated ? this.db.transaction((tx) => mutate(tx)) : mutate(this.db);
  }

  /**
   * Find all active channels that subscribe to a given event type for an organization.
   * Uses JSONB array containment: `events @> '["run.failed"]'::jsonb`
   */
  async findActiveByEventType(
    organizationId: string,
    eventType: string,
  ): Promise<NotificationChannelRecord[]> {
    return this.db
      .select()
      .from(notificationChannelsTable)
      .where(
        and(
          eq(notificationChannelsTable.organizationId, organizationId),
          eq(notificationChannelsTable.status, 'active'),
          sql`${notificationChannelsTable.events} @> ${JSON.stringify([eventType])}::jsonb`,
        ),
      );
  }

  private buildIdFilter(id: string, organizationId?: string): SQL<unknown> {
    const idFilter = eq(notificationChannelsTable.id, id);
    if (!organizationId) {
      return idFilter;
    }
    return and(idFilter, eq(notificationChannelsTable.organizationId, organizationId))!;
  }
}
