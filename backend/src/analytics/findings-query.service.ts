import {
  BadRequestException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import type { FindingDataAvailability } from '@sentris/shared';

import { AuditLogService } from '../audit/audit-log.service';
import type { AuthContext } from '../auth/types';
import { FINDING_TRIAGE_PROJECTION_EVENT } from '../findings/finding-triage.events';
import {
  FindingTriageService,
  type FindingProjectionHealth,
} from '../findings/finding-triage.service';
import { OutboxRepository } from '../outbox/outbox.repository';
import { ScopesRepository } from '../scopes/scopes.repository';
import { FindingDetailResponseDto } from './dto/findings-detail.dto';
import { FindingsQueryDto, FindingsResponseDto, type FindingItem } from './dto/findings-query.dto';
import {
  buildFindingFilter,
  buildFindingSchemaCoverageAggregation,
  FINDING_SCHEMA_COVERAGE_AGGREGATION_KEY,
  isFindingSchemaCoverageComplete,
  mapFindingHitWithCompatibility,
  readFindingSchemaCoverage,
} from './finding-query';
import { InvalidFindingPageCursorError } from './finding-pagination';
import { findingsUnavailable } from './findings-unavailable';
import { SecurityAnalyticsService } from './security-analytics.service';

const SCOPE_RUN_ID_PAGE_SIZE = 1_000;
const FINDING_ENRICHMENT_BATCH_SIZE = 5_000;

export interface FindingStorageIdIntegrityHealth {
  availability: FindingDataAvailability;
  reason: string | null;
}

/** Canonical organization-scoped findings read path shared by HTTP and Operator. */
@Injectable()
export class FindingsQueryService {
  private readonly logger = new Logger(FindingsQueryService.name);

  constructor(
    private readonly securityAnalyticsService: SecurityAnalyticsService,
    private readonly auditLogService: AuditLogService,
    private readonly findingTriageService: FindingTriageService,
    private readonly outboxRepository: OutboxRepository,
    private readonly scopesRepository: ScopesRepository,
  ) {}

  async listFindings(
    auth: AuthContext | null,
    query: FindingsQueryDto,
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
      if (availability === 'degraded') degradedReasons.add('analytics_degraded');
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
      if (projectionHealth.availability === 'degraded') {
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
        schemaCoverage: schemaCoverage ?? { canonical: 0, legacy: 0, invalid: 0 },
      };
    } catch (error) {
      this.throwUnavailable('Failed to query findings', error);
    }
  }

  async getFinding(auth: AuthContext | null, id: string): Promise<FindingDetailResponseDto> {
    this.requireAuth(auth);

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
      if (result.hits.length === 0) throw new NotFoundException('Finding not found');

      const hit = result.hits[0]!;
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
      return { ...item, raw: hit._source, availability };
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      this.throwUnavailable(`Failed to get finding ${id}`, error);
    }
  }

  async getProjectionHealth(organizationId: string): Promise<FindingProjectionHealth> {
    try {
      const [health, projectionEventLag] = await Promise.all([
        this.findingTriageService.getProjectionHealth(organizationId),
        this.hasProjectionEventLag(organizationId),
      ]);
      if (!projectionEventLag) return health;
      return { ...health, availability: 'degraded', reason: 'projection_events_pending' };
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

  async getStorageIdIntegrityHealth(
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

  async resolveOwnedScopeRunIds(
    organizationId: string,
    scopeId: string | undefined,
  ): Promise<string[] | undefined> {
    if (!scopeId) return undefined;
    try {
      const scope = await this.scopesRepository.findById(scopeId, organizationId);
      if (!scope) throw new NotFoundException('Scope not found');

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

  async enrichFindingItems(organizationId: string, items: FindingItem[]): Promise<FindingItem[]> {
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

  private requireAuth(auth: AuthContext | null): asserts auth is AuthContext & {
    isAuthenticated: true;
    organizationId: string;
  } {
    if (!auth?.isAuthenticated) throw new UnauthorizedException('Authentication required');
    if (!auth.organizationId) throw new UnauthorizedException('Organization context required');
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

  private throwUnavailable(operation: string, error: unknown): never {
    this.logger.error(`${operation}: ${error}`);
    if (error instanceof InvalidFindingPageCursorError) {
      throw new BadRequestException('Invalid or expired findings cursor');
    }
    if (error instanceof HttpException) throw error;
    throw findingsUnavailable('Findings data is unavailable');
  }
}
