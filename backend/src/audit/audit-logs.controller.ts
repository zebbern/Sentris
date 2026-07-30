import { Controller, Get, Query, Res } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiProduces, ApiTags } from '@nestjs/swagger';
import { escapeCsvCell } from '@sentris/shared';
import type { Response } from 'express';
import { ZodValidationPipe } from 'nestjs-zod';

import { CurrentAuth } from '../auth/auth-context.decorator';
import type { AuthContext } from '../auth/types';
import { AuditLogService } from './audit-log.service';
import {
  ListAuditLogsQuerySchema,
  type ListAuditLogsQueryDto,
  ListAuditLogsResponseDto,
} from './dto/audit-logs.dto';
import {
  ExportAuditLogsQuerySchema,
  type ExportAuditLogsQueryDto,
} from './dto/audit-log-export.dto';

const CSV_COLUMNS = [
  'id',
  'timestamp',
  'actorType',
  'actorDisplay',
  'action',
  'resourceType',
  'resourceId',
  'resourceName',
  'ip',
  'correlationId',
  'metadata',
] as const;

async function writeWithBackpressure(response: Response, chunk: string): Promise<boolean> {
  if (response.destroyed || response.writableEnded) {
    return false;
  }
  if (response.write(chunk)) {
    return true;
  }

  await new Promise<void>((resolve) => {
    const finish = () => {
      response.off('drain', finish);
      response.off('close', finish);
      resolve();
    };
    response.once('drain', finish);
    response.once('close', finish);
  });
  return !response.destroyed && !response.writableEnded;
}

function auditLogCsvRow(item: {
  id: string;
  createdAt: Date;
  actorType: string;
  actorDisplay?: string | null;
  action: string;
  resourceType: string;
  resourceId?: string | null;
  resourceName?: string | null;
  ip?: string | null;
  correlationId?: string | null;
  metadata?: Record<string, unknown> | null;
}): string {
  const metadataStr =
    item.metadata && Object.keys(item.metadata).length > 0 ? JSON.stringify(item.metadata) : '';

  return [
    escapeCsvCell(item.id),
    escapeCsvCell(item.createdAt.toISOString()),
    escapeCsvCell(item.actorType),
    escapeCsvCell(item.actorDisplay),
    escapeCsvCell(item.action),
    escapeCsvCell(item.resourceType),
    escapeCsvCell(item.resourceId),
    escapeCsvCell(item.resourceName),
    escapeCsvCell(item.ip),
    escapeCsvCell(item.correlationId),
    escapeCsvCell(metadataStr),
  ].join(',');
}

@ApiTags('audit-logs')
@Controller('audit-logs')
export class AuditLogsController {
  constructor(private readonly auditLogService: AuditLogService) {}

  @Get('export')
  @ApiOperation({ summary: 'Export audit log events as CSV' })
  @ApiProduces('text/csv')
  @ApiOkResponse({ description: 'CSV file of audit log events' })
  async export(
    @CurrentAuth() auth: AuthContext | null,
    @Query(new ZodValidationPipe(ExportAuditLogsQuerySchema)) query: ExportAuditLogsQueryDto,
    @Res() res: Response,
  ): Promise<void> {
    const from = query.from ? new Date(query.from) : undefined;
    const to = query.to ? new Date(query.to) : undefined;
    const pages = this.auditLogService.exportPages(auth, {
      resourceType: query.resourceType,
      resourceId: query.resourceId,
      action: query.action,
      actorId: query.actorId,
      from,
      to,
    });

    await this.auditLogService.recordDurable(auth, {
      action: 'audit.export',
      resourceType: 'analytics',
      resourceId: null,
      resourceName: null,
      metadata: {
        phase: 'requested',
        resourceType: query.resourceType ?? null,
        resourceId: query.resourceId ?? null,
        action: query.action ?? null,
        actorId: query.actorId ?? null,
        from: query.from ?? null,
        to: query.to ?? null,
      },
    });

    const dateStr = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="audit-logs-${dateStr}.csv"`);

    if (!(await writeWithBackpressure(res, `${CSV_COLUMNS.join(',')}\n`))) {
      return;
    }

    for await (const page of pages) {
      const chunk = `${page.map(auditLogCsvRow).join('\n')}\n`;
      if (!(await writeWithBackpressure(res, chunk))) {
        return;
      }
    }

    res.end();
  }

  @Get()
  @ApiOperation({ summary: 'List audit log events' })
  @ApiOkResponse({
    description: 'List audit log events for the authenticated organization',
    type: ListAuditLogsResponseDto,
  })
  async list(
    @CurrentAuth() auth: AuthContext | null,
    @Query(new ZodValidationPipe(ListAuditLogsQuerySchema)) query: ListAuditLogsQueryDto,
  ): Promise<ListAuditLogsResponseDto> {
    const from = query.from ? new Date(query.from) : undefined;
    const to = query.to ? new Date(query.to) : undefined;

    const result = await this.auditLogService.list(auth, {
      resourceType: query.resourceType,
      resourceId: query.resourceId,
      action: query.action,
      actorId: query.actorId,
      from,
      to,
      limit: query.limit,
      cursor: query.cursor,
    });

    return {
      items: result.items.map((item) => ({
        id: item.id,
        organizationId: item.organizationId ?? null,
        actorId: item.actorId ?? null,
        actorType: item.actorType,
        actorDisplay: item.actorDisplay ?? null,
        action: item.action,
        resourceType: item.resourceType,
        resourceId: item.resourceId ?? null,
        resourceName: item.resourceName ?? null,
        metadata: (item.metadata as any) ?? null,
        ip: item.ip ?? null,
        userAgent: item.userAgent ?? null,
        correlationId: item.correlationId ?? null,
        createdAt: item.createdAt.toISOString(),
      })),
      nextCursor: result.nextCursor,
    };
  }
}
