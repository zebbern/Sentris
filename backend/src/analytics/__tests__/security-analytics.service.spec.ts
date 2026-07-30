import { describe, expect, it, jest, setSystemTime } from 'bun:test';
import { ServiceUnavailableException } from '@nestjs/common';

import { SecurityAnalyticsService } from '../security-analytics.service';
import { decodeFindingPageCursor, findingQueryDigest } from '../finding-pagination';
import type { OpenSearchClient } from '../../config/opensearch.client';
import {
  buildFindingObservationIndexName,
  buildTenantAnalyticsIndexPattern,
} from '@sentris/shared/finding-observation-id';
import { buildFindingProjectionControlIndexName } from '../finding-storage-integrity';
import {
  FINDINGS_CONTRACT_CLASSIFICATION_VERSION,
  FINDINGS_FINAL_INGEST_PIPELINE_CONTENT_HASH,
  FINDINGS_FINAL_INGEST_PIPELINE_ID,
  FINDINGS_INDEX_TEMPLATE_VERSION,
  FINDINGS_OBSERVATION_MAPPING_CONTENT_HASH,
  FINDINGS_OBSERVATION_SCHEMA_VERSION,
  buildFindingsFinalIngestPipeline,
  buildOrganizationFindingsIndexTemplate,
  buildOrganizationFindingsIndexTemplateName,
  getOrganizationFindingsIndexTemplateContentHash,
  getOrganizationFindingsStorageInvariantFingerprint,
} from '../findings-index-template';

const ORG_1_INDEX = buildFindingObservationIndexName('org-1');
const ORG_1_CONTROL_INDEX = buildFindingProjectionControlIndexName('org-1');

function createOpenSearchClient(options: {
  enabled: boolean;
  client?: {
    search?: ReturnType<typeof jest.fn>;
    updateByQuery?: ReturnType<typeof jest.fn>;
    createPit?: ReturnType<typeof jest.fn>;
    deletePit?: ReturnType<typeof jest.fn>;
    bulk?: ReturnType<typeof jest.fn>;
    index?: ReturnType<typeof jest.fn>;
    get?: ReturnType<typeof jest.fn>;
    ingest?: {
      getPipeline?: ReturnType<typeof jest.fn>;
    };
    indices?: {
      getSettings?: ReturnType<typeof jest.fn>;
      getIndexTemplate?: ReturnType<typeof jest.fn>;
      getMapping?: ReturnType<typeof jest.fn>;
      refresh?: ReturnType<typeof jest.fn>;
    };
  } | null;
}) {
  const client =
    options.client === null || options.client === undefined
      ? options.client
      : {
          ...options.client,
          ingest: {
            getPipeline: jest.fn().mockResolvedValue({
              body: {
                [FINDINGS_FINAL_INGEST_PIPELINE_ID]: buildFindingsFinalIngestPipeline(),
              },
            }),
            ...options.client.ingest,
          },
          indices: {
            getIndexTemplate: jest.fn().mockResolvedValue({
              body: {
                index_templates: [
                  {
                    name: buildOrganizationFindingsIndexTemplateName('org-1'),
                    index_template: buildOrganizationFindingsIndexTemplate('org-1'),
                  },
                ],
              },
            }),
            getMapping: jest.fn().mockResolvedValue({
              body: {
                [ORG_1_INDEX]: {
                  mappings: buildOrganizationFindingsIndexTemplate('org-1').template.mappings,
                },
              },
            }),
            ...options.client.indices,
          },
        };
  return {
    isClientEnabled: jest.fn().mockReturnValue(options.enabled),
    getClient: jest.fn().mockReturnValue(client ?? null),
  } as unknown as OpenSearchClient;
}

describe('SecurityAnalyticsService', () => {
  it('throws unavailable when OpenSearch is disabled instead of returning an empty success', async () => {
    const service = new SecurityAnalyticsService(
      createOpenSearchClient({
        enabled: false,
      }),
    );

    try {
      await service.query('org-1', {});
      expect.unreachable('query should have failed');
    } catch (error) {
      expect(error).toBeInstanceOf(ServiceUnavailableException);
      expect((error as ServiceUnavailableException).getResponse()).toEqual(
        expect.objectContaining({
          availability: 'unavailable',
        }),
      );
    }
  });

  it('rejects custom suffixes that would inherit the global findings template', async () => {
    const bulk = jest.fn();
    const service = new SecurityAnalyticsService(
      createOpenSearchClient({
        enabled: true,
        client: { bulk },
      }),
    );

    await expect(
      service.bulkIndex('org-1', [{ custom_metric: 42 }], {
        workflowId: 'workflow-1',
        workflowName: 'Custom analytics',
        runId: 'run-1',
        nodeRef: 'analytics',
        componentId: 'core.analytics.sink',
        indexSuffix: 'custom-observations-v1',
      }),
    ).rejects.toThrow('reserved for canonical findings observations');
    expect(bulk).not.toHaveBeenCalled();
  });

  it('requests exact totals and forwards canonical sorting for findings', async () => {
    const search = jest.fn().mockResolvedValue({
      body: {
        hits: {
          total: { value: 1, relation: 'eq' },
          hits: [{ _id: 'finding-1', _source: { severity: 'high' } }],
        },
      },
    });
    const service = new SecurityAnalyticsService(
      createOpenSearchClient({
        enabled: true,
        client: { search },
      }),
    );

    const result = await service.queryFindings('org-1', {
      query: { term: { 'sentris.scope_id': 'scope-1' } },
      size: 25,
      from: 0,
      sort: [{ '@timestamp': 'desc' }],
    });

    expect(search).toHaveBeenCalledWith({
      index: ORG_1_INDEX,
      body: {
        query: { term: { 'sentris.scope_id': 'scope-1' } },
        size: 25,
        from: 0,
        sort: [{ '@timestamp': 'desc' }],
        track_total_hits: true,
      },
    });
    expect(result.availability).toBe('available');
    expect(result.total).toBe(1);
  });

  it('accepts a legacy numeric exact total when it is a safe nonnegative integer', async () => {
    const search = jest.fn().mockResolvedValue({
      body: { hits: { total: 7, hits: [] } },
    });
    const service = new SecurityAnalyticsService(
      createOpenSearchClient({ enabled: true, client: { search } }),
    );

    await expect(service.queryFindings('org-1', {})).resolves.toEqual(
      expect.objectContaining({ total: 7 }),
    );
  });

  it.each([
    ['missing', undefined],
    ['null', null],
    ['string', '0'],
    ['NaN', Number.NaN],
    ['negative', -1],
    ['unsafe', Number.MAX_SAFE_INTEGER + 1],
    ['lower-bound relation', { value: 1, relation: 'gte' }],
    ['missing relation', { value: 1 }],
  ])(
    'rejects a %s findings total instead of returning a false exact count',
    async (_label, total) => {
      const search = jest.fn().mockResolvedValue({
        body: { hits: { total, hits: [] } },
      });
      const service = new SecurityAnalyticsService(
        createOpenSearchClient({ enabled: true, client: { search } }),
      );

      await expect(service.queryFindings('org-1', {})).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );
    },
  );

  it('pages every observation and records actual OpenSearch document ID mismatches', async () => {
    const canonicalId = `fo_v1_${'0123456789abcdef'.repeat(4)}`;
    const mismatchedSourceId = `fo_v1_${'fedcba9876543210'.repeat(4)}`;
    const createPit = jest.fn().mockResolvedValue({ body: { pit_id: 'coverage-pit' } });
    const deletePit = jest.fn().mockResolvedValue({ body: { succeeded: true } });
    const getSettings = jest.fn().mockResolvedValue({
      body: {
        [ORG_1_INDEX]: {
          settings: {
            index: {
              uuid: 'observation-index-uuid-1',
              final_pipeline: FINDINGS_FINAL_INGEST_PIPELINE_ID,
            },
          },
        },
      },
    });
    const index = jest.fn().mockResolvedValue({ body: { result: 'created' } });
    const bulk = jest.fn().mockResolvedValue({
      body: {
        errors: false,
        items: [{ update: { status: 200 } }, { update: { status: 200 } }],
      },
    });
    const refresh = jest.fn().mockResolvedValue({ body: {} });
    const search = jest
      .fn()
      .mockResolvedValueOnce({
        body: {
          hits: {
            hits: [
              {
                _id: canonicalId,
                _seq_no: 7,
                _primary_term: 2,
                _source: {
                  sentris_contract_classification: 'invalid',
                  sentris_contract_validation_version: 999,
                  contract: 'sentris.finding-observation',
                  schema_version: 1,
                  finding_id: canonicalId,
                  observed_at: '2026-07-26T12:00:00.000Z',
                  '@timestamp': '2026-07-26T12:00:00.000Z',
                  severity: 'high',
                  title: 'Canonical',
                  description: 'Bound to storage ID',
                  evidence: null,
                  source: {},
                  sentris: {
                    organization_id: 'org-1',
                    workflow_id: 'workflow-1',
                    workflow_name: 'Workflow',
                    run_id: 'run-1',
                    scope_id: null,
                    component_id: 'component-1',
                    node_ref: 'node-1',
                    asset_key: null,
                    contract_validated: true,
                    contract_source_validated: true,
                    contract_document_id: canonicalId,
                  },
                },
                sort: [1],
              },
              {
                _id: `fo_v1_${'0'.repeat(64)}`,
                _seq_no: 11,
                _primary_term: 3,
                _source: {
                  sentris_contract_classification: 'canonical',
                  sentris_contract_validation_version: 1,
                  contract: 'sentris.finding-observation',
                  schema_version: 1,
                  finding_id: mismatchedSourceId,
                  observed_at: '2026-07-26T12:00:00.000Z',
                  '@timestamp': '2026-07-26T12:00:00.000Z',
                  severity: 'high',
                  title: 'Canonical source',
                  description: 'Not bound to storage ID',
                  evidence: null,
                  source: {},
                  sentris: {
                    organization_id: 'org-1',
                    workflow_id: 'workflow-1',
                    workflow_name: 'Workflow',
                    run_id: 'run-1',
                    scope_id: null,
                    component_id: 'component-1',
                    node_ref: 'node-1',
                    asset_key: null,
                    contract_validated: true,
                    contract_source_validated: true,
                    contract_document_id: mismatchedSourceId,
                  },
                },
                sort: [2],
              },
            ],
          },
        },
      })
      .mockResolvedValueOnce({
        body: {
          hits: { hits: [] },
        },
      });
    const service = new SecurityAnalyticsService(
      createOpenSearchClient({
        enabled: true,
        client: {
          search,
          createPit,
          deletePit,
          index,
          bulk,
          indices: { getSettings, refresh },
        },
      }),
    );

    const result = await service.reconcileFindingStorageIdIntegrity('org-1', 2);

    expect(result).toEqual({
      checked: 2,
      mismatched: 1,
      completedAt: expect.any(String),
    });
    expect(createPit).toHaveBeenCalledWith({
      index: [ORG_1_INDEX],
      keep_alive: '2m',
      allow_partial_pit_creation: false,
    });
    expect(deletePit).toHaveBeenCalledWith({ body: { pit_id: ['coverage-pit'] } });
    expect(search).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({
          seq_no_primary_term: true,
        }),
      }),
    );
    expect(bulk).toHaveBeenCalledWith({
      refresh: false,
      body: [
        {
          update: {
            _index: ORG_1_INDEX,
            _id: canonicalId,
            if_seq_no: 7,
            if_primary_term: 2,
          },
        },
        {
          script: {
            lang: 'painless',
            source: expect.any(String),
            params: {
              classification: 'canonical',
              normalizedSeverity: 'high',
              validationVersion: 2,
            },
          },
        },
        {
          update: {
            _index: ORG_1_INDEX,
            _id: `fo_v1_${'0'.repeat(64)}`,
            if_seq_no: 11,
            if_primary_term: 3,
          },
        },
        {
          script: {
            lang: 'painless',
            source: expect.any(String),
            params: {
              classification: 'invalid',
              normalizedSeverity: 'high',
              validationVersion: 2,
            },
          },
        },
      ],
    });
    expect(refresh).toHaveBeenCalledWith({
      index: ORG_1_INDEX,
    });
    expect(index).toHaveBeenCalledTimes(2);
    expect(index.mock.invocationCallOrder[0]).toBeLessThan(createPit.mock.invocationCallOrder[0]);
    expect(refresh.mock.invocationCallOrder[0]).toBeLessThan(index.mock.invocationCallOrder[1]);
    expect(index).toHaveBeenLastCalledWith({
      index: ORG_1_CONTROL_INDEX,
      id: 'storage-id-integrity-watermark-v1',
      refresh: 'wait_for',
      body: expect.objectContaining({
        verification_state: 'verified',
        organization_id: 'org-1',
        observation_index_uuid: 'observation-index-uuid-1',
        final_pipeline: FINDINGS_FINAL_INGEST_PIPELINE_ID,
        final_pipeline_content_hash: FINDINGS_FINAL_INGEST_PIPELINE_CONTENT_HASH,
        index_template_name: buildOrganizationFindingsIndexTemplateName('org-1'),
        index_template_content_hash: getOrganizationFindingsIndexTemplateContentHash('org-1'),
        mapping_content_hash: FINDINGS_OBSERVATION_MAPPING_CONTENT_HASH,
        invariant_fingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
        template_version: FINDINGS_INDEX_TEMPLATE_VERSION,
        schema_version: FINDINGS_OBSERVATION_SCHEMA_VERSION,
        classification_version: FINDINGS_CONTRACT_CLASSIFICATION_VERSION,
        checked: 2,
        mismatched: 1,
      }),
    });
  });

  it('retries the full optimistic reconciliation pass after a version conflict', async () => {
    const findingId = `fo_v1_${'0123456789abcdef'.repeat(4)}`;
    const canonicalSource = {
      contract: 'sentris.finding-observation',
      schema_version: 1,
      finding_id: findingId,
      observed_at: '2026-07-26T12:00:00.000Z',
      '@timestamp': '2026-07-26T12:00:00.000Z',
      severity: 'high',
      title: 'Canonical',
      description: 'Retry after concurrent triage projection',
      evidence: null,
      source: {},
      sentris: {
        organization_id: 'org-1',
        workflow_id: 'workflow-1',
        workflow_name: 'Workflow',
        run_id: 'run-1',
        scope_id: null,
        component_id: 'component-1',
        node_ref: 'node-1',
        asset_key: null,
        contract_validated: true,
        contract_source_validated: true,
        contract_document_id: findingId,
      },
    };
    const createPit = jest
      .fn()
      .mockResolvedValueOnce({ body: { pit_id: 'integrity-pit-1' } })
      .mockResolvedValueOnce({ body: { pit_id: 'integrity-pit-2' } });
    const search = jest
      .fn()
      .mockResolvedValueOnce({
        body: {
          hits: {
            hits: [
              {
                _id: findingId,
                _seq_no: 4,
                _primary_term: 1,
                _source: canonicalSource,
                sort: [1],
              },
            ],
          },
        },
      })
      .mockResolvedValueOnce({
        body: {
          hits: {
            hits: [
              {
                _id: findingId,
                _seq_no: 5,
                _primary_term: 1,
                _source: canonicalSource,
                sort: [1],
              },
            ],
          },
        },
      });
    const bulk = jest
      .fn()
      .mockResolvedValueOnce({
        body: {
          errors: true,
          items: [
            { update: { status: 409, error: { type: 'version_conflict_engine_exception' } } },
          ],
        },
      })
      .mockResolvedValueOnce({
        body: {
          errors: false,
          items: [{ update: { status: 200 } }],
        },
      });
    const refresh = jest.fn().mockResolvedValue({ body: {} });
    const deletePit = jest.fn().mockResolvedValue({ body: {} });
    const index = jest.fn().mockResolvedValue({ body: {} });
    const getSettings = jest.fn().mockResolvedValue({
      body: {
        [ORG_1_INDEX]: {
          settings: {
            index: {
              uuid: 'observation-index-uuid-1',
              final_pipeline: FINDINGS_FINAL_INGEST_PIPELINE_ID,
            },
          },
        },
      },
    });
    const service = new SecurityAnalyticsService(
      createOpenSearchClient({
        enabled: true,
        client: {
          createPit,
          search,
          bulk,
          deletePit,
          index,
          indices: { getSettings, refresh },
        },
      }),
    );

    await expect(service.reconcileFindingStorageIdIntegrity('org-1', 10)).resolves.toEqual({
      checked: 1,
      mismatched: 0,
      completedAt: expect.any(String),
    });

    expect(createPit).toHaveBeenCalledTimes(2);
    expect(deletePit).toHaveBeenCalledTimes(2);
    expect(bulk).toHaveBeenCalledTimes(2);
    expect(bulk.mock.calls[1]![0].body[0].update).toEqual(
      expect.objectContaining({
        if_seq_no: 5,
        if_primary_term: 1,
      }),
    );
    expect(refresh.mock.invocationCallOrder[0]).toBeLessThan(createPit.mock.invocationCallOrder[1]);
    expect(index).toHaveBeenCalledTimes(2);
    expect(index.mock.calls[0]![0].body).toEqual(
      expect.objectContaining({ verification_state: 'checking' }),
    );
    expect(index.mock.calls[1]![0].body).toEqual(
      expect.objectContaining({ verification_state: 'verified' }),
    );
  });

  it('does not publish a watermark after a non-conflict classification write failure', async () => {
    const createPit = jest.fn().mockResolvedValue({ body: { pit_id: 'integrity-pit' } });
    const search = jest.fn().mockResolvedValue({
      body: {
        hits: {
          hits: [
            {
              _id: 'legacy-finding',
              _seq_no: 2,
              _primary_term: 1,
              _source: {
                title: 'Legacy finding',
                sentris_contract_classification: 'canonical',
                sentris_contract_validation_version: 1,
              },
              sort: [1],
            },
          ],
        },
      },
    });
    const bulk = jest.fn().mockResolvedValue({
      body: {
        errors: true,
        items: [
          {
            update: {
              status: 400,
              error: { type: 'mapper_parsing_exception', reason: 'mapping rejected' },
            },
          },
        ],
      },
    });
    const deletePit = jest.fn().mockResolvedValue({ body: {} });
    const index = jest.fn().mockResolvedValue({ body: {} });
    const refresh = jest.fn().mockResolvedValue({ body: {} });
    const getSettings = jest.fn().mockResolvedValue({
      body: {
        [ORG_1_INDEX]: {
          settings: {
            index: {
              uuid: 'observation-index-uuid-1',
              final_pipeline: FINDINGS_FINAL_INGEST_PIPELINE_ID,
            },
          },
        },
      },
    });
    const service = new SecurityAnalyticsService(
      createOpenSearchClient({
        enabled: true,
        client: {
          createPit,
          search,
          bulk,
          deletePit,
          index,
          indices: { getSettings, refresh },
        },
      }),
    );

    await expect(service.reconcileFindingStorageIdIntegrity('org-1', 10)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );

    expect(createPit).toHaveBeenCalledTimes(1);
    expect(deletePit).toHaveBeenCalledTimes(1);
    expect(refresh).not.toHaveBeenCalled();
    expect(index).toHaveBeenCalledTimes(1);
    expect(index).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({ verification_state: 'checking' }),
      }),
    );
  });

  it('marks a completed storage ID integrity watermark stale after an index rebuild', async () => {
    const get = jest.fn().mockResolvedValue({
      body: {
        _source: {
          verification_state: 'verified',
          organization_id: 'org-1',
          observation_index_uuid: 'observation-index-uuid-1',
          final_pipeline: FINDINGS_FINAL_INGEST_PIPELINE_ID,
          final_pipeline_content_hash: FINDINGS_FINAL_INGEST_PIPELINE_CONTENT_HASH,
          index_template_name: buildOrganizationFindingsIndexTemplateName('org-1'),
          index_template_content_hash: getOrganizationFindingsIndexTemplateContentHash('org-1'),
          mapping_content_hash: FINDINGS_OBSERVATION_MAPPING_CONTENT_HASH,
          invariant_fingerprint: 'a'.repeat(64),
          template_version: FINDINGS_INDEX_TEMPLATE_VERSION,
          schema_version: FINDINGS_OBSERVATION_SCHEMA_VERSION,
          classification_version: FINDINGS_CONTRACT_CLASSIFICATION_VERSION,
          completed_at: '2026-07-26T12:01:00.000Z',
          checked: 2,
          mismatched: 0,
        },
      },
    });
    const getSettings = jest.fn().mockResolvedValue({
      body: {
        [ORG_1_INDEX]: {
          settings: {
            index: {
              uuid: 'observation-index-uuid-2',
              final_pipeline: FINDINGS_FINAL_INGEST_PIPELINE_ID,
            },
          },
        },
      },
    });
    const service = new SecurityAnalyticsService(
      createOpenSearchClient({
        enabled: true,
        client: { get, indices: { getSettings } },
      }),
    );

    await expect(service.getFindingStorageIdIntegrityWatermark('org-1')).resolves.toEqual({
      observationIndexUuid: 'observation-index-uuid-1',
      matchesCurrentObservationIndex: false,
      matchesCurrentInvariant: false,
      finalPipeline: FINDINGS_FINAL_INGEST_PIPELINE_ID,
      finalPipelineContentHash: FINDINGS_FINAL_INGEST_PIPELINE_CONTENT_HASH,
      indexTemplateName: buildOrganizationFindingsIndexTemplateName('org-1'),
      indexTemplateContentHash: getOrganizationFindingsIndexTemplateContentHash('org-1'),
      mappingContentHash: FINDINGS_OBSERVATION_MAPPING_CONTENT_HASH,
      invariantFingerprint: 'a'.repeat(64),
      templateVersion: FINDINGS_INDEX_TEMPLATE_VERSION,
      schemaVersion: FINDINGS_OBSERVATION_SCHEMA_VERSION,
      classificationVersion: FINDINGS_CONTRACT_CLASSIFICATION_VERSION,
      completedAt: '2026-07-26T12:01:00.000Z',
      checked: 2,
      mismatched: 0,
    });
  });

  it('hides an earlier healthy storage watermark after same-index invariant drift fails verification', async () => {
    let controlSource: Record<string, unknown> = {
      verification_state: 'verified',
      organization_id: 'org-1',
      observation_index_uuid: 'observation-index-uuid-1',
      final_pipeline: FINDINGS_FINAL_INGEST_PIPELINE_ID,
      final_pipeline_content_hash: FINDINGS_FINAL_INGEST_PIPELINE_CONTENT_HASH,
      index_template_name: buildOrganizationFindingsIndexTemplateName('org-1'),
      index_template_content_hash: getOrganizationFindingsIndexTemplateContentHash('org-1'),
      mapping_content_hash: FINDINGS_OBSERVATION_MAPPING_CONTENT_HASH,
      invariant_fingerprint: getOrganizationFindingsStorageInvariantFingerprint('org-1'),
      template_version: FINDINGS_INDEX_TEMPLATE_VERSION,
      schema_version: FINDINGS_OBSERVATION_SCHEMA_VERSION,
      classification_version: FINDINGS_CONTRACT_CLASSIFICATION_VERSION,
      completed_at: '2026-07-29T12:00:00.000Z',
      checked: 2,
      mismatched: 0,
    };
    let pipelineDrifted = false;
    const get = jest.fn().mockImplementation(() =>
      Promise.resolve({
        body: { _source: structuredClone(controlSource) },
      }),
    );
    const index = jest.fn().mockImplementation((request: Record<string, any>) => {
      controlSource = structuredClone(request.body);
      return Promise.resolve({ body: { result: 'updated' } });
    });
    const getPipeline = jest.fn().mockImplementation(() =>
      Promise.resolve({
        body: {
          [FINDINGS_FINAL_INGEST_PIPELINE_ID]: pipelineDrifted
            ? { ...buildFindingsFinalIngestPipeline(), processors: [] }
            : buildFindingsFinalIngestPipeline(),
        },
      }),
    );
    const getSettings = jest.fn().mockResolvedValue({
      body: {
        [ORG_1_INDEX]: {
          settings: {
            index: {
              uuid: 'observation-index-uuid-1',
              final_pipeline: FINDINGS_FINAL_INGEST_PIPELINE_ID,
            },
          },
        },
      },
    });
    const createPit = jest.fn();
    const service = new SecurityAnalyticsService(
      createOpenSearchClient({
        enabled: true,
        client: {
          get,
          index,
          createPit,
          ingest: { getPipeline },
          indices: { getSettings },
        },
      }),
    );

    await expect(service.getFindingStorageIdIntegrityWatermark('org-1')).resolves.toEqual(
      expect.objectContaining({
        matchesCurrentObservationIndex: true,
        matchesCurrentInvariant: true,
      }),
    );

    pipelineDrifted = true;
    await expect(service.reconcileFindingStorageIdIntegrity('org-1')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(createPit).not.toHaveBeenCalled();
    expect(controlSource).toEqual(
      expect.objectContaining({
        organization_id: 'org-1',
        verification_state: 'checking',
      }),
    );
    getSettings.mockRejectedValueOnce(new Error('observation settings temporarily unavailable'));
    await expect(service.getFindingStorageIdIntegrityWatermark('org-1')).resolves.toBeNull();
  });

  it('queries the tenant analytics pattern so custom-suffix datasets remain available', async () => {
    const search = jest.fn().mockResolvedValue({
      body: {
        hits: {
          total: { value: 1, relation: 'eq' },
          hits: [{ _id: 'metric-1', _source: { custom_metric: 42 } }],
        },
      },
    });
    const service = new SecurityAnalyticsService(
      createOpenSearchClient({
        enabled: true,
        client: { search },
      }),
    );

    await service.query('Org-1', {
      query: { exists: { field: 'custom_metric' } },
      size: 10,
      from: 0,
    });

    expect(search).toHaveBeenCalledWith({
      index: buildTenantAnalyticsIndexPattern('Org-1'),
      body: {
        query: { exists: { field: 'custom_metric' } },
        size: 10,
        from: 0,
        track_total_hits: true,
      },
    });
  });

  it('converts OpenSearch dependency failures into unavailable', async () => {
    const search = jest.fn().mockRejectedValue(new Error('socket closed'));
    const service = new SecurityAnalyticsService(
      createOpenSearchClient({
        enabled: true,
        client: { search },
      }),
    );

    await expect(service.query('org-1', {})).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it.each([
    {
      name: 'timed out',
      body: {
        timed_out: true,
        _shards: { total: 1, successful: 1, skipped: 0, failed: 0 },
      },
    },
    {
      name: 'failed shard',
      body: {
        timed_out: false,
        _shards: { total: 2, successful: 1, skipped: 0, failed: 1 },
      },
    },
  ])('rejects a partial query response when OpenSearch is $name', async ({ body }) => {
    const search = jest.fn().mockResolvedValue({
      body: {
        ...body,
        hits: { total: { value: 0, relation: 'eq' }, hits: [] },
      },
    });
    const service = new SecurityAnalyticsService(
      createOpenSearchClient({ enabled: true, client: { search } }),
    );

    await expect(service.query('org-1', {})).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('projects triage with a monotonic version guard into the tenant index', async () => {
    const updateByQuery = jest.fn().mockResolvedValue({
      body: { total: 1, updated: 1, version_conflicts: 0, failures: [] },
    });
    const service = new SecurityAnalyticsService(
      createOpenSearchClient({
        enabled: true,
        client: { updateByQuery },
      }),
    );

    await service.projectFindingTriage('org-1', 'finding-1', {
      status: 'fixed',
      assigneeUserId: 'user-1',
      severityOverride: 'critical',
      notes: 'verified',
      updatedAt: '2026-07-26T12:00:00.000Z',
      version: 7,
    });

    expect(updateByQuery).toHaveBeenCalledWith({
      index: ORG_1_INDEX,
      conflicts: 'proceed',
      refresh: false,
      body: {
        query: { ids: { values: ['finding-1'] } },
        script: {
          lang: 'painless',
          params: {
            triage: {
              status: 'fixed',
              assignee_user_id: 'user-1',
              severity_override: 'critical',
              notes: 'verified',
              updated_at: '2026-07-26T12:00:00.000Z',
              version: 7,
            },
          },
          source: expect.stringContaining('params.triage.version'),
        },
      },
    });
  });

  it('writes a durable projection watermark bound to the current observation index UUID', async () => {
    const index = jest.fn().mockResolvedValue({ body: { result: 'updated' } });
    const getSettings = jest.fn().mockResolvedValue({
      body: {
        [ORG_1_INDEX]: {
          settings: { index: { uuid: 'observation-index-uuid-1' } },
        },
      },
    });
    const service = new SecurityAnalyticsService(
      createOpenSearchClient({
        enabled: true,
        client: { index, indices: { getSettings } },
      }),
    );

    await service.writeFindingTriageProjectionWatermark('org-1', {
      reconciledThrough: '2026-07-26T12:00:00.000Z',
      completedAt: '2026-07-26T12:01:00.000Z',
      checked: 10_001,
      repaired: 4,
      failed: 0,
    });

    expect(index).toHaveBeenCalledWith({
      index: ORG_1_CONTROL_INDEX,
      id: 'triage-reconciliation-watermark-v1',
      refresh: 'wait_for',
      body: expect.objectContaining({
        organization_id: 'org-1',
        observation_index_uuid: 'observation-index-uuid-1',
        reconciled_through: '2026-07-26T12:00:00.000Z',
        checked: 10_001,
      }),
    });
  });

  it('reports a projection watermark as stale when the observation index was rebuilt', async () => {
    const get = jest.fn().mockResolvedValue({
      body: {
        _source: {
          organization_id: 'org-1',
          observation_index_uuid: 'old-observation-index-uuid',
          reconciled_through: '2026-07-26T12:00:00.000Z',
          completed_at: '2026-07-26T12:01:00.000Z',
          checked: 25,
          repaired: 0,
          failed: 0,
        },
      },
    });
    const getSettings = jest.fn().mockResolvedValue({
      body: {
        [ORG_1_INDEX]: {
          settings: { index: { uuid: 'rebuilt-observation-index-uuid' } },
        },
      },
    });
    const service = new SecurityAnalyticsService(
      createOpenSearchClient({
        enabled: true,
        client: { get, indices: { getSettings } },
      }),
    );

    await expect(service.getFindingTriageProjectionWatermark('org-1')).resolves.toEqual(
      expect.objectContaining({
        observationIndexUuid: 'old-observation-index-uuid',
        matchesCurrentObservationIndex: false,
      }),
    );
  });

  it('accepts an idempotent or out-of-order projection without regressing state', async () => {
    const updateByQuery = jest.fn().mockResolvedValue({
      body: { total: 1, updated: 0, version_conflicts: 0, failures: [] },
    });
    const service = new SecurityAnalyticsService(
      createOpenSearchClient({ enabled: true, client: { updateByQuery } }),
    );

    await expect(
      service.projectFindingTriage('org-1', 'finding-1', {
        status: 'triaged',
        assigneeUserId: null,
        severityOverride: null,
        notes: null,
        updatedAt: '2026-07-26T12:00:00.000Z',
        version: 2,
      }),
    ).resolves.toBeUndefined();
  });

  it('fails projection for retry when the observation is absent or conflicts', async () => {
    const updateByQuery = jest
      .fn()
      .mockResolvedValueOnce({
        body: { total: 0, updated: 0, version_conflicts: 0, failures: [] },
      })
      .mockResolvedValueOnce({
        body: { total: 1, updated: 0, version_conflicts: 1, failures: [] },
      });
    const service = new SecurityAnalyticsService(
      createOpenSearchClient({ enabled: true, client: { updateByQuery } }),
    );
    const projection = {
      status: 'triaged',
      assigneeUserId: null,
      severityOverride: null,
      notes: null,
      updatedAt: '2026-07-26T12:00:00.000Z',
      version: 2,
    };

    await expect(
      service.projectFindingTriage('org-1', 'missing', projection),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(
      service.projectFindingTriage('org-1', 'finding-1', projection),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('fails projection for retry when update-by-query times out', async () => {
    const updateByQuery = jest.fn().mockResolvedValue({
      body: {
        timed_out: true,
        total: 1,
        updated: 1,
        version_conflicts: 0,
        failures: [],
      },
    });
    const service = new SecurityAnalyticsService(
      createOpenSearchClient({ enabled: true, client: { updateByQuery } }),
    );

    await expect(
      service.projectFindingTriage('org-1', 'finding-1', {
        status: 'triaged',
        assigneeUserId: null,
        severityOverride: null,
        notes: null,
        updatedAt: '2026-07-26T12:00:00.000Z',
        version: 2,
      }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('exports more than 10,000 findings with PIT and search_after, then closes the PIT', async () => {
    const createPit = jest.fn().mockResolvedValue({ body: { pit_id: 'pit-1' } });
    let nextId = 0;
    const search = jest.fn().mockImplementation(({ body }: any) => {
      const remaining = 10_001 - nextId;
      const count = Math.min(body.size, Math.max(remaining, 0));
      const hits = Array.from({ length: count }, () => {
        const id = `finding-${nextId++}`;
        return {
          _id: id,
          _source: { '@timestamp': '2026-07-26T12:00:00.000Z' },
          sort: ['2026-07-26T12:00:00.000Z', nextId],
        };
      });
      return Promise.resolve({ body: { pit_id: 'pit-1', hits: { hits } } });
    });
    const deletePit = jest.fn().mockResolvedValue({ body: {} });
    const service = new SecurityAnalyticsService(
      createOpenSearchClient({
        enabled: true,
        client: { createPit, search, deletePit },
      }),
    );

    const hits = await service.scanFindings('org-1', {
      query: { match_all: {} },
      sortOrder: 'desc',
      limit: 10_001,
      pageSize: 5_000,
    });

    expect(hits).toHaveLength(10_001);
    expect(createPit).toHaveBeenCalledWith({
      index: [ORG_1_INDEX],
      keep_alive: '2m',
      allow_partial_pit_creation: false,
    });
    expect(search.mock.calls[0]![0].body.sort).toEqual([
      { '@timestamp': { order: 'desc' } },
      { _doc: { order: 'asc' } },
    ]);
    expect(search).toHaveBeenCalledTimes(3);
    expect(search.mock.calls[1]![0].body.search_after).toEqual(['2026-07-26T12:00:00.000Z', 5_000]);
    expect(deletePit).toHaveBeenCalledWith({ body: { pit_id: ['pit-1'] } });
  });

  it('fails an export instead of silently truncating a full page without sort values', async () => {
    const createPit = jest.fn().mockResolvedValue({ body: { pit_id: 'pit-missing-sort' } });
    const search = jest.fn().mockResolvedValue({
      body: {
        pit_id: 'pit-missing-sort',
        timed_out: false,
        _shards: { total: 1, successful: 1, skipped: 0, failed: 0 },
        hits: {
          hits: Array.from({ length: 2 }, (_, index) => ({
            _id: `finding-${index}`,
            _source: { '@timestamp': '2026-07-26T12:00:00.000Z' },
          })),
        },
      },
    });
    const deletePit = jest.fn().mockResolvedValue({ body: {} });
    const service = new SecurityAnalyticsService(
      createOpenSearchClient({
        enabled: true,
        client: { createPit, search, deletePit },
      }),
    );

    await expect(
      service.scanFindings('org-1', {
        query: { match_all: {} },
        sortOrder: 'desc',
        pageSize: 2,
      }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(search).toHaveBeenCalledTimes(1);
    expect(deletePit).toHaveBeenCalledWith({ body: { pit_id: ['pit-missing-sort'] } });
  });

  it('keeps a reused PIT alive through its TTL so a terminal page can navigate backward', async () => {
    const previousSecret = process.env.SESSION_SECRET;
    process.env.SESSION_SECRET = 'test-findings-cursor-secret-with-sufficient-entropy';
    try {
      const createPit = jest.fn().mockResolvedValue({ body: { pit_id: 'pit-list' } });
      const search = jest.fn().mockImplementation(({ body }: any) => {
        const start = body.search_after ? 25 : 0;
        const count = start === 0 ? 26 : 1;
        return Promise.resolve({
          body: {
            pit_id: 'pit-list',
            timed_out: false,
            _shards: { total: 1, successful: 1, skipped: 0, failed: 0 },
            hits: {
              total: { value: 10_001, relation: 'eq' },
              hits: Array.from({ length: count }, (_, index) => ({
                _id: `finding-${start + index}`,
                _source: { '@timestamp': '2026-07-26T12:00:00.000Z' },
                sort: ['2026-07-26T12:00:00.000Z', start + index],
              })),
            },
          },
        });
      });
      const deletePit = jest.fn().mockResolvedValue({ body: {} });
      const service = new SecurityAnalyticsService(
        createOpenSearchClient({
          enabled: true,
          client: { createPit, search, deletePit },
        }),
      );

      const first = await service.queryFindingPage('org-1', {
        query: { match_all: {} },
        pageSize: 25,
        sortOrder: 'desc',
      });
      expect(first.hits).toHaveLength(25);
      expect(first.total).toBe(10_001);
      expect(first.currentCursor).toBeString();
      expect(first.nextCursor).toBeString();
      expect(deletePit).not.toHaveBeenCalled();
      expect(search.mock.calls[0]![0].body.sort).toEqual([
        { '@timestamp': { order: 'desc' } },
        { _doc: { order: 'asc' } },
      ]);
      const queryDigest = findingQueryDigest({
        query: { match_all: {} },
        pageSize: 25,
        sortOrder: 'desc',
      });
      expect(
        decodeFindingPageCursor(first.currentCursor!, {
          organizationId: 'org-1',
          queryDigest,
          secret: process.env.SESSION_SECRET,
        }),
      ).toEqual(
        expect.objectContaining({
          pitId: 'pit-list',
          searchAfter: [],
        }),
      );

      const second = await service.queryFindingPage('org-1', {
        query: { match_all: {} },
        pageSize: 25,
        sortOrder: 'desc',
        cursor: first.nextCursor!,
      });
      expect(search.mock.calls[1]![0].body.search_after).toEqual(['2026-07-26T12:00:00.000Z', 24]);
      expect(
        decodeFindingPageCursor(second.currentCursor, {
          organizationId: 'org-1',
          queryDigest,
          secret: process.env.SESSION_SECRET,
        }).searchAfter,
      ).toEqual(['2026-07-26T12:00:00.000Z', 24]);
      expect(second.nextCursor).toBeNull();
      expect(deletePit).not.toHaveBeenCalled();

      const previous = await service.queryFindingPage('org-1', {
        query: { match_all: {} },
        pageSize: 25,
        sortOrder: 'desc',
        cursor: first.currentCursor!,
      });
      expect(previous.hits).toHaveLength(25);
      expect(search.mock.calls[2]![0].body).not.toHaveProperty('search_after');
      expect(createPit).toHaveBeenCalledTimes(1);
    } finally {
      if (previousSecret === undefined) delete process.env.SESSION_SECRET;
      else process.env.SESSION_SECRET = previousSecret;
    }
  });

  it('keeps cursor history on the original PIT when a search response includes another PIT ID', async () => {
    const previousSecret = process.env.SESSION_SECRET;
    process.env.SESSION_SECRET = 'test-findings-cursor-secret-with-sufficient-entropy';
    try {
      const createPit = jest.fn().mockResolvedValue({ body: { pit_id: 'pit-original' } });
      const search = jest.fn().mockResolvedValue({
        body: {
          pit_id: 'pit-response-value',
          timed_out: false,
          _shards: { total: 1, successful: 1, skipped: 0, failed: 0 },
          hits: {
            total: { value: 26, relation: 'eq' },
            hits: Array.from({ length: 26 }, (_, index) => ({
              _id: `finding-${index}`,
              _source: { '@timestamp': '2026-07-26T12:00:00.000Z' },
              sort: ['2026-07-26T12:00:00.000Z', index],
            })),
          },
        },
      });
      const deletePit = jest.fn().mockResolvedValue({ body: {} });
      const service = new SecurityAnalyticsService(
        createOpenSearchClient({
          enabled: true,
          client: { createPit, search, deletePit },
        }),
      );

      const page = await service.queryFindingPage('org-1', {
        query: { match_all: {} },
        pageSize: 25,
        sortOrder: 'desc',
      });
      const queryDigest = findingQueryDigest({
        query: { match_all: {} },
        pageSize: 25,
        sortOrder: 'desc',
      });

      expect(
        decodeFindingPageCursor(page.nextCursor!, {
          organizationId: 'org-1',
          queryDigest,
          secret: process.env.SESSION_SECRET,
        }).pitId,
      ).toBe('pit-original');
    } finally {
      if (previousSecret === undefined) delete process.env.SESSION_SECRET;
      else process.env.SESSION_SECRET = previousSecret;
    }
  });

  it('keeps cursor history valid beyond two minutes and reissues the visited cursor expiry', async () => {
    const previousSecret = process.env.SESSION_SECRET;
    process.env.SESSION_SECRET = 'test-findings-cursor-secret-with-sufficient-entropy';
    const startedAt = new Date('2026-07-29T12:00:00.000Z');
    setSystemTime(startedAt);
    try {
      const createPit = jest.fn().mockResolvedValue({ body: { pit_id: 'pit-history' } });
      const search = jest.fn().mockResolvedValue({
        body: {
          timed_out: false,
          _shards: { failed: 0 },
          hits: {
            total: { value: 26, relation: 'eq' },
            hits: Array.from({ length: 26 }, (_, index) => ({
              _id: `finding-${index}`,
              _source: { '@timestamp': '2026-07-29T12:00:00.000Z' },
              sort: ['2026-07-29T12:00:00.000Z', index],
            })),
          },
        },
      });
      const service = new SecurityAnalyticsService(
        createOpenSearchClient({
          enabled: true,
          client: { createPit, search, deletePit: jest.fn() },
        }),
      );
      const query = { match_all: {} };
      const first = await service.queryFindingPage('org-1', {
        query,
        pageSize: 25,
        sortOrder: 'desc',
      });

      setSystemTime(new Date(startedAt.getTime() + 3 * 60 * 1_000));
      const revisited = await service.queryFindingPage('org-1', {
        query,
        pageSize: 25,
        sortOrder: 'desc',
        cursor: first.nextCursor!,
      });

      const digest = findingQueryDigest({ query, pageSize: 25, sortOrder: 'desc' });
      const refreshed = decodeFindingPageCursor(revisited.currentCursor, {
        organizationId: 'org-1',
        queryDigest: digest,
        secret: process.env.SESSION_SECRET,
      });
      expect(revisited.currentCursor).not.toBe(first.nextCursor);
      expect(refreshed.expiresAt).toBeGreaterThan(Date.now() + 9 * 60 * 1_000);
      expect(createPit).toHaveBeenCalledWith(expect.objectContaining({ keep_alive: '10m' }));
      expect(search.mock.calls[1]![0].body.pit.keep_alive).toBe('10m');
    } finally {
      setSystemTime();
      if (previousSecret === undefined) delete process.env.SESSION_SECRET;
      else process.env.SESSION_SECRET = previousSecret;
    }
  });

  it('returns a revisitable start cursor and lets its PIT expire when the first page is terminal', async () => {
    const previousSecret = process.env.SESSION_SECRET;
    process.env.SESSION_SECRET = 'test-findings-cursor-secret-with-sufficient-entropy';
    const createPit = jest.fn().mockResolvedValue({ body: { pit_id: 'pit-single-page' } });
    const search = jest.fn().mockResolvedValue({
      body: {
        pit_id: 'pit-single-page',
        timed_out: false,
        _shards: { total: 1, successful: 1, skipped: 0, failed: 0 },
        hits: {
          total: { value: 1, relation: 'eq' },
          hits: [
            {
              _id: 'finding-1',
              _source: { '@timestamp': '2026-07-26T12:00:00.000Z' },
              sort: ['2026-07-26T12:00:00.000Z', 1],
            },
          ],
        },
      },
    });
    const deletePit = jest.fn().mockResolvedValue({ body: {} });
    const service = new SecurityAnalyticsService(
      createOpenSearchClient({
        enabled: true,
        client: { createPit, search, deletePit },
      }),
    );

    try {
      const page = await service.queryFindingPage('org-1', {
        query: { match_all: {} },
        pageSize: 25,
        sortOrder: 'desc',
      });

      expect(page.currentCursor).toBeString();
      expect(page.nextCursor).toBeNull();
      expect(deletePit).not.toHaveBeenCalled();
    } finally {
      if (previousSecret === undefined) delete process.env.SESSION_SECRET;
      else process.env.SESSION_SECRET = previousSecret;
    }
  });

  it.each([
    ['string', '0'],
    ['lower-bound relation', { value: 1, relation: 'gte' }],
    ['missing relation', { value: 1 }],
  ])('rejects and closes its PIT for a %s cursor-page total', async (_label, total) => {
    const previousSecret = process.env.SESSION_SECRET;
    process.env.SESSION_SECRET = 'test-findings-cursor-secret-with-sufficient-entropy';
    const createPit = jest.fn().mockResolvedValue({ body: { pit_id: 'pit-invalid-total' } });
    const search = jest.fn().mockResolvedValue({
      body: {
        timed_out: false,
        _shards: { failed: 0 },
        hits: { total, hits: [] },
      },
    });
    const deletePit = jest.fn().mockResolvedValue({ body: {} });
    const service = new SecurityAnalyticsService(
      createOpenSearchClient({
        enabled: true,
        client: { createPit, search, deletePit },
      }),
    );

    try {
      await expect(
        service.queryFindingPage('org-1', {
          query: { match_all: {} },
          pageSize: 25,
          sortOrder: 'desc',
        }),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);
      expect(deletePit).toHaveBeenCalledWith({ body: { pit_id: ['pit-invalid-total'] } });
    } finally {
      if (previousSecret === undefined) delete process.env.SESSION_SECRET;
      else process.env.SESSION_SECRET = previousSecret;
    }
  });

  it('rejects and closes a PIT when any export page is timed out or has failed shards', async () => {
    const createPit = jest.fn().mockResolvedValue({ body: { pit_id: 'pit-partial' } });
    const search = jest.fn().mockResolvedValue({
      body: {
        pit_id: 'pit-partial',
        timed_out: false,
        _shards: { total: 2, successful: 1, skipped: 0, failed: 1 },
        hits: { hits: [] },
      },
    });
    const deletePit = jest.fn().mockResolvedValue({ body: {} });
    const service = new SecurityAnalyticsService(
      createOpenSearchClient({
        enabled: true,
        client: { createPit, search, deletePit },
      }),
    );

    await expect(
      service.scanFindings('org-1', {
        query: { match_all: {} },
        sortOrder: 'desc',
      }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(deletePit).toHaveBeenCalledWith({ body: { pit_id: ['pit-partial'] } });
  });

  it('reads projection watermarks in one tenant-scoped batch for reconciliation', async () => {
    const search = jest.fn().mockResolvedValue({
      body: {
        hits: {
          hits: [
            {
              _id: 'finding-1',
              _source: { sentris: { triage: { version: 4 } } },
            },
            {
              _id: 'finding-2',
              _source: { sentris: { triage: { version: 7 } } },
            },
          ],
        },
      },
    });
    const service = new SecurityAnalyticsService(
      createOpenSearchClient({ enabled: true, client: { search } }),
    );

    const versions = await service.getFindingTriageProjectionVersions('org-1', [
      'finding-1',
      'finding-2',
      'missing',
    ]);

    expect(versions).toEqual(
      new Map([
        ['finding-1', 4],
        ['finding-2', 7],
      ]),
    );
    expect(search).toHaveBeenCalledWith({
      index: ORG_1_INDEX,
      body: {
        query: { ids: { values: ['finding-1', 'finding-2', 'missing'] } },
        size: 3,
        _source: ['sentris.triage.version'],
        track_total_hits: false,
      },
    });
  });

  it('discovers case-distinct observation tenants in bounded pages and validates index ownership', async () => {
    const upperIndex =
      'security-findings-oda570542baf73bc622dc70840e59d660aa2f5dbf66686f12ed154364f802185c-observations-v1';
    const lowerIndex =
      'security-findings-o527a4c0a7e943ca74bcc0baba99d55920cdb041997056e55c6f33a42d86910d5-observations-v1';
    const search = jest.fn().mockResolvedValue({
      body: {
        timed_out: false,
        _shards: { failed: 0 },
        hits: { total: { value: 2 }, hits: [] },
        aggregations: {
          sentris_observation_organizations: {
            buckets: [
              {
                key: { index_name: upperIndex, organization_id: 'Org-A' },
                doc_count: 1,
              },
              {
                key: { index_name: lowerIndex, organization_id: 'org-a' },
                doc_count: 1,
              },
            ],
            after_key: { index_name: lowerIndex, organization_id: 'org-a' },
          },
        },
      },
    });
    const service = new SecurityAnalyticsService(
      createOpenSearchClient({ enabled: true, client: { search } }),
    );

    const page = await service.listFindingObservationOrganizationsPage(undefined, 2);

    expect(page).toEqual({
      organizationIds: ['Org-A', 'org-a'],
      afterKey: { indexName: lowerIndex, organizationId: 'org-a' },
    });
    const request = search.mock.calls[0]![0];
    expect(request).toEqual(
      expect.objectContaining({
        index: 'security-findings-o*-observations-v1',
        allow_no_indices: true,
        body: expect.objectContaining({
          size: 0,
          aggs: {
            sentris_observation_organizations: {
              composite: expect.objectContaining({
                size: 2,
                sources: [
                  { index_name: { terms: { field: '_index', order: 'asc' } } },
                  {
                    organization_id: {
                      terms: { field: 'sentris.organization_id', order: 'asc' },
                    },
                  },
                ],
              }),
            },
          },
        }),
      }),
    );
    expect(request).not.toHaveProperty('ignore_unavailable');
  });

  it.each([
    ['missing aggregation', { timed_out: false, _shards: { failed: 0 }, hits: { hits: [] } }],
    [
      'missing buckets',
      {
        timed_out: false,
        _shards: { failed: 0 },
        hits: { hits: [] },
        aggregations: { sentris_observation_organizations: {} },
      },
    ],
    [
      'malformed continuation key',
      {
        timed_out: false,
        _shards: { failed: 0 },
        hits: { hits: [] },
        aggregations: {
          sentris_observation_organizations: {
            buckets: [],
            after_key: { index_name: 7, organization_id: 'org-1' },
          },
        },
      },
    ],
  ])(
    'reports finding organization discovery unavailable for a %s response',
    async (_label, body) => {
      const search = jest.fn().mockResolvedValue({ body });
      const service = new SecurityAnalyticsService(
        createOpenSearchClient({ enabled: true, client: { search } }),
      );

      await expect(
        service.listFindingObservationOrganizationsPage(undefined, 100),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);
    },
  );

  it('rejects a discovered organization whose exact ID does not own the bucket index', async () => {
    const search = jest.fn().mockResolvedValue({
      body: {
        timed_out: false,
        _shards: { failed: 0 },
        hits: { total: { value: 1 }, hits: [] },
        aggregations: {
          sentris_observation_organizations: {
            buckets: [
              {
                key: {
                  index_name:
                    'security-findings-o527a4c0a7e943ca74bcc0baba99d55920cdb041997056e55c6f33a42d86910d5-observations-v1',
                  organization_id: 'Org-A',
                },
                doc_count: 1,
              },
            ],
          },
        },
      },
    });
    const service = new SecurityAnalyticsService(
      createOpenSearchClient({ enabled: true, client: { search } }),
    );

    await expect(service.listFindingObservationOrganizationsPage(undefined, 100)).rejects.toThrow(
      'does not match its organization identity',
    );
  });
});
