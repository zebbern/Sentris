import type { TicketLinkResponse } from '@sentris/shared';

import type { TicketLinkRecord } from '../database/schema';

const UNRESOLVED_EXTERNAL_ID_PREFIX = 'sentris-pending:';

export function presentTicketLink(link: TicketLinkRecord): TicketLinkResponse {
  const common = {
    id: link.id,
    findingTriageId: link.findingTriageId,
    provider: 'jira' as const,
    lastSyncedAt: link.lastSyncedAt?.toISOString() ?? null,
    createdAt: link.createdAt.toISOString(),
  };
  const reconciliationRequired =
    link.syncStatus === 'pending' ||
    link.syncStatus === 'unknown' ||
    link.externalId.startsWith(UNRESOLVED_EXTERNAL_ID_PREFIX);

  if (reconciliationRequired) {
    return {
      ...common,
      externalId: null,
      externalUrl: null,
      syncStatus: 'unknown',
      reconciliationRequired: true,
    };
  }

  return {
    ...common,
    externalId: link.externalId,
    externalUrl: link.externalUrl,
    syncStatus: link.syncStatus === 'error' ? 'error' : 'synced',
    reconciliationRequired: false,
  };
}
