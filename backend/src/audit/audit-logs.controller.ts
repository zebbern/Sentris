import { Controller, Get, Query, Res } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiProduces, ApiTags } from '@nestjs/swagger';
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
  'metadata',
] as const;

function escapeCsvValue(value: string | null | undefined): string {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
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
    @Res({ passthrough: true }) res: Response,
  ): Promise<string> {
    const from = query.from ? new Date(query.from) : undefined;
    const to = query.to ? new Date(query.to) : undefined;

    const items = await this.auditLogService.exportAll(auth, {
      resourceType: query.resourceType,
      resourceId: query.resourceId,
      action: query.action,
      actorId: query.actorId,
      from,
      to,
    });

    const dateStr = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="audit-logs-${dateStr}.csv"`);

    const rows: string[] = [CSV_COLUMNS.join(',')];
    for (const item of items) {
      const metadataStr =
        item.metadata && Object.keys(item.metadata).length > 0 ? JSON.stringify(item.metadata) : '';

      rows.push(
        [
          escapeCsvValue(item.id),
          escapeCsvValue(item.createdAt.toISOString()),
          escapeCsvValue(item.actorType),
          escapeCsvValue(item.actorDisplay),
          escapeCsvValue(item.action),
          escapeCsvValue(item.resourceType),
          escapeCsvValue(item.resourceId),
          escapeCsvValue(item.resourceName),
          escapeCsvValue(item.ip),
          escapeCsvValue(metadataStr),
        ].join(','),
      );
    }

    return rows.join('\n');
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
        createdAt: item.createdAt.toISOString(),
      })),
      nextCursor: result.nextCursor,
    };
  }
}
