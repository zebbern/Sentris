import { Controller, Get, Logger, Query, UnauthorizedException } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
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

@ApiTags('findings')
@Controller('findings')
export class FindingsController {
  private readonly logger = new Logger(FindingsController.name);

  constructor(
    private readonly securityAnalyticsService: SecurityAnalyticsService,
    private readonly auditLogService: AuditLogService,
  ) {}

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
    if (!auth || !auth.isAuthenticated) {
      throw new UnauthorizedException('Authentication required');
    }

    if (!auth.organizationId) {
      throw new UnauthorizedException('Organization context required');
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

    // Build OpenSearch DSL query
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

    const opensearchQuery =
      mustClauses.length > 0 ? { bool: { must: mustClauses } } : { match_all: {} };

    try {
      const result = await this.securityAnalyticsService.query(auth.organizationId, {
        query: opensearchQuery,
        size: pageSize,
        from,
      });

      const items: FindingItem[] = result.hits.map((hit) => ({
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
        raw: hit._source,
      }));

      return { items, total: result.total, page, pageSize };
    } catch (error) {
      this.logger.error(`Failed to query findings: ${error}`);
      // Return empty results on OpenSearch errors (graceful degradation)
      return { items: [], total: 0, page, pageSize };
    }
  }
}
