import type { FindingItem } from './dto/findings-query.dto';
import {
  FINDING_OBSERVATION_CONTRACT,
  FINDING_OBSERVATION_VERSION,
  FindingObservationV1Schema,
  SEVERITY_VALUES,
} from '@sentris/shared';
import { findingsUnavailable } from './findings-unavailable';
import {
  FINDINGS_CONTRACT_CLASSIFICATION_FIELD,
  FINDINGS_CONTRACT_CLASSIFICATION_VERSION,
  FINDINGS_CONTRACT_VALIDATION_VERSION_FIELD,
  FINDINGS_NORMALIZED_SEVERITY_FIELD,
} from './findings-index-template';

export interface FindingFilterInput {
  severity?: string;
  search?: string;
  workflowId?: string;
  runId?: string;
  scopeId?: string;
  componentId?: string;
  dateFrom?: string;
  dateTo?: string;
  triageStatus?: string;
  assigneeUserId?: string;
}

export interface FindingFilterContext {
  ownedScopeRunIds?: readonly string[];
}

export interface FindingSearchHit {
  _id: string;
  _source: Record<string, unknown>;
}

export type FindingSchemaCompatibility = 'canonical' | 'legacy' | 'invalid';

export interface MappedFindingHit {
  item: FindingItem;
  compatibility: FindingSchemaCompatibility;
}

export const FINDING_SCHEMA_COVERAGE_AGGREGATION_KEY = 'sentris_schema_coverage' as const;
export const FINDING_SEVERITY_AGGREGATION_KEY = 'severity_counts' as const;

export interface FindingSchemaCoverage {
  canonical: number;
  legacy: number;
  invalid: number;
}

const SCOPE_RUN_IDS_PER_TERMS_CLAUSE = 1_000;
const FINDING_SEVERITIES = new Set<string>(SEVERITY_VALUES);

function isSafeNonnegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

export function parseExactOpenSearchTotal(value: unknown): number {
  if (isSafeNonnegativeInteger(value)) return value;
  if (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    isSafeNonnegativeInteger((value as Record<string, unknown>).value) &&
    (value as Record<string, unknown>).relation === 'eq'
  ) {
    return (value as { value: number }).value;
  }
  throw findingsUnavailable('OpenSearch returned a non-exact findings total');
}

export function parseExactFindingSeverityCounts(
  aggregations: Record<string, unknown> | undefined,
  total: number,
): { severity: (typeof SEVERITY_VALUES)[number]; count: number }[] {
  if (!isSafeNonnegativeInteger(total)) {
    throw findingsUnavailable('OpenSearch returned malformed finding severity counts');
  }
  const aggregation = aggregations?.[FINDING_SEVERITY_AGGREGATION_KEY];
  const buckets =
    aggregation !== null && typeof aggregation === 'object' && !Array.isArray(aggregation)
      ? (aggregation as Record<string, unknown>).buckets
      : undefined;
  if (!Array.isArray(buckets)) {
    throw findingsUnavailable('OpenSearch returned malformed finding severity counts');
  }

  const seen = new Set<string>();
  const counts: { severity: (typeof SEVERITY_VALUES)[number]; count: number }[] = [];
  let sum = 0;
  for (const bucket of buckets) {
    if (bucket === null || typeof bucket !== 'object' || Array.isArray(bucket)) {
      throw findingsUnavailable('OpenSearch returned malformed finding severity counts');
    }
    const key = (bucket as Record<string, unknown>).key;
    const count = (bucket as Record<string, unknown>).doc_count;
    if (
      typeof key !== 'string' ||
      !FINDING_SEVERITIES.has(key) ||
      seen.has(key) ||
      !isSafeNonnegativeInteger(count) ||
      !Number.isSafeInteger(sum + count)
    ) {
      throw findingsUnavailable('OpenSearch returned malformed finding severity counts');
    }
    seen.add(key);
    sum += count;
    counts.push({
      severity: key as (typeof SEVERITY_VALUES)[number],
      count,
    });
  }
  if (sum !== total) {
    throw findingsUnavailable('OpenSearch returned malformed finding severity counts');
  }
  return counts;
}

function buildCompatibleExactFieldFilter(
  canonicalField: string,
  legacyRootField: string,
  value: string,
): Record<string, unknown> {
  return {
    bool: {
      minimum_should_match: 1,
      should: [
        { term: { [canonicalField]: value } },
        {
          bool: {
            must: [{ term: { [legacyRootField]: value } }],
            must_not: [{ exists: { field: canonicalField } }],
          },
        },
      ],
    },
  };
}

export function buildOwnedRunIdsFilter(ownedRunIds: readonly string[]): Record<string, unknown> {
  if (ownedRunIds.length === 0) {
    return { match_none: {} };
  }

  const should: Record<string, unknown>[] = [];
  for (let start = 0; start < ownedRunIds.length; start += SCOPE_RUN_IDS_PER_TERMS_CLAUSE) {
    const runIds = ownedRunIds.slice(start, start + SCOPE_RUN_IDS_PER_TERMS_CLAUSE);
    should.push(
      { terms: { 'sentris.run_id': runIds } },
      {
        bool: {
          must: [{ terms: { run_id: runIds } }],
          must_not: [{ exists: { field: 'sentris.run_id' } }],
        },
      },
    );
  }
  return {
    bool: {
      minimum_should_match: 1,
      should,
    },
  };
}

export const canonicalFindingSourceFilter = {
  bool: {
    filter: [
      {
        term: {
          [FINDINGS_CONTRACT_VALIDATION_VERSION_FIELD]: FINDINGS_CONTRACT_CLASSIFICATION_VERSION,
        },
      },
      {
        term: {
          [FINDINGS_CONTRACT_CLASSIFICATION_FIELD]: 'canonical',
        },
      },
    ],
  },
} as const;

const legacyFindingSourceFilter = {
  bool: {
    filter: [
      {
        term: {
          [FINDINGS_CONTRACT_VALIDATION_VERSION_FIELD]: FINDINGS_CONTRACT_CLASSIFICATION_VERSION,
        },
      },
      {
        term: {
          [FINDINGS_CONTRACT_CLASSIFICATION_FIELD]: 'legacy',
        },
      },
    ],
  },
} as const;

export function buildFindingSchemaCoverageAggregation(): Record<string, unknown> {
  return {
    filters: {
      filters: {
        canonical_source: canonicalFindingSourceFilter,
        legacy: legacyFindingSourceFilter,
      },
    },
  };
}

export function readFindingSchemaCoverage(
  aggregations: Record<string, unknown> | undefined,
  total: number,
): FindingSchemaCoverage | null {
  const aggregation = asRecord(aggregations?.[FINDING_SCHEMA_COVERAGE_AGGREGATION_KEY]);
  const buckets = asRecord(aggregation.buckets);
  const canonical =
    finiteNumber(asRecord(buckets.canonical_source).doc_count) ??
    finiteNumber(asRecord(buckets.canonical).doc_count);
  const legacy = finiteNumber(asRecord(buckets.legacy).doc_count);
  const explicitInvalid = finiteNumber(asRecord(buckets.invalid).doc_count);
  const invalid =
    explicitInvalid ??
    (canonical !== undefined && legacy !== undefined && Number.isSafeInteger(total)
      ? total - canonical - legacy
      : undefined);
  if (
    canonical === undefined ||
    legacy === undefined ||
    invalid === undefined ||
    invalid < 0 ||
    canonical < 0 ||
    legacy < 0 ||
    !Number.isSafeInteger(canonical) ||
    !Number.isSafeInteger(legacy) ||
    !Number.isSafeInteger(invalid) ||
    total < 0
  ) {
    return null;
  }
  return {
    canonical,
    legacy,
    invalid,
  };
}

export function isFindingSchemaCoverageComplete(
  coverage: FindingSchemaCoverage | null,
  total: number,
): coverage is FindingSchemaCoverage {
  return (
    coverage !== null &&
    Number.isSafeInteger(total) &&
    total >= 0 &&
    coverage.canonical + coverage.legacy + coverage.invalid === total
  );
}

export function buildFindingFilter(
  query: FindingFilterInput,
  context: FindingFilterContext = {},
): Record<string, unknown> {
  const must: Record<string, unknown>[] = [];

  if (query.severity) {
    must.push({ term: { [FINDINGS_NORMALIZED_SEVERITY_FIELD]: query.severity } });
  }

  if (query.search) {
    must.push({
      bool: {
        minimum_should_match: 1,
        should: [
          {
            multi_match: {
              query: query.search,
              fields: [
                'title',
                'description',
                'name',
                'finding',
                'workflow_name',
                'host',
                'domain',
                'url',
              ],
              type: 'phrase_prefix',
            },
          },
          ...['asset_key', 'sentris.asset_key', 'sentris.workflow_name'].map((field) => ({
            prefix: {
              [field]: {
                value: query.search,
                case_insensitive: true,
              },
            },
          })),
        ],
      },
    });
  }

  if (query.workflowId) {
    must.push(
      buildCompatibleExactFieldFilter('sentris.workflow_id', 'workflow_id', query.workflowId),
    );
  }

  if (query.runId) {
    must.push(buildCompatibleExactFieldFilter('sentris.run_id', 'run_id', query.runId));
  }

  if (query.scopeId) {
    if (context.ownedScopeRunIds === undefined) {
      throw new Error('Scope filtering requires organization-owned run IDs');
    }
    must.push(buildOwnedRunIdsFilter(context.ownedScopeRunIds));
  }

  if (query.componentId) {
    must.push(
      buildCompatibleExactFieldFilter('sentris.component_id', 'component_id', query.componentId),
    );
  }

  if (query.dateFrom || query.dateTo) {
    const range: Record<string, string> = {};
    if (query.dateFrom) range.gte = query.dateFrom;
    if (query.dateTo) range.lte = query.dateTo;
    must.push({ range: { '@timestamp': range } });
  }

  if (query.triageStatus) {
    const statuses = query.triageStatus.split(',');
    const includesNew = statuses.includes('new');
    const projectedStatuses = statuses.filter((status) => status !== 'new');

    if (includesNew) {
      const should: Record<string, unknown>[] = [];
      if (projectedStatuses.length > 0) {
        should.push({ terms: { 'sentris.triage.status': projectedStatuses } });
      }
      should.push(
        { term: { 'sentris.triage.status': 'new' } },
        {
          bool: {
            must_not: [{ exists: { field: 'sentris.triage.status' } }],
          },
        },
      );
      must.push({ bool: { minimum_should_match: 1, should } });
    } else {
      must.push({ terms: { 'sentris.triage.status': statuses } });
    }
  }

  if (query.assigneeUserId) {
    must.push({ term: { 'sentris.triage.assignee_user_id': query.assigneeUserId } });
  }

  return must.length > 0 ? { bool: { must } } : { match_all: {} };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return undefined;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function mapFindingSource(
  hit: FindingSearchHit,
  compatibility: FindingSchemaCompatibility,
): FindingItem {
  const source = hit._source;
  const sentris = asRecord(source.sentris);
  const triage = asRecord(sentris.triage);
  const triageStatus = firstString(triage.status);
  const triageUpdatedAt = firstString(triage.updated_at);

  return {
    id: hit._id,
    schemaCompatibility: compatibility,
    timestamp: firstString(source['@timestamp'], source.observed_at) ?? new Date().toISOString(),
    severity: firstString(source[FINDINGS_NORMALIZED_SEVERITY_FIELD], source.severity),
    name: firstString(source.title, source.name),
    asset_key: firstString(sentris.asset_key, source.asset_key),
    workflow_name: firstString(sentris.workflow_name, source.workflow_name),
    workflow_id: firstString(sentris.workflow_id, source.workflow_id),
    run_id: firstString(sentris.run_id, source.run_id),
    scope_id: firstString(sentris.scope_id, source.scope_id),
    component_id: firstString(sentris.component_id, source.component_id),
    node_ref: firstString(sentris.node_ref, source.node_ref),
    triage:
      triageStatus && triageUpdatedAt
        ? {
            status: triageStatus,
            assigneeUserId: firstString(triage.assignee_user_id) ?? null,
            severityOverride: firstString(triage.severity_override) ?? null,
            notes: firstString(triage.notes) ?? null,
            updatedAt: triageUpdatedAt,
            projectionVersion: finiteNumber(triage.version),
          }
        : undefined,
  };
}

export function mapLegacyFindingHit(hit: FindingSearchHit): FindingItem {
  return mapFindingSource(hit, 'legacy');
}

export function classifyFindingSourceContract(
  source: Record<string, unknown>,
): FindingSchemaCompatibility {
  const hasVersionedMarker =
    Object.hasOwn(source, 'contract') || Object.hasOwn(source, 'schema_version');

  if (!hasVersionedMarker) {
    return 'legacy';
  }

  const parsed = FindingObservationV1Schema.safeParse(source);
  return parsed.success &&
    parsed.data.contract === FINDING_OBSERVATION_CONTRACT &&
    parsed.data.schema_version === FINDING_OBSERVATION_VERSION &&
    parsed.data.sentris.contract_validated === true &&
    parsed.data.sentris.contract_source_validated === true &&
    parsed.data.sentris.contract_document_id === parsed.data.finding_id
    ? 'canonical'
    : 'invalid';
}

export function classifyFindingStorageContract(hit: FindingSearchHit): FindingSchemaCompatibility {
  const sourceCompatibility = classifyFindingSourceContract(hit._source);
  if (sourceCompatibility !== 'canonical') {
    return sourceCompatibility;
  }
  const sentris = asRecord(hit._source.sentris);
  return hit._source.finding_id === hit._id && sentris.contract_document_id === hit._id
    ? 'canonical'
    : 'invalid';
}

export function mapFindingHitWithCompatibility(hit: FindingSearchHit): MappedFindingHit {
  const compatibility = classifyFindingStorageContract(hit);
  if (compatibility === 'legacy') {
    return {
      item: mapLegacyFindingHit(hit),
      compatibility: 'legacy',
    };
  }

  return {
    item: mapFindingSource(hit, compatibility),
    compatibility,
  };
}

export function mapFindingHit(hit: FindingSearchHit): FindingItem {
  return mapFindingHitWithCompatibility(hit).item;
}
