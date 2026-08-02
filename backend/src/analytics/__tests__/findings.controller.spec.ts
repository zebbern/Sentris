import { beforeEach, describe, expect, it, jest } from 'bun:test';
import {
  BadRequestException,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { InvalidFindingPageCursorError } from '../finding-pagination';
import { DECORATORS } from '@nestjs/swagger/dist/constants';

import { FindingsController } from '../findings.controller';
import { FindingsQueryService } from '../findings-query.service';
import type { SecurityAnalyticsService } from '../security-analytics.service';
import type { AuditLogService } from '../../audit/audit-log.service';
import type { AuthContext } from '../../auth/types';
import type { FindingTriageService } from '../../findings/finding-triage.service';
import type { OutboxRepository } from '../../outbox/outbox.repository';
import type { ScopesRepository } from '../../scopes/scopes.repository';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const AUTH_ADMIN: AuthContext = {
  userId: 'user-1',
  organizationId: 'org-123',
  roles: ['ADMIN'],
  isAuthenticated: true,
  provider: 'test',
};

const AUTH_NO_ORG: AuthContext = {
  userId: 'user-1',
  organizationId: null,
  roles: ['ADMIN'],
  isAuthenticated: true,
  provider: 'test',
};

const AUTH_UNAUTHENTICATED: AuthContext = {
  userId: null,
  organizationId: null,
  roles: [],
  isAuthenticated: false,
  provider: 'test',
};

// ---------------------------------------------------------------------------
// Mock factories
// ---------------------------------------------------------------------------

function makeSecurityAnalyticsService(overrides: Partial<SecurityAnalyticsService> = {}) {
  const query =
    ((overrides.queryFindings ?? overrides.query) as ReturnType<typeof jest.fn> | undefined) ??
    jest.fn().mockResolvedValue({
      total: 0,
      hits: [],
      aggregations: {
        severity_counts: { buckets: [] },
        sentris_schema_coverage: {
          buckets: {
            canonical: { doc_count: 0 },
            legacy: { doc_count: 0 },
            invalid: { doc_count: 0 },
          },
        },
      },
      availability: 'available',
    });
  const scanFindings =
    (overrides.scanFindings as ReturnType<typeof jest.fn> | undefined) ??
    jest.fn().mockImplementation(async (organizationId: string, options: any) => {
      const result = await query(organizationId, {
        query: options.query,
        size: options.limit,
        from: 0,
        sort: [{ '@timestamp': options.sortOrder }],
      });
      return result.hits;
    });
  return {
    query,
    queryFindings: query,
    queryFindingPage:
      (overrides.queryFindingPage as ReturnType<typeof jest.fn> | undefined) ??
      jest.fn().mockResolvedValue({
        total: 0,
        hits: [],
        availability: 'available',
        currentCursor: 'signed-current-cursor',
        nextCursor: null,
        aggregations: {
          sentris_schema_coverage: {
            buckets: {
              canonical: { doc_count: 0 },
              legacy: { doc_count: 0 },
              invalid: { doc_count: 0 },
            },
          },
        },
      }),
    scanFindings,
    getFindingStorageIdIntegrityWatermark:
      (overrides.getFindingStorageIdIntegrityWatermark as ReturnType<typeof jest.fn> | undefined) ??
      jest.fn().mockResolvedValue({
        observationIndexUuid: 'observation-index-uuid-1',
        matchesCurrentObservationIndex: true,
        matchesCurrentInvariant: true,
        finalPipeline: 'sentris-findings-observation-final-v1',
        templateVersion: 5,
        schemaVersion: 1,
        classificationVersion: 1,
        completedAt: '2026-07-26T12:01:00.000Z',
        checked: 0,
        mismatched: 0,
      }),
    isAvailable: jest.fn().mockReturnValue(true),
    ...overrides,
  } as unknown as SecurityAnalyticsService;
}

function makeAuditLogService(): AuditLogService {
  return {
    recordBestEffort: jest.fn(),
    recordDurable: jest.fn().mockResolvedValue(undefined),
  } as unknown as AuditLogService;
}

function makeFindingTriageService(): FindingTriageService {
  return {
    enrichWithTriageState: jest
      .fn()
      .mockImplementation((_: string, items: unknown[]) =>
        Promise.resolve(items.map((item) => ({ ...(item as object), triage: null }))),
      ),
    getProjectionHealth: jest.fn().mockResolvedValue({
      availability: 'available',
      completedAt: '2026-07-26T12:01:00.000Z',
      reconciledThrough: '2026-07-26T12:00:00.000Z',
      reason: null,
    }),
  } as unknown as FindingTriageService;
}

function makeOutboxRepository(): OutboxRepository {
  return {
    hasOutstandingEvent: jest.fn().mockResolvedValue(false),
  } as unknown as OutboxRepository;
}

function makeScopesRepository(
  overrides: {
    scope?: Record<string, unknown> | null;
    runIdPages?: string[][];
  } = {},
): ScopesRepository {
  const pages = overrides.runIdPages ?? [['run-owned-canonical', 'run-owned-legacy']];
  return {
    findById: jest
      .fn()
      .mockResolvedValue(overrides.scope === undefined ? { id: 'scope-1' } : overrides.scope),
    listRunIdsPage: jest.fn().mockImplementation(async (_scopeId, _organizationId, afterRunId) => {
      if (!afterRunId) return pages[0] ?? [];
      const pageIndex = pages.findIndex((page) => page.at(-1) === afterRunId);
      return pages[pageIndex + 1] ?? [];
    }),
  } as unknown as ScopesRepository;
}

function createController(
  overrides: {
    securityAnalytics?: SecurityAnalyticsService;
    auditLog?: AuditLogService;
    findingTriage?: FindingTriageService;
    outbox?: OutboxRepository;
    scopesRepository?: ScopesRepository;
  } = {},
) {
  const securityAnalytics = overrides.securityAnalytics ?? makeSecurityAnalyticsService();
  const auditLog = overrides.auditLog ?? makeAuditLogService();
  const findingTriage = overrides.findingTriage ?? makeFindingTriageService();
  const outbox = overrides.outbox ?? makeOutboxRepository();
  const scopesRepository = overrides.scopesRepository ?? makeScopesRepository();
  const findingsQueryService = new FindingsQueryService(
    securityAnalytics,
    auditLog,
    findingTriage,
    outbox,
    scopesRepository,
  );
  const controller = new FindingsController(securityAnalytics, auditLog, findingsQueryService);
  return { controller, securityAnalytics, auditLog, findingTriage, outbox, scopesRepository };
}

// ---------------------------------------------------------------------------
// Shared response helpers
// ---------------------------------------------------------------------------

function makeHit(id: string, source: Record<string, unknown> = {}) {
  return {
    _id: id,
    _source: {
      '@timestamp': '2025-06-15T12:00:00.000Z',
      severity: 'high',
      name: 'SQL Injection',
      asset_key: 'example.com',
      workflow_name: 'Web Scan',
      workflow_id: 'wf-1',
      run_id: 'run-1',
      component_id: 'comp-1',
      node_ref: 'node-1',
      ...source,
    },
  };
}

// ===========================================================================
// GET /findings/stats
// ===========================================================================

describe('FindingsController', () => {
  describe('OpenAPI contract', () => {
    it('declares the object-bound finding ID as a path parameter', () => {
      const parameters = Reflect.getMetadata(
        DECORATORS.API_PARAMETERS,
        FindingsController.prototype.getFinding,
      );

      expect(parameters).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: 'id',
            in: 'path',
            required: true,
          }),
        ]),
      );
    });

    it('documents both export representations and data-quality response headers', () => {
      const responses = Reflect.getMetadata(
        DECORATORS.API_RESPONSE,
        FindingsController.prototype.exportFindings,
      );

      expect(responses?.[200]?.content?.['application/json']?.schema).toEqual(
        expect.objectContaining({
          type: 'array',
          items: expect.objectContaining({ $ref: expect.stringContaining('FindingItemDto') }),
        }),
      );
      expect(responses?.[200]?.content?.['text/csv']?.schema).toEqual(
        expect.objectContaining({ type: 'string' }),
      );
      expect(responses?.[200]?.headers).toEqual(
        expect.objectContaining({
          'X-Sentris-Availability': expect.any(Object),
          'X-Sentris-Degraded-Reasons': expect.any(Object),
          'X-Sentris-Schema-Canonical': expect.any(Object),
          'X-Sentris-Schema-Legacy': expect.any(Object),
          'X-Sentris-Schema-Invalid': expect.any(Object),
        }),
      );
    });
  });

  describe('GET /findings', () => {
    it('uses PIT/search_after cursor pagination and returns the continuation token', async () => {
      const queryFindingPage = jest.fn().mockResolvedValue({
        total: 10_001,
        hits: [makeHit('finding-1')],
        availability: 'available',
        currentCursor: 'signed-current-cursor',
        nextCursor: 'signed-next-cursor',
      });
      const securityAnalytics = makeSecurityAnalyticsService({
        queryFindingPage,
      });
      const { controller } = createController({ securityAnalytics });

      const result = await controller.listFindings(AUTH_ADMIN, {
        page: 1,
        pageSize: 25,
        sortOrder: 'desc',
        paginationMode: 'cursor',
        cursor: 'signed-current-cursor',
      } as any);

      expect(queryFindingPage).toHaveBeenCalledWith(
        'org-123',
        expect.objectContaining({
          pageSize: 25,
          sortOrder: 'desc',
          cursor: 'signed-current-cursor',
        }),
      );
      expect(result.paginationMode).toBe('cursor');
      expect(result.currentCursor).toBe('signed-current-cursor');
      expect(result.nextCursor).toBe('signed-next-cursor');
      expect(securityAnalytics.query as ReturnType<typeof jest.fn>).not.toHaveBeenCalled();
    });

    it('rejects offsets beyond the OpenSearch result window with cursor guidance', async () => {
      const { controller } = createController();

      await expect(
        controller.listFindings(AUTH_ADMIN, {
          page: 102,
          pageSize: 100,
          sortOrder: 'desc',
          paginationMode: 'offset',
        } as any),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('returns a bad request for a tampered or cross-tenant cursor', async () => {
      const securityAnalytics = makeSecurityAnalyticsService({
        queryFindingPage: jest.fn().mockRejectedValue(new InvalidFindingPageCursorError()),
      });
      const { controller } = createController({ securityAnalytics });

      await expect(
        controller.listFindings(AUTH_ADMIN, {
          page: 1,
          pageSize: 25,
          sortOrder: 'desc',
          paginationMode: 'cursor',
          cursor: 'tampered',
        } as any),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('marks a response degraded when a versioned observation fails the shared schema', async () => {
      const securityAnalytics = makeSecurityAnalyticsService({
        query: jest.fn().mockResolvedValue({
          total: 1,
          hits: [
            {
              _id: 'invalid-1',
              _source: {
                contract: 'sentris.finding-observation',
                schema_version: 1,
                '@timestamp': 'not-a-date',
              },
            },
          ],
          aggregations: {},
          availability: 'available',
        }),
      });
      const { controller } = createController({ securityAnalytics });

      const result = await controller.listFindings(AUTH_ADMIN, {
        page: 1,
        pageSize: 25,
        sortOrder: 'desc',
      } as any);

      expect(result.availability).toBe('degraded');
      expect(result.items[0]?.schemaCompatibility).toBe('invalid');
    });

    it('marks a response degraded when schema coverage does not partition every matching hit', async () => {
      const securityAnalytics = makeSecurityAnalyticsService({
        query: jest.fn().mockResolvedValue({
          total: 3,
          hits: [makeHit('legacy-1')],
          aggregations: {
            sentris_schema_coverage: {
              buckets: {
                canonical: { doc_count: 1 },
                legacy: { doc_count: 1 },
                invalid: { doc_count: 0 },
              },
            },
          },
          availability: 'available',
        }),
      });
      const { controller } = createController({ securityAnalytics });

      const result = await controller.listFindings(AUTH_ADMIN, {} as any);

      expect(result.availability).toBe('degraded');
      expect(result.degradedReasons).toContain('schema_coverage_incomplete');
    });

    it('combines filters using the canonical finding observation fields', async () => {
      const { controller, securityAnalytics, scopesRepository } = createController();

      const result = await controller.listFindings(AUTH_ADMIN, {
        page: 2,
        pageSize: 10,
        severity: 'high',
        search: 'injection',
        workflowId: 'workflow-1',
        runId: 'run-1',
        scopeId: 'scope-1',
        componentId: 'component-1',
        dateFrom: '2026-07-01T00:00:00.000Z',
        dateTo: '2026-07-31T23:59:59.999Z',
        sortOrder: 'asc',
      } as any);

      const queryArg = (securityAnalytics.query as ReturnType<typeof jest.fn>).mock.calls[0][1];
      expect(queryArg).toEqual(
        expect.objectContaining({
          query: {
            bool: {
              must: [
                { term: { sentris_normalized_severity: 'high' } },
                {
                  multi_match: {
                    query: 'injection',
                    fields: [
                      'title',
                      'description',
                      'name',
                      'finding',
                      'asset_key',
                      'sentris.asset_key',
                      'sentris.workflow_name',
                      'workflow_name',
                      'host',
                      'domain',
                      'url',
                    ],
                    type: 'phrase_prefix',
                  },
                },
                {
                  bool: {
                    minimum_should_match: 1,
                    should: [
                      { term: { 'sentris.workflow_id': 'workflow-1' } },
                      {
                        bool: {
                          must: [{ term: { workflow_id: 'workflow-1' } }],
                          must_not: [{ exists: { field: 'sentris.workflow_id' } }],
                        },
                      },
                    ],
                  },
                },
                {
                  bool: {
                    minimum_should_match: 1,
                    should: [
                      { term: { 'sentris.run_id': 'run-1' } },
                      {
                        bool: {
                          must: [{ term: { run_id: 'run-1' } }],
                          must_not: [{ exists: { field: 'sentris.run_id' } }],
                        },
                      },
                    ],
                  },
                },
                {
                  bool: {
                    minimum_should_match: 1,
                    should: [
                      {
                        terms: {
                          'sentris.run_id': ['run-owned-canonical', 'run-owned-legacy'],
                        },
                      },
                      {
                        bool: {
                          must: [
                            {
                              terms: {
                                run_id: ['run-owned-canonical', 'run-owned-legacy'],
                              },
                            },
                          ],
                          must_not: [{ exists: { field: 'sentris.run_id' } }],
                        },
                      },
                    ],
                  },
                },
                {
                  bool: {
                    minimum_should_match: 1,
                    should: [
                      { term: { 'sentris.component_id': 'component-1' } },
                      {
                        bool: {
                          must: [{ term: { component_id: 'component-1' } }],
                          must_not: [{ exists: { field: 'sentris.component_id' } }],
                        },
                      },
                    ],
                  },
                },
                {
                  range: {
                    '@timestamp': {
                      gte: '2026-07-01T00:00:00.000Z',
                      lte: '2026-07-31T23:59:59.999Z',
                    },
                  },
                },
              ],
            },
          },
          size: 10,
          from: 10,
          sort: [{ '@timestamp': 'asc' }],
        }),
      );
      expect(queryArg.aggs.sentris_schema_coverage).toBeDefined();
      expect(scopesRepository.findById).toHaveBeenCalledWith('scope-1', 'org-123');
      expect(scopesRepository.listRunIdsPage).toHaveBeenCalledWith(
        'scope-1',
        'org-123',
        undefined,
        1_000,
      );
      expect(result.availability).toBe('available');
    });

    it('rejects a foreign scope before querying OpenSearch', async () => {
      const scopesRepository = makeScopesRepository({ scope: null });
      const { controller, securityAnalytics } = createController({ scopesRepository });

      await expect(
        controller.listFindings(AUTH_ADMIN, { scopeId: 'scope-foreign' } as any),
      ).rejects.toBeInstanceOf(NotFoundException);

      expect(scopesRepository.findById).toHaveBeenCalledWith('scope-foreign', 'org-123');
      expect(securityAnalytics.queryFindings as ReturnType<typeof jest.fn>).not.toHaveBeenCalled();
    });

    it('uses match_none for an owned scope with no runs', async () => {
      const scopesRepository = makeScopesRepository({ runIdPages: [[]] });
      const { controller, securityAnalytics } = createController({ scopesRepository });

      await controller.listFindings(AUTH_ADMIN, { scopeId: 'scope-1' } as any);

      expect(
        (securityAnalytics.queryFindings as ReturnType<typeof jest.fn>).mock.calls[0][1].query,
      ).toEqual({
        bool: {
          must: [{ match_none: {} }],
        },
      });
    });

    it('returns canonical identity while remaining compatible with legacy root fields', async () => {
      const securityAnalytics = makeSecurityAnalyticsService();
      (securityAnalytics.query as ReturnType<typeof jest.fn>).mockResolvedValue({
        total: 2,
        hits: [
          makeHit('legacy'),
          makeHit('canonical', {
            asset_key: undefined,
            workflow_name: undefined,
            workflow_id: undefined,
            run_id: undefined,
            component_id: undefined,
            node_ref: undefined,
            sentris: {
              asset_key: 'canonical.example',
              workflow_name: 'Canonical workflow',
              workflow_id: 'workflow-canonical',
              run_id: 'run-canonical',
              scope_id: 'scope-canonical',
              component_id: 'component-canonical',
              node_ref: 'node-canonical',
            },
          }),
        ],
      });
      const { controller } = createController({ securityAnalytics });

      const result = await controller.listFindings(AUTH_ADMIN, {} as any);

      expect(result.items[0]).toEqual(
        expect.objectContaining({
          workflow_id: 'wf-1',
          run_id: 'run-1',
        }),
      );
      expect(result.items[1]).toEqual(
        expect.objectContaining({
          asset_key: 'canonical.example',
          workflow_name: 'Canonical workflow',
          workflow_id: 'workflow-canonical',
          run_id: 'run-canonical',
          scope_id: 'scope-canonical',
          component_id: 'component-canonical',
          node_ref: 'node-canonical',
        }),
      );
    });

    it('marks unfiltered results degraded when triage enrichment is unavailable', async () => {
      const findingTriage = makeFindingTriageService();
      (findingTriage.enrichWithTriageState as ReturnType<typeof jest.fn>).mockRejectedValue(
        new Error('Postgres unavailable'),
      );
      const securityAnalytics = makeSecurityAnalyticsService();
      (securityAnalytics.query as ReturnType<typeof jest.fn>).mockResolvedValue({
        total: 1,
        hits: [makeHit('f-1')],
      });
      const { controller } = createController({ securityAnalytics, findingTriage });

      const result = await controller.listFindings(AUTH_ADMIN, {} as any);

      expect(result.items).toHaveLength(1);
      expect(result.availability).toBe('degraded');
      expect(result.degradedReasons).toContain('triage_enrichment_unavailable');
    });

    it('filters projected triage in OpenSearch without materializing PostgreSQL IDs', async () => {
      const { controller, securityAnalytics, findingTriage } = createController();
      (securityAnalytics.query as ReturnType<typeof jest.fn>).mockResolvedValueOnce({
        total: 1,
        hits: [makeHit('f-1')],
        availability: 'available',
        aggregations: {
          sentris_schema_coverage: {
            buckets: {
              canonical: { doc_count: 0 },
              legacy: { doc_count: 1 },
              invalid: { doc_count: 0 },
            },
          },
        },
      });

      await controller.listFindings(AUTH_ADMIN, {
        triageStatus: 'new,fixed',
        assigneeUserId: 'user-1',
      } as any);

      const queryArg = (securityAnalytics.query as ReturnType<typeof jest.fn>).mock.calls[0][1];
      expect(queryArg.query).toEqual({
        bool: {
          must: [
            {
              bool: {
                minimum_should_match: 1,
                should: [
                  { terms: { 'sentris.triage.status': ['fixed'] } },
                  { term: { 'sentris.triage.status': 'new' } },
                  {
                    bool: {
                      must_not: [{ exists: { field: 'sentris.triage.status' } }],
                    },
                  },
                ],
              },
            },
            { term: { 'sentris.triage.assignee_user_id': 'user-1' } },
          ],
        },
      });
      expect(findingTriage.enrichWithTriageState).toHaveBeenCalledTimes(1);
    });

    it('marks projected filters degraded while a projection event is pending or dead', async () => {
      const outbox = makeOutboxRepository();
      (outbox.hasOutstandingEvent as ReturnType<typeof jest.fn>).mockResolvedValue(true);
      const { controller } = createController({ outbox });

      const result = await controller.listFindings(AUTH_ADMIN, { triageStatus: 'fixed' } as any);

      expect(result.availability).toBe('degraded');
      expect(outbox.hasOutstandingEvent).toHaveBeenCalledWith(
        'org-123',
        'finding.triage.project.v1',
      );
      expect(result.projectionHealth).toEqual(
        expect.objectContaining({
          availability: 'degraded',
          reason: 'projection_events_pending',
        }),
      );
    });

    it('preserves projection health on an unfiltered zero-item page', async () => {
      const findingTriage = makeFindingTriageService();
      (findingTriage.getProjectionHealth as ReturnType<typeof jest.fn>).mockResolvedValue({
        availability: 'degraded',
        completedAt: '2026-07-26T12:01:00.000Z',
        reconciledThrough: '2026-07-26T12:00:00.000Z',
        reason: 'authoritative_updates_pending',
      });
      const { controller } = createController({ findingTriage });

      const result = await controller.listFindings(AUTH_ADMIN, {} as any);

      expect(result.items).toEqual([]);
      expect(result.availability).toBe('degraded');
      expect(result.projectionHealth).toEqual({
        availability: 'degraded',
        completedAt: '2026-07-26T12:01:00.000Z',
        reconciledThrough: '2026-07-26T12:00:00.000Z',
        reason: 'authoritative_updates_pending',
      });
      expect(result.degradedReasons).toContain('authoritative_updates_pending');
    });

    it('exposes the durable projection watermark for projected filters', async () => {
      const findingTriage = makeFindingTriageService();
      (findingTriage.getProjectionHealth as ReturnType<typeof jest.fn>).mockResolvedValue({
        availability: 'degraded',
        completedAt: '2026-07-26T12:01:00.000Z',
        reconciledThrough: '2026-07-26T12:00:00.000Z',
        reason: 'authoritative_updates_pending',
      });
      const { controller } = createController({ findingTriage });

      const result = await controller.listFindings(AUTH_ADMIN, { triageStatus: 'fixed' } as any);

      expect(result.availability).toBe('degraded');
      expect(result.projectionHealth).toEqual({
        availability: 'degraded',
        completedAt: '2026-07-26T12:01:00.000Z',
        reconciledThrough: '2026-07-26T12:00:00.000Z',
        reason: 'authoritative_updates_pending',
      });
    });

    it('degrades an unfiltered page when authoritative row versions exceed the projection', async () => {
      const securityAnalytics = makeSecurityAnalyticsService({
        query: jest.fn().mockResolvedValue({
          total: 1,
          hits: [
            makeHit('f-1', {
              sentris: {
                triage: {
                  status: 'triaged',
                  assignee_user_id: null,
                  severity_override: null,
                  notes: null,
                  updated_at: '2026-07-26T11:00:00.000Z',
                  version: 1,
                },
              },
            }),
          ],
          aggregations: {},
          availability: 'available',
        }),
      });
      const findingTriage = makeFindingTriageService();
      (findingTriage.enrichWithTriageState as ReturnType<typeof jest.fn>).mockResolvedValue([
        {
          id: 'f-1',
          timestamp: '2025-06-15T12:00:00.000Z',
          triage: {
            status: 'fixed',
            assigneeUserId: null,
            severityOverride: null,
            notes: null,
            updatedAt: '2026-07-26T12:00:00.000Z',
            projectionVersion: 2,
          },
        },
      ]);
      const { controller } = createController({ securityAnalytics, findingTriage });

      const result = await controller.listFindings(AUTH_ADMIN, {} as any);

      expect(result.items[0]?.triage?.projectionVersion).toBe(2);
      expect(result.availability).toBe('degraded');
      expect(result.degradedReasons).toContain('triage_projection_stale');
    });

    it('throws unavailable instead of returning a false zero when OpenSearch fails', async () => {
      const securityAnalytics = makeSecurityAnalyticsService();
      (securityAnalytics.query as ReturnType<typeof jest.fn>).mockRejectedValue(
        new Error('Connection refused'),
      );
      const { controller } = createController({ securityAnalytics });

      await expect(controller.listFindings(AUTH_ADMIN, {} as any)).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );
    });
  });

  describe('GET /findings/stats', () => {
    let controller: FindingsController;
    let securityAnalytics: SecurityAnalyticsService;

    beforeEach(() => {
      const ctx = createController();
      controller = ctx.controller;
      securityAnalytics = ctx.securityAnalytics;
    });

    it('returns severity counts from OpenSearch aggregation buckets', async () => {
      (securityAnalytics.query as ReturnType<typeof jest.fn>).mockResolvedValue({
        total: 55,
        hits: [],
        aggregations: {
          severity_counts: {
            buckets: [
              { key: 'high', doc_count: 42 },
              { key: 'critical', doc_count: 13 },
            ],
          },
          sentris_schema_coverage: {
            buckets: {
              canonical: { doc_count: 50 },
              legacy: { doc_count: 5 },
              invalid: { doc_count: 0 },
            },
          },
        },
      });

      const result = await controller.getStats(AUTH_ADMIN, {} as any);

      expect(result.severityCounts).toEqual([
        { severity: 'high', count: 42 },
        { severity: 'critical', count: 13 },
      ]);
      expect(result.total).toBe(55);
      expect(result.availability).toBe('available');
      expect(result.schemaCoverage).toEqual({ canonical: 50, legacy: 5, invalid: 0 });
      expect((securityAnalytics.query as ReturnType<typeof jest.fn>).mock.calls[0][1].aggs).toEqual(
        expect.objectContaining({
          severity_counts: {
            terms: { field: 'sentris_normalized_severity', size: 10 },
          },
        }),
      );
    });

    it.each([
      {
        label: 'missing aggregation',
        total: 0,
        severityCounts: undefined,
      },
      {
        label: 'unknown severity',
        total: 1,
        severityCounts: { buckets: [{ key: 'urgent', doc_count: 1 }] },
      },
      {
        label: 'duplicate severity',
        total: 2,
        severityCounts: {
          buckets: [
            { key: 'high', doc_count: 1 },
            { key: 'high', doc_count: 1 },
          ],
        },
      },
      {
        label: 'negative count',
        total: 0,
        severityCounts: { buckets: [{ key: 'high', doc_count: -1 }] },
      },
      {
        label: 'unsafe count',
        total: 0,
        severityCounts: {
          buckets: [{ key: 'high', doc_count: Number.MAX_SAFE_INTEGER + 1 }],
        },
      },
      {
        label: 'count sum mismatch',
        total: 2,
        severityCounts: { buckets: [{ key: 'high', doc_count: 1 }] },
      },
    ])(
      'rejects $label instead of publishing false severity stats',
      async ({ total, severityCounts }) => {
        (securityAnalytics.query as ReturnType<typeof jest.fn>).mockResolvedValue({
          total,
          hits: [],
          aggregations: {
            ...(severityCounts !== undefined && { severity_counts: severityCounts }),
            sentris_schema_coverage: {
              buckets: {
                canonical: { doc_count: total },
                legacy: { doc_count: 0 },
                invalid: { doc_count: 0 },
              },
            },
          },
        });

        await expect(controller.getStats(AUTH_ADMIN, {} as any)).rejects.toBeInstanceOf(
          ServiceUnavailableException,
        );
      },
    );

    it('marks aggregate stats degraded when versioned documents fail coverage', async () => {
      (securityAnalytics.query as ReturnType<typeof jest.fn>).mockResolvedValue({
        total: 3,
        hits: [],
        aggregations: {
          severity_counts: { buckets: [{ key: 'high', doc_count: 3 }] },
          sentris_schema_coverage: {
            buckets: {
              canonical: { doc_count: 1 },
              legacy: { doc_count: 1 },
              invalid: { doc_count: 1 },
            },
          },
        },
      });

      const result = await controller.getStats(AUTH_ADMIN, {} as any);

      expect(result.availability).toBe('degraded');
      expect(result.schemaCoverage.invalid).toBe(1);
    });

    it('marks stats degraded when storage ID integrity has not been reconciled', async () => {
      const securityAnalytics = makeSecurityAnalyticsService({
        getFindingStorageIdIntegrityWatermark: jest.fn().mockResolvedValue(null),
      });
      const { controller } = createController({ securityAnalytics });

      const result = await controller.getStats(AUTH_ADMIN, {} as any);

      expect(result.availability).toBe('degraded');
    });

    it('applies projected triage filters to the same OpenSearch aggregation', async () => {
      await controller.getStats(AUTH_ADMIN, {
        triageStatus: 'fixed',
        assigneeUserId: 'user-1',
      } as any);

      const queryArg = (securityAnalytics.query as ReturnType<typeof jest.fn>).mock.calls[0][1];
      expect(queryArg.query).toEqual({
        bool: {
          must: [
            { terms: { 'sentris.triage.status': ['fixed'] } },
            { term: { 'sentris.triage.assignee_user_id': 'user-1' } },
          ],
        },
      });
    });

    it('resolves scope stats through organization-owned run IDs', async () => {
      await controller.getStats(AUTH_ADMIN, { scopeId: 'scope-1' } as any);

      const queryArg = (securityAnalytics.queryFindings as ReturnType<typeof jest.fn>).mock
        .calls[0][1];
      expect(queryArg.query).toEqual({
        bool: {
          must: [
            {
              bool: {
                minimum_should_match: 1,
                should: [
                  {
                    terms: {
                      'sentris.run_id': ['run-owned-canonical', 'run-owned-legacy'],
                    },
                  },
                  {
                    bool: {
                      must: [
                        {
                          terms: {
                            run_id: ['run-owned-canonical', 'run-owned-legacy'],
                          },
                        },
                      ],
                      must_not: [{ exists: { field: 'sentris.run_id' } }],
                    },
                  },
                ],
              },
            },
          ],
        },
      });
    });

    it('marks filtered stats degraded while projection work is outstanding', async () => {
      const outbox = makeOutboxRepository();
      (outbox.hasOutstandingEvent as ReturnType<typeof jest.fn>).mockResolvedValue(true);
      const ctx = createController({ outbox });

      const result = await ctx.controller.getStats(AUTH_ADMIN, { triageStatus: 'fixed' } as any);

      expect(result.availability).toBe('degraded');
      expect(result.projectionHealth?.reason).toBe('projection_events_pending');
      expect(outbox.hasOutstandingEvent).toHaveBeenCalledTimes(1);
    });

    it('throws unavailable when OpenSearch query fails', async () => {
      (securityAnalytics.query as ReturnType<typeof jest.fn>).mockRejectedValue(
        new Error('Connection refused'),
      );

      await expect(controller.getStats(AUTH_ADMIN, {} as any)).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );
    });

    it('throws UnauthorizedException when unauthenticated', async () => {
      await expect(controller.getStats(AUTH_UNAUTHENTICATED, {} as any)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it('throws UnauthorizedException when no organization context', async () => {
      await expect(controller.getStats(AUTH_NO_ORG, {} as any)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it('throws UnauthorizedException when auth is null', async () => {
      await expect(controller.getStats(null, {} as any)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });
  });

  // =========================================================================
  // GET /findings/export
  // =========================================================================

  describe('GET /findings/export', () => {
    let controller: FindingsController;
    let securityAnalytics: SecurityAnalyticsService;
    let auditLog: AuditLogService;

    beforeEach(() => {
      const ctx = createController();
      controller = ctx.controller;
      securityAnalytics = ctx.securityAnalytics;
      auditLog = ctx.auditLog;
    });

    function makeMockResponse() {
      const headers: Record<string, string> = {};
      const res = {
        set: jest.fn().mockImplementation(function (this: any, key: string, value: string) {
          headers[key] = value;
          return this;
        }),
        send: jest.fn().mockReturnThis(),
        json: jest.fn().mockReturnThis(),
        _headers: headers,
      };
      return res as any;
    }

    it('returns JSON with correct Content-Type and Content-Disposition when format=json', async () => {
      const hit = makeHit('f-1');
      (securityAnalytics.query as ReturnType<typeof jest.fn>).mockResolvedValue({
        total: 1,
        hits: [hit],
      });

      const res = makeMockResponse();
      await controller.exportFindings(AUTH_ADMIN, { format: 'json', limit: 100 } as any, res);

      expect(res.set).toHaveBeenCalledWith('Content-Type', 'application/json');
      expect(res.set).toHaveBeenCalledWith('X-Sentris-Availability', 'available');
      expect(res.set).toHaveBeenCalledWith('X-Sentris-Schema-Canonical', '0');
      expect(res.set).toHaveBeenCalledWith('X-Sentris-Schema-Legacy', '1');
      expect(res.set).toHaveBeenCalledWith('X-Sentris-Schema-Invalid', '0');
      expect(res.set).toHaveBeenCalledWith(
        'Content-Disposition',
        expect.stringContaining('findings-export-'),
      );
      expect(res.json).toHaveBeenCalled();
      expect(auditLog.recordDurable).toHaveBeenCalledWith(
        AUTH_ADMIN,
        expect.objectContaining({
          action: 'findings.export',
          metadata: expect.objectContaining({ resultCount: 1 }),
        }),
      );
    });

    it('does not release an export when its durable audit cannot be accepted', async () => {
      const hit = makeHit('f-1');
      (securityAnalytics.query as ReturnType<typeof jest.fn>).mockResolvedValue({
        total: 1,
        hits: [hit],
      });
      (auditLog.recordDurable as ReturnType<typeof jest.fn>).mockRejectedValueOnce(
        new Error('audit outbox unavailable'),
      );

      const res = makeMockResponse();
      await expect(
        controller.exportFindings(AUTH_ADMIN, { format: 'json', limit: 100 } as any, res),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);

      expect(res.send).not.toHaveBeenCalled();
      expect(res.json).not.toHaveBeenCalled();
      expect(res.set).not.toHaveBeenCalled();
    });

    it('returns CSV with correct Content-Type when format=csv', async () => {
      const hit = makeHit('f-1');
      (securityAnalytics.query as ReturnType<typeof jest.fn>).mockResolvedValue({
        total: 1,
        hits: [hit],
      });

      const res = makeMockResponse();
      await controller.exportFindings(AUTH_ADMIN, { format: 'csv', limit: 100 } as any, res);

      expect(res.set).toHaveBeenCalledWith('Content-Type', 'text/csv');
      expect(res.send).toHaveBeenCalled();
    });

    it('CSV output contains expected columns', async () => {
      const hit = makeHit('f-1');
      (securityAnalytics.query as ReturnType<typeof jest.fn>).mockResolvedValue({
        total: 1,
        hits: [hit],
      });

      const res = makeMockResponse();
      await controller.exportFindings(AUTH_ADMIN, { format: 'csv', limit: 100 } as any, res);

      const csvOutput: string = res.send.mock.calls[0][0];
      const headerLine = csvOutput.split('\r\n')[0];
      const expectedColumns = [
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
      ];
      expect(headerLine).toBe(expectedColumns.join(','));
    });

    it('CSV properly escapes values containing commas and quotes', async () => {
      const hit = makeHit('f-1', { name: 'Vuln with, comma', asset_key: 'host "quoted"' });
      (securityAnalytics.query as ReturnType<typeof jest.fn>).mockResolvedValue({
        total: 1,
        hits: [hit],
      });

      const res = makeMockResponse();
      await controller.exportFindings(AUTH_ADMIN, { format: 'csv', limit: 100 } as any, res);

      const csvOutput: string = res.send.mock.calls[0][0];
      const dataLine = csvOutput.split('\r\n')[1];
      // Commas should be wrapped in double quotes
      expect(dataLine).toContain('"Vuln with, comma"');
      // Inner double quotes should be escaped to double-double quotes
      expect(dataLine).toContain('"host ""quoted"""');
    });

    it('neutralizes formulas without corrupting ordinary signed numbers', async () => {
      const hit = makeHit('f-1', {
        name: '=HYPERLINK("https://example.test")',
        asset_key: '-42.50',
        workflow_name: '-cmd|calc',
        component_id: '@SUM(A1:A2)',
      });
      (securityAnalytics.query as ReturnType<typeof jest.fn>).mockResolvedValue({
        total: 1,
        hits: [hit],
      });

      const res = makeMockResponse();
      await controller.exportFindings(AUTH_ADMIN, { format: 'csv', limit: 100 } as any, res);

      const csvOutput: string = res.send.mock.calls[0][0];
      const dataLine = csvOutput.split('\r\n')[1];
      expect(dataLine).toContain('"\'=HYPERLINK(""https://example.test"")"');
      expect(dataLine).toContain(',-42.50,');
      expect(dataLine).toContain("'-cmd|calc");
      expect(dataLine).toContain("'@SUM(A1:A2)");
    });

    it('applies severity filter to the OpenSearch query', async () => {
      (securityAnalytics.query as ReturnType<typeof jest.fn>).mockResolvedValue({
        total: 0,
        hits: [],
      });

      const res = makeMockResponse();
      await controller.exportFindings(
        AUTH_ADMIN,
        { format: 'json', limit: 100, severity: 'critical' } as any,
        res,
      );

      const queryArg = (securityAnalytics.query as ReturnType<typeof jest.fn>).mock.calls[0][1];
      expect(queryArg.query).toEqual({
        bool: { must: [{ term: { sentris_normalized_severity: 'critical' } }] },
      });
    });

    it('applies projected triage filters to exports', async () => {
      const res = makeMockResponse();
      await controller.exportFindings(
        AUTH_ADMIN,
        {
          format: 'json',
          limit: 100,
          triageStatus: 'triaged',
          assigneeUserId: 'user-1',
        } as any,
        res,
      );

      const queryArg = (securityAnalytics.query as ReturnType<typeof jest.fn>).mock.calls[0][1];
      expect(queryArg.query).toEqual({
        bool: {
          must: [
            { terms: { 'sentris.triage.status': ['triaged'] } },
            { term: { 'sentris.triage.assignee_user_id': 'user-1' } },
          ],
        },
      });
    });

    it('resolves scope exports through organization-owned run IDs', async () => {
      const res = makeMockResponse();

      await controller.exportFindings(
        AUTH_ADMIN,
        { format: 'json', scopeId: 'scope-1' } as any,
        res,
      );

      const scanFindings = securityAnalytics.scanFindings as ReturnType<typeof jest.fn>;
      expect(scanFindings.mock.calls[0][1].query).toEqual({
        bool: {
          must: [
            {
              bool: {
                minimum_should_match: 1,
                should: [
                  {
                    terms: {
                      'sentris.run_id': ['run-owned-canonical', 'run-owned-legacy'],
                    },
                  },
                  {
                    bool: {
                      must: [
                        {
                          terms: {
                            run_id: ['run-owned-canonical', 'run-owned-legacy'],
                          },
                        },
                      ],
                      must_not: [{ exists: { field: 'sentris.run_id' } }],
                    },
                  },
                ],
              },
            },
          ],
        },
      });
    });

    it('exposes degraded projection consistency on the export response', async () => {
      const outbox = makeOutboxRepository();
      (outbox.hasOutstandingEvent as ReturnType<typeof jest.fn>).mockResolvedValue(true);
      const ctx = createController({ outbox });
      const res = makeMockResponse();

      await ctx.controller.exportFindings(
        AUTH_ADMIN,
        { format: 'json', triageStatus: 'fixed' } as any,
        res,
      );

      expect(res.set).toHaveBeenCalledWith('X-Sentris-Availability', 'degraded');
      expect(res.set).toHaveBeenCalledWith(
        'X-Sentris-Projection-Health-Reason',
        'projection_events_pending',
      );
    });

    it('checks projection health for an unfiltered export', async () => {
      const outbox = makeOutboxRepository();
      (outbox.hasOutstandingEvent as ReturnType<typeof jest.fn>).mockResolvedValue(true);
      const ctx = createController({ outbox });
      const res = makeMockResponse();

      await ctx.controller.exportFindings(AUTH_ADMIN, { format: 'json' } as any, res);

      expect(res.set).toHaveBeenCalledWith('X-Sentris-Availability', 'degraded');
      expect(res.set).toHaveBeenCalledWith(
        'X-Sentris-Projection-Health-Reason',
        'projection_events_pending',
      );
    });

    it('exports authoritative triage and degrades when the projection is behind', async () => {
      const hit = makeHit('f-1', {
        sentris: {
          triage: {
            status: 'triaged',
            assignee_user_id: null,
            severity_override: null,
            notes: null,
            updated_at: '2026-07-26T11:59:00.000Z',
            version: 1,
          },
        },
      });
      const securityAnalytics = makeSecurityAnalyticsService({
        scanFindings: jest.fn().mockResolvedValue([hit]),
      });
      const findingTriage = makeFindingTriageService();
      (findingTriage.enrichWithTriageState as ReturnType<typeof jest.fn>).mockImplementation(
        async (_organizationId: string, items: Record<string, unknown>[]) =>
          items.map((item) => ({
            ...item,
            triage: {
              status: 'fixed',
              assigneeUserId: 'user-2',
              severityOverride: 'critical',
              notes: 'verified',
              updatedAt: '2026-07-26T12:01:00.000Z',
              projectionVersion: 2,
            },
          })),
      );
      const ctx = createController({ securityAnalytics, findingTriage });
      const res = makeMockResponse();

      await ctx.controller.exportFindings(AUTH_ADMIN, { format: 'json' } as any, res);

      expect(res.json).toHaveBeenCalledWith([
        expect.objectContaining({
          triage: expect.objectContaining({
            status: 'fixed',
            projectionVersion: 2,
          }),
        }),
      ]);
      expect(res.set).toHaveBeenCalledWith('X-Sentris-Availability', 'degraded');
      expect(res.set).toHaveBeenCalledWith('X-Sentris-Degraded-Reasons', 'triage_projection_stale');
    });

    it('exports observation data as degraded when authoritative triage enrichment is unavailable', async () => {
      const securityAnalytics = makeSecurityAnalyticsService({
        scanFindings: jest.fn().mockResolvedValue([makeHit('f-1')]),
      });
      const findingTriage = makeFindingTriageService();
      (findingTriage.enrichWithTriageState as ReturnType<typeof jest.fn>).mockRejectedValue(
        new Error('Postgres unavailable'),
      );
      const ctx = createController({ securityAnalytics, findingTriage });
      const res = makeMockResponse();

      await ctx.controller.exportFindings(AUTH_ADMIN, { format: 'json' } as any, res);

      expect(res.set).toHaveBeenCalledWith('X-Sentris-Availability', 'degraded');
      expect(res.set).toHaveBeenCalledWith(
        'X-Sentris-Degraded-Reasons',
        'triage_enrichment_unavailable',
      );
      expect(res.json).toHaveBeenCalled();
    });

    it('enriches an unbounded export in safe batches without truncating results', async () => {
      const hits = Array.from({ length: 5_001 }, (_, index) => makeHit(`f-${index}`));
      const securityAnalytics = makeSecurityAnalyticsService({
        scanFindings: jest.fn().mockResolvedValue(hits),
      });
      const findingTriage = makeFindingTriageService();
      (findingTriage.enrichWithTriageState as ReturnType<typeof jest.fn>).mockImplementation(
        async (_organizationId: string, items: Record<string, unknown>[]) => {
          if (items.length > 5_000) throw new Error('unsafe PostgreSQL parameter batch');
          return items.map((item) => ({
            ...item,
            triage: {
              status: 'fixed',
              assigneeUserId: null,
              severityOverride: null,
              notes: null,
              updatedAt: '2026-07-26T12:00:00.000Z',
              projectionVersion: 1,
            },
          }));
        },
      );
      const ctx = createController({ securityAnalytics, findingTriage });
      const res = makeMockResponse();

      await ctx.controller.exportFindings(AUTH_ADMIN, { format: 'json' } as any, res);

      const exported = res.json.mock.calls[0]?.[0] as {
        triage?: { status?: string };
      }[];
      expect(exported).toHaveLength(5_001);
      expect(exported[0]?.triage?.status).toBe('fixed');
      expect(exported.at(-1)?.triage?.status).toBe('fixed');
    });

    it('degrades an export when a versioned hit violates the shared contract', async () => {
      const securityAnalytics = makeSecurityAnalyticsService({
        scanFindings: jest.fn().mockResolvedValue([
          {
            _id: 'invalid-1',
            _source: {
              contract: 'sentris.finding-observation',
              schema_version: 1,
              '@timestamp': 'not-a-date',
            },
          },
        ]),
      });
      const ctx = createController({ securityAnalytics });
      const res = makeMockResponse();

      await ctx.controller.exportFindings(AUTH_ADMIN, { format: 'json' } as any, res);

      expect(res.set).toHaveBeenCalledWith('X-Sentris-Availability', 'degraded');
      expect(res.json).toHaveBeenCalledWith([
        expect.objectContaining({ schemaCompatibility: 'invalid' }),
      ]);
    });

    it('respects the limit parameter', async () => {
      (securityAnalytics.query as ReturnType<typeof jest.fn>).mockResolvedValue({
        total: 0,
        hits: [],
      });

      const res = makeMockResponse();
      await controller.exportFindings(AUTH_ADMIN, { format: 'json', limit: 42 } as any, res);

      const queryArg = (securityAnalytics.query as ReturnType<typeof jest.fn>).mock.calls[0][1];
      expect(queryArg.size).toBe(42);
    });

    it('throws UnauthorizedException when unauthenticated', async () => {
      const res = makeMockResponse();
      await expect(
        controller.exportFindings(AUTH_UNAUTHENTICATED, { format: 'json' } as any, res),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('throws ServiceUnavailableException when OpenSearch fails', async () => {
      (securityAnalytics.query as ReturnType<typeof jest.fn>).mockRejectedValue(
        new Error('Connection lost'),
      );

      const res = makeMockResponse();
      await expect(
        controller.exportFindings(AUTH_ADMIN, { format: 'json', limit: 100 } as any, res),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);
    });
  });

  // =========================================================================
  // GET /findings/:id
  // =========================================================================

  describe('GET /findings/:id', () => {
    let controller: FindingsController;
    let securityAnalytics: SecurityAnalyticsService;

    beforeEach(() => {
      const ctx = createController();
      controller = ctx.controller;
      securityAnalytics = ctx.securityAnalytics;
    });

    it('returns full finding detail when document exists', async () => {
      const hit = makeHit('finding-42');
      (securityAnalytics.query as ReturnType<typeof jest.fn>).mockResolvedValue({
        total: 1,
        hits: [hit],
      });

      const result = await controller.getFinding(AUTH_ADMIN, { id: 'finding-42' });

      expect(result.id).toBe('finding-42');
      expect(result.severity).toBe('high');
      expect(result.name).toBe('SQL Injection');
      expect(result.availability).toBe('available');
    });

    it('includes raw field with complete _source data', async () => {
      const sourceData = {
        '@timestamp': '2025-06-15T12:00:00.000Z',
        severity: 'high',
        custom: 'data',
      };
      const hit = { _id: 'f-1', _source: sourceData };
      (securityAnalytics.query as ReturnType<typeof jest.fn>).mockResolvedValue({
        total: 1,
        hits: [hit],
      });

      const result = await controller.getFinding(AUTH_ADMIN, { id: 'f-1' });

      expect(result.raw).toEqual(sourceData);
    });

    it('overlays authoritative PostgreSQL triage and reports a stale projection as degraded', async () => {
      const securityAnalytics = makeSecurityAnalyticsService();
      (securityAnalytics.query as ReturnType<typeof jest.fn>).mockResolvedValue({
        total: 1,
        hits: [
          makeHit('f-1', {
            sentris: {
              triage: {
                status: 'triaged',
                assignee_user_id: null,
                severity_override: null,
                notes: null,
                updated_at: '2026-07-26T11:00:00.000Z',
                version: 1,
              },
            },
          }),
        ],
      });
      const findingTriage = makeFindingTriageService();
      (findingTriage.enrichWithTriageState as ReturnType<typeof jest.fn>).mockResolvedValue([
        {
          id: 'f-1',
          timestamp: '2025-06-15T12:00:00.000Z',
          triage: {
            status: 'fixed',
            assigneeUserId: 'user-1',
            severityOverride: null,
            notes: null,
            updatedAt: '2026-07-26T12:00:00.000Z',
            projectionVersion: 2,
          },
        },
      ]);
      const { controller } = createController({ securityAnalytics, findingTriage });

      const result = await controller.getFinding(AUTH_ADMIN, { id: 'f-1' });

      expect(result.triage?.status).toBe('fixed');
      expect(result.triage?.projectionVersion).toBe(2);
      expect(result.availability).toBe('degraded');
    });

    it('throws NotFoundException when no hits returned', async () => {
      (securityAnalytics.query as ReturnType<typeof jest.fn>).mockResolvedValue({
        total: 0,
        hits: [],
      });

      await expect(controller.getFinding(AUTH_ADMIN, { id: 'nonexistent' })).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('throws ServiceUnavailableException when OpenSearch is disabled', async () => {
      const svc = makeSecurityAnalyticsService();
      (svc.isAvailable as ReturnType<typeof jest.fn>).mockReturnValue(false);
      const { controller: ctrl } = createController({ securityAnalytics: svc });

      await expect(ctrl.getFinding(AUTH_ADMIN, { id: 'any-id' })).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );
    });

    it('throws UnauthorizedException when unauthenticated', async () => {
      await expect(
        controller.getFinding(AUTH_UNAUTHENTICATED, { id: 'any-id' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('throws UnauthorizedException when auth is null', async () => {
      await expect(controller.getFinding(null, { id: 'any-id' })).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });
  });
});
