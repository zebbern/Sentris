import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, type SQL } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DRIZZLE_TOKEN } from '../../database/database.module';
import {
  type WebhookConfigurationRecord,
  type WebhookConfigurationInsert,
  webhookConfigurationsTable,
} from '../../database/schema';
import type { OutboxExecutor } from '../../outbox/enqueue-outbox-event';

type WebhookMutationHook<T = void> = (executor: OutboxExecutor, result: T) => Promise<void>;

export interface WebhookRepositoryFilters {
  workflowId?: string;
  status?: string;
  organizationId?: string | null;
}

@Injectable()
export class WebhookRepository {
  constructor(
    @Inject(DRIZZLE_TOKEN)
    private readonly db: NodePgDatabase,
  ) {}

  async create(
    values: Omit<WebhookConfigurationInsert, 'id'>,
    onMutated?: WebhookMutationHook<WebhookConfigurationRecord>,
  ): Promise<WebhookConfigurationRecord> {
    const mutate = async (executor: Pick<NodePgDatabase, 'insert'>) => {
      const [record] = await executor.insert(webhookConfigurationsTable).values(values).returning();
      await onMutated?.(executor, record);
      return record;
    };
    return onMutated ? this.db.transaction((tx) => mutate(tx)) : mutate(this.db);
  }

  async update(
    id: string,
    values: Partial<WebhookConfigurationInsert>,
    options: { organizationId?: string | null } = {},
    onMutated?: WebhookMutationHook<WebhookConfigurationRecord>,
  ): Promise<WebhookConfigurationRecord | undefined> {
    const mutate = async (executor: Pick<NodePgDatabase, 'insert' | 'update'>) => {
      const [record] = await executor
        .update(webhookConfigurationsTable)
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

  async findById(
    id: string,
    options: { organizationId?: string | null } = {},
  ): Promise<WebhookConfigurationRecord | undefined> {
    const [record] = await this.db
      .select()
      .from(webhookConfigurationsTable)
      .where(this.buildIdFilter(id, options.organizationId))
      .limit(1);
    return record;
  }

  async findByPath(path: string): Promise<WebhookConfigurationRecord | undefined> {
    const [record] = await this.db
      .select()
      .from(webhookConfigurationsTable)
      .where(eq(webhookConfigurationsTable.webhookPath, path))
      .limit(1);
    return record;
  }

  async delete(
    id: string,
    options: { organizationId?: string | null } = {},
    onMutated?: WebhookMutationHook,
  ): Promise<void> {
    const mutate = async (executor: Pick<NodePgDatabase, 'delete' | 'insert'>) => {
      await executor
        .delete(webhookConfigurationsTable)
        .where(this.buildIdFilter(id, options.organizationId));
      await onMutated?.(executor, undefined);
    };
    await (onMutated ? this.db.transaction((tx) => mutate(tx)) : mutate(this.db));
  }

  async list(filters: WebhookRepositoryFilters = {}): Promise<WebhookConfigurationRecord[]> {
    const conditions: SQL<unknown>[] = [];

    if (filters.workflowId) {
      conditions.push(eq(webhookConfigurationsTable.workflowId, filters.workflowId));
    }

    if (filters.status) {
      conditions.push(
        eq(webhookConfigurationsTable.status, filters.status as 'active' | 'inactive'),
      );
    }

    if (filters.organizationId) {
      conditions.push(eq(webhookConfigurationsTable.organizationId, filters.organizationId));
    }

    const baseQuery = this.db.select().from(webhookConfigurationsTable);

    if (conditions.length === 0) {
      return baseQuery.orderBy(desc(webhookConfigurationsTable.createdAt));
    }

    let combinedCondition: SQL<unknown> = conditions[0]!;
    for (let index = 1; index < conditions.length; index += 1) {
      const nextCondition = and(combinedCondition, conditions[index]!);
      combinedCondition = nextCondition ?? combinedCondition;
    }

    return baseQuery.where(combinedCondition).orderBy(desc(webhookConfigurationsTable.createdAt));
  }

  private buildIdFilter(id: string, organizationId?: string | null) {
    const idFilter = eq(webhookConfigurationsTable.id, id);
    if (!organizationId) {
      return idFilter;
    }
    return and(idFilter, eq(webhookConfigurationsTable.organizationId, organizationId));
  }
}
