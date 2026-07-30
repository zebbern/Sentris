import { afterEach, describe, expect, it, vi } from 'bun:test';
import { componentRegistry } from '@sentris/component-sdk';

import { finalizeAnalyticsIndexResult } from '../analytics-sink';
import { getOpenSearchIndexer } from '../../../utils/opensearch-indexer';
import { createMockExecutionContext } from '../../../testing/test-utils';

const PARTIAL_RESULT = {
  indexName: 'security-findings-org-1-observations-v1',
  documentCount: 3,
  succeededCount: 2,
  failedCount: 1,
  degraded: true,
};

describe('Analytics Sink bulk result handling', () => {
  const indexer = getOpenSearchIndexer();
  const originalIndexerState = {
    enabled: (indexer as unknown as { enabled: boolean }).enabled,
    client: (indexer as unknown as { client: unknown }).client,
    bulkIndex: indexer.bulkIndex,
  };

  afterEach(() => {
    Object.assign(indexer as unknown as Record<string, unknown>, originalIndexerState);
  });

  it('reports partial indexing truthfully in lenient mode', () => {
    expect(finalizeAnalyticsIndexResult(PARTIAL_RESULT, false)).toEqual({
      indexed: false,
      documentCount: 2,
      indexName: 'security-findings-org-1-observations-v1',
      succeededCount: 2,
      failedCount: 1,
      degraded: true,
    });
  });

  it('throws on any partial bulk failure in strict mode', () => {
    expect(() => finalizeAnalyticsIndexResult(PARTIAL_RESULT, true)).toThrow(
      '1 of 3 documents failed',
    );
  });

  it('reports every received document as degraded when OpenSearch is disabled', async () => {
    Object.assign(indexer as unknown as Record<string, unknown>, {
      enabled: false,
      client: null,
    });
    const component = componentRegistry.get('core.analytics.sink');
    const context = createMockExecutionContext({
      workflowId: 'workflow-1',
      workflowName: 'Web scan',
      organizationId: 'org-1',
    });

    const result = await component!.execute(
      {
        inputs: { input1: [{ title: 'one' }, { title: 'two' }] },
        params: {
          dataInputs: [{ id: 'input1', label: 'Input 1', sourceTag: 'input_1' }],
          failOnError: false,
          assetKeyField: 'auto',
        },
      } as never,
      context,
    );

    expect(result).toEqual({
      indexed: false,
      documentCount: 0,
      indexName: '',
      succeededCount: 0,
      failedCount: 2,
      degraded: true,
    });
  });

  it('reports every received document as degraded when workflow context is missing', async () => {
    Object.assign(indexer as unknown as Record<string, unknown>, {
      enabled: true,
      client: {},
    });
    const component = componentRegistry.get('core.analytics.sink');
    const context = createMockExecutionContext();

    const result = await component!.execute(
      {
        inputs: { input1: [{ title: 'one' }] },
        params: {
          dataInputs: [{ id: 'input1', label: 'Input 1', sourceTag: 'input_1' }],
          failOnError: false,
          assetKeyField: 'auto',
        },
      } as never,
      context,
    );

    expect(result).toEqual({
      indexed: false,
      documentCount: 0,
      indexName: '',
      succeededCount: 0,
      failedCount: 1,
      degraded: true,
    });
  });

  it('reports every document failed in lenient mode when bulk response validation fails', async () => {
    Object.assign(indexer as unknown as Record<string, unknown>, {
      enabled: true,
      client: {},
      bulkIndex: vi.fn().mockRejectedValue(new Error('Malformed OpenSearch bulk response')),
    });
    const component = componentRegistry.get('core.analytics.sink');
    const context = createMockExecutionContext({
      workflowId: 'workflow-1',
      workflowName: 'Web scan',
      organizationId: 'org-1',
    });

    const result = await component!.execute(
      {
        inputs: { input1: [{ title: 'one' }, { title: 'two' }] },
        params: {
          dataInputs: [{ id: 'input1', label: 'Input 1', sourceTag: 'input_1' }],
          failOnError: false,
          assetKeyField: 'auto',
        },
      } as never,
      context,
    );

    expect(result).toEqual({
      indexed: false,
      documentCount: 0,
      indexName: '',
      succeededCount: 0,
      failedCount: 2,
      degraded: true,
    });
  });

  it('throws in strict mode when bulk response validation fails', async () => {
    Object.assign(indexer as unknown as Record<string, unknown>, {
      enabled: true,
      client: {},
      bulkIndex: vi.fn().mockRejectedValue(new Error('Malformed OpenSearch bulk response')),
    });
    const component = componentRegistry.get('core.analytics.sink');
    const context = createMockExecutionContext({
      workflowId: 'workflow-1',
      workflowName: 'Web scan',
      organizationId: 'org-1',
    });

    await expect(
      component!.execute(
        {
          inputs: {
            input1: [
              {
                scanner: 'nuclei',
                finding_hash: 'finding-1',
                severity: 'high',
                title: 'one',
              },
            ],
          },
          params: {
            dataInputs: [{ id: 'input1', label: 'Input 1', sourceTag: 'input_1' }],
            failOnError: true,
            assetKeyField: 'auto',
          },
        } as never,
        context,
      ),
    ).rejects.toThrow('Malformed OpenSearch bulk response');
  });
});
