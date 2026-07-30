import {
  buildFindingObservationIndexName,
  buildFindingOrganizationIndexKey,
} from '@sentris/shared/finding-observation-id';

import {
  classifyFindingSourceContract,
  classifyFindingStorageContract,
  type FindingSchemaCompatibility,
} from './finding-query';
import {
  FINDINGS_CONTRACT_CLASSIFICATION_FIELD,
  FINDINGS_CONTRACT_CLASSIFICATION_VERSION,
  FINDINGS_CONTRACT_VALIDATION_VERSION_FIELD,
  FINDINGS_FINAL_INGEST_PIPELINE_ID,
  FINDINGS_FINAL_INGEST_PIPELINE_CONTENT_HASH,
  FINDINGS_INDEX_TEMPLATE_VERSION,
  FINDINGS_NORMALIZED_SEVERITY_FIELD,
  FINDINGS_OBSERVATION_MAPPING_CONTENT_HASH,
  FINDINGS_OBSERVATION_SCHEMA_VERSION,
  buildOrganizationFindingsIndexTemplate,
  buildOrganizationFindingsIndexTemplateName,
  getOrganizationFindingsIndexTemplateContentHash,
  getOrganizationFindingsStorageInvariantFingerprint,
  hashFindingsIndexTemplateInvariant,
  hashFindingsMappingInvariant,
  hashFindingsPipelineInvariant,
  normalizeFindingsIndexSettings,
} from './findings-index-template';

export const FINDING_STORAGE_ID_INTEGRITY_WATERMARK_ID =
  'storage-id-integrity-watermark-v1' as const;

const DEFAULT_STORAGE_INTEGRITY_PAGE_SIZE = 1_000;
const MAX_STORAGE_INTEGRITY_PAGE_SIZE = 5_000;
const MAX_STORAGE_INTEGRITY_ATTEMPTS = 3;

const STORAGE_INTEGRITY_SOURCE_FIELDS = [
  'contract',
  'schema_version',
  'finding_id',
  'observed_at',
  '@timestamp',
  'severity',
  'title',
  'description',
  'evidence',
  'source',
  'sentris.organization_id',
  'sentris.workflow_id',
  'sentris.workflow_name',
  'sentris.run_id',
  'sentris.scope_id',
  'sentris.component_id',
  'sentris.node_ref',
  'sentris.asset_key',
  'sentris.contract_validated',
  'sentris.contract_source_validated',
  'sentris.contract_document_id',
  FINDINGS_CONTRACT_CLASSIFICATION_FIELD,
  FINDINGS_CONTRACT_VALIDATION_VERSION_FIELD,
  FINDINGS_NORMALIZED_SEVERITY_FIELD,
] as const;

const BACKFILL_CLASSIFICATION_SCRIPT = [
  `ctx._source['${FINDINGS_CONTRACT_CLASSIFICATION_FIELD}'] = params.classification;`,
  `ctx._source['${FINDINGS_CONTRACT_VALIDATION_VERSION_FIELD}'] = params.validationVersion;`,
  `ctx._source['${FINDINGS_NORMALIZED_SEVERITY_FIELD}'] = params.normalizedSeverity;`,
].join('\n');

export interface FindingStorageIdIntegrityResult {
  checked: number;
  mismatched: number;
  completedAt: string;
}

export interface FindingStorageIdIntegrityClient {
  ingest: {
    getPipeline(input: Record<string, unknown>): Promise<{
      body: Record<string, Record<string, unknown>>;
    }>;
  };
  createPit(input: Record<string, unknown>): Promise<{ body: { pit_id?: string } }>;
  search(input: Record<string, unknown>): Promise<{
    body: {
      timed_out?: boolean;
      _shards?: { failed?: number };
      hits: {
        hits: {
          _id?: string;
          _seq_no?: number;
          _primary_term?: number;
          _source?: Record<string, unknown>;
          sort?: unknown[];
        }[];
      };
    };
  }>;
  deletePit(input: Record<string, unknown>): Promise<unknown>;
  bulk(input: Record<string, unknown>): Promise<{ body: unknown }>;
  index(input: Record<string, unknown>): Promise<unknown>;
  indices: {
    getSettings(input: Record<string, unknown>): Promise<{
      body: Record<string, { settings?: Record<string, unknown> }>;
    }>;
    getIndexTemplate(input: Record<string, unknown>): Promise<{
      body: {
        index_templates?: {
          name?: string;
          index_template?: Record<string, unknown>;
        }[];
      };
    }>;
    getMapping(input: Record<string, unknown>): Promise<{
      body: Record<string, { mappings?: Record<string, unknown> }>;
    }>;
    refresh(input: Record<string, unknown>): Promise<unknown>;
  };
}

export function buildFindingProjectionControlIndexName(organizationId: string): string {
  return `sentris-internal-finding-projection-${buildFindingOrganizationIndexKey(organizationId)}`;
}

export async function reconcileFindingStorageIdIntegrity(
  client: FindingStorageIdIntegrityClient,
  organizationId: string,
  requestedPageSize = DEFAULT_STORAGE_INTEGRITY_PAGE_SIZE,
  now: () => Date = () => new Date(),
): Promise<FindingStorageIdIntegrityResult> {
  const observationIndex = buildFindingObservationIndexName(organizationId);
  const normalizedPageSize = Number.isFinite(requestedPageSize)
    ? Math.trunc(requestedPageSize)
    : DEFAULT_STORAGE_INTEGRITY_PAGE_SIZE;
  const pageSize = Math.max(1, Math.min(normalizedPageSize, MAX_STORAGE_INTEGRITY_PAGE_SIZE));
  await client.index({
    index: buildFindingProjectionControlIndexName(organizationId),
    id: FINDING_STORAGE_ID_INTEGRITY_WATERMARK_ID,
    refresh: 'wait_for',
    body: {
      organization_id: organizationId,
      verification_state: 'checking',
      started_at: now().toISOString(),
    },
  });
  const observationIndexIdentity = await verifyFindingStorageInvariant(
    client,
    organizationId,
    observationIndex,
  );
  let pass: FindingStorageIntegrityPass | undefined;
  for (let attempt = 1; attempt <= MAX_STORAGE_INTEGRITY_ATTEMPTS; attempt += 1) {
    try {
      pass = await runFindingStorageIntegrityPass(client, observationIndex, pageSize);
      break;
    } catch (error) {
      if (
        !(error instanceof StorageIntegrityVersionConflictError) ||
        attempt === MAX_STORAGE_INTEGRITY_ATTEMPTS
      ) {
        throw error;
      }
      await client.indices.refresh({ index: observationIndex });
    }
  }
  if (!pass) {
    throw new Error('Storage ID reconciliation did not complete');
  }

  if (pass.updated > 0) {
    await client.indices.refresh({ index: observationIndex });
  }

  const currentObservationIndexIdentity = await verifyFindingStorageInvariant(
    client,
    organizationId,
    observationIndex,
  );
  if (
    currentObservationIndexIdentity.uuid !== observationIndexIdentity.uuid ||
    currentObservationIndexIdentity.invariantFingerprint !==
      observationIndexIdentity.invariantFingerprint
  ) {
    throw new Error('Observation index changed during storage ID reconciliation');
  }

  const completedAt = now().toISOString();
  await client.index({
    index: buildFindingProjectionControlIndexName(organizationId),
    id: FINDING_STORAGE_ID_INTEGRITY_WATERMARK_ID,
    refresh: 'wait_for',
    body: {
      organization_id: organizationId,
      verification_state: 'verified',
      observation_index_uuid: observationIndexIdentity.uuid,
      final_pipeline: FINDINGS_FINAL_INGEST_PIPELINE_ID,
      final_pipeline_content_hash: FINDINGS_FINAL_INGEST_PIPELINE_CONTENT_HASH,
      index_template_name: observationIndexIdentity.templateName,
      index_template_content_hash: observationIndexIdentity.templateContentHash,
      mapping_content_hash: FINDINGS_OBSERVATION_MAPPING_CONTENT_HASH,
      invariant_fingerprint: observationIndexIdentity.invariantFingerprint,
      template_version: FINDINGS_INDEX_TEMPLATE_VERSION,
      schema_version: FINDINGS_OBSERVATION_SCHEMA_VERSION,
      classification_version: FINDINGS_CONTRACT_CLASSIFICATION_VERSION,
      completed_at: completedAt,
      checked: pass.checked,
      mismatched: pass.mismatched,
    },
  });
  return { checked: pass.checked, mismatched: pass.mismatched, completedAt };
}

interface FindingStorageIntegrityPass {
  checked: number;
  mismatched: number;
  updated: number;
}

class StorageIntegrityVersionConflictError extends Error {}

async function runFindingStorageIntegrityPass(
  client: FindingStorageIdIntegrityClient,
  observationIndex: string,
  pageSize: number,
): Promise<FindingStorageIntegrityPass> {
  let pitId: string | undefined;
  let searchAfter: unknown[] | undefined;
  let checked = 0;
  let mismatched = 0;
  let updated = 0;

  try {
    const created = await client.createPit({
      index: [observationIndex],
      keep_alive: '2m',
      allow_partial_pit_creation: false,
    });
    pitId = created.body.pit_id;
    if (!pitId) throw new Error('OpenSearch did not return a storage integrity PIT identifier');

    while (true) {
      const response = await client.search({
        body: {
          query: { match_all: {} },
          size: pageSize,
          pit: { id: pitId, keep_alive: '2m' },
          sort: [{ _doc: { order: 'asc' } }],
          track_total_hits: false,
          seq_no_primary_term: true,
          _source: { includes: STORAGE_INTEGRITY_SOURCE_FIELDS },
          ...(searchAfter && { search_after: searchAfter }),
        },
      });
      assertCompleteSearchResponse(response.body);
      const page = response.body.hits.hits;
      if (page.length === 0) break;

      const bulkBody: Record<string, unknown>[] = [];
      for (const hit of page) {
        checked += 1;
        const source = hit._source ?? {};
        const sourceClassification = classifyFindingSourceContract(source);
        const storageClassification = classifyFindingStorageContract({
          _id: hit._id ?? '',
          _source: source,
        });
        const normalizedSeverity = normalizeFindingSeverity(source.severity);
        if (sourceClassification === 'canonical' && storageClassification === 'invalid') {
          mismatched += 1;
        }

        if (
          source[FINDINGS_CONTRACT_CLASSIFICATION_FIELD] === storageClassification &&
          source[FINDINGS_CONTRACT_VALIDATION_VERSION_FIELD] ===
            FINDINGS_CONTRACT_CLASSIFICATION_VERSION &&
          source[FINDINGS_NORMALIZED_SEVERITY_FIELD] === normalizedSeverity
        ) {
          continue;
        }
        if (
          typeof hit._id !== 'string' ||
          !Number.isInteger(hit._seq_no) ||
          !Number.isInteger(hit._primary_term)
        ) {
          throw new Error(
            'OpenSearch omitted identity metadata required for safe classification backfill',
          );
        }
        appendClassificationUpdate(
          bulkBody,
          observationIndex,
          hit._id,
          hit._seq_no as number,
          hit._primary_term as number,
          storageClassification,
          normalizedSeverity,
        );
        updated += 1;
      }

      if (bulkBody.length > 0) {
        await applyClassificationUpdates(client, bulkBody);
      }

      if (page.length < pageSize) break;
      searchAfter = page.at(-1)?.sort;
      if (!searchAfter || searchAfter.length === 0) {
        throw new Error(
          'OpenSearch omitted sort values required for complete storage ID reconciliation',
        );
      }
    }

    return { checked, mismatched, updated };
  } finally {
    if (pitId) {
      await client.deletePit({ body: { pit_id: [pitId] } });
    }
  }
}

function appendClassificationUpdate(
  bulkBody: Record<string, unknown>[],
  observationIndex: string,
  id: string,
  sequenceNumber: number,
  primaryTerm: number,
  classification: FindingSchemaCompatibility,
  normalizedSeverity: string,
): void {
  bulkBody.push(
    {
      update: {
        _index: observationIndex,
        _id: id,
        if_seq_no: sequenceNumber,
        if_primary_term: primaryTerm,
      },
    },
    {
      script: {
        lang: 'painless',
        source: BACKFILL_CLASSIFICATION_SCRIPT,
        params: {
          classification,
          normalizedSeverity,
          validationVersion: FINDINGS_CONTRACT_CLASSIFICATION_VERSION,
        },
      },
    },
  );
}

function normalizeFindingSeverity(value: unknown): string {
  if (typeof value !== 'string') return 'none';
  const normalized = value.toLowerCase();
  return normalized === 'critical' ||
    normalized === 'high' ||
    normalized === 'medium' ||
    normalized === 'low' ||
    normalized === 'info' ||
    normalized === 'none'
    ? normalized
    : 'none';
}

async function applyClassificationUpdates(
  client: FindingStorageIdIntegrityClient,
  bulkBody: Record<string, unknown>[],
): Promise<void> {
  const response = await client.bulk({ refresh: false, body: bulkBody });
  const expectedUpdates = bulkBody.length / 2;
  const body = response.body;
  if (!isRecord(body) || typeof body.errors !== 'boolean' || !Array.isArray(body.items)) {
    throw new Error(
      'Malformed storage classification backfill response: missing errors flag or item results',
    );
  }
  if (body.items.length !== expectedUpdates) {
    throw new Error(
      `Storage classification backfill returned ${body.items.length} of ${expectedUpdates} item results`,
    );
  }

  const failures: { status: number; error: { type: string; reason?: string } }[] = [];
  for (const item of body.items) {
    if (!isRecord(item) || Object.keys(item).length !== 1 || !Object.hasOwn(item, 'update')) {
      throw new Error(
        'Malformed storage classification backfill response: expected one update result per document',
      );
    }
    const update = item.update;
    if (!isRecord(update)) {
      throw new Error('Malformed storage classification backfill response: invalid update result');
    }

    const status = update.status;
    if (typeof status !== 'number' || !Number.isInteger(status) || status < 100 || status > 599) {
      throw new Error('Malformed storage classification backfill response: invalid item status');
    }
    const hasError = Object.hasOwn(update, 'error');
    if (status >= 200 && status < 300) {
      if (hasError) {
        throw new Error(
          'Malformed storage classification backfill response: successful item included an error',
        );
      }
      continue;
    }

    const error = update.error;
    if (
      !hasError ||
      !isRecord(error) ||
      typeof error.type !== 'string' ||
      error.type.length === 0 ||
      (Object.hasOwn(error, 'reason') && typeof error.reason !== 'string')
    ) {
      throw new Error(
        'Malformed storage classification backfill response: failed item omitted a valid error',
      );
    }
    failures.push({
      status,
      error: {
        type: error.type,
        ...(typeof error.reason === 'string' && { reason: error.reason }),
      },
    });
  }

  if (body.errors !== failures.length > 0) {
    throw new Error(
      'Malformed storage classification backfill response: errors flag contradicts item results',
    );
  }
  if (failures.length === 0) return;

  const nonConflict = failures.find(
    (failure) =>
      failure.status !== 409 || failure.error.type !== 'version_conflict_engine_exception',
  );
  if (nonConflict) {
    throw new Error(
      `Storage classification backfill failed: ${nonConflict.error.reason ?? nonConflict.error.type}`,
    );
  }
  throw new StorageIntegrityVersionConflictError(
    'Storage classification changed during optimistic reconciliation',
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

interface VerifiedFindingStorageInvariant {
  uuid: string;
  finalPipeline: string;
  templateName: string;
  templateContentHash: string;
  invariantFingerprint: string;
}

async function verifyFindingStorageInvariant(
  client: Pick<FindingStorageIdIntegrityClient, 'indices' | 'ingest'>,
  organizationId: string,
  index: string,
): Promise<VerifiedFindingStorageInvariant> {
  const templateName = buildOrganizationFindingsIndexTemplateName(organizationId);
  const [settingsResponse, pipelineResponse, templateResponse, mappingResponse] = await Promise.all(
    [
      client.indices.getSettings({ index }),
      client.ingest.getPipeline({ id: FINDINGS_FINAL_INGEST_PIPELINE_ID }),
      client.indices.getIndexTemplate({ name: templateName }),
      client.indices.getMapping({ index }),
    ],
  );

  const indexSettings = normalizeFindingsIndexSettings(settingsResponse.body[index]?.settings);
  const uuid = indexSettings?.['index.uuid'];
  if (typeof uuid !== 'string' || uuid.length === 0) {
    throw new Error(`OpenSearch did not return an index UUID for ${index}`);
  }
  if (indexSettings?.['index.final_pipeline'] !== FINDINGS_FINAL_INGEST_PIPELINE_ID) {
    throw new Error(
      `Observation index ${index} is not protected by ${FINDINGS_FINAL_INGEST_PIPELINE_ID}`,
    );
  }

  const installedPipeline = pipelineResponse.body[FINDINGS_FINAL_INGEST_PIPELINE_ID];
  if (
    !installedPipeline ||
    hashFindingsPipelineInvariant(installedPipeline) !== FINDINGS_FINAL_INGEST_PIPELINE_CONTENT_HASH
  ) {
    throw new Error('Installed findings final pipeline content does not match its immutable ID');
  }

  const installedTemplate = templateResponse.body.index_templates?.find(
    (candidate) => candidate.name === templateName,
  )?.index_template;
  const expectedTemplateHash = getOrganizationFindingsIndexTemplateContentHash(organizationId);
  if (
    !installedTemplate ||
    hashFindingsIndexTemplateInvariant(installedTemplate) !== expectedTemplateHash
  ) {
    throw new Error('Installed findings observation template content does not match its name');
  }

  const installedMappings = mappingResponse.body[index]?.mappings;
  const expectedMappings = buildOrganizationFindingsIndexTemplate(organizationId).template.mappings;
  if (
    !installedMappings ||
    hashFindingsMappingInvariant(installedMappings) !==
      hashFindingsMappingInvariant(expectedMappings)
  ) {
    throw new Error('Installed findings observation mapping does not match the contract');
  }

  const invariantFingerprint = getOrganizationFindingsStorageInvariantFingerprint(organizationId);
  return {
    uuid,
    finalPipeline: FINDINGS_FINAL_INGEST_PIPELINE_ID,
    templateName,
    templateContentHash: expectedTemplateHash,
    invariantFingerprint,
  };
}

function assertCompleteSearchResponse(response: {
  timed_out?: boolean;
  _shards?: { failed?: number };
}): void {
  if (response.timed_out === true || (response._shards?.failed ?? 0) > 0) {
    throw new Error(
      `Storage ID reconciliation returned a partial response (timed_out=${response.timed_out === true}, failed_shards=${response._shards?.failed ?? 0})`,
    );
  }
}
