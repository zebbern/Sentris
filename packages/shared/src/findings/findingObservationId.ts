import { createHash } from 'node:crypto';

import { FINDING_OBSERVATION_INDEX_SUFFIX } from './findingObservation.js';

export interface FindingObservationIdInput {
  organizationId: string;
  workflowId: string;
  runId: string;
  scopeId?: string | null;
  componentId: string;
  nodeRef: string;
  sourceFindingId: unknown;
}

const FINDING_INDEX_PREFIX = 'security-findings';

/**
 * Validate an exact organization identifier without changing its bytes.
 * Surrounding whitespace is meaningful when other non-whitespace bytes exist;
 * empty/all-whitespace and control characters are not valid tenant identities.
 */
export function validateFindingOrganizationId(organizationId: string): string {
  if (organizationId.length === 0 || organizationId.trim().length === 0) {
    throw new Error('Organization ID is required');
  }
  if (/[\p{Cc}\p{Cs}]/u.test(organizationId)) {
    throw new Error('Organization ID contains control characters or invalid Unicode');
  }
  return organizationId;
}

/**
 * Build the OpenSearch-safe identity for an organization without normalizing
 * away case or whitespace. The fixed-width digest also keeps every derived
 * resource name below OpenSearch's 255-byte index-name limit.
 */
export function buildFindingOrganizationIndexKey(organizationId: string): string {
  return `o${createHash('sha256')
    .update(validateFindingOrganizationId(organizationId), 'utf8')
    .digest('hex')}`;
}

export function buildFindingObservationIndexName(organizationId: string): string {
  return `${FINDING_INDEX_PREFIX}-${buildFindingOrganizationIndexKey(organizationId)}-${FINDING_OBSERVATION_INDEX_SUFFIX}`;
}

export function buildFindingObservationIndexPattern(organizationId: string): string {
  return buildFindingObservationIndexName(organizationId);
}

export function buildAllFindingObservationIndexPattern(): string {
  return `${FINDING_INDEX_PREFIX}-o*-${FINDING_OBSERVATION_INDEX_SUFFIX}`;
}

export function buildTenantAnalyticsIndexPattern(organizationId: string): string {
  return `${FINDING_INDEX_PREFIX}-${buildFindingOrganizationIndexKey(organizationId)}-*`;
}

export function buildTenantAnalyticsIndexName(organizationId: string, indexSuffix: string): string {
  const normalizedSuffix = indexSuffix.trim().toLowerCase();
  if (
    normalizedSuffix === '.' ||
    normalizedSuffix === '..' ||
    !/^[a-z0-9][a-z0-9._-]*$/.test(normalizedSuffix)
  ) {
    throw new Error('Analytics index suffix contains unsupported characters');
  }
  if (
    normalizedSuffix === FINDING_OBSERVATION_INDEX_SUFFIX ||
    normalizedSuffix.endsWith(`-${FINDING_OBSERVATION_INDEX_SUFFIX}`)
  ) {
    throw new Error(
      `Analytics index suffix "${normalizedSuffix}" is reserved for canonical findings observations`,
    );
  }
  if (/^\d{4}\.\d{2}\.\d{2}$/.test(normalizedSuffix)) {
    throw new Error(
      `Analytics index suffix "${normalizedSuffix}" is reserved for legacy findings indexes`,
    );
  }
  return `${FINDING_INDEX_PREFIX}-${buildFindingOrganizationIndexKey(organizationId)}-${normalizedSuffix}`;
}

/**
 * The pre-v2 index key is retained only for explicit, non-destructive
 * migrations. It must never be used for new reads or writes because it
 * collapses case and surrounding whitespace.
 */
export function buildLegacyFindingOrganizationIndexKey(organizationId: string): string {
  const legacy = organizationId.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(legacy)) {
    throw new Error('Organization ID has no representable legacy OpenSearch index key');
  }
  return legacy;
}

function stableSerialize(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return '"[undefined]"';

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableSerialize(item)).join(',')}]`;
  }

  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableSerialize(record[key])}`)
      .join(',')}}`;
  }

  if (typeof value === 'bigint') {
    return JSON.stringify(value.toString());
  }

  const serialized = JSON.stringify(value);
  return serialized ?? JSON.stringify(String(value));
}

/**
 * Build the replay-stable OpenSearch identity for an immutable finding observation.
 *
 * This lives behind a server-only package subpath so importing the shared browser
 * contract does not pull Node's crypto module into frontend bundles.
 */
export function createFindingObservationId(input: FindingObservationIdInput): string {
  const identity = {
    organizationId: input.organizationId,
    workflowId: input.workflowId,
    runId: input.runId,
    scopeId: input.scopeId ?? null,
    componentId: input.componentId,
    nodeRef: input.nodeRef,
    sourceFindingId: input.sourceFindingId,
  };
  const digest = createHash('sha256').update(stableSerialize(identity)).digest('hex');
  return `fo_v1_${digest}`;
}
