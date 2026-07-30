import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  buildFindingObservationIndexName,
  buildFindingObservationIndexPattern,
  buildFindingOrganizationIndexKey,
} from '@sentris/shared/finding-observation-id';
import {
  FINDINGS_FINAL_INGEST_PIPELINE_ID,
  FINDINGS_FINAL_INGEST_PIPELINE_CONTENT_HASH,
  FINDINGS_INDEX_PROPERTIES,
  buildFindingsFinalIngestPipeline,
  buildOrganizationFindingsIndexTemplate,
  buildOrganizationFindingsIndexTemplateName,
  getOrganizationFindingsIndexTemplateContentHash,
  hashFindingsIndexTemplateInvariant,
  hashFindingsMappingInvariant,
  hashFindingsPipelineInvariant,
  normalizeFindingsIndexSettings,
} from './findings-index-template';

const MAX_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 1000;
const DEFAULT_FETCH_TIMEOUT_MS = 5_000;
export const OPENSEARCH_TENANT_PROVISIONING_TIMEOUT_MS = 80_000;

export async function fetchWithAttemptTimeout<T = Response>(
  fetchImpl: typeof fetch,
  url: string,
  options: RequestInit,
  timeoutMs: number,
  consume?: (response: Response, signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const timeoutController = new AbortController();
  const timer = setTimeout(
    () =>
      timeoutController.abort(
        new DOMException(`OpenSearch fetch attempt exceeded ${timeoutMs}ms`, 'TimeoutError'),
      ),
    timeoutMs,
  );
  const signal = options.signal
    ? AbortSignal.any([options.signal, timeoutController.signal])
    : timeoutController.signal;
  try {
    const response = await fetchImpl(url, { ...options, signal });
    signal.throwIfAborted();
    if (consume) {
      const value = await consume(response, signal);
      signal.throwIfAborted();
      return value;
    }
    await response.arrayBuffer();
    signal.throwIfAborted();
    return response as T;
  } finally {
    clearTimeout(timer);
  }
}

export async function delayWithAbort(ms: number, signal?: AbortSignal | null): Promise<void> {
  signal?.throwIfAborted();
  await new Promise<void>((resolveDelay, rejectDelay) => {
    const handleAbort = () => {
      clearTimeout(timer);
      rejectDelay(signal?.reason);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', handleAbort);
      resolveDelay();
    }, ms);
    signal?.addEventListener('abort', handleAbort, { once: true });
  });
}

/**
 * OpenSearch Tenant Service
 *
 * Handles dynamic tenant provisioning for multi-tenant analytics isolation.
 * Creates OpenSearch Security tenants, roles, role mappings, index templates,
 * seed indices, and index patterns for new organizations.
 *
 * This service is idempotent - safe to call multiple times for the same org.
 * Observation storage is provisioned in every mode. OpenSearch Security and
 * tenant-scoped Dashboards resources are conditional on security being enabled.
 */
@Injectable()
export class OpenSearchTenantService {
  private readonly logger = new Logger(OpenSearchTenantService.name);
  private readonly securityEnabled: boolean;
  private readonly opensearchUrl: string;
  private readonly dashboardsUrl: string;
  private readonly adminUsername: string;
  private readonly adminPassword: string;
  private readonly fetchTimeoutMs: number;

  constructor(private readonly configService: ConfigService) {
    this.securityEnabled = this.configService.get<string>('OPENSEARCH_SECURITY_ENABLED') === 'true';
    this.opensearchUrl =
      this.configService.get<string>('OPENSEARCH_URL') || 'http://opensearch:9200';
    this.dashboardsUrl =
      this.configService.get<string>('OPENSEARCH_DASHBOARDS_URL') ||
      'http://opensearch-dashboards:5601';
    this.adminUsername = this.configService.get<string>('OPENSEARCH_ADMIN_USERNAME') || 'admin';
    this.adminPassword = this.configService.get<string>('OPENSEARCH_ADMIN_PASSWORD') || '';
    this.fetchTimeoutMs =
      this.configService.get<number>('OPENSEARCH_TENANT_FETCH_TIMEOUT_MS') ??
      DEFAULT_FETCH_TIMEOUT_MS;

    this.logger.log(
      `OpenSearch tenant service initialized (security: ${this.securityEnabled}, url: ${this.opensearchUrl})`,
    );
  }

  /**
   * Creates Basic Auth header for OpenSearch API calls.
   */
  private getAuthHeader(): string {
    return `Basic ${Buffer.from(`${this.adminUsername}:${this.adminPassword}`).toString('base64')}`;
  }

  /**
   * Fetch wrapper with retry logic for transient connection errors.
   * Bun's fetch can fail with various messages (ConnectionRefused, "typo in url",
   * "Unable to connect") during concurrent request bursts. Retry all fetch-level
   * errors (not HTTP errors) with exponential backoff.
   */
  private async fetchWithRetry<T = Response>(
    url: string,
    options: RequestInit,
    label: string,
    consume?: (response: Response, signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      options.signal?.throwIfAborted();
      try {
        const response = await fetchWithAttemptTimeout(
          fetch,
          url,
          options,
          this.fetchTimeoutMs,
          consume,
        );
        options.signal?.throwIfAborted();
        return response;
      } catch (error: unknown) {
        if (options.signal?.aborted) throw error;
        if (attempt === MAX_RETRIES) {
          throw error;
        }

        const delay = RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1);
        const errMsg = error instanceof Error ? error.message : String(error);
        this.logger.warn(
          `${label}: fetch failed (attempt ${attempt}/${MAX_RETRIES}): ${errMsg}. Retrying in ${delay}ms`,
        );
        await delayWithAbort(delay, options.signal);
      }
    }
    // Unreachable, but TypeScript needs it
    throw new Error(`${label}: exhausted retries`);
  }

  /**
   * Ensures all tenant resources exist for the given organization.
   * Creates: tenant, role, role mapping, index template, seed index, index pattern.
   *
   * This method is idempotent - safe to call multiple times.
   * Returns true if all resources were created/verified successfully.
   */
  async ensureTenantExists(orgId: string, signal?: AbortSignal): Promise<boolean> {
    signal?.throwIfAborted();
    let organizationKey: string;
    try {
      organizationKey = buildFindingOrganizationIndexKey(orgId);
    } catch {
      this.logger.warn('Cannot provision OpenSearch resources without an organization ID');
      return false;
    }

    this.logger.log(`Provisioning OpenSearch resources for organization key: ${organizationKey}`);

    try {
      if (this.securityEnabled) {
        // Brief delay to let the nginx auth_request burst settle before
        // making outbound connections (Bun's fetch can fail during bursts)
        await delayWithAbort(500, signal);

        await this.createTenant(organizationKey, signal);
        signal?.throwIfAborted();
        await this.createCustomerRole(organizationKey, signal);
        signal?.throwIfAborted();
        await this.createRoleMapping(organizationKey, signal);
        signal?.throwIfAborted();
      }

      // The data plane is mandatory even in trusted-local mode. The global
      // observation template is only a bootstrap fallback; first use installs
      // the immutable pipeline and exact per-organization template.
      await this.createFinalIngestPipeline(signal);
      signal?.throwIfAborted();
      await this.createIndexTemplate(orgId, signal);
      signal?.throwIfAborted();
      await this.createSeedIndex(orgId, signal);
      signal?.throwIfAborted();
      await this.verifyObservationStorage(orgId, signal);
      signal?.throwIfAborted();

      if (this.securityEnabled) {
        await this.createIndexPattern(orgId, organizationKey, signal);
        signal?.throwIfAborted();
      }

      this.logger.log(
        `OpenSearch resources provisioned successfully: ${organizationKey} (security: ${this.securityEnabled})`,
      );
      return true;
    } catch (error: unknown) {
      if (signal?.aborted) signal.throwIfAborted();
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to provision tenant ${organizationKey}: ${message}`);
      return false;
    }
  }

  /**
   * Installs the content-addressed final pipeline used by every canonical
   * observation index. PUT is intentional: its immutable ID is derived from
   * the exact body, so this is idempotent and repairs a missing installation.
   */
  private async createFinalIngestPipeline(signal?: AbortSignal): Promise<void> {
    const url = `${this.opensearchUrl}/_ingest/pipeline/${FINDINGS_FINAL_INGEST_PIPELINE_ID}`;
    const response = await this.fetchWithRetry(
      url,
      {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: this.getAuthHeader(),
        },
        body: JSON.stringify(buildFindingsFinalIngestPipeline()),
        signal,
      },
      `createFinalIngestPipeline(${FINDINGS_FINAL_INGEST_PIPELINE_ID})`,
    );

    if (!response.ok) {
      throw new Error(
        `Failed to create final ingest pipeline: ${response.status} ${response.statusText}`,
      );
    }

    this.logger.debug(
      `Final ingest pipeline created/verified: ${FINDINGS_FINAL_INGEST_PIPELINE_ID}`,
    );
  }

  /**
   * Read back every installed storage invariant before reporting first-use
   * provisioning success. This catches a mutated pipeline/template, a stale
   * pre-existing index, and OpenSearch accepting a request without applying the
   * expected mapping.
   */
  private async verifyObservationStorage(orgId: string, signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted();
    const indexName = buildFindingObservationIndexName(orgId);
    const templateName = buildOrganizationFindingsIndexTemplateName(orgId);
    const [pipelines, templates, settings, mappings] = await Promise.all([
      this.getOpenSearchJson(
        `${this.opensearchUrl}/_ingest/pipeline/${FINDINGS_FINAL_INGEST_PIPELINE_ID}`,
        `verifyFinalIngestPipeline(${FINDINGS_FINAL_INGEST_PIPELINE_ID})`,
        signal,
      ),
      this.getOpenSearchJson(
        `${this.opensearchUrl}/_index_template/${templateName}`,
        `verifyIndexTemplate(${templateName})`,
        signal,
      ),
      this.getOpenSearchJson(
        `${this.opensearchUrl}/${indexName}/_settings`,
        `verifyIndexSettings(${indexName})`,
        signal,
      ),
      this.getOpenSearchJson(
        `${this.opensearchUrl}/${indexName}/_mapping`,
        `verifyIndexMapping(${indexName})`,
        signal,
      ),
    ]);
    signal?.throwIfAborted();

    const installedPipeline = pipelines[FINDINGS_FINAL_INGEST_PIPELINE_ID];
    if (
      !installedPipeline ||
      hashFindingsPipelineInvariant(installedPipeline) !==
        FINDINGS_FINAL_INGEST_PIPELINE_CONTENT_HASH
    ) {
      throw new Error('Installed findings final pipeline content does not match its immutable ID');
    }

    const indexTemplates = templates.index_templates;
    const installedTemplate = Array.isArray(indexTemplates)
      ? (
          indexTemplates.find(
            (candidate) => this.isRecord(candidate) && candidate.name === templateName,
          ) as Record<string, unknown> | undefined
        )?.index_template
      : undefined;
    if (
      !installedTemplate ||
      hashFindingsIndexTemplateInvariant(installedTemplate) !==
        getOrganizationFindingsIndexTemplateContentHash(orgId)
    ) {
      throw new Error('Installed findings observation template content does not match its name');
    }

    const installedIndexSettings = normalizeFindingsIndexSettings(
      this.asRecord(settings[indexName])?.settings,
    );
    if (installedIndexSettings?.['index.final_pipeline'] !== FINDINGS_FINAL_INGEST_PIPELINE_ID) {
      throw new Error(
        `Observation index ${indexName} is not protected by ${FINDINGS_FINAL_INGEST_PIPELINE_ID}`,
      );
    }

    const installedMappings = this.asRecord(this.asRecord(mappings[indexName])?.mappings);
    const expectedMappings = buildOrganizationFindingsIndexTemplate(orgId).template.mappings;
    if (
      !installedMappings ||
      hashFindingsMappingInvariant(installedMappings) !==
        hashFindingsMappingInvariant(expectedMappings)
    ) {
      throw new Error('Installed findings observation mapping does not match the contract');
    }

    this.logger.debug(`Observation storage invariants verified: ${indexName}`);
  }

  private async getOpenSearchJson(
    url: string,
    label: string,
    signal?: AbortSignal,
  ): Promise<Record<string, unknown>> {
    const result = await this.fetchWithRetry(
      url,
      {
        method: 'GET',
        headers: {
          Authorization: this.getAuthHeader(),
        },
        signal,
      },
      label,
      async (response, attemptSignal) => {
        if (!response.ok) return { response, body: undefined };
        const body: unknown = await response.json();
        attemptSignal.throwIfAborted();
        return { response, body };
      },
    );
    const { response, body } = result;
    if (!response.ok) {
      throw new Error(`${label} failed: ${response.status} ${response.statusText}`);
    }
    signal?.throwIfAborted();
    if (!this.isRecord(body)) {
      throw new Error(`${label} returned a malformed response`);
    }
    return body;
  }

  private asRecord(value: unknown): Record<string, unknown> | undefined {
    return this.isRecord(value) ? value : undefined;
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  /**
   * Creates a tenant in OpenSearch Security.
   */
  private async createTenant(orgId: string, signal?: AbortSignal): Promise<void> {
    const url = `${this.opensearchUrl}/_plugins/_security/api/tenants/${orgId}`;

    const response = await this.fetchWithRetry(
      url,
      {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: this.getAuthHeader(),
        },
        body: JSON.stringify({
          description: `Tenant for organization ${orgId}`,
        }),
        signal,
      },
      `createTenant(${orgId})`,
    );

    // 200 = created, 409 = already exists (both are OK)
    if (!response.ok && response.status !== 409) {
      throw new Error(`Failed to create tenant: ${response.status} ${response.statusText}`);
    }

    this.logger.debug(`Tenant created/verified: ${orgId}`);
  }

  /**
   * Creates a read-only customer role for the organization.
   * Grants read-only access to security findings indices, plus the minimum
   * Dashboards/Notifications permissions required for tenant-scoped UI usage.
   */
  private async createCustomerRole(orgId: string, signal?: AbortSignal): Promise<void> {
    const roleName = `customer_${orgId}_ro`;
    const url = `${this.opensearchUrl}/_plugins/_security/api/roles/${roleName}`;
    const tenantSavedObjectsPattern = `.kibana_*_${orgId.replace(/[^a-z0-9]/g, '')}*`;

    const roleDefinition = {
      cluster_permissions: [
        'cluster_composite_ops_ro',
        // Required for Dashboards saved objects (bulk writes to .kibana_* tenant indices)
        'indices:data/write/bulk',
        // Alerting: monitor CRUD, execution, alerts, and destinations (legacy endpoints)
        'cluster:admin/opendistro/alerting/monitor/get',
        'cluster:admin/opendistro/alerting/monitor/search',
        'cluster:admin/opendistro/alerting/monitor/write',
        'cluster:admin/opendistro/alerting/monitor/execute',
        'cluster:admin/opendistro/alerting/alerts/get',
        'cluster:admin/opendistro/alerting/alerts/ack',
        'cluster:admin/opendistro/alerting/destination/get',
        'cluster:admin/opendistro/alerting/destination/write',
        'cluster:admin/opendistro/alerting/destination/delete',
        // Notifications plugin (OpenSearch 2.x): channel features + config CRUD
        'cluster:admin/opensearch/notifications/features',
        'cluster:admin/opensearch/notifications/configs/get',
        'cluster:admin/opensearch/notifications/configs/create',
        'cluster:admin/opensearch/notifications/configs/update',
        'cluster:admin/opensearch/notifications/configs/delete',
      ],
      index_permissions: [
        {
          index_patterns: [`security-findings-${orgId}-*`],
          allowed_actions: ['read', 'indices:data/read/*'],
        },
        {
          // Tenant-scoped Dashboards saved objects index alias/index
          index_patterns: [tenantSavedObjectsPattern],
          allowed_actions: [
            'read',
            'write',
            'create_index',
            'indices:data/read/*',
            'indices:data/write/*',
            'indices:admin/mapping/put',
          ],
        },
      ],
      tenant_permissions: [
        {
          tenant_patterns: [orgId],
          allowed_actions: ['kibana_all_write'],
        },
      ],
    };

    const response = await this.fetchWithRetry(
      url,
      {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: this.getAuthHeader(),
        },
        body: JSON.stringify(roleDefinition),
        signal,
      },
      `createCustomerRole(${orgId})`,
    );

    if (!response.ok && response.status !== 409) {
      throw new Error(`Failed to create role: ${response.status} ${response.statusText}`);
    }

    this.logger.debug(`Role created/verified: ${roleName}`);
  }

  /**
   * Creates a role mapping for the customer role.
   * Maps the role name to backend_roles so nginx proxy auth works.
   */
  private async createRoleMapping(orgId: string, signal?: AbortSignal): Promise<void> {
    const roleName = `customer_${orgId}_ro`;
    const url = `${this.opensearchUrl}/_plugins/_security/api/rolesmapping/${roleName}`;

    const mappingDefinition = {
      backend_roles: [roleName],
      description: `Role mapping for ${orgId} read-only access`,
    };

    const response = await this.fetchWithRetry(
      url,
      {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: this.getAuthHeader(),
        },
        body: JSON.stringify(mappingDefinition),
        signal,
      },
      `createRoleMapping(${orgId})`,
    );

    if (!response.ok && response.status !== 409) {
      throw new Error(`Failed to create role mapping: ${response.status} ${response.statusText}`);
    }

    this.logger.debug(`Role mapping created/verified: ${roleName}`);
  }

  /**
   * Creates an index template so all future security-findings-{orgId}-* indices
   * get proper field mappings automatically.
   */
  private async createIndexTemplate(orgId: string, signal?: AbortSignal): Promise<void> {
    const templateName = buildOrganizationFindingsIndexTemplateName(orgId);
    const url = `${this.opensearchUrl}/_index_template/${templateName}`;

    const templateDefinition = buildOrganizationFindingsIndexTemplate(orgId);

    const response = await this.fetchWithRetry(
      url,
      {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: this.getAuthHeader(),
        },
        body: JSON.stringify(templateDefinition),
        signal,
      },
      `createIndexTemplate(${orgId})`,
    );

    if (!response.ok) {
      throw new Error(`Failed to create index template: ${response.status} ${response.statusText}`);
    }

    this.logger.debug(`Index template created/verified: ${templateName}`);
  }

  /**
   * Creates a seed index with explicit mappings so the Dashboards index pattern
   * can resolve fields (especially @timestamp) before any real data is ingested.
   */
  private async createSeedIndex(orgId: string, signal?: AbortSignal): Promise<void> {
    const indexName = buildFindingObservationIndexName(orgId);
    const url = `${this.opensearchUrl}/${indexName}`;

    const response = await this.fetchWithRetry(
      url,
      {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: this.getAuthHeader(),
        },
        body: JSON.stringify({
          settings: {
            'index.final_pipeline': FINDINGS_FINAL_INGEST_PIPELINE_ID,
          },
          mappings: {
            dynamic: false,
            properties: FINDINGS_INDEX_PROPERTIES,
          },
        }),
        signal,
      },
      `createSeedIndex(${orgId})`,
    );

    // 200 = created, 400 with "already exists" = OK
    if (!response.ok && response.status !== 400) {
      throw new Error(`Failed to create seed index: ${response.status} ${response.statusText}`);
    }

    this.logger.debug(`Seed index created/verified: ${indexName}`);
  }

  /**
   * Creates an index pattern in OpenSearch Dashboards for this tenant.
   */
  private async createIndexPattern(
    orgId: string,
    organizationKey: string,
    signal?: AbortSignal,
  ): Promise<void> {
    const patternId = buildFindingObservationIndexPattern(orgId);
    const url = `${this.dashboardsUrl}/analytics/api/saved_objects/index-pattern/${encodeURIComponent(patternId)}`;

    const result = await this.fetchWithRetry(
      url,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'osd-xsrf': 'true',
          securitytenant: organizationKey, // Create in tenant's namespace
          'x-proxy-user': this.adminUsername, // Required for Dashboards proxy auth mode
          'x-proxy-roles': 'platform_admin',
          'x-forwarded-for': '127.0.0.1', // Required for proxy auth trust chain
        },
        body: JSON.stringify({
          attributes: {
            title: patternId,
            timeFieldName: '@timestamp',
          },
        }),
        signal,
      },
      `createIndexPattern(${orgId})`,
      async (response, attemptSignal) => {
        const errorBody =
          response.ok || response.status === 409 ? '' : await response.text().catch(() => '');
        attemptSignal.throwIfAborted();
        return { response, errorBody };
      },
    );
    const { response, errorBody } = result;

    // 200 = created, 409 = already exists (both are OK)
    if (!response.ok && response.status !== 409) {
      signal?.throwIfAborted();
      throw new Error(
        `Failed to create index pattern: ${response.status} ${response.statusText} - ${errorBody}`,
      );
    }

    this.logger.debug(`Index pattern created/verified: ${patternId}`);
  }

  /**
   * Check if security mode is enabled.
   */
  isSecurityEnabled(): boolean {
    return this.securityEnabled;
  }
}
