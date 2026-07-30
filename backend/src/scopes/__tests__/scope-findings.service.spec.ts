import { describe, expect, it, jest } from 'bun:test';
import { NotFoundException, ServiceUnavailableException } from '@nestjs/common';

import { ScopeFindingsService } from '../scope-findings.service';
import type { SecurityAnalyticsService } from '../../analytics/security-analytics.service';
import type { ScopesRepository } from '../scopes.repository';
import type { AuthContext } from '../../auth/types';

const AUTH: AuthContext = {
  userId: 'user-1',
  organizationId: 'org-1',
  roles: ['MEMBER'],
  isAuthenticated: true,
  provider: 'test',
};

function createService(options: {
  scope?: Record<string, unknown> | null;
  runIdPages?: string[][];
  queryResults?: Record<string, unknown>[];
  queryError?: Error;
}) {
  const runIdPages = options.runIdPages ?? [['run-1', 'run-2']];
  const scopesRepository = {
    findById: jest
      .fn()
      .mockResolvedValue(options.scope === undefined ? { id: 'scope-1' } : options.scope),
    listRunIdsPage: jest.fn().mockImplementation(async (_scopeId, _organizationId, afterRunId) => {
      if (!afterRunId) return runIdPages[0] ?? [];
      const pageIndex = runIdPages.findIndex((page) => page.at(-1) === afterRunId);
      return runIdPages[pageIndex + 1] ?? [];
    }),
  };
  const queryResults = options.queryResults ?? [
    {
      total: 5,
      hits: [],
      aggregations: {
        severity_counts: {
          buckets: [
            { key: 'high', doc_count: 3 },
            { key: 'none', doc_count: 2 },
          ],
        },
        sentris_schema_coverage: {
          buckets: {
            canonical: { doc_count: 0 },
            legacy: { doc_count: 5 },
            invalid: { doc_count: 0 },
          },
        },
      },
    },
  ];
  const securityAnalytics = {
    queryFindings: options.queryError
      ? jest.fn().mockRejectedValue(options.queryError)
      : jest
          .fn()
          .mockImplementation(async () => queryResults.shift() ?? { total: 0, aggregations: {} }),
    getFindingStorageIdIntegrityWatermark: jest.fn().mockResolvedValue({
      observationIndexUuid: 'observation-index-uuid-1',
      matchesCurrentObservationIndex: true,
      matchesCurrentInvariant: true,
      finalPipeline: 'sentris-findings-observation-final-v1',
      templateVersion: 5,
      schemaVersion: 1,
      classificationVersion: 1,
      completedAt: '2026-07-26T12:01:00.000Z',
      checked: 5,
      mismatched: 0,
    }),
  };
  const service = new ScopeFindingsService(
    securityAnalytics as unknown as SecurityAnalyticsService,
    scopesRepository as unknown as ScopesRepository,
  );
  return { service, scopesRepository, securityAnalytics };
}

describe('ScopeFindingsService', () => {
  it('verifies exact organization ownership and queries canonical and legacy run ownership', async () => {
    const { service, scopesRepository, securityAnalytics } = createService({});

    const result = await service.getSummary(AUTH, 'scope-1');

    expect(scopesRepository.findById).toHaveBeenCalledWith('scope-1', 'org-1');
    expect(scopesRepository.listRunIdsPage).toHaveBeenCalledWith(
      'scope-1',
      'org-1',
      undefined,
      1_000,
    );
    expect(securityAnalytics.queryFindings).toHaveBeenCalledWith(
      'org-1',
      expect.objectContaining({
        query: {
          bool: {
            minimum_should_match: 1,
            should: [
              { terms: { 'sentris.run_id': ['run-1', 'run-2'] } },
              {
                bool: {
                  must: [{ terms: { run_id: ['run-1', 'run-2'] } }],
                  must_not: [{ exists: { field: 'sentris.run_id' } }],
                },
              },
            ],
          },
        },
        size: 0,
      }),
    );
    expect(securityAnalytics.queryFindings.mock.calls[0][1].aggs).toEqual(
      expect.objectContaining({
        severity_counts: { terms: { field: 'sentris_normalized_severity', size: 10 } },
        sentris_schema_coverage: expect.any(Object),
      }),
    );
    expect(result).toEqual({
      availability: 'available',
      total: 5,
      bySeverity: { critical: 0, high: 3, medium: 0, low: 0, info: 0, none: 2 },
    });
  });

  it('accumulates every run page without a 10,000-run truncation boundary', async () => {
    const allRunIds = Array.from(
      { length: 10_001 },
      (_, index) => `run-${index.toString().padStart(5, '0')}`,
    );
    const runIdPages = Array.from({ length: 11 }, (_, page) =>
      allRunIds.slice(page * 1_000, (page + 1) * 1_000),
    );
    const queryResults = runIdPages.map((runIds, page) => ({
      total: runIds.length,
      aggregations: {
        severity_counts: {
          buckets:
            page === 10
              ? [{ key: 'none', doc_count: 1 }]
              : [{ key: 'medium', doc_count: runIds.length }],
        },
        sentris_schema_coverage: {
          buckets: {
            canonical: { doc_count: runIds.length },
            legacy: { doc_count: 0 },
            invalid: { doc_count: 0 },
          },
        },
      },
    }));
    const { service, scopesRepository, securityAnalytics } = createService({
      runIdPages,
      queryResults,
    });

    const result = await service.getSummary(AUTH, 'scope-1');

    expect(scopesRepository.listRunIdsPage).toHaveBeenCalledTimes(11);
    expect(securityAnalytics.queryFindings).toHaveBeenCalledTimes(11);
    for (const call of securityAnalytics.queryFindings.mock.calls) {
      const clauses = call[1].query.bool.should as [
        { terms: Record<string, string[]> },
        {
          bool: {
            must: { terms: Record<string, string[]> }[];
            must_not: { exists: { field: string } }[];
          };
        },
      ];
      expect(clauses).toHaveLength(2);
      const canonicalRunIds = clauses[0]?.terms['sentris.run_id'];
      const legacyRunIds = clauses[1]?.bool.must[0]?.terms.run_id;
      expect(canonicalRunIds?.length).toBeLessThanOrEqual(1_000);
      expect(legacyRunIds).toEqual(canonicalRunIds);
      expect(clauses[1]?.bool.must_not).toEqual([{ exists: { field: 'sentris.run_id' } }]);
    }
    expect(result).toEqual({
      availability: 'available',
      total: 10_001,
      bySeverity: {
        critical: 0,
        high: 0,
        medium: 10_000,
        low: 0,
        info: 0,
        none: 1,
      },
    });
  });

  it('returns an exact available zero when the owned scope has no runs', async () => {
    const { service, securityAnalytics } = createService({ runIdPages: [[]] });

    await expect(service.getSummary(AUTH, 'scope-1')).resolves.toEqual({
      availability: 'available',
      total: 0,
      bySeverity: { critical: 0, high: 0, medium: 0, low: 0, info: 0, none: 0 },
    });
    expect(securityAnalytics.queryFindings).not.toHaveBeenCalled();
  });

  it('marks scope counts degraded when malformed versioned observations are present', async () => {
    const { service } = createService({
      queryResults: [
        {
          total: 1,
          aggregations: {
            severity_counts: {
              buckets: [{ key: 'high', doc_count: 1 }],
            },
            sentris_schema_coverage: {
              buckets: {
                canonical: { doc_count: 0 },
                legacy: { doc_count: 0 },
                invalid: { doc_count: 1 },
              },
            },
          },
        },
      ],
    });

    await expect(service.getSummary(AUTH, 'scope-1')).resolves.toEqual(
      expect.objectContaining({
        availability: 'degraded',
        total: 1,
      }),
    );
  });

  it('marks scope counts degraded when coverage buckets omit a matching observation', async () => {
    const { service } = createService({
      queryResults: [
        {
          total: 2,
          aggregations: {
            severity_counts: {
              buckets: [{ key: 'high', doc_count: 2 }],
            },
            sentris_schema_coverage: {
              buckets: {
                canonical: { doc_count: 1 },
                legacy: { doc_count: 0 },
                invalid: { doc_count: 0 },
              },
            },
          },
        },
      ],
    });

    await expect(service.getSummary(AUTH, 'scope-1')).resolves.toEqual(
      expect.objectContaining({
        availability: 'degraded',
        total: 2,
      }),
    );
  });

  it('rejects malformed severity buckets instead of publishing a false scope total', async () => {
    const { service } = createService({
      queryResults: [
        {
          total: 2,
          aggregations: {
            severity_counts: {
              buckets: [
                { key: 'high', doc_count: 1 },
                { key: 'high', doc_count: 1 },
              ],
            },
            sentris_schema_coverage: {
              buckets: {
                canonical: { doc_count: 2 },
                legacy: { doc_count: 0 },
                invalid: { doc_count: 0 },
              },
            },
          },
        },
      ],
    });

    await expect(service.getSummary(AUTH, 'scope-1')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('marks scope counts degraded when storage ID integrity is stale', async () => {
    const { service, securityAnalytics } = createService({});
    securityAnalytics.getFindingStorageIdIntegrityWatermark.mockResolvedValue({
      observationIndexUuid: 'observation-index-uuid-1',
      matchesCurrentObservationIndex: false,
      matchesCurrentInvariant: false,
      finalPipeline: 'sentris-findings-observation-final-v1',
      templateVersion: 5,
      schemaVersion: 1,
      classificationVersion: 1,
      completedAt: '2026-07-26T12:01:00.000Z',
      checked: 5,
      mismatched: 0,
    });

    await expect(service.getSummary(AUTH, 'scope-1')).resolves.toEqual(
      expect.objectContaining({
        availability: 'degraded',
        total: 5,
      }),
    );
  });

  it('does not query analytics when the scope is outside the organization', async () => {
    const { service, securityAnalytics } = createService({ scope: null });

    await expect(service.getSummary(AUTH, 'scope-other')).rejects.toBeInstanceOf(NotFoundException);
    expect(securityAnalytics.queryFindings).not.toHaveBeenCalled();
  });

  it('throws unavailable instead of returning an empty summary on dependency failure', async () => {
    const { service } = createService({
      queryError: new Error('OpenSearch connection refused'),
    });

    await expect(service.getSummary(AUTH, 'scope-1')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });
});
