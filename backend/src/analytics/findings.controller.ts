import {
  Controller,
  Get,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  Param,
  Query,
  Res,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { ZodValidationPipe } from 'nestjs-zod';

import { CurrentAuth } from '../auth/auth-context.decorator';
import type { AuthContext } from '../auth/types';
import { AuditLogService } from '../audit/audit-log.service';
import { SecurityAnalyticsService } from './security-analytics.service';
import {
  FindingsQueryDto,
  FindingsQuerySchema,
  FindingsResponseDto,
  type FindingItem,
} from './dto/findings-query.dto';
import { FindingDetailResponseDto, FindingIdParamSchema } from './dto/findings-detail.dto';
import { FindingsExportQueryDto, FindingsExportQuerySchema } from './dto/findings-export.dto';
import {
  FindingsStatsQueryDto,
  FindingsStatsQuerySchema,
  FindingsStatsResponseDto,
} from './dto/findings-stats.dto';

@ApiTags('findings')
@Controller('findings')
export class FindingsController {
  private readonly logger = new Logger(FindingsController.name);

  constructor(
    private readonly securityAnalyticsService: SecurityAnalyticsService,
    private readonly auditLogService: AuditLogService,
  ) {}

  /**
   * Build OpenSearch DSL filter clauses from common query parameters.
   * Reused across list, export, and stats endpoints.
   */
  private buildFindingsFilter(query: {
    severity?: string;
    search?: string;
    workflowId?: string;
    componentId?: string;
    dateFrom?: string;
    dateTo?: string;
  }): Record<string, unknown> {
    const mustClauses: Record<string, unknown>[] = [];

    if (query.severity) {
      mustClauses.push({ term: { severity: query.severity } });
    }

    if (query.search) {
      mustClauses.push({
        multi_match: {
          query: query.search,
          fields: ['name', 'title', 'asset_key', 'workflow_name', 'host', 'domain', 'url'],
          type: 'phrase_prefix',
        },
      });
    }

    if (query.workflowId) {
      mustClauses.push({ term: { workflow_id: query.workflowId } });
    }

    if (query.componentId) {
      mustClauses.push({ term: { component_id: query.componentId } });
    }

    if (query.dateFrom || query.dateTo) {
      const range: Record<string, string> = {};
      if (query.dateFrom) range.gte = query.dateFrom;
      if (query.dateTo) range.lte = query.dateTo;
      mustClauses.push({ range: { '@timestamp': range } });
    }

    return mustClauses.length > 0 ? { bool: { must: mustClauses } } : { match_all: {} };
  }

  /**
   * Map a raw OpenSearch hit to a FindingItem shape.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- OpenSearch hit source is untyped
  private mapHitToFindingItem(hit: { _id: string; _source: Record<string, any> }): FindingItem {
    return {
      id: hit._id,
      timestamp: (hit._source['@timestamp'] as string) || new Date().toISOString(),
      severity: (hit._source.severity as string) || undefined,
      name: (hit._source.name as string) || (hit._source.title as string) || undefined,
      asset_key: (hit._source.asset_key as string) || undefined,
      workflow_name: (hit._source.workflow_name as string) || undefined,
      workflow_id: (hit._source.workflow_id as string) || undefined,
      run_id: (hit._source.run_id as string) || undefined,
      component_id: (hit._source.component_id as string) || undefined,
      node_ref: (hit._source.node_ref as string) || undefined,
    };
  }

  /**
   * Require authenticated user with an organization context.
   */
  private requireAuth(auth: AuthContext | null): asserts auth is AuthContext & {
    isAuthenticated: true;
    organizationId: string;
  } {
    if (!auth || !auth.isAuthenticated) {
      throw new UnauthorizedException('Authentication required');
    }
    if (!auth.organizationId) {
      throw new UnauthorizedException('Organization context required');
    }
  }

  @Get()
  @Throttle({ default: { limit: 100, ttl: 60000 } })
  @ApiOperation({ summary: 'List security findings with pagination and filters' })
  @ApiOkResponse({
    description: 'Paginated list of security findings',
    type: FindingsResponseDto,
  })
  async listFindings(
    @CurrentAuth() auth: AuthContext | null,
    @Query(new ZodValidationPipe(FindingsQuerySchema)) query: FindingsQueryDto,
  ): Promise<FindingsResponseDto> {
    this.requireAuth(auth);

    if (!this.securityAnalyticsService.isAvailable()) {
      throw new ServiceUnavailableException('Analytics service is not available');
    }

    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 25;
    const from = (page - 1) * pageSize;

    this.auditLogService.record(auth, {
      action: 'findings.list',
      resourceType: 'analytics',
      resourceId: null,
      resourceName: null,
      metadata: {
        page,
        pageSize,
        severity: query.severity ?? null,
        search: query.search ?? null,
      },
    });

    const opensearchQuery = this.buildFindingsFilter(query);

    try {
      const result = await this.securityAnalyticsService.query(auth.organizationId, {
        query: opensearchQuery,
        size: pageSize,
        from,
      });

      const items: FindingItem[] = result.hits.map((hit) => this.mapHitToFindingItem(hit));

      return { items, total: result.total, page, pageSize };
    } catch (error) {
      this.logger.error(`Failed to query findings: ${error}`);
      // Return empty results on OpenSearch errors (graceful degradation)
      return { items: [], total: 0, page, pageSize };
    }
  }

  @Get('stats')
  @Throttle({ default: { limit: 100, ttl: 60000 } })
  @ApiOperation({ summary: 'Get severity distribution stats for findings' })
  @ApiOkResponse({
    description: 'Severity counts and total for security findings',
    type: FindingsStatsResponseDto,
  })
  async getStats(
    @CurrentAuth() auth: AuthContext | null,
    @Query(new ZodValidationPipe(FindingsStatsQuerySchema)) query: FindingsStatsQueryDto,
  ): Promise<FindingsStatsResponseDto> {
    this.requireAuth(auth);

    if (!this.securityAnalyticsService.isAvailable()) {
      throw new ServiceUnavailableException('Analytics service is not available');
    }

    this.auditLogService.record(auth, {
      action: 'findings.stats',
      resourceType: 'analytics',
      resourceId: null,
      resourceName: null,
      metadata: null,
    });

    const opensearchQuery = this.buildFindingsFilter(query);

    try {
      const result = await this.securityAnalyticsService.query(auth.organizationId, {
        query: opensearchQuery,
        size: 0,
        aggs: {
          severity_counts: {
            terms: { field: 'severity', size: 10 },
          },
        },
      });

      const buckets = result.aggregations?.severity_counts?.buckets ?? [];
      const severityCounts = buckets.map((bucket: { key: string; doc_count: number }) => ({
        severity: bucket.key,
        count: bucket.doc_count,
      }));

      return { severityCounts, total: result.total };
    } catch (error) {
      this.logger.error(`Failed to query findings stats: ${error}`);
      // Graceful degradation — same pattern as listFindings
      return { severityCounts: [], total: 0 };
    }
  }

  @Get('export')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @ApiOperation({ summary: 'Export security findings as CSV or JSON' })
  async exportFindings(
    @CurrentAuth() auth: AuthContext | null,
    @Query(new ZodValidationPipe(FindingsExportQuerySchema)) query: FindingsExportQueryDto,
    @Res() res: Response,
  ): Promise<void> {
    this.requireAuth(auth);

    if (!this.securityAnalyticsService.isAvailable()) {
      throw new ServiceUnavailableException('Analytics service is not available');
    }

    const limit = query.limit ?? 1000;
    const format = query.format ?? 'json';
    const opensearchQuery = this.buildFindingsFilter(query);

    try {
      const result = await this.securityAnalyticsService.query(auth.organizationId, {
        query: opensearchQuery,
        size: limit,
        from: 0,
      });

      const items = result.hits.map((hit) => this.mapHitToFindingItem(hit));

      this.auditLogService.record(auth, {
        action: 'findings.export',
        resourceType: 'analytics',
        resourceId: null,
        resourceName: null,
        metadata: {
          format,
          limit,
          resultCount: items.length,
          severity: query.severity ?? null,
          search: query.search ?? null,
        },
      });

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

      if (format === 'csv') {
        const csv = this.generateCsv(items);
        res
          .set('Content-Type', 'text/csv')
          .set('Content-Disposition', `attachment; filename="findings-export-${timestamp}.csv"`)
          .send(csv);
      } else {
        res
          .set('Content-Type', 'application/json')
          .set('Content-Disposition', `attachment; filename="findings-export-${timestamp}.json"`)
          .json(items);
      }
    } catch (error) {
      this.logger.error(`Failed to export findings: ${error}`);
      throw new InternalServerErrorException('Failed to export findings');
    }
  }

  @Get(':id')
  @Throttle({ default: { limit: 100, ttl: 60000 } })
  @ApiOperation({ summary: 'Get a single security finding by ID' })
  @ApiOkResponse({
    description: 'Single security finding detail',
    type: FindingDetailResponseDto,
  })
  async getFinding(
    @CurrentAuth() auth: AuthContext | null,
    @Param(new ZodValidationPipe(FindingIdParamSchema)) params: { id: string },
  ): Promise<FindingDetailResponseDto> {
    this.requireAuth(auth);

    const { id } = params;

    if (!this.securityAnalyticsService.isAvailable()) {
      throw new ServiceUnavailableException('Analytics service is not available');
    }

    this.auditLogService.record(auth, {
      action: 'findings.detail',
      resourceType: 'analytics',
      resourceId: id,
      resourceName: null,
      metadata: { findingId: id },
    });

    try {
      const result = await this.securityAnalyticsService.query(auth.organizationId, {
        query: { term: { _id: id } },
        size: 1,
      });

      if (result.hits.length === 0) {
        throw new NotFoundException('Finding not found');
      }

      const hit = result.hits[0];
      return {
        ...this.mapHitToFindingItem(hit),
        raw: hit._source,
      };
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error(`Failed to get finding ${id}: ${error}`);
      throw new InternalServerErrorException('Failed to retrieve finding');
    }
  }

  /**
   * Generate RFC 4180 compliant CSV from finding items.
   */
  private generateCsv(items: FindingItem[]): string {
    const columns = [
      'id',
      'timestamp',
      'severity',
      'name',
      'asset_key',
      'workflow_name',
      'workflow_id',
      'run_id',
      'component_id',
      'node_ref',
    ] as const;

    const header = columns.join(',');

    const rows = items.map((item) =>
      columns.map((col) => this.escapeCsvField(item[col] ?? '')).join(','),
    );

    return [header, ...rows].join('\r\n');
  }

  /**
   * Escape a CSV field value per RFC 4180.
   * Wraps in double quotes if the value contains commas, double quotes, or newlines.
   */
  private escapeCsvField(value: string): string {
    const needsPrefix = /^[=+\-@\t\r]/.test(value);
    const escaped = needsPrefix ? `'${value}` : value;
    if (
      escaped.includes(',') ||
      escaped.includes('"') ||
      escaped.includes('\n') ||
      escaped.includes('\r')
    ) {
      return `"${escaped.replace(/"/g, '""')}"`;
    }
    return escaped;
  }
}
