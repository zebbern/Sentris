import { Injectable, Logger } from '@nestjs/common';
import { OpenSearchClient } from '../config/opensearch.client';

interface IndexDocumentOptions {
  workflowId: string;
  workflowName: string;
  runId: string;
  nodeRef: string;
  componentId: string;
  assetKeyField?: string;
  indexSuffix?: string;
}

type BulkIndexOptions = IndexDocumentOptions;

@Injectable()
export class SecurityAnalyticsService {
  private readonly logger = new Logger(SecurityAnalyticsService.name);

  constructor(private readonly openSearchClient: OpenSearchClient) {}

  /**
   * Check if the OpenSearch client is available for queries.
   */
  isAvailable(): boolean {
    return this.openSearchClient.isClientEnabled();
  }

  /**
   * Index a single document to OpenSearch with metadata
   */
  async indexDocument(
    orgId: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- OpenSearch SDK requires untyped payloads
    document: Record<string, any>,
    options: IndexDocumentOptions,
  ): Promise<void> {
    if (!this.openSearchClient.isClientEnabled()) {
      this.logger.debug('OpenSearch client not enabled, skipping indexing');
      return;
    }

    const client = this.openSearchClient.getClient();
    if (!client) {
      this.logger.warn('OpenSearch client is null, skipping indexing');
      return;
    }

    try {
      const indexName = this.buildIndexName(orgId, options.indexSuffix);
      const assetKey = this.detectAssetKey(document, options.assetKeyField);

      const enrichedDocument = {
        ...document,
        '@timestamp': new Date().toISOString(),
        workflow_id: options.workflowId,
        workflow_name: options.workflowName,
        run_id: options.runId,
        node_ref: options.nodeRef,
        component_id: options.componentId,
        ...(assetKey && { asset_key: assetKey }),
      };

      await client.index({
        index: indexName,
        body: enrichedDocument,
      });

      this.logger.debug(`Indexed document to ${indexName} for workflow ${options.workflowId}`);
    } catch (error) {
      this.logger.error(`Failed to index document: ${error}`);
      throw error;
    }
  }

  /**
   * Bulk index multiple documents to OpenSearch
   */
  async bulkIndex(
    orgId: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- OpenSearch SDK requires untyped payloads
    documents: Record<string, any>[],
    options: BulkIndexOptions,
  ): Promise<void> {
    if (!this.openSearchClient.isClientEnabled()) {
      this.logger.debug('OpenSearch client not enabled, skipping bulk indexing');
      return;
    }

    const client = this.openSearchClient.getClient();
    if (!client) {
      this.logger.warn('OpenSearch client is null, skipping bulk indexing');
      return;
    }

    if (documents.length === 0) {
      this.logger.debug('No documents to index, skipping bulk indexing');
      return;
    }

    try {
      const indexName = this.buildIndexName(orgId, options.indexSuffix);

      // Build bulk operations array
      const bulkOps: Record<string, unknown>[] = [];
      for (const document of documents) {
        const assetKey = this.detectAssetKey(document, options.assetKeyField);

        const enrichedDocument = {
          ...document,
          '@timestamp': new Date().toISOString(),
          workflow_id: options.workflowId,
          workflow_name: options.workflowName,
          run_id: options.runId,
          node_ref: options.nodeRef,
          component_id: options.componentId,
          ...(assetKey && { asset_key: assetKey }),
        };

        bulkOps.push({ index: { _index: indexName } });
        bulkOps.push(enrichedDocument);
      }

      const response = await client.bulk({
        body: bulkOps,
      });

      if (response.body.errors) {
        const errorCount = response.body.items.filter(
          (item: { index?: { error?: unknown } }) => item.index?.error,
        ).length;
        this.logger.warn(
          `Bulk indexing completed with ${errorCount} errors out of ${documents.length} documents`,
        );
      } else {
        this.logger.debug(
          `Bulk indexed ${documents.length} documents to ${indexName} for workflow ${options.workflowId}`,
        );
      }
    } catch (error) {
      this.logger.error(`Failed to bulk index documents: ${error}`);
      throw error;
    }
  }

  /**
   * Build the index name with org scoping and date-based rotation
   * Format: security-findings-{orgId}-{YYYY.MM.DD}
   */
  private buildIndexName(orgId: string, indexSuffix?: string): string {
    const date = new Date();
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');

    const suffix = indexSuffix || `${year}.${month}.${day}`;
    return `security-findings-${orgId}-${suffix}`;
  }

  /**
   * Query analytics data for an organization
   */
  async query(
    orgId: string,
    options: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- OpenSearch DSL query is untyped
      query?: Record<string, any>;
      size?: number;
      from?: number;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- OpenSearch aggregation is untyped
      aggs?: Record<string, any>;
    },
  ): Promise<{
    total: number;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- OpenSearch hit source is untyped
    hits: { _id: string; _source: Record<string, any>; _score?: number }[];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- OpenSearch aggregation result is untyped
    aggregations?: Record<string, any>;
  }> {
    if (!this.openSearchClient.isClientEnabled()) {
      this.logger.warn('OpenSearch client not enabled, returning empty results');
      return { total: 0, hits: [], aggregations: undefined };
    }

    const client = this.openSearchClient.getClient();
    if (!client) {
      this.logger.warn('OpenSearch client is null, returning empty results');
      return { total: 0, hits: [], aggregations: undefined };
    }

    try {
      // Build index pattern for org: security-findings-{orgId}-*
      const indexPattern = `security-findings-${orgId}-*`;

      // Execute the search
      const response = await client.search({
        index: indexPattern,
        body: {
          query: options.query || { match_all: {} },
          size: options.size ?? 10,
          from: options.from ?? 0,
          ...(options.aggs && { aggs: options.aggs }),
        },
      });

      // Extract results from OpenSearch response
      const total: number =
        typeof response.body.hits.total === 'object'
          ? (response.body.hits.total.value ?? 0)
          : (response.body.hits.total ?? 0);

      const hits = response.body.hits.hits.map(
        (hit: { _id: string; _source?: Record<string, unknown>; _score?: string | number }) => ({
          _id: hit._id as string,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any -- OpenSearch hit source is untyped
          _source: (hit._source ?? {}) as Record<string, any>,
          ...(hit._score !== undefined && { _score: Number(hit._score) }),
        }),
      );

      return {
        total,
        hits,
        aggregations: response.body.aggregations,
      };
    } catch (error) {
      this.logger.error(`Failed to query analytics data: ${error}`);
      throw error;
    }
  }

  /**
   * Auto-detect asset key from common fields
   * Priority: host > domain > subdomain > url > ip > asset > target
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- OpenSearch document is untyped
  private detectAssetKey(document: Record<string, any>, explicitField?: string): string | null {
    // If explicit field is provided, use it
    if (explicitField && document[explicitField]) {
      return String(document[explicitField]);
    }

    if (document.asset_key) {
      return String(document.asset_key);
    }

    // Auto-detect from common fields
    const assetFields = ['host', 'domain', 'subdomain', 'url', 'ip', 'asset', 'target'];

    for (const field of assetFields) {
      if (document[field]) {
        return String(document[field]);
      }
    }

    return null;
  }
}
