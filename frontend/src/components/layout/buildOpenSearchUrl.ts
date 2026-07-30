import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';

/**
 * Builds a fully-qualified OpenSearch Data Explorer discover URL.
 *
 * Uses the explicitly mapped keyword fields for exact-match filtering and a
 * one-year time range (run_id is unique, so time filtering is unnecessary).
 */
export interface OpenSearchUrlParams {
  baseUrl: string;
  workflowId: string;
  runId?: string | null;
  orgId: string;
}

function buildOrganizationIndexKey(organizationId: string): string {
  return `o${bytesToHex(sha256(organizationId))}`;
}

export function buildOpenSearchUrl({
  baseUrl,
  workflowId,
  runId,
  orgId,
}: OpenSearchUrlParams): string {
  const normalizedBase = baseUrl.replace(/\/+$/, '');

  // Filter by run_id if a specific run is selected, otherwise by workflow_id
  const filterQuery = runId ? `sentris.run_id:"${runId}"` : `sentris.workflow_id:"${workflowId}"`;

  const organizationKey = buildOrganizationIndexKey(orgId);
  const orgScopedPattern = `security-findings-${organizationKey}-observations-v1`;

  // OpenSearch Data Explorer URL format
  const aParam = encodeURIComponent(
    `(discover:(columns:!(_source),interval:auto,sort:!()),metadata:(indexPattern:'${orgScopedPattern}',view:discover))`,
  );
  const qParam = encodeURIComponent(`(query:(language:kuery,query:'${filterQuery}'))`);
  const gParam = encodeURIComponent(
    '(filters:!(),refreshInterval:(pause:!t,value:0),time:(from:now-1y,to:now))',
  );

  return `${normalizedBase}/app/data-explorer/discover/#?_a=${aParam}&_q=${qParam}&_g=${gParam}`;
}
