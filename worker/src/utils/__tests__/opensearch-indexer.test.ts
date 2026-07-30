import { afterEach, beforeEach, describe, expect, it, setSystemTime, vi } from 'bun:test';
import { FindingObservationV1Schema } from '@sentris/shared';
import {
  buildFindingObservationIndexName,
  buildTenantAnalyticsIndexName,
} from '@sentris/shared/finding-observation-id';

import { OpenSearchIndexer } from '../opensearch-indexer';

const ORG_1_OBSERVATION_INDEX = buildFindingObservationIndexName('org-1');
const ORG_1_CUSTOM_METRICS_INDEX = buildTenantAnalyticsIndexName('org-1', 'custom-metrics');

function createIndexer(bulkResponse?: Record<string, unknown>) {
  const bulk =
    bulkResponse === undefined
      ? vi.fn().mockImplementation(({ body }: { body: Record<string, unknown>[] }) =>
          Promise.resolve({
            body: {
              errors: false,
              items: body
                .filter((_entry, index) => index % 2 === 0)
                .map((operation) =>
                  Object.hasOwn(operation, 'create')
                    ? { create: { status: 201 } }
                    : { index: { status: 201 } },
                ),
            },
          }),
        )
      : vi.fn().mockResolvedValue(bulkResponse);
  const indexer = new OpenSearchIndexer();
  Object.assign(indexer as unknown as Record<string, unknown>, {
    enabled: true,
    client: { bulk },
    dashboardsUrl: null,
    securityEnabled: false,
    backendUrl: null,
    internalServiceToken: null,
  });
  return { indexer, bulk };
}

describe('OpenSearchIndexer finding observations', () => {
  beforeEach(() => {
    setSystemTime(new Date('2026-07-26T23:59:59.000Z'));
  });

  afterEach(() => {
    setSystemTime();
    vi.restoreAllMocks();
  });

  it('requests first-use observation storage provisioning in trusted-local mode', async () => {
    const provision = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          securityEnabled: false,
          message: 'Observation storage provisioned for org-1; security mode disabled',
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      ),
    );
    vi.spyOn(globalThis, 'fetch').mockImplementation(provision as unknown as typeof fetch);
    const { indexer } = createIndexer();
    Object.assign(indexer as unknown as Record<string, unknown>, {
      backendUrl: 'http://backend:3211/api/v1',
      internalServiceToken: 'internal-token',
    });

    await (
      indexer as unknown as {
        ensureTenantProvisioned(organizationId: string): Promise<boolean>;
      }
    ).ensureTenantProvisioned('org-1');

    expect(provision).toHaveBeenCalledWith('http://backend:3211/api/v1/analytics/ensure-tenant', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Token': 'internal-token',
      },
      body: JSON.stringify({ organizationId: 'org-1' }),
    });
  });

  it('marks indexing degraded when first-use invariant verification fails', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          success: false,
          securityEnabled: false,
          message: 'Installed findings final pipeline content does not match its immutable ID',
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      ),
    );
    const { indexer, bulk } = createIndexer({
      body: {
        errors: false,
        items: [{ create: { status: 201 } }],
      },
    });
    Object.assign(indexer as unknown as Record<string, unknown>, {
      backendUrl: 'http://backend:3211/api/v1',
      internalServiceToken: 'internal-token',
    });

    const result = await indexer.bulkIndex(
      'org-1',
      [{ finding_hash: 'finding-1', severity: 'high', title: 'Finding' }],
      {
        workflowId: 'workflow-1',
        workflowName: 'Web scan',
        runId: 'run-1',
        scopeId: null,
        nodeRef: 'analytics',
        componentId: 'core.analytics.sink',
      },
    );

    expect(bulk).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      indexName: ORG_1_OBSERVATION_INDEX,
      documentCount: 1,
      succeededCount: 1,
      failedCount: 0,
      degraded: true,
    });
  });

  it('stamps and validates v1 observations without dropping custom analytics fields', async () => {
    const { indexer, bulk } = createIndexer();

    await indexer.bulkIndex(
      'org-authoritative',
      [
        {
          scanner: 'nuclei',
          finding_hash: 'source-hash',
          severity: 'high',
          title: 'SQL injection',
          evidence: [{ parameter: 'id', values: [1, 'one', null] }, 'raw scanner output'],
          source: {
            scanner_payload: { template: 'sqli', tags: ['cve', 'injection'] },
          },
          custom_score: 0.97,
          sentris: {
            organization_id: 'org-spoofed',
            run_id: 'run-spoofed',
            scope_id: 'scope-spoofed',
          },
        },
      ],
      {
        workflowId: 'workflow-1',
        workflowName: 'Web scan',
        runId: 'run-1',
        scopeId: 'scope-1',
        nodeRef: 'analytics',
        componentId: 'core.analytics.sink',
      },
    );

    const body = bulk.mock.calls[0][0].body as Record<string, unknown>[];
    const metadata = body[0] as { create: { _id: string } };
    const document = body[1] as Record<string, unknown>;

    expect(FindingObservationV1Schema.safeParse(document).success).toBe(true);
    expect(document.custom_score).toBe(0.97);
    expect(document.evidence).toEqual([
      { parameter: 'id', values: [1, 'one', null] },
      'raw scanner output',
    ]);
    expect(document.source).toEqual({
      scanner_payload: { template: 'sqli', tags: ['cve', 'injection'] },
    });
    expect(document.sentris).toEqual(
      expect.objectContaining({
        organization_id: 'org-authoritative',
        run_id: 'run-1',
        scope_id: 'scope-1',
        contract_validated: true,
      }),
    );
    expect(metadata.create._id).toBe(String(document.finding_id));
  });

  it.each([
    ['object', { scanner: 'nuclei', nested: [1, null, true] }],
    ['array', [{ scanner: 'nuclei' }, 'raw', 7, false, null]],
    ['string', 'nuclei'],
    ['number', 7],
    ['boolean', false],
    ['null', null],
  ])('preserves explicit arbitrary JSON source and evidence shapes: %s', async (_label, value) => {
    const { indexer, bulk } = createIndexer();

    await indexer.bulkIndex(
      'org-1',
      [
        {
          finding_hash: `finding-${_label}`,
          severity: 'high',
          title: 'Finding',
          description: 'Description',
          source: value,
          evidence: value,
        },
      ],
      {
        workflowId: 'workflow-1',
        workflowName: 'Web scan',
        runId: 'run-1',
        scopeId: null,
        nodeRef: 'analytics',
        componentId: 'core.analytics.sink',
      },
    );

    const body = bulk.mock.calls[0][0].body as Record<string, unknown>[];
    expect(body[1]?.source).toEqual(value);
    expect(body[1]?.evidence).toEqual(value);
    expect(FindingObservationV1Schema.safeParse(body[1]).success).toBe(true);
  });

  it('preserves explicit null evidence instead of replacing it with legacy metadata', async () => {
    const { indexer, bulk } = createIndexer();

    await indexer.bulkIndex(
      'org-1',
      [
        {
          finding_hash: 'finding-null-evidence',
          severity: 'high',
          title: 'Finding',
          description: 'Description',
          evidence: null,
          metadata: { legacy: true },
        },
      ],
      {
        workflowId: 'workflow-1',
        workflowName: 'Web scan',
        runId: 'run-1',
        scopeId: null,
        nodeRef: 'analytics',
        componentId: 'core.analytics.sink',
      },
    );

    const body = bulk.mock.calls[0][0].body as Record<string, unknown>[];
    expect(body[1]?.evidence).toBeNull();
  });

  it('uses the same OpenSearch _id when an observation is replayed', async () => {
    const { indexer, bulk } = createIndexer();
    const document = {
      scanner: 'nuclei',
      finding_hash: 'source-hash',
      severity: 'high',
      name: 'SQL injection',
    };
    const options = {
      workflowId: 'workflow-1',
      workflowName: 'Web scan',
      runId: 'run-1',
      scopeId: null,
      nodeRef: 'analytics',
      componentId: 'core.analytics.sink',
    };

    await indexer.bulkIndex('org-1', [document], options);
    await indexer.bulkIndex('org-1', [document], options);

    const firstBody = bulk.mock.calls[0][0].body as { create?: { _id: string } }[];
    const replayBody = bulk.mock.calls[1][0].body as { create?: { _id: string } }[];
    expect(firstBody[0].create?._id).toBe(replayBody[0].create?._id);
  });

  it('targets the same stable index when a replay crosses UTC midnight', async () => {
    const { indexer, bulk } = createIndexer();
    const document = {
      scanner: 'nuclei',
      finding_hash: 'source-hash',
      severity: 'high',
      name: 'SQL injection',
    };
    const options = {
      workflowId: 'workflow-1',
      workflowName: 'Web scan',
      runId: 'run-1',
      scopeId: null,
      nodeRef: 'analytics',
      componentId: 'core.analytics.sink',
    };

    await indexer.bulkIndex('org-1', [document], options);
    setSystemTime(new Date('2026-07-27T00:00:01.000Z'));
    await indexer.bulkIndex('org-1', [document], options);

    const firstMetadata = bulk.mock.calls[0][0].body[0] as {
      create: { _index: string; _id: string };
    };
    const replayMetadata = bulk.mock.calls[1][0].body[0] as {
      create: { _index: string; _id: string };
    };
    expect(firstMetadata.create._index).toBe(ORG_1_OBSERVATION_INDEX);
    expect(replayMetadata.create._index).toBe(firstMetadata.create._index);
    expect(replayMetadata.create._id).toBe(firstMetadata.create._id);
  });

  it('treats an immutable create conflict as a successful observation replay', async () => {
    const { indexer, bulk } = createIndexer({
      body: {
        errors: true,
        items: [
          {
            create: {
              status: 409,
              error: {
                type: 'version_conflict_engine_exception',
                reason: 'document already exists',
              },
            },
          },
        ],
      },
    });

    const result = await indexer.bulkIndex(
      'org-1',
      [{ finding_hash: 'same-finding', severity: 'high', title: 'Finding' }],
      {
        workflowId: 'workflow-1',
        workflowName: 'Web scan',
        runId: 'run-1',
        scopeId: 'scope-1',
        nodeRef: 'analytics',
        componentId: 'core.analytics.sink',
      },
    );

    const body = bulk.mock.calls[0][0].body as Record<string, unknown>[];
    expect(body[0]).toEqual({
      create: {
        _index: ORG_1_OBSERVATION_INDEX,
        _id: expect.stringMatching(/^fo_v1_[a-f0-9]{64}$/),
      },
    });
    expect(result).toEqual({
      indexName: ORG_1_OBSERVATION_INDEX,
      documentCount: 1,
      succeededCount: 1,
      failedCount: 0,
      degraded: false,
    });
  });

  it('keeps original observation content and timestamps plus newer triage on replay', async () => {
    let storedDocument: Record<string, any> | undefined;
    const bulk = vi.fn().mockImplementation(async ({ body }: { body: Record<string, any>[] }) => {
      if (!storedDocument) {
        storedDocument = structuredClone(body[1]);
        return {
          body: {
            errors: false,
            items: [{ create: { status: 201 } }],
          },
        };
      }
      return {
        body: {
          errors: true,
          items: [
            {
              create: {
                status: 409,
                error: {
                  type: 'version_conflict_engine_exception',
                  reason: 'document already exists',
                },
              },
            },
          ],
        },
      };
    });
    const indexer = new OpenSearchIndexer();
    Object.assign(indexer as unknown as Record<string, unknown>, {
      enabled: true,
      client: { bulk },
      dashboardsUrl: null,
      securityEnabled: false,
    });
    const options = {
      workflowId: 'workflow-1',
      workflowName: 'Web scan',
      runId: 'run-1',
      scopeId: 'scope-1',
      nodeRef: 'analytics',
      componentId: 'core.analytics.sink',
    };

    await indexer.bulkIndex(
      'org-1',
      [
        {
          finding_hash: 'same-finding',
          severity: 'high',
          title: 'Original title',
          description: 'Original evidence',
        },
      ],
      options,
    );
    const originalObservedAt = storedDocument?.observed_at;
    const originalTimestamp = storedDocument?.['@timestamp'];
    storedDocument!.sentris.triage = {
      status: 'fixed',
      updated_at: '2026-07-27T00:00:00.000Z',
      version: 4,
    };

    setSystemTime(new Date('2026-07-28T00:00:00.000Z'));
    await indexer.bulkIndex(
      'org-1',
      [
        {
          finding_hash: 'same-finding',
          severity: 'critical',
          title: 'Replay title',
          description: 'Replay evidence',
        },
      ],
      options,
    );

    expect(storedDocument).toEqual(
      expect.objectContaining({
        title: 'Original title',
        description: 'Original evidence',
        observed_at: originalObservedAt,
        '@timestamp': originalTimestamp,
        sentris: expect.objectContaining({
          triage: {
            status: 'fixed',
            updated_at: '2026-07-27T00:00:00.000Z',
            version: 4,
          },
        }),
      }),
    );
  });

  it('rejects custom suffixes that collide with canonical and legacy findings indexes', async () => {
    const { indexer, bulk } = createIndexer();
    const options = {
      workflowId: 'workflow-1',
      workflowName: 'Custom analytics',
      runId: 'run-1',
      scopeId: 'scope-1',
      nodeRef: 'analytics',
      componentId: 'core.analytics.sink',
    };

    await expect(
      indexer.bulkIndex('org-1', [{ metric: 1 }], {
        ...options,
        indexSuffix: ' OBSERVATIONS-V1 ',
      }),
    ).rejects.toThrow('reserved for canonical findings observations');
    await expect(
      indexer.bulkIndex('org-1', [{ metric: 1 }], {
        ...options,
        indexSuffix: ' CUSTOM-OBSERVATIONS-V1 ',
      }),
    ).rejects.toThrow('reserved for canonical findings observations');
    await expect(
      indexer.bulkIndex('org-1', [{ metric: 1 }], {
        ...options,
        indexSuffix: '2026.07.26',
      }),
    ).rejects.toThrow('reserved for legacy findings indexes');
    expect(bulk).not.toHaveBeenCalled();
  });

  it('keeps explicit custom suffixes as generic analytics instead of hidden findings', async () => {
    const { indexer, bulk } = createIndexer();

    const result = await indexer.bulkIndex(
      'org-1',
      [
        {
          scanner: 'custom-correlator',
          finding_hash: 'generic-row-1',
          severity: 'none',
          custom_metric: 42,
        },
      ],
      {
        workflowId: 'workflow-1',
        workflowName: 'Custom analytics',
        runId: 'run-1',
        scopeId: 'scope-1',
        nodeRef: 'analytics',
        componentId: 'core.analytics.sink',
        indexSuffix: 'custom-metrics',
      },
    );

    const body = bulk.mock.calls[0][0].body as Record<string, unknown>[];
    expect(body[0]).toEqual({
      index: { _index: ORG_1_CUSTOM_METRICS_INDEX },
    });
    expect(body[1]).toEqual(
      expect.objectContaining({
        scanner: 'custom-correlator',
        custom_metric: 42,
        sentris: expect.objectContaining({
          organization_id: 'org-1',
          workflow_id: 'workflow-1',
          run_id: 'run-1',
          scope_id: 'scope-1',
        }),
      }),
    );
    expect(body[1]).not.toHaveProperty('contract');
    expect(body[1]).not.toHaveProperty('finding_id');
    expect(result.indexName).toBe(ORG_1_CUSTOM_METRICS_INDEX);
  });

  it('returns truthful success and failure counts for partial bulk responses', async () => {
    const { indexer } = createIndexer({
      body: {
        errors: true,
        items: [
          { create: { status: 201 } },
          {
            create: {
              status: 400,
              error: { type: 'mapper_parsing_exception', reason: 'bad field' },
            },
          },
        ],
      },
    });

    const result = await indexer.bulkIndex(
      'org-1',
      [
        { finding_hash: 'finding-1', severity: 'high', title: 'Finding 1' },
        { finding_hash: 'finding-2', severity: 'high', title: 'Finding 2' },
      ],
      {
        workflowId: 'workflow-1',
        workflowName: 'Web scan',
        runId: 'run-1',
        scopeId: null,
        nodeRef: 'analytics',
        componentId: 'core.analytics.sink',
      },
    );

    expect(result).toEqual({
      indexName: ORG_1_OBSERVATION_INDEX,
      documentCount: 2,
      succeededCount: 1,
      failedCount: 1,
      degraded: true,
    });
  });

  it.each([
    [
      'missing item result',
      {
        body: {
          errors: false,
          items: [],
        },
      },
    ],
    [
      'extra item result',
      {
        body: {
          errors: false,
          items: [{ create: { status: 201 } }, { create: { status: 201 } }],
        },
      },
    ],
    [
      'missing operation result',
      {
        body: {
          errors: false,
          items: [{}],
        },
      },
    ],
    [
      'wrong operation result',
      {
        body: {
          errors: false,
          items: [{ index: { status: 201 } }],
        },
      },
    ],
    [
      'successful status with an error',
      {
        body: {
          errors: true,
          items: [
            {
              create: {
                status: 201,
                error: { type: 'mapper_parsing_exception', reason: 'contradictory' },
              },
            },
          ],
        },
      },
    ],
    [
      'failure status without an error',
      {
        body: {
          errors: true,
          items: [{ create: { status: 400 } }],
        },
      },
    ],
    [
      'false errors flag with an item failure',
      {
        body: {
          errors: false,
          items: [
            {
              create: {
                status: 400,
                error: { type: 'mapper_parsing_exception', reason: 'bad field' },
              },
            },
          ],
        },
      },
    ],
  ])('rejects a malformed or contradictory bulk response: %s', async (_label, response) => {
    const { indexer } = createIndexer(response);

    await expect(
      indexer.bulkIndex(
        'org-1',
        [{ finding_hash: 'finding-1', severity: 'high', title: 'Finding' }],
        {
          workflowId: 'workflow-1',
          workflowName: 'Web scan',
          runId: 'run-1',
          scopeId: null,
          nodeRef: 'analytics',
          componentId: 'core.analytics.sink',
        },
      ),
    ).rejects.toThrow();
  });

  it('counts a generic analytics 409 as a failure rather than a finding replay', async () => {
    const { indexer } = createIndexer({
      body: {
        errors: true,
        items: [
          {
            index: {
              status: 409,
              error: {
                type: 'version_conflict_engine_exception',
                reason: 'generic indexing conflict',
              },
            },
          },
        ],
      },
    });

    await expect(
      indexer.bulkIndex('org-1', [{ custom_metric: 42 }], {
        workflowId: 'workflow-1',
        workflowName: 'Custom analytics',
        runId: 'run-1',
        scopeId: null,
        nodeRef: 'analytics',
        componentId: 'core.analytics.sink',
        indexSuffix: 'custom-metrics',
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        succeededCount: 0,
        failedCount: 1,
        degraded: true,
      }),
    );
  });
});
