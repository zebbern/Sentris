import { Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';

import { SecurityAnalyticsService } from '../analytics/security-analytics.service';
import {
  buildOwnedRunIdsFilter,
  buildFindingSchemaCoverageAggregation,
  FINDING_SCHEMA_COVERAGE_AGGREGATION_KEY,
  isFindingSchemaCoverageComplete,
  parseExactFindingSeverityCounts,
  readFindingSchemaCoverage,
} from '../analytics/finding-query';
import { findingsUnavailable } from '../analytics/findings-unavailable';
import { FINDINGS_NORMALIZED_SEVERITY_FIELD } from '../analytics/findings-index-template';
import type { AuthContext } from '../auth/types';
import { requireOrganizationId } from '../common/auth/require-organization-id';
import type { ScopeFindingsSummary } from './dto/scope-findings.dto';
import { ScopesRepository } from './scopes.repository';

const EMPTY_SUMMARY: ScopeFindingsSummary = {
  availability: 'available',
  total: 0,
  bySeverity: { critical: 0, high: 0, medium: 0, low: 0, info: 0, none: 0 },
};
const RUN_ID_PAGE_SIZE = 1_000;

@Injectable()
export class ScopeFindingsService {
  private readonly logger = new Logger(ScopeFindingsService.name);

  constructor(
    private readonly securityAnalytics: SecurityAnalyticsService,
    private readonly scopesRepository: ScopesRepository,
  ) {}

  async getSummary(auth: AuthContext | null, scopeId: string): Promise<ScopeFindingsSummary> {
    const organizationId = requireOrganizationId(auth);

    const scope = await this.scopesRepository.findById(scopeId, organizationId);
    if (!scope) {
      throw new NotFoundException('Scope not found');
    }

    try {
      const bySeverity = { ...EMPTY_SUMMARY.bySeverity };
      let total = 0;
      let schemaCoverageValid = true;
      let afterRunId: string | undefined;

      while (true) {
        const runIds = await this.scopesRepository.listRunIdsPage(
          scopeId,
          organizationId,
          afterRunId,
          RUN_ID_PAGE_SIZE,
        );
        if (runIds.length === 0) break;

        const result = await this.securityAnalytics.queryFindings(organizationId, {
          query: buildOwnedRunIdsFilter(runIds),
          size: 0,
          aggs: {
            severity_counts: {
              terms: { field: FINDINGS_NORMALIZED_SEVERITY_FIELD, size: 10 },
            },
            [FINDING_SCHEMA_COVERAGE_AGGREGATION_KEY]: buildFindingSchemaCoverageAggregation(),
          },
        });
        total += result.total;
        const schemaCoverage = readFindingSchemaCoverage(result.aggregations, result.total);
        if (
          !isFindingSchemaCoverageComplete(schemaCoverage, result.total) ||
          schemaCoverage.invalid > 0
        ) {
          schemaCoverageValid = false;
        }
        const severityCounts = parseExactFindingSeverityCounts(result.aggregations, result.total);
        for (const severityCount of severityCounts) {
          bySeverity[severityCount.severity] += severityCount.count;
        }

        if (runIds.length < RUN_ID_PAGE_SIZE) break;
        afterRunId = runIds.at(-1);
      }

      const storageIdIntegrity =
        total > 0
          ? await this.securityAnalytics.getFindingStorageIdIntegrityWatermark(organizationId)
          : null;
      const storageIdIntegrityValid =
        total === 0 ||
        (storageIdIntegrity !== null &&
          storageIdIntegrity.matchesCurrentObservationIndex &&
          storageIdIntegrity.matchesCurrentInvariant &&
          storageIdIntegrity.mismatched === 0);
      return {
        availability: schemaCoverageValid && storageIdIntegrityValid ? 'available' : 'degraded',
        total,
        bySeverity,
      };
    } catch (err) {
      this.logger.warn(`findings summary failed for scope ${scopeId}: ${err}`);
      if (err instanceof ServiceUnavailableException) {
        throw err;
      }
      throw findingsUnavailable('Scope findings data is unavailable');
    }
  }
}
