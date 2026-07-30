import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, gte, lt, lte, or, sql, inArray, type SQL } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DRIZZLE_TOKEN } from '../database/database.module';
import {
  auditLogsTable,
  type AuditLogInsert,
  type AuditLogRecord,
  type AuditResourceType,
} from '../database/schema';
import { enqueueOutboxEvent, type OutboxExecutor } from '../outbox/enqueue-outbox-event';

export interface ListAuditLogFilters {
  organizationId: string;
  resourceType?: string | string[];
  resourceId?: string;
  action?: string | string[];
  actorId?: string;
  from?: Date;
  to?: Date;
  limit: number;
  cursor?: {
    createdAt: Date;
    id: string;
  };
}

@Injectable()
export class AuditLogRepository {
  constructor(
    @Inject(DRIZZLE_TOKEN)
    private readonly db: NodePgDatabase,
  ) {}

  async enqueue(
    values: Required<Pick<AuditLogInsert, 'id' | 'createdAt'>> & AuditLogInsert,
    executor: OutboxExecutor = this.db,
  ): Promise<void> {
    await enqueueOutboxEvent(executor, {
      eventType: 'audit.log.persist.v1',
      organizationId: values.organizationId ?? null,
      aggregateType: 'audit_log',
      aggregateId: values.id,
      dedupeKey: `audit.log:${values.id}`,
      payload: {
        auditId: values.id,
        organizationId: values.organizationId ?? null,
        actorId: values.actorId ?? null,
        actorType: values.actorType,
        actorDisplay: values.actorDisplay ?? null,
        action: values.action,
        resourceType: values.resourceType,
        resourceId: values.resourceId ?? null,
        resourceName: values.resourceName ?? null,
        metadata: values.metadata ?? null,
        ip: values.ip ?? null,
        userAgent: values.userAgent ?? null,
        correlationId: values.correlationId ?? null,
        occurredAt: values.createdAt.toISOString(),
      },
    });
  }

  async insert(values: AuditLogInsert): Promise<void> {
    await this.db
      .insert(auditLogsTable)
      .values(values)
      .onConflictDoNothing({ target: auditLogsTable.id });
  }

  async list(filters: ListAuditLogFilters): Promise<AuditLogRecord[]> {
    const conditions: SQL<unknown>[] = [];

    // Always scope by organization.
    conditions.push(eq(auditLogsTable.organizationId, filters.organizationId));

    if (filters.resourceType) {
      if (Array.isArray(filters.resourceType)) {
        if (filters.resourceType.length > 0) {
          conditions.push(
            inArray(auditLogsTable.resourceType, filters.resourceType as AuditResourceType[]),
          );
        }
      } else {
        conditions.push(eq(auditLogsTable.resourceType, filters.resourceType as AuditResourceType));
      }
    }
    if (filters.resourceId) {
      conditions.push(eq(auditLogsTable.resourceId, filters.resourceId));
    }
    if (filters.action) {
      if (Array.isArray(filters.action)) {
        if (filters.action.length > 0) {
          conditions.push(inArray(auditLogsTable.action, filters.action));
        }
      } else {
        conditions.push(eq(auditLogsTable.action, filters.action));
      }
    }
    if (filters.actorId) {
      conditions.push(eq(auditLogsTable.actorId, filters.actorId));
    }
    if (filters.from) {
      conditions.push(gte(auditLogsTable.createdAt, filters.from));
    }
    if (filters.to) {
      conditions.push(lte(auditLogsTable.createdAt, filters.to));
    }

    if (filters.cursor) {
      const cursorCreatedAt = filters.cursor.createdAt;
      const cursorId = filters.cursor.id;
      // Pagination for DESC order: fetch items "older" than the cursor.
      conditions.push(
        or(
          lt(auditLogsTable.createdAt, cursorCreatedAt),
          and(
            eq(auditLogsTable.createdAt, cursorCreatedAt),
            sql`${auditLogsTable.id}::text < ${cursorId}`,
          ),
        )!,
      );
    }

    let whereCondition: SQL<unknown> = conditions[0]!;
    for (let index = 1; index < conditions.length; index += 1) {
      const next = and(whereCondition, conditions[index]!);
      whereCondition = next ?? whereCondition;
    }

    return this.db
      .select()
      .from(auditLogsTable)
      .where(whereCondition)
      .orderBy(desc(auditLogsTable.createdAt), desc(auditLogsTable.id))
      .limit(filters.limit);
  }
}
