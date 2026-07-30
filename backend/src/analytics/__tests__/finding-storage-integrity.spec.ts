import { describe, expect, it, jest } from 'bun:test';
import { buildFindingObservationIndexName } from '@sentris/shared/finding-observation-id';

import {
  reconcileFindingStorageIdIntegrity,
  type FindingStorageIdIntegrityClient,
} from '../finding-storage-integrity';
import {
  FINDINGS_FINAL_INGEST_PIPELINE_CONTENT_HASH,
  FINDINGS_FINAL_INGEST_PIPELINE_ID,
  FINDINGS_OBSERVATION_MAPPING_CONTENT_HASH,
  buildFindingsFinalIngestPipeline,
  buildOrganizationFindingsIndexTemplate,
  buildOrganizationFindingsIndexTemplateName,
  getOrganizationFindingsIndexTemplateContentHash,
} from '../findings-index-template';

function invariantClient(
  overrides: {
    pipeline?: Record<string, unknown>;
    template?: Record<string, unknown>;
    mappings?: Record<string, unknown>;
  } = {},
) {
  const organizationId = 'Org-1';
  const index = buildFindingObservationIndexName(organizationId);
  const templateName = buildOrganizationFindingsIndexTemplateName(organizationId);
  const pipeline = overrides.pipeline ?? buildFindingsFinalIngestPipeline();
  const template = overrides.template ?? buildOrganizationFindingsIndexTemplate(organizationId);
  const mappings =
    overrides.mappings ?? buildOrganizationFindingsIndexTemplate(organizationId).template.mappings;
  return {
    ingest: {
      getPipeline: jest.fn().mockResolvedValue({
        body: {
          [FINDINGS_FINAL_INGEST_PIPELINE_ID]: {
            ...pipeline,
            deprecated: false,
          },
        },
      }),
    },
    indices: {
      getSettings: jest.fn().mockResolvedValue({
        body: {
          [index]: {
            settings: {
              index: {
                uuid: 'observation-index-uuid',
                final_pipeline: FINDINGS_FINAL_INGEST_PIPELINE_ID,
              },
            },
          },
        },
      }),
      getIndexTemplate: jest.fn().mockResolvedValue({
        body: {
          index_templates: [
            {
              name: templateName,
              index_template: asOpenSearchTemplateGet(template),
            },
          ],
        },
      }),
      getMapping: jest.fn().mockResolvedValue({
        body: {
          [index]: {
            mappings: asOpenSearchMappingGet(mappings),
          },
        },
      }),
      refresh: jest.fn().mockResolvedValue({ body: {} }),
    },
    createPit: jest.fn().mockResolvedValue({ body: { pit_id: 'integrity-pit' } }),
    search: jest.fn().mockResolvedValue({ body: { hits: { hits: [] } } }),
    deletePit: jest.fn().mockResolvedValue({ body: {} }),
    bulk: jest.fn(),
    index: jest.fn().mockResolvedValue({ body: { result: 'created' } }),
  };
}

function asOpenSearchMappingGet(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => asOpenSearchMappingGet(item));
  if (typeof value !== 'object' || value === null) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [
      key,
      (key === 'dynamic' || key === 'enabled') && typeof child === 'boolean'
        ? String(child)
        : asOpenSearchMappingGet(child),
    ]),
  );
}

function asOpenSearchTemplateGet(template: Record<string, unknown>): Record<string, unknown> {
  const templateBody = template.template as {
    settings: Record<string, unknown>;
    mappings: Record<string, unknown>;
  };
  return {
    ...template,
    composed_of: [],
    version: String(template.version),
    priority: String(template.priority),
    template: {
      ...templateBody,
      settings: {
        index: {
          number_of_shards: String(templateBody.settings.number_of_shards),
          number_of_replicas: String(templateBody.settings.number_of_replicas),
          final_pipeline: templateBody.settings['index.final_pipeline'],
        },
      },
      mappings: asOpenSearchMappingGet(templateBody.mappings),
    },
  };
}

function projectSource(
  source: Record<string, unknown>,
  includes: readonly string[],
): Record<string, unknown> {
  const projected: Record<string, unknown> = {};
  for (const include of includes) {
    const path = include.split('.');
    let sourceCursor: unknown = source;
    for (const segment of path) {
      sourceCursor =
        typeof sourceCursor === 'object' && sourceCursor !== null && !Array.isArray(sourceCursor)
          ? (sourceCursor as Record<string, unknown>)[segment]
          : undefined;
    }
    if (sourceCursor === undefined) continue;

    let targetCursor = projected;
    for (const segment of path.slice(0, -1)) {
      const child = targetCursor[segment];
      if (typeof child !== 'object' || child === null || Array.isArray(child)) {
        targetCursor[segment] = {};
      }
      targetCursor = targetCursor[segment] as Record<string, unknown>;
    }
    targetCursor[path.at(-1)!] = sourceCursor;
  }
  return projected;
}

function canonicalFindingSource(findingId: string): Record<string, unknown> {
  return {
    contract: 'sentris.finding-observation',
    schema_version: 1,
    finding_id: findingId,
    observed_at: '2026-07-29T12:00:00.000Z',
    '@timestamp': '2026-07-29T12:00:00.000Z',
    severity: 'high',
    title: 'Canonical finding',
    description: 'Evidence is part of the canonical contract',
    evidence: [{ proof: 'scanner output' }],
    source: { scanner: 'nuclei' },
    sentris: {
      organization_id: 'Org-1',
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
    sentris_contract_classification: 'invalid',
    sentris_contract_validation_version: 1,
    sentris_normalized_severity: 'high',
  };
}

function clientWithFindingNeedingBackfill(bulkResponseBody: Record<string, unknown>) {
  const findingId = `fo_v1_${'fedcba9876543210'.repeat(4)}`;
  const source = canonicalFindingSource(findingId);
  const client = invariantClient();
  client.bulk.mockResolvedValue({ body: bulkResponseBody });
  client.search.mockImplementationOnce((input: Record<string, any>) =>
    Promise.resolve({
      body: {
        timed_out: false,
        _shards: { failed: 0 },
        hits: {
          hits: [
            {
              _id: findingId,
              _seq_no: 1,
              _primary_term: 1,
              _source: projectSource(source, input.body._source.includes),
              sort: [1],
            },
          ],
        },
      },
    }),
  );
  return client;
}

describe('finding storage invariant verification', () => {
  it('requests every required canonical field when reconciling projected sources', async () => {
    const findingId = `fo_v1_${'0123456789abcdef'.repeat(4)}`;
    const source = canonicalFindingSource(findingId);
    const client = invariantClient();
    client.bulk.mockResolvedValue({
      body: { errors: false, items: [{ update: { status: 200 } }] },
    });
    client.search.mockImplementationOnce((input: Record<string, any>) =>
      Promise.resolve({
        body: {
          timed_out: false,
          _shards: { failed: 0 },
          hits: {
            hits: [
              {
                _id: findingId,
                _seq_no: 1,
                _primary_term: 1,
                _source: projectSource(source, input.body._source.includes),
                sort: [1],
              },
            ],
          },
        },
      }),
    );

    await reconcileFindingStorageIdIntegrity(
      client as unknown as FindingStorageIdIntegrityClient,
      'Org-1',
      2,
    );

    expect(client.search.mock.calls[0]![0].body._source.includes).toContain('evidence');
    expect(client.search.mock.calls[0]![0].body.sort).toEqual([{ _doc: { order: 'asc' } }]);
    expect(client.bulk.mock.calls[0]![0].body[1].script.params.classification).toBe('canonical');
  });

  it('does not publish a verified watermark when a bulk item omits its update result', async () => {
    const client = clientWithFindingNeedingBackfill({ errors: false, items: [{}] });

    await expect(
      reconcileFindingStorageIdIntegrity(
        client as unknown as FindingStorageIdIntegrityClient,
        'Org-1',
        2,
      ),
    ).rejects.toThrow('update result');
    expect(client.index).toHaveBeenCalledTimes(1);
  });

  it.each([
    {
      label: 'requires a boolean errors flag',
      response: { items: [{ update: { status: 200 } }] },
      message: 'missing errors flag',
    },
    {
      label: 'requires exactly one update operation per item',
      response: {
        errors: false,
        items: [{ update: { status: 200 }, index: { status: 200 } }],
      },
      message: 'one update result',
    },
    {
      label: 'requires an integer HTTP status',
      response: { errors: false, items: [{ update: { status: '200' } }] },
      message: 'invalid item status',
    },
    {
      label: 'rejects errors attached to successful updates',
      response: {
        errors: true,
        items: [{ update: { status: 200, error: { type: 'unexpected' } } }],
      },
      message: 'successful item included an error',
    },
    {
      label: 'requires a structured error for failed updates',
      response: { errors: true, items: [{ update: { status: 500 } }] },
      message: 'failed item omitted a valid error',
    },
    {
      label: 'rejects a false errors flag when an update failed',
      response: {
        errors: false,
        items: [{ update: { status: 500, error: { type: 'server_error' } } }],
      },
      message: 'errors flag contradicts item results',
    },
    {
      label: 'rejects a true errors flag when every update succeeded',
      response: { errors: true, items: [{ update: { status: 200 } }] },
      message: 'errors flag contradicts item results',
    },
  ])('$label', async ({ response, message }) => {
    const client = clientWithFindingNeedingBackfill(response);

    await expect(
      reconcileFindingStorageIdIntegrity(
        client as unknown as FindingStorageIdIntegrityClient,
        'Org-1',
        2,
      ),
    ).rejects.toThrow(message);
    expect(client.index).toHaveBeenCalledTimes(1);
  });

  it('invalidates an earlier healthy watermark before verifying a drifted pipeline', async () => {
    const client = invariantClient({
      pipeline: {
        ...buildFindingsFinalIngestPipeline(),
        processors: [],
      },
    });

    await expect(
      reconcileFindingStorageIdIntegrity(
        client as unknown as FindingStorageIdIntegrityClient,
        'Org-1',
      ),
    ).rejects.toThrow('pipeline content');
    expect(client.createPit).not.toHaveBeenCalled();
    expect(client.index).toHaveBeenCalledTimes(1);
    expect(client.index).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({
          organization_id: 'Org-1',
          verification_state: 'checking',
        }),
      }),
    );
  });

  it('propagates a failed checking-state write before scanning or reporting success', async () => {
    const client = invariantClient();
    client.index.mockRejectedValue(new Error('control index unavailable'));

    await expect(
      reconcileFindingStorageIdIntegrity(
        client as unknown as FindingStorageIdIntegrityClient,
        'Org-1',
      ),
    ).rejects.toThrow('control index unavailable');
    expect(client.index).toHaveBeenCalledTimes(1);
    expect(client.createPit).not.toHaveBeenCalled();
  });

  it('fails closed when the installed template or current index mapping drifts', async () => {
    const templateClient = invariantClient({
      template: {
        ...buildOrganizationFindingsIndexTemplate('Org-1'),
        index_patterns: ['security-findings-unrelated-*'],
      },
    });
    await expect(
      reconcileFindingStorageIdIntegrity(
        templateClient as unknown as FindingStorageIdIntegrityClient,
        'Org-1',
      ),
    ).rejects.toThrow('template content');
    expect(templateClient.createPit).not.toHaveBeenCalled();

    const mappingClient = invariantClient({
      mappings: {
        ...buildOrganizationFindingsIndexTemplate('Org-1').template.mappings,
        dynamic: true,
      },
    });
    await expect(
      reconcileFindingStorageIdIntegrity(
        mappingClient as unknown as FindingStorageIdIntegrityClient,
        'Org-1',
      ),
    ).rejects.toThrow('mapping');
    expect(mappingClient.createPit).not.toHaveBeenCalled();
  });

  it('binds the completion watermark to verified immutable invariant content', async () => {
    const client = invariantClient();

    await expect(
      reconcileFindingStorageIdIntegrity(
        client as unknown as FindingStorageIdIntegrityClient,
        'Org-1',
      ),
    ).resolves.toEqual({
      checked: 0,
      mismatched: 0,
      completedAt: expect.any(String),
    });

    expect(client.ingest.getPipeline).toHaveBeenCalledTimes(2);
    expect(client.indices.getIndexTemplate).toHaveBeenCalledTimes(2);
    expect(client.indices.getMapping).toHaveBeenCalledTimes(2);
    expect(client.index).toHaveBeenCalledTimes(2);
    expect(client.index).toHaveBeenLastCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({
          verification_state: 'verified',
          final_pipeline: FINDINGS_FINAL_INGEST_PIPELINE_ID,
          final_pipeline_content_hash: FINDINGS_FINAL_INGEST_PIPELINE_CONTENT_HASH,
          index_template_name: buildOrganizationFindingsIndexTemplateName('Org-1'),
          index_template_content_hash: getOrganizationFindingsIndexTemplateContentHash('Org-1'),
          mapping_content_hash: FINDINGS_OBSERVATION_MAPPING_CONTENT_HASH,
          invariant_fingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
        }),
      }),
    );
  });
});
