import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, sql, type SQL } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DRIZZLE_TOKEN } from '../../database/database.module';
import {
  type NotificationChannelRecord,
  type NotificationChannelInsert,
  notificationChannelsTable,
} from '../../database/schema';

@Injectable()
export class NotificationChannelRepository {
  constructor(
    @Inject(DRIZZLE_TOKEN)
    private readonly db: NodePgDatabase,
  ) {}

  async create(values: Omit<NotificationChannelInsert, 'id'>): Promise<NotificationChannelRecord> {
    const [record] = await this.db.insert(notificationChannelsTable).values(values).returning();
    return record;
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
  ): Promise<NotificationChannelRecord | undefined> {
    const [record] = await this.db
      .update(notificationChannelsTable)
      .set({
        ...values,
        updatedAt: new Date(),
      })
      .where(this.buildIdFilter(id, options.organizationId))
      .returning();
    return record;
  }

  async delete(id: string, options: { organizationId?: string } = {}): Promise<void> {
    await this.db
      .delete(notificationChannelsTable)
      .where(this.buildIdFilter(id, options.organizationId));
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
