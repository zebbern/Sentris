import { Client } from '@opensearch-project/opensearch';
import type { IScopedTraceService } from '@sentris/component-sdk';
import {
  FINDING_OBSERVATION_CONTRACT,
  FINDING_OBSERVATION_VERSION,
  FindingObservationV1Schema,
} from '@sentris/shared';
import {
  buildFindingObservationIndexName,
  buildTenantAnalyticsIndexName,
  createFindingObservationId,
} from '@sentris/shared/finding-observation-id';
import { resolveBackendApiBaseUrl } from '../common/backend-url';

interface IndexOptions {
  workflowId: string;
  workflowName: string;
  runId: string;
  scopeId?: string | null;
  nodeRef: string;
  componentId: string;
  assetKeyField?: string;
  indexSuffix?: string;
  trace?: IScopedTraceService;
}

export interface OpenSearchBulkIndexResult {
  indexName: string;
  documentCount: number;
  succeededCount: number;
  failedCount: number;
  degraded: boolean;
}

/**
 * Retry helper with exponential backoff
 * Attempts: 3, delays: 1s, 2s, 4s
 */
async function retryWithBackoff<T>(operation: () => Promise<T>, operationName: string): Promise<T> {
  const maxAttempts = 3;
  const delays = [1000, 2000, 4000]; // milliseconds

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await operation();
    } catch (error: unknown) {
      const isLastAttempt = attempt === maxAttempts - 1;

      if (isLastAttempt) {
        throw error; // Re-throw on last attempt
      }

      const delay = delays[attempt];
      console.warn(
        `[OpenSearchIndexer] ${operationName} failed (attempt ${attempt + 1}/${maxAttempts}), ` +
          `retrying in ${delay}ms...`,
        error,
      );

      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  // This should never be reached, but TypeScript requires it
  throw new Error(`${operationName} failed after ${maxAttempts} attempts`);
}

interface OpenSearchBulkFailureSample {
  type: string;
  reason?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function parseBulkResponse(
  body: unknown,
  expectedOperation: 'create' | 'index',
  expectedItems: number,
): {
  failedCount: number;
  replayCount: number;
  errorSamples: OpenSearchBulkFailureSample[];
} {
  if (!isRecord(body) || typeof body.errors !== 'boolean' || !Array.isArray(body.items)) {
    throw new Error('Malformed OpenSearch bulk response: missing errors flag or item results');
  }
  if (body.items.length !== expectedItems) {
    throw new Error(
      `Malformed OpenSearch bulk response: received ${body.items.length} of ${expectedItems} item results`,
    );
  }

  let failedCount = 0;
  let replayCount = 0;
  let nonSuccessCount = 0;
  const errorSamples: OpenSearchBulkFailureSample[] = [];
  for (const item of body.items) {
    if (
      !isRecord(item) ||
      Object.keys(item).length !== 1 ||
      !Object.hasOwn(item, expectedOperation)
    ) {
      throw new Error(
        `Malformed OpenSearch bulk response: expected one ${expectedOperation} result per document`,
      );
    }
    const result = item[expectedOperation];
    if (!isRecord(result)) {
      throw new Error(`Malformed OpenSearch bulk response: invalid ${expectedOperation} result`);
    }

    const status = result.status;
    const hasError = Object.hasOwn(result, 'error');
    const succeeded = typeof status === 'number' && status >= 200 && status < 300;
    if (!Number.isInteger(status) || (status as number) < 100 || (status as number) > 599) {
      throw new Error('Malformed OpenSearch bulk response: invalid item status');
    }
    if (succeeded) {
      if (hasError) {
        throw new Error('Malformed OpenSearch bulk response: successful item included an error');
      }
      continue;
    }

    nonSuccessCount += 1;
    const error = result.error;
    if (
      !hasError ||
      !isRecord(error) ||
      typeof error.type !== 'string' ||
      error.type.length === 0 ||
      (Object.hasOwn(error, 'reason') && typeof error.reason !== 'string')
    ) {
      throw new Error('Malformed OpenSearch bulk response: failed item omitted a valid error');
    }

    if (
      expectedOperation === 'create' &&
      status === 409 &&
      error.type === 'version_conflict_engine_exception'
    ) {
      replayCount += 1;
      continue;
    }

    failedCount += 1;
    errorSamples.push({
      type: error.type,
      ...(typeof error.reason === 'string' && { reason: error.reason }),
    });
  }

  const itemResultsContainErrors = nonSuccessCount > 0;
  if (body.errors !== itemResultsContainErrors) {
    throw new Error('Malformed OpenSearch bulk response: errors flag contradicts item results');
  }

  return { failedCount, replayCount, errorSamples };
}

// TTL for tenant provisioning cache (1 hour in milliseconds)
const TENANT_CACHE_TTL_MS = 60 * 60 * 1000;

export class OpenSearchIndexer {
  private client: Client | null = null;
  private enabled = false;
  private dashboardsUrl: string | null = null;
  private dashboardsAuth: { username: string; password: string } | null = null;
  private securityEnabled = false;
  private backendUrl: string | null = null;
  private internalServiceToken: string | null = null;

  // Cache of provisioned org IDs with timestamp
  private provisionedOrgs = new Map<string, number>();

  constructor() {
    const url = process.env.OPENSEARCH_URL;
    const username = process.env.OPENSEARCH_USERNAME;
    const password = process.env.OPENSEARCH_PASSWORD;

    // OpenSearch Dashboards URL for index pattern management
    this.dashboardsUrl = process.env.OPENSEARCH_DASHBOARDS_URL || null;
    if (username && password) {
      this.dashboardsAuth = { username, password };
    }

    // Security mode configuration
    this.securityEnabled = process.env.OPENSEARCH_SECURITY_ENABLED === 'true';
    this.backendUrl = resolveBackendApiBaseUrl();
    this.internalServiceToken = process.env.INTERNAL_SERVICE_TOKEN || null;

    if (url) {
      try {
        this.client = new Client({
          node: url,
          ...(username &&
            password && {
              auth: {
                username,
                password,
              },
            }),
          ssl: {
            rejectUnauthorized: process.env.NODE_ENV === 'production',
          },
        });
        this.enabled = true;
        console.log(
          `[OpenSearchIndexer] Client initialized (security enabled: ${this.securityEnabled})`,
        );
      } catch (error: unknown) {
        console.warn('[OpenSearchIndexer] Failed to initialize client:', error);
      }
    } else {
      console.debug('[OpenSearchIndexer] OpenSearch URL not configured, indexing disabled');
    }
  }

  isEnabled(): boolean {
    return this.enabled && this.client !== null;
  }

  /**
   * Ensure canonical observation storage is provisioned before first use.
   * In secured mode the same endpoint also provisions tenant isolation.
   * Caches provisioned orgs with 1-hour TTL to avoid redundant calls.
   * A verified backend rejection returns false so bulk callers can report a
   * truthful degraded result.
   */
  private async ensureTenantProvisioned(orgId: string): Promise<boolean> {
    if (!this.internalServiceToken) {
      console.warn(
        `[OpenSearchIndexer] INTERNAL_SERVICE_TOKEN is unavailable; first-use provisioning skipped for ${orgId}`,
      );
      return true;
    }

    // Check cache
    const cachedTimestamp = this.provisionedOrgs.get(orgId);
    if (cachedTimestamp && Date.now() - cachedTimestamp < TENANT_CACHE_TTL_MS) {
      console.debug(`[OpenSearchIndexer] Tenant already provisioned (cached): ${orgId}`);
      return true;
    }

    // Call backend to provision tenant
    try {
      const url = `${this.backendUrl}/analytics/ensure-tenant`;
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };

      if (this.internalServiceToken) {
        headers['X-Internal-Token'] = this.internalServiceToken;
      }

      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({ organizationId: orgId }),
      });

      if (!response.ok) {
        console.error(
          `[OpenSearchIndexer] Failed to provision tenant ${orgId}: ${response.status} ${response.statusText}`,
        );
        return false;
      }

      const result = (await response.json()) as { success: boolean; message: string };
      if (result.success) {
        // Cache the successful provisioning
        this.provisionedOrgs.set(orgId, Date.now());
        console.log(`[OpenSearchIndexer] Tenant provisioned: ${orgId}`);
      } else {
        console.warn(`[OpenSearchIndexer] Tenant provisioning returned failure: ${result.message}`);
      }

      return result.success;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[OpenSearchIndexer] Error provisioning tenant ${orgId}: ${message}`);
      return false;
    }
  }

  /**
   * Copy source fields without changing their JSON shape. Canonical observation
   * mappings retain arbitrary values in `_source` without dynamically indexing
   * them; custom analytics indexes keep their generic mapping behavior.
   */
  private serializeNestedFields(document: Record<string, any>): Record<string, any> {
    return { ...document };
  }

  /**
   * Build the canonical observation with trusted `sentris` context.
   * Scanner data remains at the root in its original JSON shape.
   */
  private buildFindingObservation(
    document: Record<string, any>,
    options: IndexOptions,
    orgId: string,
    timestamp: string,
    assetKey: string | null,
  ): Record<string, any> {
    const serializedDocument = this.serializeNestedFields(document);
    const observedAt = timestamp;
    const sourceFindingId =
      this.nonEmptyString(document.finding_hash) ??
      this.nonEmptyString(document.finding_id) ??
      this.nonEmptyString(document.id) ??
      this.documentIdentityFallback(document);
    const findingId = createFindingObservationId({
      organizationId: orgId,
      workflowId: options.workflowId,
      runId: options.runId,
      scopeId: options.scopeId ?? null,
      componentId: options.componentId,
      nodeRef: options.nodeRef,
      sourceFindingId,
    });
    const severity = this.normalizeSeverity(document.severity);
    const title =
      this.nonEmptyString(document.title) ??
      this.nonEmptyString(document.name) ??
      this.nonEmptyString(document.finding) ??
      this.nonEmptyString(document.message) ??
      `${this.nonEmptyString(document.scanner) ?? options.componentId} finding`;
    const description =
      this.nonEmptyString(document.description) ??
      this.nonEmptyString(document.finding) ??
      this.nonEmptyString(document.message) ??
      title;
    const scanner = this.nonEmptyString(document.scanner);
    const findingHash = this.nonEmptyString(document.finding_hash);
    const source = Object.prototype.hasOwnProperty.call(document, 'source')
      ? document.source
      : {
          ...(scanner && { scanner }),
          ...(findingHash && { finding_hash: findingHash }),
        };
    const evidence = Object.prototype.hasOwnProperty.call(document, 'evidence')
      ? document.evidence
      : (document.metadata ?? null);

    const observation = {
      ...serializedDocument,
      contract: FINDING_OBSERVATION_CONTRACT,
      schema_version: FINDING_OBSERVATION_VERSION,
      finding_id: findingId,
      observed_at: observedAt,
      severity,
      title,
      description,
      evidence,
      source,
      sentris: {
        organization_id: orgId,
        run_id: options.runId,
        workflow_id: options.workflowId,
        workflow_name: options.workflowName,
        scope_id: options.scopeId ?? null,
        component_id: options.componentId,
        node_ref: options.nodeRef,
        asset_key: assetKey,
        contract_validated: true,
        contract_source_validated: true,
        contract_document_id: findingId,
      },
      '@timestamp': timestamp,
    };

    return FindingObservationV1Schema.parse(observation);
  }

  private buildGenericAnalyticsDocument(
    document: Record<string, any>,
    options: IndexOptions,
    orgId: string,
    timestamp: string,
    assetKey: string | null,
  ): Record<string, any> {
    return {
      ...this.serializeNestedFields(document),
      sentris: {
        organization_id: orgId,
        run_id: options.runId,
        workflow_id: options.workflowId,
        workflow_name: options.workflowName,
        scope_id: options.scopeId ?? null,
        component_id: options.componentId,
        node_ref: options.nodeRef,
        asset_key: assetKey,
      },
      '@timestamp': timestamp,
    };
  }

  async indexDocument(
    orgId: string,
    document: Record<string, any>,
    options: IndexOptions,
  ): Promise<string> {
    if (!this.isEnabled() || !this.client) {
      console.debug('[OpenSearchIndexer] Indexing skipped, client not enabled');
      throw new Error('OpenSearch client not enabled');
    }

    const provisioningVerified = await this.ensureTenantProvisioned(orgId);
    if (!provisioningVerified) {
      throw new Error(
        `OpenSearch first-use provisioning or invariant verification failed for ${orgId}`,
      );
    }

    const indexName = this.buildIndexName(orgId, options.indexSuffix);
    const assetKey = this.detectAssetKey(document, options.assetKeyField);
    const timestamp = new Date().toISOString();

    const isGenericAnalytics = Boolean(options.indexSuffix);
    const enrichedDocument = isGenericAnalytics
      ? this.buildGenericAnalyticsDocument(document, options, orgId, timestamp, assetKey)
      : this.buildFindingObservation(document, options, orgId, timestamp, assetKey);

    try {
      await retryWithBackoff(async () => {
        if (isGenericAnalytics) {
          await this.client!.index({
            index: indexName,
            body: enrichedDocument,
          });
        } else {
          try {
            await this.client!.create({
              index: indexName,
              id: enrichedDocument.finding_id,
              body: enrichedDocument,
            });
          } catch (error) {
            if (!this.isVersionConflict(error)) throw error;
          }
        }
      }, `Index document to ${indexName}`);

      console.debug(`[OpenSearchIndexer] Indexed document to ${indexName}`);

      // Log successful indexing to trace
      if (options.trace) {
        options.trace.record({
          type: 'NODE_PROGRESS',
          level: 'info',
          message: `Successfully indexed 1 document to ${indexName}`,
          data: {
            indexName,
            documentCount: 1,
            assetKey: assetKey ?? undefined,
          },
        });
      }

      return indexName;
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`[OpenSearchIndexer] Failed to index document after retries:`, error);

      // Log indexing error to trace
      if (options.trace) {
        options.trace.record({
          type: 'NODE_PROGRESS',
          level: 'error',
          message: `Failed to index document to ${indexName}`,
          error: errorMessage,
          data: {
            indexName,
            documentCount: 1,
          },
        });
      }

      throw error;
    }
  }

  async bulkIndex(
    orgId: string,
    documents: Record<string, any>[],
    options: IndexOptions,
  ): Promise<OpenSearchBulkIndexResult> {
    if (!this.isEnabled() || !this.client) {
      console.debug('[OpenSearchIndexer] Bulk indexing skipped, client not enabled');
      throw new Error('OpenSearch client not enabled');
    }

    if (documents.length === 0) {
      console.debug('[OpenSearchIndexer] No documents to index');
      return {
        indexName: '',
        documentCount: 0,
        succeededCount: 0,
        failedCount: 0,
        degraded: false,
      };
    }

    const provisioningVerified = await this.ensureTenantProvisioned(orgId);
    if (!provisioningVerified && options.trace) {
      options.trace.record({
        type: 'NODE_PROGRESS',
        level: 'warn',
        message: `OpenSearch first-use provisioning or invariant verification failed for ${orgId}; indexing result will be degraded`,
      });
    }

    const indexName = this.buildIndexName(orgId, options.indexSuffix);
    const isGenericAnalytics = Boolean(options.indexSuffix);

    // Use same timestamp for all documents in this batch
    // (they all came from the same component execution)
    const timestamp = new Date().toISOString();

    // Build bulk operations array
    const bulkOps: any[] = [];
    for (const document of documents) {
      const assetKey = this.detectAssetKey(document, options.assetKeyField);

      const enrichedDocument = isGenericAnalytics
        ? this.buildGenericAnalyticsDocument(document, options, orgId, timestamp, assetKey)
        : this.buildFindingObservation(document, options, orgId, timestamp, assetKey);

      if (isGenericAnalytics) {
        bulkOps.push({ index: { _index: indexName } });
        bulkOps.push(enrichedDocument);
      } else {
        bulkOps.push({
          create: {
            _index: indexName,
            _id: enrichedDocument.finding_id,
          },
        });
        bulkOps.push(enrichedDocument);
      }
    }

    try {
      const response = await retryWithBackoff(async () => {
        return await this.client!.bulk({
          body: bulkOps,
        });
      }, `Bulk index ${documents.length} documents to ${indexName}`);

      const { failedCount, replayCount, errorSamples } = parseBulkResponse(
        response.body,
        isGenericAnalytics ? 'index' : 'create',
        documents.length,
      );
      if (failedCount > 0 || replayCount > 0) {
        if (failedCount > 0) {
          console.warn(
            `[OpenSearchIndexer] Bulk indexing completed with ${failedCount} errors out of ${documents.length} documents`,
          );
          console.warn(
            `[OpenSearchIndexer] Error samples:`,
            JSON.stringify(errorSamples.slice(0, 3), null, 2),
          );
        } else {
          console.debug(
            `[OpenSearchIndexer] Bulk replay kept ${documents.length} existing immutable observations`,
          );
        }

        // Log partial failure to trace
        if (options.trace && failedCount > 0) {
          options.trace.record({
            type: 'NODE_PROGRESS',
            level: 'warn',
            message: `Bulk indexed with ${failedCount} errors out of ${documents.length} documents to ${indexName}`,
            data: {
              indexName,
              documentCount: documents.length,
              errorCount: failedCount,
              errorSamples: errorSamples.slice(0, 3),
            },
          });
        }
      } else {
        console.debug(
          `[OpenSearchIndexer] Bulk indexed ${documents.length} documents to ${indexName}`,
        );

        // Log successful bulk indexing to trace
        if (options.trace) {
          options.trace.record({
            type: 'NODE_PROGRESS',
            level: 'info',
            message: `Successfully bulk indexed ${documents.length} documents to ${indexName}`,
            data: {
              indexName,
              documentCount: documents.length,
            },
          });
        }
      }

      // Refresh index pattern in OpenSearch Dashboards to make new fields visible
      // Skip when security is enabled - patterns are created per-tenant by the provisioning service
      if (!this.securityEnabled) {
        await this.refreshIndexPattern();
      }

      return {
        indexName,
        documentCount: documents.length,
        succeededCount: Math.max(0, documents.length - failedCount),
        failedCount,
        degraded: !provisioningVerified || failedCount > 0,
      };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`[OpenSearchIndexer] Failed to bulk index after retries:`, error);

      // Log bulk indexing error to trace
      if (options.trace) {
        options.trace.record({
          type: 'NODE_PROGRESS',
          level: 'error',
          message: `Failed to bulk index ${documents.length} documents to ${indexName}`,
          error: errorMessage,
          data: {
            indexName,
            documentCount: documents.length,
          },
        });
      }

      throw error;
    }
  }

  /**
   * Refresh the index pattern in OpenSearch Dashboards to make new fields visible.
   * Two-step process:
   * 1. Get fresh field mappings from OpenSearch via _fields_for_wildcard API
   * 2. Update the saved index pattern object with the new fields
   * Fails silently if Dashboards URL is not configured or refresh fails.
   */
  private async refreshIndexPattern(): Promise<void> {
    if (!this.dashboardsUrl) {
      console.debug(
        '[OpenSearchIndexer] Dashboards URL not configured, skipping index pattern refresh',
      );
      return;
    }

    const indexPatternId = 'security-findings-*';

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'osd-xsrf': 'true', // Required by OpenSearch Dashboards
      };

      // Add basic auth if credentials are available
      if (this.dashboardsAuth) {
        const authString = Buffer.from(
          `${this.dashboardsAuth.username}:${this.dashboardsAuth.password}`,
        ).toString('base64');
        headers['Authorization'] = `Basic ${authString}`;
      }

      // Step 1: Get fresh fields from OpenSearch via Dashboards API
      const fieldsUrl = `${this.dashboardsUrl}/api/index_patterns/_fields_for_wildcard?pattern=${encodeURIComponent(indexPatternId)}&meta_fields=_source&meta_fields=_id&meta_fields=_type&meta_fields=_index&meta_fields=_score`;
      const fieldsResponse = await fetch(fieldsUrl, { method: 'GET', headers });

      if (!fieldsResponse.ok) {
        console.warn(`[OpenSearchIndexer] Failed to get fresh fields: ${fieldsResponse.status}`);
        return;
      }

      const fieldsData = (await fieldsResponse.json()) as { fields?: unknown[] };
      const freshFields = fieldsData.fields || [];

      // Step 2: Get current index pattern to preserve other attributes
      const patternUrl = `${this.dashboardsUrl}/api/saved_objects/index-pattern/${encodeURIComponent(indexPatternId)}`;
      const patternResponse = await fetch(patternUrl, { method: 'GET', headers });

      if (!patternResponse.ok) {
        console.warn(`[OpenSearchIndexer] Index pattern not found: ${patternResponse.status}`);
        return;
      }

      const patternData = (await patternResponse.json()) as {
        attributes: { title: string; timeFieldName: string };
        version: string;
      };

      // Step 3: Update the index pattern with fresh fields
      // Include version for optimistic concurrency control (matches UI behavior)
      const updateResponse = await fetch(patternUrl, {
        method: 'PUT',
        headers,
        body: JSON.stringify({
          attributes: {
            title: patternData.attributes.title,
            timeFieldName: patternData.attributes.timeFieldName,
            fields: JSON.stringify(freshFields),
          },
          version: patternData.version,
        }),
      });

      if (updateResponse.ok) {
        console.debug(
          `[OpenSearchIndexer] Index pattern fields refreshed (${freshFields.length} fields)`,
        );
      } else {
        console.warn(
          `[OpenSearchIndexer] Failed to update index pattern: ${updateResponse.status}`,
        );
      }
    } catch (error: unknown) {
      // Non-critical failure - log but don't throw
      console.warn('[OpenSearchIndexer] Failed to refresh index pattern:', error);
    }
  }

  private buildIndexName(orgId: string, indexSuffix?: string): string {
    if (!indexSuffix) {
      return buildFindingObservationIndexName(orgId);
    }
    return buildTenantAnalyticsIndexName(orgId, indexSuffix);
  }

  private isVersionConflict(value: unknown): boolean {
    if (!value || typeof value !== 'object') return false;
    const record = value as {
      status?: number;
      statusCode?: number;
      error?: { type?: string };
      meta?: { statusCode?: number; body?: { error?: { type?: string } } };
    };
    const status = record.status ?? record.statusCode ?? record.meta?.statusCode;
    const type = record.error?.type ?? record.meta?.body?.error?.type;
    return status === 409 && type === 'version_conflict_engine_exception';
  }

  private detectAssetKey(document: Record<string, any>, explicitField?: string): string | null {
    // If explicit field is provided, use it
    if (explicitField && document[explicitField]) {
      return String(document[explicitField]);
    }

    // Auto-detect from common fields
    const assetFields = [
      'asset_key',
      'host',
      'domain',
      'subdomain',
      'url',
      'ip',
      'asset',
      'target',
    ];

    for (const field of assetFields) {
      if (document[field]) {
        return String(document[field]);
      }
    }

    return null;
  }

  private nonEmptyString(value: unknown): string | null {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
  }

  private normalizeSeverity(
    value: unknown,
  ): 'critical' | 'high' | 'medium' | 'low' | 'info' | 'none' {
    const normalized = this.nonEmptyString(value)?.toLowerCase();
    if (
      normalized === 'critical' ||
      normalized === 'high' ||
      normalized === 'medium' ||
      normalized === 'low' ||
      normalized === 'info' ||
      normalized === 'none'
    ) {
      return normalized;
    }
    return 'info';
  }

  private documentIdentityFallback(document: Record<string, any>): Record<string, unknown> {
    const {
      sentris: _sentris,
      contract: _contract,
      schema_version: _schemaVersion,
      finding_id: _findingId,
      observed_at: _observedAt,
      '@timestamp': _timestamp,
      ...sourceDocument
    } = document;
    return sourceDocument;
  }
}

// Singleton instance
let indexerInstance: OpenSearchIndexer | null = null;

export function getOpenSearchIndexer(): OpenSearchIndexer {
  if (!indexerInstance) {
    indexerInstance = new OpenSearchIndexer();
  }
  return indexerInstance;
}
