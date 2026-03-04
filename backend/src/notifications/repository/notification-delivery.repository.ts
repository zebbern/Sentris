import { Inject, Injectable } from '@nestjs/common';
import { desc, eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DRIZZLE_TOKEN } from '../../database/database.module';
import {
  type NotificationDeliveryRecord,
  type NotificationDeliveryInsert,
  notificationDeliveriesTable,
} from '../../database/schema';

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

  async listByChannelId(channelId: string, limit = 100): Promise<NotificationDeliveryRecord[]> {
    return this.db
      .select()
      .from(notificationDeliveriesTable)
      .where(eq(notificationDeliveriesTable.channelId, channelId))
      .orderBy(desc(notificationDeliveriesTable.createdAt))
      .limit(limit);
  }

  async listByRunId(runId: string): Promise<NotificationDeliveryRecord[]> {
    return this.db
      .select()
      .from(notificationDeliveriesTable)
      .where(eq(notificationDeliveriesTable.runId, runId))
      .orderBy(desc(notificationDeliveriesTable.createdAt));
  }
}
