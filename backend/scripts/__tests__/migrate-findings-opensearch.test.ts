import { describe, expect, it, jest } from 'bun:test';

import { migrateFindingsIndices } from '../migrate-findings-opensearch';
import {
  FINDINGS_CONTRACT_CLASSIFICATION_VERSION,
  FINDINGS_FINAL_INGEST_PIPELINE_ID,
  FINDINGS_INDEX_TEMPLATE_VERSION,
  buildFindingsFinalIngestPipeline,
  buildOrganizationFindingsIndexTemplate,
  buildOrganizationFindingsIndexTemplateName,
} from '../../src/analytics/findings-index-template';
import { buildFindingObservationIndexName } from '@sentris/shared/finding-observation-id';

function makeClient() {
  return {
    ingest: {
      putPipeline: jest.fn().mockResolvedValue({ body: { acknowledged: true } }),
      getPipeline: jest.fn().mockResolvedValue({
        body: {
          [FINDINGS_FINAL_INGEST_PIPELINE_ID]: buildFindingsFinalIngestPipeline(),
        },
      }),
    },
    indices: {
      get: jest.fn().mockResolvedValue({
        body: {
          'security-findings-org-1-2026.07.24': {},
          'security-findings-org-1-2026.07.25': {},
          'security-findings-org-1-observations-v1': {},
        },
      }),
      putIndexTemplate: jest.fn().mockResolvedValue({ body: { acknowledged: true } }),
      putMapping: jest.fn().mockResolvedValue({ body: { acknowledged: true } }),
      putSettings: jest.fn().mockResolvedValue({ body: { acknowledged: true } }),
      getSettings: jest.fn().mockResolvedValue({
        body: {
          [buildFindingObservationIndexName('org-1')]: {
            settings: {
              index: {
                uuid: 'observation-index-uuid-1',
                final_pipeline: FINDINGS_FINAL_INGEST_PIPELINE_ID,
              },
            },
          },
        },
      }),
      exists: jest.fn().mockResolvedValue({ body: true }),
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
          [buildFindingObservationIndexName('org-1')]: {
            mappings: buildOrganizationFindingsIndexTemplate('org-1').template.mappings,
          },
        },
      }),
    },
    createPit: jest.fn().mockResolvedValue({ body: { pit_id: 'integrity-pit' } }),
    search: jest.fn().mockResolvedValue({ body: { hits: { hits: [] } } }),
    deletePit: jest.fn().mockResolvedValue({ body: { succeeded: true } }),
    index: jest.fn().mockResolvedValue({ body: { result: 'created' } }),
    reindex: jest.fn().mockResolvedValue({
      body: { timed_out: false, failures: [], total: 1, created: 0, updated: 1 },
    }),
  };
}

describe('checked findings OpenSearch migration', () => {
  it('dry-runs without mutating OpenSearch and reports every legacy daily source', async () => {
    const client = makeClient();

    const result = await migrateFindingsIndices(client as never, 'org-1', false);

    expect(result.applied).toBe(false);
    expect(result.plan.sourceIndices).toHaveLength(3);
    expect(client.indices.get).toHaveBeenCalledWith({
      index: [buildFindingObservationIndexName('org-1'), 'security-findings-org-1-*'],
      allow_no_indices: true,
      ignore_unavailable: true,
      expand_wildcards: ['open', 'closed'],
    });
    expect(client.indices.putIndexTemplate).not.toHaveBeenCalled();
    expect(client.ingest.putPipeline).not.toHaveBeenCalled();
    expect(client.reindex).not.toHaveBeenCalled();
  });

  it('updates the versioned template then reindexes oldest to newest without deleting sources', async () => {
    const client = makeClient();

    const result = await migrateFindingsIndices(client as never, 'org-1', true);

    expect(client.indices.putIndexTemplate).toHaveBeenCalledWith(
      expect.objectContaining({
        name: buildOrganizationFindingsIndexTemplateName('org-1'),
        body: expect.objectContaining({
          version: FINDINGS_INDEX_TEMPLATE_VERSION,
          priority: 100,
        }),
      }),
    );
    expect(client.indices.putSettings).toHaveBeenCalledWith({
      index: buildFindingObservationIndexName('org-1'),
      body: {
        'index.final_pipeline': FINDINGS_FINAL_INGEST_PIPELINE_ID,
      },
    });
    expect(client.indices.putMapping).toHaveBeenCalledWith({
      index: buildFindingObservationIndexName('org-1'),
      body: {
        properties: expect.objectContaining({
          run_id: { type: 'keyword' },
          workflow_id: { type: 'keyword' },
          component_id: { type: 'keyword' },
          workflow_name: { type: 'text' },
          sentris: expect.objectContaining({
            properties: expect.objectContaining({
              contract_document_id: { type: 'keyword' },
              contract_source_validated: { type: 'boolean' },
            }),
          }),
        }),
      },
    });
    expect(client.reindex.mock.calls.map(([request]) => request.body.source.index)).toEqual([
      'security-findings-org-1-2026.07.24',
      'security-findings-org-1-2026.07.25',
      'security-findings-org-1-observations-v1',
    ]);
    expect(
      client.reindex.mock.calls.every(([request]) => request.body.dest.op_type === 'create'),
    ).toBe(true);
    expect(
      client.reindex.mock.calls.every(
        ([request]) =>
          request.body.source.query.bool.filter[0].term['sentris.organization_id'] === 'org-1' &&
          request.body.source.index,
      ),
    ).toBe(true);
    expect(client.reindex.mock.calls.every(([request]) => !('delete' in request.body))).toBe(true);
    expect(client.ingest.putPipeline.mock.invocationCallOrder[0]).toBeLessThan(
      client.indices.putIndexTemplate.mock.invocationCallOrder[0],
    );
    expect(client.indices.putIndexTemplate.mock.invocationCallOrder[0]).toBeLessThan(
      client.indices.putSettings.mock.invocationCallOrder[0],
    );
    expect(client.indices.putSettings.mock.invocationCallOrder[0]).toBeLessThan(
      client.reindex.mock.invocationCallOrder[0],
    );
    expect(client.reindex.mock.invocationCallOrder.at(-1)).toBeLessThan(
      client.createPit.mock.invocationCallOrder[0],
    );
    expect(client.index).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'storage-id-integrity-watermark-v1',
        body: expect.objectContaining({
          observation_index_uuid: 'observation-index-uuid-1',
          final_pipeline: FINDINGS_FINAL_INGEST_PIPELINE_ID,
          template_version: FINDINGS_INDEX_TEMPLATE_VERSION,
          schema_version: 1,
          classification_version: FINDINGS_CONTRACT_CLASSIFICATION_VERSION,
          mismatched: 0,
        }),
      }),
    );
    expect(result.applied).toBe(true);
    expect(result.migratedDocuments).toBe(3);
  });

  it('fails closed when OpenSearch reports a timed-out or partial reindex', async () => {
    const client = makeClient();
    client.reindex.mockResolvedValueOnce({
      body: {
        timed_out: true,
        failures: [{ cause: { reason: 'shard unavailable' } }],
        total: 1,
        created: 0,
        updated: 0,
      },
    });

    await expect(migrateFindingsIndices(client as never, 'org-1', true)).rejects.toThrow(
      'Reindex incomplete',
    );
  });
});
