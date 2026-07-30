import {
  BadRequestException,
  Controller,
  Get,
  HttpException,
  Logger,
  NotFoundException,
  Param,
  Query,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import {
  ApiExtraModels,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiProduces,
  ApiTags,
  getSchemaPath,
} from '@nestjs/swagger';
import { escapeCsvCell, type FindingDataAvailability } from '@sentris/shared';
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
  FindingItemDto,
  type FindingItem,
} from './dto/findings-query.dto';
import { FindingDetailResponseDto, FindingIdParamSchema } from './dto/findings-detail.dto';
import { FindingsExportQueryDto, FindingsExportQuerySchema } from './dto/findings-export.dto';
import {
  FindingsStatsQueryDto,
  FindingsStatsQuerySchema,
  FindingsStatsResponseDto,
} from './dto/findings-stats.dto';
import {
  FindingTriageService,
  type FindingProjectionHealth,
} from '../findings/finding-triage.service';
import { FINDING_TRIAGE_PROJECTION_EVENT } from '../findings/finding-triage.events';
import { OutboxRepository } from '../outbox/outbox.repository';
import { FINDINGS_NORMALIZED_SEVERITY_FIELD } from './findings-index-template';
import {
  buildFindingFilter,
  buildFindingSchemaCoverageAggregation,
  FINDING_SCHEMA_COVERAGE_AGGREGATION_KEY,
  isFindingSchemaCoverageComplete,
  mapFindingHitWithCompatibility,
  parseExactFindingSeverityCounts,
  readFindingSchemaCoverage,
} from './finding-query';
import { findingsUnavailable } from './findings-unavailable';
import { InvalidFindingPageCursorError } from './finding-pagination';
import { ScopesRepository } from '../scopes/scopes.repository';

const SCOPE_RUN_ID_PAGE_SIZE = 1_000;
const FINDING_ENRICHMENT_BATCH_SIZE = 5_000;

interface FindingStorageIdIntegrityHealth {
  availability: FindingDataAvailability;
  reason: string | null;
}

@ApiTags('findings')
@ApiExtraModels(FindingItemDto)
@Controller('findings')
export class FindingsController {
  private readonly logger = new Logger(FindingsController.name);

  constructor(
    private readonly securityAnalyticsService: SecurityAnalyticsService,
    private readonly auditLogService: AuditLogService,
    private readonly findingTriageService: FindingTriageService,
    private readonly outboxRepository: OutboxRepository,
    private readonly scopesRepository: ScopesRepository,
  ) {}

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

  private throwUnavailable(operation: string, error: unknown): never {
    this.logger.error(`${operation}: ${error}`);
    if (error instanceof InvalidFindingPageCursorError) {
      throw new BadRequestException('Invalid or expired findings cursor');
    }
    if (error instanceof HttpException) {
      throw error;
    }
    throw findingsUnavailable('Findings data is unavailable');
  }

  private async hasProjectionEventLag(organizationId: string): Promise<boolean> {
    try {
      return await this.outboxRepository.hasOutstandingEvent(
        organizationId,
        FINDING_TRIAGE_PROJECTION_EVENT,
      );
    } catch (error) {
      this.logger.warn(`Unable to establish finding projection health: ${error}`);
      return true;
    }
  }

  private async getProjectionHealth(organizationId: string): Promise<FindingProjectionHealth> {
    try {
      const [health, projectionEventLag] = await Promise.all([
        this.findingTriageService.getProjectionHealth(organizationId),
        this.hasProjectionEventLag(organizationId),
      ]);
      if (!projectionEventLag) return health;
      return {
        ...health,
        availability: 'degraded',
        reason: 'projection_events_pending',
      };
    } catch (error) {
      this.logger.warn(`Unable to establish finding projection health: ${error}`);
      return {
        availability: 'degraded',
        completedAt: null,
        reconciledThrough: null,
        reason: 'health_check_failed',
      };
    }
  }

  private async getStorageIdIntegrityHealth(
    organizationId: string,
  ): Promise<FindingStorageIdIntegrityHealth> {
    try {
      const watermark =
        await this.securityAnalyticsService.getFindingStorageIdIntegrityWatermark(organizationId);
      if (!watermark) {
        return { availability: 'degraded', reason: 'storage_id_integrity_unverified' };
      }
      if (!watermark.matchesCurrentObservationIndex) {
        return { availability: 'degraded', reason: 'storage_id_integrity_stale' };
      }
      if (!watermark.matchesCurrentInvariant) {
        return { availability: 'degraded', reason: 'storage_id_integrity_invariant_stale' };
      }
      if (watermark.mismatched > 0) {
        return { availability: 'degraded', reason: 'storage_id_integrity_mismatch' };
      }
      return { availability: 'available', reason: null };
    } catch (error) {
      this.logger.warn(`Unable to establish finding storage ID integrity: ${error}`);
      return { availability: 'degraded', reason: 'storage_id_integrity_unavailable' };
    }
  }

  private async resolveOwnedScopeRunIds(
    organizationId: string,
    scopeId: string | undefined,
  ): Promise<string[] | undefined> {
    if (!scopeId) return undefined;

    try {
      const scope = await this.scopesRepository.findById(scopeId, organizationId);
      if (!scope) {
        throw new NotFoundException('Scope not found');
      }

      const runIds: string[] = [];
      let afterRunId: string | undefined;
      while (true) {
        const page = await this.scopesRepository.listRunIdsPage(
          scopeId,
          organizationId,
          afterRunId,
          SCOPE_RUN_ID_PAGE_SIZE,
        );
        runIds.push(...page);
        if (page.length < SCOPE_RUN_ID_PAGE_SIZE) break;
        afterRunId = page.at(-1);
      }
      return runIds;
    } catch (error) {
      if (error instanceof HttpException) throw error;
      this.logger.error(`Unable to resolve finding scope ownership: ${error}`);
      throw findingsUnavailable('Scope ownership data is unavailable');
    }
  }

  private async enrichFindingItems(
    organizationId: string,
    items: FindingItem[],
  ): Promise<FindingItem[]> {
    const enriched: FindingItem[] = [];
    for (let start = 0; start < items.length; start += FINDING_ENRICHMENT_BATCH_SIZE) {
      const batch = items.slice(start, start + FINDING_ENRICHMENT_BATCH_SIZE);
      const enrichedBatch = await this.findingTriageService.enrichWithTriageState(
        organizationId,
        batch,
      );
      if (enrichedBatch.length !== batch.length) {
        throw new Error('Authoritative triage enrichment returned an incomplete batch');
      }
      enriched.push(...enrichedBatch);
    }
    return enriched;
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
      throw findingsUnavailable('Analytics service is not available');
    }

    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 25;
    const from = (page - 1) * pageSize;
    const paginationMode = query.paginationMode ?? 'offset';
    if (paginationMode === 'offset' && from + pageSize > 10_000) {
      throw new BadRequestException(
        'Offset pagination is limited to the first 10,000 findings; use paginationMode=cursor',
      );
    }

    this.auditLogService.recordBestEffort(auth, {
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

    const ownedScopeRunIds = await this.resolveOwnedScopeRunIds(auth.organizationId, query.scopeId);
    const opensearchQuery = buildFindingFilter(query, { ownedScopeRunIds });
    const schemaCoverageAggregations = {
      [FINDING_SCHEMA_COVERAGE_AGGREGATION_KEY]: buildFindingSchemaCoverageAggregation(),
    };
    const projectionHealthPromise = this.getProjectionHealth(auth.organizationId);
    const storageIdIntegrityPromise = this.getStorageIdIntegrityHealth(auth.organizationId);

    try {
      const resultPromise =
        paginationMode === 'cursor'
          ? this.securityAnalyticsService.queryFindingPage(auth.organizationId, {
              query: opensearchQuery,
              pageSize,
              sortOrder: query.sortOrder ?? 'desc',
              aggs: schemaCoverageAggregations,
              ...(query.cursor && { cursor: query.cursor }),
            })
          : this.securityAnalyticsService.queryFindings(auth.organizationId, {
              query: opensearchQuery,
              size: pageSize,
              from,
              sort: [{ '@timestamp': query.sortOrder ?? 'desc' }],
              aggs: schemaCoverageAggregations,
            });
      const [result, projectionHealth, storageIdIntegrity] = await Promise.all([
        resultPromise,
        projectionHealthPromise,
        storageIdIntegrityPromise,
      ]);

      const mappedHits = result.hits.map((hit) => mapFindingHitWithCompatibility(hit));
      const items: FindingItem[] = mappedHits.map(({ item }) => item);
      const schemaCoverage = readFindingSchemaCoverage(result.aggregations, result.total);
      let availability: FindingDataAvailability = result.availability ?? 'available';
      const degradedReasons = new Set<string>();
      if (availability === 'degraded') {
        degradedReasons.add('analytics_degraded');
      }
      if (storageIdIntegrity.availability === 'degraded') {
        availability = 'degraded';
        degradedReasons.add(storageIdIntegrity.reason ?? 'storage_id_integrity_degraded');
      }
      if (!schemaCoverage) {
        availability = 'degraded';
        degradedReasons.add('schema_coverage_unavailable');
      } else if (!isFindingSchemaCoverageComplete(schemaCoverage, result.total)) {
        availability = 'degraded';
        degradedReasons.add('schema_coverage_incomplete');
      }
      if (
        (schemaCoverage?.invalid ?? 0) > 0 ||
        mappedHits.some(({ compatibility }) => compatibility === 'invalid')
      ) {
        availability = 'degraded';
        degradedReasons.add('invalid_schema_documents');
      }

      // Enrich with triage state from PG
      let enrichedItems: FindingItem[];
      try {
        enrichedItems = await this.enrichFindingItems(auth.organizationId, items);
      } catch (error) {
        this.logger.warn(`Triage enrichment unavailable; returning observation data: ${error}`);
        availability = 'degraded';
        degradedReasons.add('triage_enrichment_unavailable');
        enrichedItems = items;
      }
      if (
        enrichedItems.some((item, index) => {
          const projectedVersion = items[index]?.triage?.projectionVersion ?? 0;
          const authoritativeVersion = item.triage?.projectionVersion ?? 0;
          return projectedVersion !== authoritativeVersion;
        })
      ) {
        availability = 'degraded';
        degradedReasons.add('triage_projection_stale');
      }
      if (projectionHealth?.availability === 'degraded') {
        availability = 'degraded';
        degradedReasons.add(projectionHealth.reason ?? 'projection_health_degraded');
      }

      return {
        items: enrichedItems,
        total: result.total,
        page,
        pageSize,
        availability,
        paginationMode,
        currentCursor:
          'currentCursor' in result && typeof result.currentCursor === 'string'
            ? result.currentCursor
            : null,
        nextCursor:
          'nextCursor' in result &&
          (typeof result.nextCursor === 'string' || result.nextCursor === null)
            ? result.nextCursor
            : null,
        projectionHealth,
        degradedReasons: [...degradedReasons],
        schemaCoverage: schemaCoverage ?? {
          canonical: 0,
          legacy: 0,
          invalid: 0,
        },
      };
    } catch (error) {
      this.throwUnavailable('Failed to query findings', error);
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
      throw findingsUnavailable('Analytics service is not available');
    }

    this.auditLogService.recordBestEffort(auth, {
      action: 'findings.stats',
      resourceType: 'analytics',
      resourceId: null,
      resourceName: null,
      metadata: null,
    });

    const ownedScopeRunIds = await this.resolveOwnedScopeRunIds(auth.organizationId, query.scopeId);
    const opensearchQuery = buildFindingFilter(query, { ownedScopeRunIds });
    const usesProjection = Boolean(query.triageStatus || query.assigneeUserId);
    const [projectionHealth, storageIdIntegrity] = await Promise.all([
      usesProjection ? this.getProjectionHealth(auth.organizationId) : undefined,
      this.getStorageIdIntegrityHealth(auth.organizationId),
    ]);

    try {
      const result = await this.securityAnalyticsService.queryFindings(auth.organizationId, {
        query: opensearchQuery,
        size: 0,
        aggs: {
          severity_counts: {
            terms: { field: FINDINGS_NORMALIZED_SEVERITY_FIELD, size: 10 },
          },
          [FINDING_SCHEMA_COVERAGE_AGGREGATION_KEY]: buildFindingSchemaCoverageAggregation(),
        },
      });

      const severityCounts = parseExactFindingSeverityCounts(result.aggregations, result.total);
      const schemaCoverage = readFindingSchemaCoverage(result.aggregations, result.total);

      return {
        severityCounts,
        total: result.total,
        availability:
          projectionHealth?.availability === 'degraded' ||
          storageIdIntegrity.availability === 'degraded' ||
          !isFindingSchemaCoverageComplete(schemaCoverage, result.total) ||
          schemaCoverage.invalid > 0
            ? 'degraded'
            : 'available',
        ...(projectionHealth && { projectionHealth }),
        schemaCoverage: schemaCoverage ?? {
          canonical: 0,
          legacy: 0,
          invalid: 0,
        },
      };
    } catch (error) {
      this.throwUnavailable('Failed to query findings stats', error);
    }
  }

  @Get('export')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @ApiOperation({ summary: 'Export security findings as CSV or JSON' })
  @ApiProduces('application/json', 'text/csv')
  @ApiOkResponse({
    description: 'Finding export in the requested format',
    content: {
      'application/json': {
        schema: {
          type: 'array',
          items: { $ref: getSchemaPath(FindingItemDto) },
        },
      },
      'text/csv': {
        schema: {
          type: 'string',
          format: 'binary',
        },
      },
    },
    headers: {
      'Content-Disposition': {
        description: 'Attachment filename',
        schema: { type: 'string' },
      },
      'X-Sentris-Availability': {
        description: 'Trust state for the exported finding data',
        schema: { type: 'string', enum: ['available', 'degraded'] },
      },
      'X-Sentris-Degraded-Reasons': {
        description: 'Comma-separated reasons the export is degraded, when present',
        schema: { type: 'string' },
      },
      'X-Sentris-Projection-Health-Reason': {
        description: 'Projection degradation reason, when present',
        schema: { type: 'string' },
      },
      'X-Sentris-Projection-Reconciled-Through': {
        description: 'Latest reconciled projection timestamp, when present',
        schema: { type: 'string', format: 'date-time' },
      },
      'X-Sentris-Schema-Canonical': {
        description: 'Canonical observations included in the export',
        schema: { type: 'integer', minimum: 0 },
      },
      'X-Sentris-Schema-Legacy': {
        description: 'Legacy observations included in the export',
        schema: { type: 'integer', minimum: 0 },
      },
      'X-Sentris-Schema-Invalid': {
        description: 'Invalid versioned observations included in the export',
        schema: { type: 'integer', minimum: 0 },
      },
    },
  })
  async exportFindings(
    @CurrentAuth() auth: AuthContext | null,
    @Query(new ZodValidationPipe(FindingsExportQuerySchema)) query: FindingsExportQueryDto,
    @Res() res: Response,
  ): Promise<void> {
    this.requireAuth(auth);

    if (!this.securityAnalyticsService.isAvailable()) {
      throw findingsUnavailable('Analytics service is not available');
    }

    const limit = query.limit;
    const format = query.format ?? 'json';
    const ownedScopeRunIds = await this.resolveOwnedScopeRunIds(auth.organizationId, query.scopeId);
    const opensearchQuery = buildFindingFilter(query, { ownedScopeRunIds });
    const [projectionHealth, storageIdIntegrity] = await Promise.all([
      this.getProjectionHealth(auth.organizationId),
      this.getStorageIdIntegrityHealth(auth.organizationId),
    ]);

    try {
      const hits = await this.securityAnalyticsService.scanFindings(auth.organizationId, {
        query: opensearchQuery,
        sortOrder: query.sortOrder ?? 'desc',
        limit,
      });

      const mappedHits = hits.map((hit) => mapFindingHitWithCompatibility(hit));
      const projectedItems = mappedHits.map(({ item }) => item);
      const degradedReasons = new Set<string>();
      let items: FindingItem[];
      try {
        items = await this.enrichFindingItems(auth.organizationId, projectedItems);
      } catch (error) {
        this.logger.warn(
          `Export triage enrichment unavailable; returning observation data: ${error}`,
        );
        degradedReasons.add('triage_enrichment_unavailable');
        items = projectedItems;
      }
      if (
        items.some((item, index) => {
          const projectedVersion = projectedItems[index]?.triage?.projectionVersion ?? 0;
          const authoritativeVersion = item.triage?.projectionVersion ?? 0;
          return projectedVersion !== authoritativeVersion;
        })
      ) {
        degradedReasons.add('triage_projection_stale');
      }
      if (projectionHealth.availability === 'degraded') {
        degradedReasons.add(projectionHealth.reason ?? 'projection_health_degraded');
      }
      if (storageIdIntegrity.availability === 'degraded') {
        degradedReasons.add(storageIdIntegrity.reason ?? 'storage_id_integrity_degraded');
      }
      if (mappedHits.some(({ compatibility }) => compatibility === 'invalid')) {
        degradedReasons.add('invalid_schema_documents');
      }
      const availability: FindingDataAvailability =
        degradedReasons.size > 0 ? 'degraded' : 'available';
      const exportSchemaCoverage = mappedHits.reduce(
        (coverage, hit) => {
          coverage[hit.compatibility] += 1;
          return coverage;
        },
        { canonical: 0, legacy: 0, invalid: 0 },
      );

      await this.auditLogService.recordDurable(auth, {
        action: 'findings.export',
        resourceType: 'analytics',
        resourceId: null,
        resourceName: null,
        metadata: {
          format,
          limit: limit ?? null,
          resultCount: items.length,
          availability,
          degradedReasons: [...degradedReasons],
          severity: query.severity ?? null,
          search: query.search ?? null,
        },
      });

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      res.set('X-Sentris-Availability', availability);
      if (degradedReasons.size > 0) {
        res.set('X-Sentris-Degraded-Reasons', [...degradedReasons].join(','));
      }
      res.set('X-Sentris-Schema-Canonical', String(exportSchemaCoverage.canonical));
      res.set('X-Sentris-Schema-Legacy', String(exportSchemaCoverage.legacy));
      res.set('X-Sentris-Schema-Invalid', String(exportSchemaCoverage.invalid));
      if (projectionHealth.reason) {
        res.set('X-Sentris-Projection-Health-Reason', projectionHealth.reason);
      }
      if (projectionHealth.reconciledThrough) {
        res.set('X-Sentris-Projection-Reconciled-Through', projectionHealth.reconciledThrough);
      }

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
      this.throwUnavailable('Failed to export findings', error);
    }
  }

  @Get(':id')
  @Throttle({ default: { limit: 100, ttl: 60000 } })
  @ApiOperation({ summary: 'Get a single security finding by ID' })
  @ApiOkResponse({
    description: 'Single security finding detail',
    type: FindingDetailResponseDto,
  })
  @ApiParam({
    name: 'id',
    description: 'OpenSearch finding document identifier',
    required: true,
    schema: { type: 'string', minLength: 1, maxLength: 512 },
  })
  async getFinding(
    @CurrentAuth() auth: AuthContext | null,
    @Param(new ZodValidationPipe(FindingIdParamSchema)) params: { id: string },
  ): Promise<FindingDetailResponseDto> {
    this.requireAuth(auth);

    const { id } = params;

    if (!this.securityAnalyticsService.isAvailable()) {
      throw findingsUnavailable('Analytics service is not available');
    }

    this.auditLogService.recordBestEffort(auth, {
      action: 'findings.detail',
      resourceType: 'analytics',
      resourceId: id,
      resourceName: null,
      metadata: { findingId: id },
    });

    try {
      const result = await this.securityAnalyticsService.queryFindings(auth.organizationId, {
        query: { term: { _id: id } },
        size: 1,
      });

      if (result.hits.length === 0) {
        throw new NotFoundException('Finding not found');
      }

      const hit = result.hits[0];
      const mapped = mapFindingHitWithCompatibility(hit);
      const projected = mapped.item;
      let item = projected;
      let availability: FindingDataAvailability =
        mapped.compatibility === 'invalid' ? 'degraded' : 'available';
      try {
        const [authoritative] = await this.findingTriageService.enrichWithTriageState(
          auth.organizationId,
          [projected],
        );
        item = authoritative ?? projected;
        if (
          authoritative?.triage &&
          authoritative.triage.projectionVersion !== projected.triage?.projectionVersion
        ) {
          availability = 'degraded';
        }
      } catch (error) {
        this.logger.warn(
          `Triage enrichment unavailable for finding ${id}; returning projection: ${error}`,
        );
        availability = 'degraded';
      }
      return {
        ...item,
        raw: hit._source,
        availability,
      };
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      this.throwUnavailable(`Failed to get finding ${id}`, error);
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
      'scope_id',
      'component_id',
      'node_ref',
    ] as const;

    const header = columns.join(',');

    const rows = items.map((item) =>
      columns.map((col) => escapeCsvCell(item[col] ?? '')).join(','),
    );

    return [header, ...rows].join('\r\n');
  }
}
