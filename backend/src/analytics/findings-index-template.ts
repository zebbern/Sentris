import { createHash } from 'node:crypto';

import {
  buildFindingObservationIndexName,
  buildFindingObservationIndexPattern,
  buildFindingOrganizationIndexKey,
  buildLegacyFindingOrganizationIndexKey,
} from '@sentris/shared/finding-observation-id';

export const FINDINGS_INDEX_TEMPLATE_VERSION = 6 as const;
export const FINDINGS_OBSERVATION_SCHEMA_VERSION = 1 as const;
export const FINDINGS_CONTRACT_CLASSIFICATION_VERSION = 2 as const;
export const FINDINGS_CONTRACT_CLASSIFICATION_FIELD = 'sentris_contract_classification' as const;
export const FINDINGS_CONTRACT_VALIDATION_VERSION_FIELD =
  'sentris_contract_validation_version' as const;
export const FINDINGS_NORMALIZED_SEVERITY_FIELD = 'sentris_normalized_severity' as const;

function stableSerialize(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return `[${value.map((item) => stableSerialize(item)).join(',')}]`;
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableSerialize(record[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? JSON.stringify(String(value));
}

export function hashFindingsInvariant(value: unknown): string {
  return createHash('sha256').update(stableSerialize(value)).digest('hex');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizedBoolean(value: unknown): unknown {
  if (value === 'true') return true;
  if (value === 'false') return false;
  return value;
}

function normalizedInteger(value: unknown): unknown {
  if (typeof value === 'string' && /^-?\d+$/.test(value)) return Number(value);
  return value;
}

function normalizeMappingValue(value: unknown, fieldName?: string): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeMappingValue(item));
  }
  if (!isRecord(value)) {
    if (
      fieldName === 'dynamic' ||
      fieldName === 'enabled' ||
      fieldName === 'index' ||
      fieldName === 'doc_values' ||
      fieldName === 'store' ||
      fieldName === 'norms' ||
      fieldName === 'ignore_malformed' ||
      fieldName === 'coerce'
    ) {
      return normalizedBoolean(value);
    }
    if (fieldName === 'ignore_above' || fieldName === 'scaling_factor' || fieldName === 'dims') {
      return normalizedInteger(value);
    }
    return value;
  }
  const normalized = Object.fromEntries(
    Object.entries(value).map(([key, child]) => [key, normalizeMappingValue(child, key)]),
  );
  if (normalized.type === 'object' && isRecord(normalized.properties)) {
    delete normalized.type;
  }
  return normalized;
}

function flattenIndexSettings(
  value: Record<string, unknown>,
  prefix: string,
  output: Record<string, unknown>,
): void {
  for (const [key, child] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (isRecord(child)) {
      flattenIndexSettings(child, path, output);
      continue;
    }
    const canonicalPath = path.startsWith('index.') ? path : `index.${path}`;
    const leaf = canonicalPath.slice(canonicalPath.lastIndexOf('.') + 1);
    const normalized =
      leaf === 'number_of_shards' ||
      leaf === 'number_of_replicas' ||
      leaf === 'routing_partition_size'
        ? normalizedInteger(child)
        : normalizedBoolean(child);
    output[canonicalPath] = normalized;
  }
}

/**
 * Canonical semantic representation of OpenSearch index settings. OpenSearch
 * may return the same setting nested or dotted and serializes typed values as
 * strings; callers compare this representation without changing material
 * setting names or values.
 */
export function normalizeFindingsIndexSettings(
  value: unknown,
): Record<string, unknown> | undefined {
  if (!isRecord(value)) return undefined;
  const normalized: Record<string, unknown> = {};
  flattenIndexSettings(value, '', normalized);
  return normalized;
}

export function normalizeFindingsPipelineInvariant(value: unknown): unknown {
  if (!isRecord(value)) return value;
  const normalized = Object.fromEntries(
    Object.entries(value).map(([key, child]) => [
      key,
      key === 'version' ? normalizedInteger(child) : child,
    ]),
  );
  if (normalized.deprecated === false || normalized.deprecated === 'false') {
    delete normalized.deprecated;
  }
  return normalized;
}

export function normalizeFindingsMappingInvariant(value: unknown): unknown {
  return normalizeMappingValue(value);
}

export function normalizeFindingsIndexTemplateInvariant(value: unknown): unknown {
  if (!isRecord(value)) return value;
  const normalized: Record<string, unknown> = { ...value };
  normalized.version = normalizedInteger(normalized.version);
  normalized.priority = normalizedInteger(normalized.priority);
  if (Array.isArray(normalized.composed_of) && normalized.composed_of.length === 0) {
    delete normalized.composed_of;
  }

  if (isRecord(normalized._meta)) {
    normalized._meta = Object.fromEntries(
      Object.entries(normalized._meta).map(([key, child]) => [
        key,
        key.endsWith('_version') ? normalizedInteger(child) : child,
      ]),
    );
  }

  if (isRecord(normalized.template)) {
    normalized.template = {
      ...normalized.template,
      settings: normalizeFindingsIndexSettings(normalized.template.settings),
      mappings: normalizeFindingsMappingInvariant(normalized.template.mappings),
    };
  }
  return normalized;
}

export function hashFindingsPipelineInvariant(value: unknown): string {
  return hashFindingsInvariant(normalizeFindingsPipelineInvariant(value));
}

export function hashFindingsMappingInvariant(value: unknown): string {
  return hashFindingsInvariant(normalizeFindingsMappingInvariant(value));
}

export function hashFindingsIndexTemplateInvariant(value: unknown): string {
  return hashFindingsInvariant(normalizeFindingsIndexTemplateInvariant(value));
}

const canonicalDateTimeValidationScript = [
  'boolean isCanonicalDateTime(def value) {',
  '  if (!(value instanceof String)) return false;',
  '  int length = value.length();',
  '  if (length < 17 || value.charAt(length - 1) != 90) return false;',
  '  if (value.charAt(4) != 45 || value.charAt(7) != 45 || value.charAt(10) != 84 || value.charAt(13) != 58) return false;',
  '  for (int index : new int[] { 0, 1, 2, 3, 5, 6, 8, 9, 11, 12, 14, 15 }) {',
  '    int digit = value.charAt(index);',
  '    if (digit < 48 || digit > 57) return false;',
  '  }',
  '  int year = Integer.parseInt(value.substring(0, 4));',
  '  int month = Integer.parseInt(value.substring(5, 7));',
  '  int day = Integer.parseInt(value.substring(8, 10));',
  '  int hour = Integer.parseInt(value.substring(11, 13));',
  '  int minute = Integer.parseInt(value.substring(14, 16));',
  '  if (month < 1 || month > 12 || hour > 23 || minute > 59) return false;',
  '  int maxDay = 31;',
  '  if (month == 4 || month == 6 || month == 9 || month == 11) maxDay = 30;',
  '  if (month == 2) {',
  '    boolean leapYear = year % 4 == 0 && (year % 100 != 0 || year % 400 == 0);',
  '    maxDay = leapYear ? 29 : 28;',
  '  }',
  '  if (day < 1 || day > maxDay) return false;',
  '  if (length == 17) return true;',
  '  if (length < 20 || value.charAt(16) != 58) return false;',
  '  for (int index = 17; index <= 18; index++) {',
  '    int digit = value.charAt(index);',
  '    if (digit < 48 || digit > 57) return false;',
  '  }',
  '  int second = Integer.parseInt(value.substring(17, 19));',
  '  if (second > 59) return false;',
  '  if (length == 20) return true;',
  '  if (length < 22 || value.charAt(19) != 46) return false;',
  '  for (int index = 20; index < length - 1; index++) {',
  '    int digit = value.charAt(index);',
  '    if (digit < 48 || digit > 57) return false;',
  '  }',
  '  return true;',
  '}',
].join('\n');

const canonicalFindingIdValidationScript = [
  'boolean isCanonicalFindingId(def value) {',
  '  if (!(value instanceof String) || value.length() != 70 || !value.startsWith("fo_v1_")) return false;',
  '  for (int index = 6; index < value.length(); index++) {',
  '    int digit = value.charAt(index);',
  '    boolean hexadecimal = (digit >= 48 && digit <= 57) || (digit >= 97 && digit <= 102);',
  '    if (!hexadecimal) return false;',
  '  }',
  '  return true;',
  '}',
].join('\n');

const canonicalSourceValidationScript = [
  canonicalDateTimeValidationScript,
  canonicalFindingIdValidationScript,
  'boolean isCanonicalFindingSource(def source) {',
  '  if (!(source instanceof Map)) return false;',
  "  if (source.contract != 'sentris.finding-observation') return false;",
  '  if (source.schema_version != 1) return false;',
  '  if (!isCanonicalFindingId(source.finding_id)) return false;',
  "  if (!isCanonicalDateTime(source.observed_at) || !isCanonicalDateTime(source['@timestamp'])) return false;",
  "  if (!(source.severity == 'critical' || source.severity == 'high' || source.severity == 'medium' ||",
  "        source.severity == 'low' || source.severity == 'info' || source.severity == 'none')) return false;",
  '  if (!(source.title instanceof String && source.title.length() > 0)) return false;',
  '  if (!(source.description instanceof String && source.description.length() > 0)) return false;',
  "  if (!source.containsKey('evidence')) return false;",
  "  if (!source.containsKey('source')) return false;",
  '  if (!(source.sentris instanceof Map)) return false;',
  '  def sentris = source.sentris;',
  '  if (!(sentris.organization_id instanceof String) || sentris.organization_id.length() == 0) return false;',
  '  if (!(sentris.workflow_id instanceof String) || sentris.workflow_id.length() == 0) return false;',
  '  if (!(sentris.workflow_name instanceof String) || sentris.workflow_name.length() == 0) return false;',
  '  if (!(sentris.run_id instanceof String) || sentris.run_id.length() == 0) return false;',
  "  if (!sentris.containsKey('scope_id')) return false;",
  '  if (!(sentris.scope_id == null || (sentris.scope_id instanceof String && sentris.scope_id.length() > 0))) return false;',
  '  if (!(sentris.component_id instanceof String) || sentris.component_id.length() == 0) return false;',
  '  if (!(sentris.node_ref instanceof String) || sentris.node_ref.length() == 0) return false;',
  "  if (!sentris.containsKey('asset_key')) return false;",
  '  if (!(sentris.asset_key == null || (sentris.asset_key instanceof String && sentris.asset_key.length() > 0))) return false;',
  '  if (sentris.contract_validated != true) return false;',
  '  if (sentris.contract_source_validated != true) return false;',
  '  if (!isCanonicalFindingId(sentris.contract_document_id)) return false;',
  '  return sentris.contract_document_id == source.finding_id;',
  '}',
].join('\n');

export function buildFindingsFinalIngestPipeline() {
  return {
    description:
      'Enforce canonical Sentris finding source IDs against immutable OpenSearch ingest metadata',
    version: FINDINGS_INDEX_TEMPLATE_VERSION,
    processors: [
      {
        script: {
          lang: 'painless',
          source: [
            canonicalSourceValidationScript,
            `ctx.${FINDINGS_NORMALIZED_SEVERITY_FIELD} = 'none';`,
            'if (ctx.severity instanceof String) {',
            '  String normalizedSeverity = ctx.severity.toLowerCase();',
            "  if (normalizedSeverity == 'critical') ctx.sentris_normalized_severity = 'critical';",
            "  else if (normalizedSeverity == 'high') ctx.sentris_normalized_severity = 'high';",
            "  else if (normalizedSeverity == 'medium') ctx.sentris_normalized_severity = 'medium';",
            "  else if (normalizedSeverity == 'low') ctx.sentris_normalized_severity = 'low';",
            "  else if (normalizedSeverity == 'info') ctx.sentris_normalized_severity = 'info';",
            "  else if (normalizedSeverity == 'none') ctx.sentris_normalized_severity = 'none';",
            '}',
            `ctx.${FINDINGS_CONTRACT_VALIDATION_VERSION_FIELD} = ${FINDINGS_CONTRACT_CLASSIFICATION_VERSION};`,
            `ctx.${FINDINGS_CONTRACT_CLASSIFICATION_FIELD} = 'invalid';`,
            "boolean hasContractMarker = ctx.containsKey('contract');",
            "boolean hasSchemaVersionMarker = ctx.containsKey('schema_version');",
            'if (!hasContractMarker && !hasSchemaVersionMarker) {',
            `  ctx.${FINDINGS_CONTRACT_CLASSIFICATION_FIELD} = 'legacy';`,
            '  return;',
            '}',
            'def sentris = ctx.sentris;',
            'if (ctx.finding_id instanceof String && sentris instanceof Map && sentris.contract_document_id instanceof String &&',
            '    (ctx._id == null || ctx._id != ctx.finding_id || ctx._id != sentris.contract_document_id)) {',
            "  throw new IllegalArgumentException('Canonical finding IDs must match the OpenSearch document ID');",
            '}',
            'if (isCanonicalFindingSource(ctx)) {',
            `  ctx.${FINDINGS_CONTRACT_CLASSIFICATION_FIELD} = 'canonical';`,
            '}',
          ].join('\n'),
        },
      },
    ],
  } as const;
}

export const FINDINGS_FINAL_INGEST_PIPELINE_CONTENT_HASH = hashFindingsPipelineInvariant(
  buildFindingsFinalIngestPipeline(),
);
export const FINDINGS_FINAL_INGEST_PIPELINE_ID =
  `sentris-findings-observation-final-${FINDINGS_FINAL_INGEST_PIPELINE_CONTENT_HASH.slice(0, 16)}` as const;

export const FINDINGS_INDEX_PROPERTIES = {
  '@timestamp': { type: 'date' },
  scanner: { type: 'keyword' },
  severity: { type: 'keyword' },
  finding_hash: { type: 'keyword' },
  finding_id: { type: 'keyword' },
  contract: { type: 'keyword' },
  schema_version: { type: 'integer' },
  observed_at: { type: 'date' },
  title: { type: 'text' },
  description: { type: 'text' },
  evidence: { type: 'object', enabled: false },
  source: { type: 'object', enabled: false },
  [FINDINGS_CONTRACT_CLASSIFICATION_FIELD]: { type: 'keyword' },
  [FINDINGS_CONTRACT_VALIDATION_VERSION_FIELD]: { type: 'integer' },
  [FINDINGS_NORMALIZED_SEVERITY_FIELD]: { type: 'keyword' },
  asset_key: { type: 'keyword' },
  run_id: { type: 'keyword' },
  workflow_id: { type: 'keyword' },
  workflow_name: { type: 'text' },
  component_id: { type: 'keyword' },
  sentris: {
    type: 'object',
    dynamic: false,
    properties: {
      organization_id: { type: 'keyword' },
      run_id: { type: 'keyword' },
      workflow_id: { type: 'keyword' },
      workflow_name: { type: 'keyword' },
      scope_id: { type: 'keyword' },
      component_id: { type: 'keyword' },
      node_ref: { type: 'keyword' },
      asset_key: { type: 'keyword' },
      contract_validated: { type: 'boolean' },
      contract_source_validated: { type: 'boolean' },
      contract_document_id: { type: 'keyword' },
      triage: {
        type: 'object',
        dynamic: 'strict',
        properties: {
          status: { type: 'keyword' },
          assignee_user_id: { type: 'keyword' },
          severity_override: { type: 'keyword' },
          notes: { type: 'text', index: false },
          updated_at: { type: 'date' },
          version: { type: 'long' },
        },
      },
    },
  },
} as const;

export const FINDINGS_OBSERVATION_MAPPING_CONTENT_HASH = hashFindingsMappingInvariant({
  dynamic: false,
  properties: FINDINGS_INDEX_PROPERTIES,
});

export function buildFindingsIndexTemplate(indexPatterns: string[]) {
  return {
    index_patterns: indexPatterns,
    version: FINDINGS_INDEX_TEMPLATE_VERSION,
    _meta: {
      sentris_contract: 'sentris.finding-observation',
      sentris_schema_version: FINDINGS_OBSERVATION_SCHEMA_VERSION,
      sentris_template_version: FINDINGS_INDEX_TEMPLATE_VERSION,
      sentris_final_pipeline: FINDINGS_FINAL_INGEST_PIPELINE_ID,
      sentris_final_pipeline_content_hash: FINDINGS_FINAL_INGEST_PIPELINE_CONTENT_HASH,
      sentris_mapping_content_hash: FINDINGS_OBSERVATION_MAPPING_CONTENT_HASH,
      sentris_contract_classification_version: FINDINGS_CONTRACT_CLASSIFICATION_VERSION,
    },
    template: {
      settings: {
        number_of_shards: 1,
        number_of_replicas: 1,
        'index.final_pipeline': FINDINGS_FINAL_INGEST_PIPELINE_ID,
      },
      mappings: {
        dynamic: false,
        properties: FINDINGS_INDEX_PROPERTIES,
      },
    },
  } as const;
}

export interface FindingsReindexPlan {
  organizationId: string;
  targetIndex: string;
  sourceIndices: string[];
  deleteSources: false;
}

export function buildFindingsReindexPlan(
  organizationId: string,
  existingIndices: string[],
): FindingsReindexPlan {
  const legacyOrganizationKey = buildLegacyFindingOrganizationIndexKey(organizationId);
  const prefix = `security-findings-${legacyOrganizationKey}-`;
  const legacyDailyIndex = /^\d{4}\.\d{2}\.\d{2}$/;
  const legacyStableIndex = 'observations-v1';
  const targetIndex = buildFindingObservationIndexName(organizationId);

  const sourceIndices = [...new Set(existingIndices)]
    .filter((indexName) => {
      if (!indexName.startsWith(prefix) || indexName === targetIndex) return false;
      const suffix = indexName.slice(prefix.length);
      return legacyDailyIndex.test(suffix) || suffix === legacyStableIndex;
    })
    .sort();

  return {
    organizationId,
    targetIndex,
    sourceIndices,
    deleteSources: false,
  };
}

export function buildOrganizationFindingsIndexTemplate(organizationId: string) {
  return {
    ...buildFindingsIndexTemplate([buildFindingObservationIndexPattern(organizationId)]),
    priority: 100,
  } as const;
}

export function buildOrganizationFindingsIndexTemplateName(organizationId: string): string {
  return [
    'sentris-findings-observation',
    buildFindingOrganizationIndexKey(organizationId),
    FINDINGS_OBSERVATION_MAPPING_CONTENT_HASH.slice(0, 12),
    FINDINGS_FINAL_INGEST_PIPELINE_CONTENT_HASH.slice(0, 12),
  ].join('-');
}

export function getOrganizationFindingsIndexTemplateContentHash(organizationId: string): string {
  return hashFindingsIndexTemplateInvariant(buildOrganizationFindingsIndexTemplate(organizationId));
}

export function getOrganizationFindingsStorageInvariantFingerprint(organizationId: string): string {
  return hashFindingsInvariant({
    finalPipeline: FINDINGS_FINAL_INGEST_PIPELINE_ID,
    pipelineContentHash: FINDINGS_FINAL_INGEST_PIPELINE_CONTENT_HASH,
    templateName: buildOrganizationFindingsIndexTemplateName(organizationId),
    templateContentHash: getOrganizationFindingsIndexTemplateContentHash(organizationId),
    mappingContentHash: FINDINGS_OBSERVATION_MAPPING_CONTENT_HASH,
  });
}
