import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { type FindingDataAvailability } from '@sentris/shared';
import {
  buildAllFindingObservationIndexPattern,
  buildFindingObservationIndexName,
  buildTenantAnalyticsIndexName,
  buildTenantAnalyticsIndexPattern,
} from '@sentris/shared/finding-observation-id';
import { OpenSearchClient } from '../config/opensearch.client';
import { findingsUnavailable } from './findings-unavailable';
import {
  decodeFindingPageCursor,
  encodeFindingPageCursor,
  findingQueryDigest,
  type FindingSearchAfterValue,
} from './finding-pagination';
import {
  buildFindingProjectionControlIndexName,
  FINDING_STORAGE_ID_INTEGRITY_WATERMARK_ID,
  reconcileFindingStorageIdIntegrity as reconcileStorageIdIntegrity,
  type FindingStorageIdIntegrityResult,
} from './finding-storage-integrity';
import {
  FINDINGS_CONTRACT_CLASSIFICATION_VERSION,
  FINDINGS_FINAL_INGEST_PIPELINE_CONTENT_HASH,
  FINDINGS_FINAL_INGEST_PIPELINE_ID,
  FINDINGS_INDEX_TEMPLATE_VERSION,
  FINDINGS_OBSERVATION_MAPPING_CONTENT_HASH,
  FINDINGS_OBSERVATION_SCHEMA_VERSION,
  buildOrganizationFindingsIndexTemplateName,
  getOrganizationFindingsIndexTemplateContentHash,
  getOrganizationFindingsStorageInvariantFingerprint,
} from './findings-index-template';
import { parseExactOpenSearchTotal } from './finding-query';

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

export interface FindingTriageProjection {
  status: string;
  assigneeUserId: string | null;
  severityOverride: string | null;
  notes: string | null;
  updatedAt: string;
  version: number;
}

export interface FindingTriageProjectionWatermarkInput {
  reconciledThrough: string;
  completedAt: string;
  checked: number;
  repaired: number;
  failed: number;
}

export interface FindingTriageProjectionWatermark extends FindingTriageProjectionWatermarkInput {
  observationIndexUuid: string;
  matchesCurrentObservationIndex: boolean;
}

const FINDING_TRIAGE_WATERMARK_ID = 'triage-reconciliation-watermark-v1';
const FINDING_CURSOR_KEEP_ALIVE = '10m';
const FINDING_CURSOR_TTL_MS = 10 * 60 * 1_000;

export interface FindingStorageIdIntegrityWatermark extends FindingStorageIdIntegrityResult {
  observationIndexUuid: string;
  matchesCurrentObservationIndex: boolean;
  matchesCurrentInvariant: boolean;
  finalPipeline: string;
  finalPipelineContentHash: string;
  indexTemplateName: string;
  indexTemplateContentHash: string;
  mappingContentHash: string;
  invariantFingerprint: string;
  templateVersion: number;
  schemaVersion: number;
  classificationVersion: number;
}

export interface FindingScanOptions {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- OpenSearch DSL query is untyped
  query: Record<string, any>;
  sortOrder: 'asc' | 'desc';
  limit?: number;
  pageSize?: number;
}

export interface FindingPageOptions {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- OpenSearch DSL query is untyped
  query: Record<string, any>;
  pageSize: number;
  sortOrder: 'asc' | 'desc';
  cursor?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- OpenSearch aggregation DSL is untyped here
  aggs?: Record<string, any>;
}

export interface AnalyticsQueryOptions {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- OpenSearch DSL query is untyped
  query?: Record<string, any>;
  size?: number;
  from?: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- OpenSearch aggregation is untyped
  aggs?: Record<string, any>;
  sort?: Record<string, 'asc' | 'desc'>[];
}

export interface AnalyticsQueryResult {
  total: number;
  availability: FindingDataAvailability;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- OpenSearch hit source is untyped
  hits: { _id: string; _source: Record<string, any>; _score?: number }[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- OpenSearch aggregation result is untyped
  aggregations?: Record<string, any>;
}

export interface FindingObservationOrganizationCursor {
  indexName: string;
  organizationId: string;
}

export interface FindingObservationOrganizationPage {
  organizationIds: string[];
  afterKey: FindingObservationOrganizationCursor | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

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

  /** Build the stable per-organization observation index name. */
  private buildIndexName(orgId: string, indexSuffix?: string): string {
    return indexSuffix
      ? buildTenantAnalyticsIndexName(orgId, indexSuffix)
      : buildFindingObservationIndexName(orgId);
  }

  /**
   * Query analytics data for an organization
   */
  async query(orgId: string, options: AnalyticsQueryOptions): Promise<AnalyticsQueryResult> {
    return this.queryIndex(buildTenantAnalyticsIndexPattern(orgId), options, 'analytics query');
  }

  async queryFindings(
    orgId: string,
    options: AnalyticsQueryOptions,
  ): Promise<AnalyticsQueryResult> {
    return this.queryIndex(buildFindingObservationIndexName(orgId), options, 'findings query');
  }

  async listFindingObservationOrganizationsPage(
    afterKey: FindingObservationOrganizationCursor | undefined,
    requestedPageSize: number,
  ): Promise<FindingObservationOrganizationPage> {
    if (!this.openSearchClient.isClientEnabled()) {
      throw findingsUnavailable('Analytics service is not available');
    }
    const client = this.openSearchClient.getClient();
    if (!client) {
      throw findingsUnavailable('Analytics service is not available');
    }

    const pageSize = Math.max(1, Math.min(Math.trunc(requestedPageSize), 100));
    const response = await client.search({
      index: buildAllFindingObservationIndexPattern(),
      allow_no_indices: true,
      body: {
        size: 0,
        track_total_hits: false,
        aggs: {
          sentris_observation_organizations: {
            composite: {
              size: pageSize,
              sources: [
                { index_name: { terms: { field: '_index', order: 'asc' } } },
                {
                  organization_id: {
                    terms: { field: 'sentris.organization_id', order: 'asc' },
                  },
                },
              ],
              ...(afterKey && {
                after: {
                  index_name: afterKey.indexName,
                  organization_id: afterKey.organizationId,
                },
              }),
            },
          },
        },
      },
    });
    this.assertCompleteSearchResponse(response.body, 'finding organization discovery');

    const aggregations = (response.body as { aggregations?: unknown }).aggregations;
    const aggregation = isRecord(aggregations)
      ? aggregations.sentris_observation_organizations
      : undefined;
    if (!isRecord(aggregation) || !Array.isArray(aggregation.buckets)) {
      throw findingsUnavailable('OpenSearch returned malformed finding organization discovery');
    }

    const organizationIds: string[] = [];
    for (const bucket of aggregation.buckets) {
      const key = isRecord(bucket) && isRecord(bucket.key) ? bucket.key : undefined;
      const indexName = key?.index_name;
      const organizationId = key?.organization_id;
      if (typeof indexName !== 'string' || typeof organizationId !== 'string') {
        throw findingsUnavailable('OpenSearch returned a malformed finding organization bucket');
      }
      if (buildFindingObservationIndexName(organizationId) !== indexName) {
        throw findingsUnavailable(
          `Observation index ${indexName} does not match its organization identity`,
        );
      }
      organizationIds.push(organizationId);
    }

    const rawAfterKey = aggregation.after_key;
    let nextAfterKey: FindingObservationOrganizationCursor | null = null;
    if (rawAfterKey !== undefined) {
      if (
        !isRecord(rawAfterKey) ||
        typeof rawAfterKey.index_name !== 'string' ||
        typeof rawAfterKey.organization_id !== 'string'
      ) {
        throw findingsUnavailable(
          'OpenSearch returned a malformed finding organization continuation key',
        );
      }
      if (
        buildFindingObservationIndexName(rawAfterKey.organization_id) !== rawAfterKey.index_name
      ) {
        throw findingsUnavailable(
          'OpenSearch returned a finding organization continuation key with invalid ownership',
        );
      }
      nextAfterKey = {
        indexName: rawAfterKey.index_name,
        organizationId: rawAfterKey.organization_id,
      };
    }
    return { organizationIds, afterKey: nextAfterKey };
  }

  private async queryIndex(
    index: string,
    options: AnalyticsQueryOptions,
    operation: string,
  ): Promise<AnalyticsQueryResult> {
    if (!this.openSearchClient.isClientEnabled()) {
      this.logger.warn('OpenSearch client not enabled');
      throw findingsUnavailable('Analytics service is not available');
    }

    const client = this.openSearchClient.getClient();
    if (!client) {
      this.logger.warn('OpenSearch client is null');
      throw findingsUnavailable('Analytics service is not available');
    }

    try {
      // Execute the search
      const response = await client.search({
        index,
        body: {
          query: options.query || { match_all: {} },
          size: options.size ?? 10,
          from: options.from ?? 0,
          ...(options.sort && { sort: options.sort }),
          track_total_hits: true,
          ...(options.aggs && { aggs: options.aggs }),
        },
      });
      this.assertCompleteSearchResponse(response.body, operation);

      // Extract results from OpenSearch response
      const total = parseExactOpenSearchTotal(response.body.hits.total);

      const rawHits = response.body.hits.hits as {
        _id?: string;
        _source?: Record<string, unknown>;
        _score?: string | number;
      }[];

      const hits = rawHits.map((hit) => ({
        _id: hit._id ?? '',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- OpenSearch hit source is untyped
        _source: (hit._source ?? {}) as Record<string, any>,
        ...(hit._score !== undefined && { _score: Number(hit._score) }),
      }));

      return {
        total,
        hits,
        aggregations: response.body.aggregations,
        availability: 'available',
      };
    } catch (error) {
      this.logger.error(`Failed to query analytics data: ${error}`);
      if (error instanceof ServiceUnavailableException) {
        throw error;
      }
      throw findingsUnavailable('Analytics service is not available');
    }
  }

  /**
   * Project authoritative PostgreSQL triage state into the finding read model.
   * The Painless guard makes duplicate and out-of-order outbox deliveries safe.
   */
  async projectFindingTriage(
    orgId: string,
    findingOpensearchId: string,
    projection: FindingTriageProjection,
  ): Promise<void> {
    if (!this.openSearchClient.isClientEnabled()) {
      throw findingsUnavailable('Analytics service is not available');
    }

    const client = this.openSearchClient.getClient();
    if (!client) {
      throw findingsUnavailable('Analytics service is not available');
    }

    const triage = {
      status: projection.status,
      assignee_user_id: projection.assigneeUserId,
      severity_override: projection.severityOverride,
      notes: projection.notes,
      updated_at: projection.updatedAt,
      version: projection.version,
    };

    try {
      const response = await client.updateByQuery({
        index: buildFindingObservationIndexName(orgId),
        conflicts: 'proceed',
        refresh: false,
        body: {
          query: { ids: { values: [findingOpensearchId] } },
          script: {
            lang: 'painless',
            params: { triage },
            source: [
              "if (!ctx._source.containsKey('sentris') || ctx._source.sentris == null) {",
              '  ctx._source.sentris = new HashMap();',
              '}',
              'def current = ctx._source.sentris.triage;',
              'if (current == null || current.version == null || current.version < params.triage.version) {',
              '  ctx._source.sentris.triage = params.triage;',
              '} else {',
              "  ctx.op = 'noop';",
              '}',
            ].join('\n'),
          },
        },
      });
      const body = response.body as {
        timed_out?: boolean;
        total?: number;
        version_conflicts?: number;
        failures?: unknown[];
      };
      if (
        body.timed_out === true ||
        (body.total ?? 0) === 0 ||
        (body.version_conflicts ?? 0) > 0 ||
        (body.failures?.length ?? 0) > 0
      ) {
        throw new Error(
          `Projection incomplete: total=${body.total ?? 0}, conflicts=${body.version_conflicts ?? 0}, failures=${body.failures?.length ?? 0}`,
        );
      }
    } catch (error) {
      this.logger.error(
        `Failed to project triage for ${findingOpensearchId} in organization ${orgId}: ${error}`,
      );
      if (error instanceof ServiceUnavailableException) throw error;
      throw findingsUnavailable('Finding triage projection is unavailable');
    }
  }

  async writeFindingTriageProjectionWatermark(
    orgId: string,
    watermark: FindingTriageProjectionWatermarkInput,
  ): Promise<void> {
    if (!this.openSearchClient.isClientEnabled()) {
      throw findingsUnavailable('Analytics service is not available');
    }
    const client = this.openSearchClient.getClient();
    if (!client) {
      throw findingsUnavailable('Analytics service is not available');
    }

    try {
      const observationIndex = buildFindingObservationIndexName(orgId);
      const observationIndexUuid = await this.getObservationIndexUuid(client, observationIndex);
      await client.index({
        index: this.buildFindingProjectionControlIndexName(orgId),
        id: FINDING_TRIAGE_WATERMARK_ID,
        refresh: 'wait_for',
        body: {
          organization_id: orgId,
          observation_index_uuid: observationIndexUuid,
          reconciled_through: watermark.reconciledThrough,
          completed_at: watermark.completedAt,
          checked: watermark.checked,
          repaired: watermark.repaired,
          failed: watermark.failed,
        },
      });
    } catch (error) {
      this.logger.error(
        `Failed to write finding triage projection watermark for ${orgId}: ${error}`,
      );
      if (error instanceof ServiceUnavailableException) throw error;
      throw findingsUnavailable('Finding triage projection watermark is unavailable');
    }
  }

  async getFindingTriageProjectionWatermark(
    orgId: string,
  ): Promise<FindingTriageProjectionWatermark | null> {
    if (!this.openSearchClient.isClientEnabled()) {
      throw findingsUnavailable('Analytics service is not available');
    }
    const client = this.openSearchClient.getClient();
    if (!client) {
      throw findingsUnavailable('Analytics service is not available');
    }

    try {
      const observationIndex = buildFindingObservationIndexName(orgId);
      const [response, currentObservationIndexUuid] = await Promise.all([
        client.get({
          index: this.buildFindingProjectionControlIndexName(orgId),
          id: FINDING_TRIAGE_WATERMARK_ID,
        }),
        this.getObservationIndexUuid(client, observationIndex),
      ]);
      const source = response.body._source as Record<string, unknown> | undefined;
      if (!source) return null;

      const observationIndexUuid = source.observation_index_uuid;
      const reconciledThrough = source.reconciled_through;
      const completedAt = source.completed_at;
      const checked = source.checked;
      const repaired = source.repaired;
      const failed = source.failed;
      if (
        typeof observationIndexUuid !== 'string' ||
        typeof reconciledThrough !== 'string' ||
        typeof completedAt !== 'string' ||
        !Number.isInteger(checked) ||
        !Number.isInteger(repaired) ||
        !Number.isInteger(failed)
      ) {
        throw new Error('Projection watermark document is malformed');
      }

      return {
        observationIndexUuid,
        matchesCurrentObservationIndex: observationIndexUuid === currentObservationIndexUuid,
        reconciledThrough,
        completedAt,
        checked: checked as number,
        repaired: repaired as number,
        failed: failed as number,
      };
    } catch (error) {
      if (this.isNotFoundError(error)) return null;
      this.logger.error(
        `Failed to read finding triage projection watermark for ${orgId}: ${error}`,
      );
      if (error instanceof ServiceUnavailableException) throw error;
      throw findingsUnavailable('Finding triage projection watermark is unavailable');
    }
  }

  async reconcileFindingStorageIdIntegrity(
    orgId: string,
    pageSize?: number,
  ): Promise<FindingStorageIdIntegrityResult> {
    if (!this.openSearchClient.isClientEnabled()) {
      throw findingsUnavailable('Analytics service is not available');
    }
    const client = this.openSearchClient.getClient();
    if (!client) {
      throw findingsUnavailable('Analytics service is not available');
    }

    try {
      return await reconcileStorageIdIntegrity(client as never, orgId, pageSize);
    } catch (error) {
      this.logger.error(
        `Failed to reconcile finding storage IDs for organization ${orgId}: ${error}`,
      );
      if (error instanceof ServiceUnavailableException) throw error;
      throw findingsUnavailable('Finding storage ID integrity is unavailable');
    }
  }

  async getFindingStorageIdIntegrityWatermark(
    orgId: string,
  ): Promise<FindingStorageIdIntegrityWatermark | null> {
    if (!this.openSearchClient.isClientEnabled()) {
      throw findingsUnavailable('Analytics service is not available');
    }
    const client = this.openSearchClient.getClient();
    if (!client) {
      throw findingsUnavailable('Analytics service is not available');
    }

    try {
      const observationIndex = buildFindingObservationIndexName(orgId);
      const [responseResult, currentSettingsResult] = await Promise.allSettled([
        client.get({
          index: buildFindingProjectionControlIndexName(orgId),
          id: FINDING_STORAGE_ID_INTEGRITY_WATERMARK_ID,
        }),
        this.getObservationIndexSettings(client, observationIndex),
      ]);
      if (responseResult.status === 'rejected') throw responseResult.reason;
      const response = responseResult.value;
      const source = response.body._source as Record<string, unknown> | undefined;
      if (!source) return null;
      if (source.verification_state !== 'verified') return null;
      if (currentSettingsResult.status === 'rejected') throw currentSettingsResult.reason;
      const currentObservationIndexSettings = currentSettingsResult.value;

      const observationIndexUuid = source.observation_index_uuid;
      const completedAt = source.completed_at;
      const finalPipeline = source.final_pipeline;
      const finalPipelineContentHash = source.final_pipeline_content_hash;
      const indexTemplateName = source.index_template_name;
      const indexTemplateContentHash = source.index_template_content_hash;
      const mappingContentHash = source.mapping_content_hash;
      const invariantFingerprint = source.invariant_fingerprint;
      const templateVersion = source.template_version;
      const schemaVersion = source.schema_version;
      const classificationVersion = source.classification_version;
      const checked = source.checked;
      const mismatched = source.mismatched;
      if (
        typeof observationIndexUuid !== 'string' ||
        typeof completedAt !== 'string' ||
        typeof finalPipeline !== 'string' ||
        typeof finalPipelineContentHash !== 'string' ||
        typeof indexTemplateName !== 'string' ||
        typeof indexTemplateContentHash !== 'string' ||
        typeof mappingContentHash !== 'string' ||
        typeof invariantFingerprint !== 'string' ||
        !Number.isInteger(templateVersion) ||
        !Number.isInteger(schemaVersion) ||
        !Number.isInteger(classificationVersion) ||
        !Number.isInteger(checked) ||
        !Number.isInteger(mismatched)
      ) {
        throw new Error('Storage ID integrity watermark document is malformed');
      }

      const matchesCurrentObservationIndex =
        observationIndexUuid === currentObservationIndexSettings.uuid;
      return {
        observationIndexUuid,
        matchesCurrentObservationIndex,
        matchesCurrentInvariant:
          matchesCurrentObservationIndex &&
          currentObservationIndexSettings.finalPipeline === FINDINGS_FINAL_INGEST_PIPELINE_ID &&
          finalPipeline === FINDINGS_FINAL_INGEST_PIPELINE_ID &&
          finalPipelineContentHash === FINDINGS_FINAL_INGEST_PIPELINE_CONTENT_HASH &&
          indexTemplateName === buildOrganizationFindingsIndexTemplateName(orgId) &&
          indexTemplateContentHash === getOrganizationFindingsIndexTemplateContentHash(orgId) &&
          mappingContentHash === FINDINGS_OBSERVATION_MAPPING_CONTENT_HASH &&
          invariantFingerprint === getOrganizationFindingsStorageInvariantFingerprint(orgId) &&
          templateVersion === FINDINGS_INDEX_TEMPLATE_VERSION &&
          schemaVersion === FINDINGS_OBSERVATION_SCHEMA_VERSION &&
          classificationVersion === FINDINGS_CONTRACT_CLASSIFICATION_VERSION,
        finalPipeline,
        finalPipelineContentHash,
        indexTemplateName,
        indexTemplateContentHash,
        mappingContentHash,
        invariantFingerprint,
        templateVersion: templateVersion as number,
        schemaVersion: schemaVersion as number,
        classificationVersion: classificationVersion as number,
        completedAt,
        checked: checked as number,
        mismatched: mismatched as number,
      };
    } catch (error) {
      if (this.isNotFoundError(error)) return null;
      this.logger.error(
        `Failed to read finding storage ID integrity watermark for ${orgId}: ${error}`,
      );
      if (error instanceof ServiceUnavailableException) throw error;
      throw findingsUnavailable('Finding storage ID integrity watermark is unavailable');
    }
  }

  /**
   * Return a consistent deep export using OpenSearch PIT + search_after.
   * An omitted limit means the complete matching snapshot; an explicit limit is
   * caller-selected and never silently truncated.
   */
  async scanFindings(
    orgId: string,
    options: FindingScanOptions,
  ): Promise<{ _id: string; _source: Record<string, unknown>; _score?: number }[]> {
    if (!this.openSearchClient.isClientEnabled()) {
      throw findingsUnavailable('Analytics service is not available');
    }

    const client = this.openSearchClient.getClient();
    if (!client) {
      throw findingsUnavailable('Analytics service is not available');
    }

    const pageSize = Math.max(1, Math.min(Math.trunc(options.pageSize ?? 1_000), 5_000));
    let pitId: string | undefined;
    const hits: { _id: string; _source: Record<string, unknown>; _score?: number }[] = [];
    let searchAfter: (boolean | null | undefined | number | string)[] | undefined;

    try {
      const created = await client.createPit({
        index: [buildFindingObservationIndexName(orgId)],
        keep_alive: '2m',
        allow_partial_pit_creation: false,
      });
      pitId = created.body.pit_id;
      if (!pitId) {
        throw new Error('OpenSearch did not return a PIT identifier');
      }

      while (options.limit === undefined || hits.length < options.limit) {
        const remaining =
          options.limit === undefined ? pageSize : Math.min(pageSize, options.limit - hits.length);
        // OpenSearch emits null sort values for legacy rows even though its
        // TypeScript FieldValue declaration omits null.
        const response = (await client.search({
          body: {
            query: options.query,
            size: remaining,
            pit: { id: pitId, keep_alive: '2m' },
            sort: [{ '@timestamp': { order: options.sortOrder } }, { _doc: { order: 'asc' } }],
            track_total_hits: false,
            ...(searchAfter && { search_after: searchAfter }),
          },
        } as never)) as {
          body: {
            pit_id?: string;
            timed_out?: boolean;
            _shards?: { failed?: number };
            hits: {
              hits: {
                _id?: string;
                _source?: Record<string, unknown>;
                _score?: string | number;
                sort?: (boolean | null | undefined | number | string)[];
              }[];
            };
          };
        };

        this.assertCompleteSearchResponse(response.body, 'findings export page');
        pitId = (response.body as { pit_id?: string }).pit_id ?? pitId;
        const page = response.body.hits.hits;
        if (page.length === 0) break;

        for (const hit of page) {
          hits.push({
            _id: hit._id ?? '',
            _source: hit._source ?? {},
            ...(hit._score !== undefined && { _score: Number(hit._score) }),
          });
        }

        if (page.length < remaining) break;
        searchAfter = page.at(-1)?.sort;
        if (!searchAfter || searchAfter.length === 0) {
          throw new Error('OpenSearch omitted sort values required for complete findings export');
        }
      }

      return hits;
    } catch (error) {
      this.logger.error(`Failed to scan findings for organization ${orgId}: ${error}`);
      if (error instanceof ServiceUnavailableException) throw error;
      throw findingsUnavailable('Findings export is unavailable');
    } finally {
      if (pitId) {
        try {
          await client.deletePit({ body: { pit_id: [pitId] } });
        } catch (error) {
          this.logger.warn(`Failed to close findings export PIT: ${error}`);
        }
      }
    }
  }

  async queryFindingPage(
    orgId: string,
    options: FindingPageOptions,
  ): Promise<{
    total: number;
    availability: FindingDataAvailability;
    hits: { _id: string; _source: Record<string, unknown>; _score?: number }[];
    currentCursor: string;
    nextCursor: string | null;
    aggregations?: Record<string, unknown>;
  }> {
    if (!this.openSearchClient.isClientEnabled()) {
      throw findingsUnavailable('Analytics service is not available');
    }
    const client = this.openSearchClient.getClient();
    if (!client) {
      throw findingsUnavailable('Analytics service is not available');
    }

    const pageSize = Math.max(1, Math.min(Math.trunc(options.pageSize), 100));
    const queryDigest = findingQueryDigest({
      query: options.query,
      pageSize,
      sortOrder: options.sortOrder,
    });
    const cursorSecret = this.getFindingCursorSecret();
    let pitId: string | undefined;
    let searchAfter: FindingSearchAfterValue[] = [];
    let keepPitOpen = false;

    try {
      if (options.cursor) {
        const decoded = decodeFindingPageCursor(options.cursor, {
          organizationId: orgId,
          queryDigest,
          secret: cursorSecret,
        });
        pitId = decoded.pitId;
        searchAfter = decoded.searchAfter;
      } else {
        const created = await client.createPit({
          index: [buildFindingObservationIndexName(orgId)],
          keep_alive: FINDING_CURSOR_KEEP_ALIVE,
          allow_partial_pit_creation: false,
        });
        pitId = created.body.pit_id;
        if (!pitId) throw new Error('OpenSearch did not return a PIT identifier');
      }

      const currentCursor = encodeFindingPageCursor(
        {
          organizationId: orgId,
          queryDigest,
          pitId,
          searchAfter,
          expiresAt: Date.now() + FINDING_CURSOR_TTL_MS,
        },
        cursorSecret,
      );
      // OpenSearch emits null sort values for legacy rows even though its
      // TypeScript FieldValue declaration omits null.
      const response = (await client.search({
        body: {
          query: options.query,
          size: pageSize + 1,
          pit: { id: pitId, keep_alive: FINDING_CURSOR_KEEP_ALIVE },
          sort: [{ '@timestamp': { order: options.sortOrder } }, { _doc: { order: 'asc' } }],
          track_total_hits: true,
          ...(options.aggs && { aggs: options.aggs }),
          ...(searchAfter.length > 0 && { search_after: searchAfter }),
        },
      } as never)) as {
        body: {
          pit_id?: string;
          timed_out?: boolean;
          _shards?: { failed?: number };
          hits: {
            total?: number | { value?: number; relation?: string };
            hits: {
              _id?: string;
              _source?: Record<string, unknown>;
              _score?: string | number;
              sort?: FindingSearchAfterValue[];
            }[];
          };
          aggregations?: Record<string, unknown>;
        };
      };
      this.assertCompleteSearchResponse(response.body, 'findings cursor page');
      const rawHits = response.body.hits.hits;
      const hasMore = rawHits.length > pageSize;
      const page = rawHits.slice(0, pageSize);
      const total = parseExactOpenSearchTotal(response.body.hits.total);
      let nextCursor: string | null = null;
      if (hasMore) {
        const nextSearchAfter = page.at(-1)?.sort;
        if (!nextSearchAfter || nextSearchAfter.length === 0) {
          throw new Error('OpenSearch omitted sort values required for cursor pagination');
        }
        nextCursor = encodeFindingPageCursor(
          {
            organizationId: orgId,
            queryDigest,
            pitId,
            searchAfter: nextSearchAfter,
            expiresAt: Date.now() + FINDING_CURSOR_TTL_MS,
          },
          cursorSecret,
        );
      }
      // Every returned page has a signed cursor, including the start position.
      // Keep the PIT alive for its bounded TTL so all recorded history remains
      // revisitable even when the first or current page is terminal.
      keepPitOpen = true;

      return {
        total,
        availability: 'available',
        hits: page.map((hit) => ({
          _id: hit._id ?? '',
          _source: hit._source ?? {},
          ...(hit._score !== undefined && { _score: Number(hit._score) }),
        })),
        currentCursor,
        nextCursor,
        aggregations: response.body.aggregations,
      };
    } catch (error) {
      this.logger.error(`Failed to query findings cursor page for organization ${orgId}: ${error}`);
      if (error instanceof ServiceUnavailableException) throw error;
      throw error;
    } finally {
      if (pitId && !keepPitOpen) {
        try {
          await client.deletePit({ body: { pit_id: [pitId] } });
        } catch (error) {
          this.logger.warn(`Failed to close findings list PIT: ${error}`);
        }
      }
    }
  }

  async getFindingTriageProjectionVersions(
    orgId: string,
    findingOpensearchIds: string[],
  ): Promise<Map<string, number>> {
    if (findingOpensearchIds.length === 0) return new Map();
    if (!this.openSearchClient.isClientEnabled()) {
      throw findingsUnavailable('Analytics service is not available');
    }
    const client = this.openSearchClient.getClient();
    if (!client) {
      throw findingsUnavailable('Analytics service is not available');
    }

    try {
      const response = await client.search({
        index: buildFindingObservationIndexName(orgId),
        body: {
          query: { ids: { values: findingOpensearchIds } },
          size: findingOpensearchIds.length,
          _source: ['sentris.triage.version'],
          track_total_hits: false,
        },
      });
      this.assertCompleteSearchResponse(response.body, 'triage projection watermark query');
      const versions = new Map<string, number>();
      const hits = response.body.hits.hits as {
        _id?: string;
        _source?: { sentris?: { triage?: { version?: unknown } } };
      }[];
      for (const hit of hits) {
        const version = hit._source?.sentris?.triage?.version;
        if (!hit._id || typeof version !== 'number' || !Number.isInteger(version)) continue;
        versions.set(hit._id, Math.max(versions.get(hit._id) ?? 0, version));
      }
      return versions;
    } catch (error) {
      this.logger.error(`Failed to read finding triage projection versions: ${error}`);
      if (error instanceof ServiceUnavailableException) throw error;
      throw findingsUnavailable('Finding triage projection is unavailable');
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

  private assertCompleteSearchResponse(
    body: { timed_out?: boolean; _shards?: { failed?: number } },
    operation: string,
  ): void {
    const failedShards = body._shards?.failed ?? 0;
    if (body.timed_out === true || failedShards > 0) {
      throw findingsUnavailable(
        `${operation} returned a partial response (timed_out=${body.timed_out === true}, failed_shards=${failedShards})`,
      );
    }
  }

  private getFindingCursorSecret(): string {
    const configured = process.env.SESSION_SECRET || process.env.SECRET_STORE_MASTER_KEY;
    if (configured) return configured;
    if (process.env.NODE_ENV === 'production') {
      throw findingsUnavailable('Findings cursor signing is not configured');
    }
    return 'sentris-local-findings-cursor-v1';
  }

  private buildFindingProjectionControlIndexName(orgId: string): string {
    return buildFindingProjectionControlIndexName(orgId);
  }

  private async getObservationIndexUuid(
    client: NonNullable<ReturnType<OpenSearchClient['getClient']>>,
    index: string,
  ): Promise<string> {
    return (await this.getObservationIndexSettings(client, index)).uuid;
  }

  private async getObservationIndexSettings(
    client: NonNullable<ReturnType<OpenSearchClient['getClient']>>,
    index: string,
  ): Promise<{ uuid: string; finalPipeline: string | null }> {
    const response = await client.indices.getSettings({ index });
    const body = response.body as Record<
      string,
      { settings?: { index?: { uuid?: unknown; final_pipeline?: unknown } } }
    >;
    const indexSettings = body[index]?.settings?.index;
    const uuid = indexSettings?.uuid;
    if (typeof uuid !== 'string' || uuid.length === 0) {
      throw new Error(`OpenSearch did not return an index UUID for ${index}`);
    }
    return {
      uuid,
      finalPipeline:
        typeof indexSettings?.final_pipeline === 'string' ? indexSettings.final_pipeline : null,
    };
  }

  private isNotFoundError(error: unknown): boolean {
    if (!error || typeof error !== 'object') return false;
    const candidate = error as {
      statusCode?: number;
      meta?: { statusCode?: number; body?: { found?: boolean } };
      body?: { found?: boolean };
    };
    return (
      candidate.statusCode === 404 ||
      candidate.meta?.statusCode === 404 ||
      candidate.meta?.body?.found === false ||
      candidate.body?.found === false
    );
  }
}
