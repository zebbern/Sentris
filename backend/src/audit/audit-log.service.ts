import { randomUUID } from 'node:crypto';
import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { z } from 'zod';

import type { AuthContext } from '../auth/types';
import { DEFAULT_ORGANIZATION_ID } from '../auth/constants';
import {
  AUDIT_RESOURCE_TYPES,
  type AuditActorType,
  type AuditLogInsert,
  type AuditResourceType,
} from '../database/schema/audit-logs';
import { AuditLogRepository } from './audit-log.repository';
import type { OutboxExecutor } from '../outbox/enqueue-outbox-event';
import { currentAuditRequestMeta } from './audit-request-context';

export interface AuditRequestMeta {
  ip?: string | null;
  userAgent?: string | null;
  correlationId?: string | null;
}

export interface AuditEventInput {
  action: string;
  resourceType: AuditResourceType;
  resourceId?: string | null;
  resourceName?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface ListAuditLogsInput {
  resourceType?: string | string[];
  resourceId?: string;
  action?: string | string[];
  actorId?: string;
  from?: Date;
  to?: Date;
  limit: number;
  cursor?: string;
}

export interface ExportAuditLogsInput {
  resourceType?: string | string[];
  resourceId?: string;
  action?: string | string[];
  actorId?: string;
  from?: Date;
  to?: Date;
}

export const AUDIT_EXPORT_PAGE_SIZE = 1_000;
const AUDIT_PERSIST_EVENT = 'audit.log.persist.v1';
export const BEST_EFFORT_AUDIT_ACTIONS = [
  'analytics.query',
  'findings.detail',
  'findings.list',
  'findings.stats',
] as const;
export type BestEffortAuditAction = (typeof BEST_EFFORT_AUDIT_ACTIONS)[number];

const AuditPersistEventSchema = z.object({
  auditId: z.string().uuid(),
  organizationId: z.string().max(191).nullable(),
  actorId: z.string().max(191).nullable(),
  actorType: z.enum(['user', 'api-key', 'internal', 'unknown']),
  actorDisplay: z.string().max(191).nullable(),
  action: z.string().min(1).max(64),
  resourceType: z.enum(AUDIT_RESOURCE_TYPES),
  resourceId: z.string().max(191).nullable(),
  resourceName: z.string().max(191).nullable(),
  metadata: z.record(z.string(), z.unknown()).nullable(),
  ip: z.string().max(64).nullable(),
  userAgent: z.string().nullable(),
  correlationId: z.string().max(191).nullable(),
  occurredAt: z.string().datetime(),
});

function actorTypeFromAuth(auth: AuthContext | null): AuditActorType {
  if (!auth) return 'unknown';
  if (auth.provider === 'api-key') return 'api-key';
  if (auth.provider === 'internal') return 'internal';
  if (auth.isAuthenticated) return 'user';
  return 'unknown';
}

function decodeCursor(cursor: string): { createdAt: Date; id: string } | null {
  try {
    const raw = Buffer.from(cursor, 'base64url').toString('utf8');
    const [createdAtIso, id] = raw.split('|');
    if (!createdAtIso || !id) return null;
    const createdAt = new Date(createdAtIso);
    if (Number.isNaN(createdAt.getTime())) return null;
    return { createdAt, id };
  } catch {
    return null;
  }
}

function encodeCursor(createdAt: Date, id: string): string {
  return Buffer.from(`${createdAt.toISOString()}|${id}`, 'utf8').toString('base64url');
}

@Injectable()
export class AuditLogService {
  private readonly logger = new Logger(AuditLogService.name);

  constructor(private readonly repository: AuditLogRepository) {}

  canRead(auth: AuthContext | null): boolean {
    if (!auth?.isAuthenticated) return false;

    if (auth.roles.includes('ADMIN')) {
      return true;
    }

    if (auth.provider === 'api-key') {
      return Boolean(auth.apiKeyPermissions?.audit?.read);
    }

    return false;
  }

  recordBestEffort(
    auth: AuthContext | null,
    event: AuditEventInput & { action: BestEffortAuditAction },
    meta?: AuditRequestMeta,
    organizationIdOverride?: string | null,
  ): void {
    const values = this.buildInsert(auth, event, meta, organizationIdOverride);
    void this.repository.insert(values).catch((error: unknown) => {
      this.logger.warn(
        `Failed to write audit log action=${event.action} resourceType=${event.resourceType}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    });
  }

  async recordDurable(
    auth: AuthContext | null,
    event: AuditEventInput,
    meta?: AuditRequestMeta,
    organizationIdOverride?: string | null,
  ): Promise<void> {
    await this.repository.enqueue(this.buildInsert(auth, event, meta, organizationIdOverride));
  }

  async recordDurableWithExecutor(
    executor: OutboxExecutor,
    auth: AuthContext | null,
    event: AuditEventInput,
    meta?: AuditRequestMeta,
    organizationIdOverride?: string | null,
  ): Promise<void> {
    await this.repository.enqueue(
      this.buildInsert(auth, event, meta, organizationIdOverride),
      executor,
    );
  }

  private buildInsert(
    auth: AuthContext | null,
    event: AuditEventInput,
    meta?: AuditRequestMeta,
    organizationIdOverride?: string | null,
  ): Required<Pick<AuditLogInsert, 'id' | 'createdAt'>> & AuditLogInsert {
    const organizationId =
      organizationIdOverride ?? auth?.organizationId ?? DEFAULT_ORGANIZATION_ID;
    const actorType = actorTypeFromAuth(auth);
    const actorId = auth?.userId ?? null;

    const requestMeta = currentAuditRequestMeta();
    const values = {
      id: randomUUID(),
      organizationId,
      actorId,
      actorType,
      actorDisplay: null,
      action: event.action,
      resourceType: event.resourceType,
      resourceId: event.resourceId ?? null,
      resourceName: event.resourceName ?? null,
      metadata: event.metadata ?? null,
      ip: meta?.ip ?? requestMeta?.ip ?? null,
      userAgent: meta?.userAgent ?? requestMeta?.userAgent ?? null,
      correlationId: meta?.correlationId ?? requestMeta?.correlationId ?? null,
      createdAt: new Date(),
    };
    return values;
  }

  @OnEvent(AUDIT_PERSIST_EVENT, { async: true })
  async handlePersistEvent(payload: unknown): Promise<void> {
    const event = AuditPersistEventSchema.parse(payload);
    await this.repository.insert({
      id: event.auditId,
      organizationId: event.organizationId,
      actorId: event.actorId,
      actorType: event.actorType,
      actorDisplay: event.actorDisplay,
      action: event.action,
      resourceType: event.resourceType,
      resourceId: event.resourceId,
      resourceName: event.resourceName,
      metadata: event.metadata,
      ip: event.ip,
      userAgent: event.userAgent,
      correlationId: event.correlationId,
      createdAt: new Date(event.occurredAt),
    });
  }

  async list(auth: AuthContext | null, input: ListAuditLogsInput) {
    if (!this.canRead(auth)) {
      throw new ForbiddenException('Audit log access denied');
    }

    const organizationId = auth?.organizationId ?? DEFAULT_ORGANIZATION_ID;
    const cursor = input.cursor ? decodeCursor(input.cursor) : null;

    const resourceTypes = input.resourceType
      ? (Array.isArray(input.resourceType)
          ? input.resourceType
          : input.resourceType.split(',')
        ).map((s) => s.trim())
      : undefined;

    const actions = input.action
      ? (Array.isArray(input.action) ? input.action : input.action.split(',')).map((s) => s.trim())
      : undefined;

    const items = await this.repository.list({
      organizationId,
      resourceType: resourceTypes,
      resourceId: input.resourceId,
      action: actions,
      actorId: input.actorId,
      from: input.from,
      to: input.to,
      limit: input.limit,
      cursor: cursor ?? undefined,
    });

    const nextCursor =
      items.length === input.limit
        ? encodeCursor(items[items.length - 1]!.createdAt, items[items.length - 1]!.id)
        : null;

    return { items, nextCursor };
  }

  exportPages(
    auth: AuthContext | null,
    input: ExportAuditLogsInput,
    pageSize = AUDIT_EXPORT_PAGE_SIZE,
  ): AsyncGenerator<Awaited<ReturnType<AuditLogRepository['list']>>, void, void> {
    if (!this.canRead(auth)) {
      throw new ForbiddenException('Audit log access denied');
    }
    if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > AUDIT_EXPORT_PAGE_SIZE) {
      throw new RangeError(
        `Audit export page size must be between 1 and ${AUDIT_EXPORT_PAGE_SIZE}`,
      );
    }

    const organizationId = auth?.organizationId ?? DEFAULT_ORGANIZATION_ID;

    const resourceTypes = input.resourceType
      ? (Array.isArray(input.resourceType)
          ? input.resourceType
          : input.resourceType.split(',')
        ).map((s) => s.trim())
      : undefined;

    const actions = input.action
      ? (Array.isArray(input.action) ? input.action : input.action.split(',')).map((s) => s.trim())
      : undefined;

    return this.iterateExportPages({
      organizationId,
      resourceType: resourceTypes,
      resourceId: input.resourceId,
      action: actions,
      actorId: input.actorId,
      from: input.from,
      to: input.to,
      limit: pageSize,
    });
  }

  private async *iterateExportPages(
    filters: Omit<Parameters<AuditLogRepository['list']>[0], 'cursor'>,
  ): AsyncGenerator<Awaited<ReturnType<AuditLogRepository['list']>>, void, void> {
    let cursor: { createdAt: Date; id: string } | undefined;

    while (true) {
      const items = await this.repository.list({
        ...filters,
        cursor,
      });
      if (items.length === 0) {
        return;
      }

      yield items;
      if (items.length < filters.limit) {
        return;
      }

      const lastItem = items[items.length - 1]!;
      cursor = {
        createdAt: lastItem.createdAt,
        id: lastItem.id,
      };
    }
  }
}
