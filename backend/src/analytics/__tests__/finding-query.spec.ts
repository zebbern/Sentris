import { describe, expect, it } from 'bun:test';

import {
  buildFindingFilter,
  buildFindingSchemaCoverageAggregation,
  mapFindingHitWithCompatibility,
  mapFindingHit,
  readFindingSchemaCoverage,
} from '../finding-query';
import {
  FINDINGS_CONTRACT_CLASSIFICATION_VERSION,
  FINDINGS_CONTRACT_CLASSIFICATION_FIELD,
  FINDINGS_CONTRACT_VALIDATION_VERSION_FIELD,
} from '../findings-index-template';

describe('buildFindingFilter triage projection', () => {
  it('queries canonical exact-match fields with disjoint legacy root fallbacks', () => {
    const query = buildFindingFilter({
      search: 'Nightly scan',
      workflowId: 'workflow-1',
      runId: 'run-1',
      componentId: 'component-1',
    });

    expect(query).toEqual({
      bool: {
        must: [
          {
            multi_match: expect.objectContaining({
              fields: expect.arrayContaining(['sentris.workflow_name', 'workflow_name']),
            }),
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
        ],
      },
    });
  });

  it('combines observation and projected triage filters in one OpenSearch query', () => {
    expect(
      buildFindingFilter(
        {
          severity: 'high',
          scopeId: 'scope-1',
          triageStatus: 'triaged,in_progress',
          assigneeUserId: 'user-1',
        },
        {
          ownedScopeRunIds: ['run-canonical', 'run-legacy'],
        },
      ),
    ).toEqual({
      bool: {
        must: [
          { term: { sentris_normalized_severity: 'high' } },
          {
            bool: {
              minimum_should_match: 1,
              should: [
                {
                  terms: {
                    'sentris.run_id': ['run-canonical', 'run-legacy'],
                  },
                },
                {
                  bool: {
                    must: [
                      {
                        terms: {
                          run_id: ['run-canonical', 'run-legacy'],
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
            terms: {
              'sentris.triage.status': ['triaged', 'in_progress'],
            },
          },
          { term: { 'sentris.triage.assignee_user_id': 'user-1' } },
        ],
      },
    });
  });

  it('uses the indexed normalized severity when legacy source casing differs', () => {
    const mapped = mapFindingHit({
      _id: 'legacy-high',
      _source: {
        severity: 'HIGH',
        sentris_normalized_severity: 'high',
        title: 'Legacy high severity',
      },
    });

    expect(mapped.severity).toBe('high');
  });

  it('fails closed when a scope filter has not been resolved through PostgreSQL ownership', () => {
    expect(() => buildFindingFilter({ scopeId: 'scope-1' })).toThrow(
      'Scope filtering requires organization-owned run IDs',
    );
  });

  it('matches nothing when an owned scope has no runs', () => {
    expect(
      buildFindingFilter(
        { scopeId: 'scope-1' },
        {
          ownedScopeRunIds: [],
        },
      ),
    ).toEqual({
      bool: {
        must: [{ match_none: {} }],
      },
    });
  });

  it('chunks run ownership clauses instead of relying on an unbounded terms array', () => {
    const runIds = Array.from({ length: 1_001 }, (_, index) => `run-${index}`);

    const query = buildFindingFilter(
      { scopeId: 'scope-1' },
      {
        ownedScopeRunIds: runIds,
      },
    ) as {
      bool: {
        must: {
          bool: {
            should: (
              | { terms: Record<string, string[]> }
              | {
                  bool: {
                    must: { terms: Record<string, string[]> }[];
                    must_not: { exists: { field: string } }[];
                  };
                }
            )[];
          };
        }[];
      };
    };

    const clauses = query.bool.must[0]!.bool.should;
    expect(clauses).toHaveLength(4);
    expect('terms' in clauses[0]! && clauses[0].terms['sentris.run_id']).toHaveLength(1_000);
    expect('terms' in clauses[2]! && clauses[2].terms['sentris.run_id']).toHaveLength(1);
    expect('bool' in clauses[1]! && clauses[1].bool.must_not).toEqual([
      { exists: { field: 'sentris.run_id' } },
    ]);
  });

  it('treats a missing projection as the authoritative default new state', () => {
    expect(buildFindingFilter({ triageStatus: 'new' })).toEqual({
      bool: {
        must: [
          {
            bool: {
              minimum_should_match: 1,
              should: [
                { term: { 'sentris.triage.status': 'new' } },
                {
                  bool: {
                    must_not: [{ exists: { field: 'sentris.triage.status' } }],
                  },
                },
              ],
            },
          },
        ],
      },
    });
  });

  it('combines new and non-new states without materializing PostgreSQL IDs', () => {
    expect(buildFindingFilter({ triageStatus: 'new,fixed' })).toEqual({
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
        ],
      },
    });
  });
});

describe('mapFindingHit triage projection', () => {
  it('maps the projection watermark while keeping PostgreSQL enrichment optional', () => {
    expect(
      mapFindingHit({
        _id: 'finding-1',
        _source: {
          '@timestamp': '2026-07-26T12:00:00.000Z',
          sentris: {
            triage: {
              status: 'fixed',
              assignee_user_id: 'user-1',
              severity_override: 'critical',
              notes: 'verified by operator',
              updated_at: '2026-07-26T11:59:00.000Z',
              version: 7,
            },
          },
        },
      }),
    ).toEqual(
      expect.objectContaining({
        triage: {
          status: 'fixed',
          assigneeUserId: 'user-1',
          severityOverride: 'critical',
          notes: 'verified by operator',
          updatedAt: '2026-07-26T11:59:00.000Z',
          projectionVersion: 7,
        },
      }),
    );
  });
});

describe('finding schema coverage', () => {
  it('uses indexed ingest attestations without query-time source scripts', () => {
    const aggregation = buildFindingSchemaCoverageAggregation();
    const filters = (aggregation as any).filters.filters;

    expect(aggregation).toEqual({
      filters: {
        filters: {
          canonical_source: {
            bool: {
              filter: [
                {
                  term: {
                    [FINDINGS_CONTRACT_VALIDATION_VERSION_FIELD]:
                      FINDINGS_CONTRACT_CLASSIFICATION_VERSION,
                  },
                },
                {
                  term: {
                    [FINDINGS_CONTRACT_CLASSIFICATION_FIELD]: 'canonical',
                  },
                },
              ],
            },
          },
          legacy: {
            bool: {
              filter: [
                {
                  term: {
                    [FINDINGS_CONTRACT_VALIDATION_VERSION_FIELD]:
                      FINDINGS_CONTRACT_CLASSIFICATION_VERSION,
                  },
                },
                {
                  term: {
                    [FINDINGS_CONTRACT_CLASSIFICATION_FIELD]: 'legacy',
                  },
                },
              ],
            },
          },
        },
      },
    });
    expect(JSON.stringify(filters)).not.toContain('"script"');
    expect(JSON.stringify(filters)).not.toContain("params['_source']");
  });

  it('keeps the indexed canonical and legacy buckets disjoint', () => {
    const filters = (buildFindingSchemaCoverageAggregation() as any).filters.filters;

    expect(filters.canonical_source.bool.filter).toContainEqual({
      term: {
        [FINDINGS_CONTRACT_CLASSIFICATION_FIELD]: 'canonical',
      },
    });
    expect(filters.legacy.bool.filter).toContainEqual({
      term: {
        [FINDINGS_CONTRACT_CLASSIFICATION_FIELD]: 'legacy',
      },
    });
    expect(filters.canonical_source.bool.filter).not.toContainEqual({
      term: {
        [FINDINGS_CONTRACT_CLASSIFICATION_FIELD]: 'legacy',
      },
    });
    expect(filters.legacy.bool.filter).not.toContainEqual({
      term: {
        [FINDINGS_CONTRACT_CLASSIFICATION_FIELD]: 'canonical',
      },
    });
  });

  it('requires evidence, accepts arbitrary JSON values, and rejects non-Z timestamps', () => {
    const findingId = `fo_v1_${'0123456789abcdef'.repeat(4)}`;
    const source: Record<string, unknown> = {
      contract: 'sentris.finding-observation',
      schema_version: 1,
      finding_id: findingId,
      observed_at: '2026-07-26T12:00:00.000Z',
      '@timestamp': '2026-07-26T12:00:00.000Z',
      severity: 'high',
      title: 'Canonical title',
      description: 'Canonical description',
      source: {},
      sentris: {
        organization_id: 'org-1',
        workflow_id: 'workflow-1',
        workflow_name: 'Web scan',
        run_id: 'run-1',
        scope_id: null,
        component_id: 'core.analytics.sink',
        node_ref: 'analytics',
        asset_key: null,
        contract_validated: true,
        contract_source_validated: true,
        contract_document_id: findingId,
      },
    };

    expect(mapFindingHitWithCompatibility({ _id: findingId, _source: source }).compatibility).toBe(
      'invalid',
    );
    const canonicalSource = { ...source, evidence: null };
    expect(
      mapFindingHitWithCompatibility({ _id: findingId, _source: canonicalSource }).compatibility,
    ).toBe('canonical');
    expect(
      mapFindingHitWithCompatibility({
        _id: findingId,
        _source: {
          ...canonicalSource,
          observed_at: '2026-07-26T14:00:00+02:00',
          '@timestamp': '2026-07-26T14:00:00+02:00',
        },
      }).compatibility,
    ).toBe('invalid');
  });

  it('requires complete keyed coverage buckets', () => {
    expect(
      readFindingSchemaCoverage(
        {
          sentris_schema_coverage: {
            buckets: {
              canonical: { doc_count: 8 },
              legacy: { doc_count: 2 },
              invalid: { doc_count: 1 },
            },
          },
        },
        11,
      ),
    ).toEqual({ canonical: 8, legacy: 2, invalid: 1 });
    expect(
      readFindingSchemaCoverage(
        {
          sentris_schema_coverage: {
            buckets: {
              canonical: { doc_count: 8 },
              legacy: { doc_count: 2 },
            },
          },
        },
        11,
      ),
    ).toEqual({ canonical: 8, legacy: 2, invalid: 1 });
    expect(readFindingSchemaCoverage({}, 0)).toBeNull();
    expect(
      readFindingSchemaCoverage(
        {
          sentris_schema_coverage: {
            buckets: {
              canonical: { doc_count: 8 },
              legacy: { doc_count: 4 },
            },
          },
        },
        11,
      ),
    ).toBeNull();
  });

  it.each([
    {
      name: 'null version marker',
      patch: { schema_version: null },
    },
    {
      name: 'malformed version marker',
      patch: { schema_version: '1' },
    },
    {
      name: 'missing required source map',
      patch: { source: undefined },
    },
    {
      name: 'empty required title',
      patch: { title: '' },
    },
    {
      name: 'null required workflow ID',
      patch: {
        sentris: {
          organization_id: 'org-1',
          workflow_id: null,
          workflow_name: 'Web scan',
          run_id: 'run-1',
          scope_id: null,
          component_id: 'core.analytics.sink',
          node_ref: 'analytics',
          asset_key: null,
          contract_validated: true,
          contract_source_validated: true,
          contract_document_id: `fo_v1_${'0123456789abcdef'.repeat(4)}`,
        },
      },
    },
    {
      name: 'missing nullable scope field',
      patch: {
        sentris: {
          organization_id: 'org-1',
          workflow_id: 'workflow-1',
          workflow_name: 'Web scan',
          run_id: 'run-1',
          component_id: 'core.analytics.sink',
          node_ref: 'analytics',
          asset_key: null,
          contract_validated: true,
          contract_source_validated: true,
          contract_document_id: `fo_v1_${'0123456789abcdef'.repeat(4)}`,
        },
      },
    },
  ])('classifies $name as invalid rather than legacy or canonical', ({ patch }) => {
    const findingId = `fo_v1_${'0123456789abcdef'.repeat(4)}`;
    const source: Record<string, unknown> = {
      contract: 'sentris.finding-observation',
      schema_version: 1,
      finding_id: findingId,
      observed_at: '2026-07-26T12:00:00.000Z',
      '@timestamp': '2026-07-26T12:00:00.000Z',
      severity: 'high',
      title: 'Canonical title',
      description: 'Canonical description',
      evidence: null,
      source: {},
      sentris: {
        organization_id: 'org-1',
        workflow_id: 'workflow-1',
        workflow_name: 'Web scan',
        run_id: 'run-1',
        scope_id: null,
        component_id: 'core.analytics.sink',
        node_ref: 'analytics',
        asset_key: null,
        contract_validated: true,
        contract_source_validated: true,
        contract_document_id: findingId,
      },
      ...patch,
    };
    if (patch.source === undefined) delete source.source;

    expect(
      mapFindingHitWithCompatibility({
        _id: findingId,
        _source: source,
      }).compatibility,
    ).toBe('invalid');
  });

  it('does not classify an unstamped versioned document as canonical', () => {
    const mapped = mapFindingHitWithCompatibility({
      _id: `fo_v1_${'0123456789abcdef'.repeat(4)}`,
      _source: {
        contract: 'sentris.finding-observation',
        schema_version: 1,
        finding_id: `fo_v1_${'0123456789abcdef'.repeat(4)}`,
        observed_at: '2026-07-26T12:00:00.000Z',
        '@timestamp': '2026-07-26T12:00:00.000Z',
        severity: 'high',
        title: 'Missing trusted-writer validation marker',
        description: 'The shape alone cannot establish aggregate schema validity.',
        evidence: null,
        source: {},
        sentris: {
          organization_id: 'org-1',
          workflow_id: 'workflow-1',
          workflow_name: 'Web scan',
          run_id: 'run-1',
          scope_id: null,
          component_id: 'core.analytics.sink',
          node_ref: 'analytics',
          asset_key: null,
        },
      },
    });

    expect(mapped.compatibility).toBe('invalid');
  });

  it('rejects a validation attestation that is not bound to the OpenSearch document ID', () => {
    const findingId = `fo_v1_${'0123456789abcdef'.repeat(4)}`;
    const mapped = mapFindingHitWithCompatibility({
      _id: findingId,
      _source: {
        contract: 'sentris.finding-observation',
        schema_version: 1,
        finding_id: findingId,
        observed_at: '2026-07-26T12:00:00.000Z',
        '@timestamp': '2026-07-26T12:00:00.000Z',
        severity: 'high',
        title: 'Mismatched validation binding',
        description: 'The writer attestation names a different document.',
        evidence: null,
        source: {},
        sentris: {
          organization_id: 'org-1',
          workflow_id: 'workflow-1',
          workflow_name: 'Web scan',
          run_id: 'run-1',
          scope_id: null,
          component_id: 'core.analytics.sink',
          node_ref: 'analytics',
          asset_key: null,
          contract_validated: true,
          contract_source_validated: true,
          contract_document_id: `fo_v1_${'fedcba9876543210'.repeat(4)}`,
        },
      },
    });

    expect(mapped.compatibility).toBe('invalid');
  });
});
