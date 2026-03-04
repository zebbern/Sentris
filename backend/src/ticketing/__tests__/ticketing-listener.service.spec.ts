import { beforeEach, describe, expect, it, mock } from 'bun:test';

import type { FindingTriageChangedEvent } from '@sentris/shared';
import { TicketingListenerService } from '../ticketing-listener.service';
import type { TicketingService } from '../ticketing.service';
import type { TicketingRepository } from '../ticketing.repository';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ORG_ID = 'org-listener-1';

function makeConnection(overrides: Record<string, unknown> = {}) {
  return {
    id: 'conn-1',
    organizationId: ORG_ID,
    provider: 'jira',
    cloudId: 'cloud-abc',
    config: {
      projectKey: 'SEC',
      issueTypeId: '10001',
      statusMapping: {
        triaged: 'Open',
        in_progress: 'In Progress',
        fixed: 'Done',
      },
      autoCreateOnStatuses: ['triaged'],
    },
    ...overrides,
  };
}

function makeTicketLink(overrides: Record<string, unknown> = {}) {
  return {
    id: 'link-1',
    findingTriageId: 'triage-1',
    organizationId: ORG_ID,
    provider: 'jira',
    externalId: 'SEC-42',
    externalUrl: 'https://myteam.atlassian.net/browse/SEC-42',
    syncStatus: 'synced',
    lastSyncedAt: new Date(),
    metadata: {},
    createdAt: new Date(),
    ...overrides,
  };
}

function makeEvent(overrides: Partial<FindingTriageChangedEvent> = {}): FindingTriageChangedEvent {
  return {
    findingTriageId: 'triage-1',
    findingOpensearchId: 'f-1',
    organizationId: ORG_ID,
    status: 'triaged',
    previousStatus: 'new',
    source: 'user',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TicketingListenerService', () => {
  let listener: TicketingListenerService;
  let serviceMock: {
    createTicket: ReturnType<typeof mock>;
    updateTicketStatus: ReturnType<typeof mock>;
  };
  let repoMock: {
    findConnectionByOrg: ReturnType<typeof mock>;
    findTicketLinkByTriageId: ReturnType<typeof mock>;
  };

  beforeEach(() => {
    serviceMock = {
      createTicket: mock(() => Promise.resolve(makeTicketLink())),
      updateTicketStatus: mock(() => Promise.resolve()),
    };

    repoMock = {
      findConnectionByOrg: mock(() => Promise.resolve(makeConnection())),
      findTicketLinkByTriageId: mock(() => Promise.resolve(undefined)),
    };

    listener = new TicketingListenerService(
      serviceMock as unknown as TicketingService,
      repoMock as unknown as TicketingRepository,
    );
  });

  // -----------------------------------------------------------------------
  // Auto-create ticket
  // -----------------------------------------------------------------------

  it('creates ticket when status is in autoCreateOnStatuses and no existing link', async () => {
    repoMock.findTicketLinkByTriageId.mockResolvedValue(undefined);

    await listener.handleFindingTriageChanged(makeEvent({ status: 'triaged' }));

    expect(serviceMock.createTicket).toHaveBeenCalledTimes(1);
    const [orgId, triageId, findingData] = serviceMock.createTicket.mock.calls[0]!;
    expect(orgId).toBe(ORG_ID);
    expect(triageId).toBe('triage-1');
    expect(findingData.findingOpensearchId).toBe('f-1');
  });

  // -----------------------------------------------------------------------
  // Sync existing ticket
  // -----------------------------------------------------------------------

  it('syncs status when ticket already exists', async () => {
    repoMock.findTicketLinkByTriageId.mockResolvedValue(makeTicketLink());

    await listener.handleFindingTriageChanged(makeEvent({ status: 'in_progress' }));

    expect(serviceMock.updateTicketStatus).toHaveBeenCalledTimes(1);
    expect(serviceMock.updateTicketStatus).toHaveBeenCalledWith(ORG_ID, 'triage-1', 'in_progress');
    expect(serviceMock.createTicket).not.toHaveBeenCalled();
  });

  // -----------------------------------------------------------------------
  // Circular prevention
  // -----------------------------------------------------------------------

  it('skips when source is jira_webhook (circular prevention)', async () => {
    await listener.handleFindingTriageChanged(makeEvent({ source: 'jira_webhook' }));

    expect(serviceMock.createTicket).not.toHaveBeenCalled();
    expect(serviceMock.updateTicketStatus).not.toHaveBeenCalled();
    expect(repoMock.findConnectionByOrg).not.toHaveBeenCalled();
  });

  // -----------------------------------------------------------------------
  // No connection
  // -----------------------------------------------------------------------

  it('skips when org has no Jira connection', async () => {
    repoMock.findConnectionByOrg.mockResolvedValue(undefined);

    await listener.handleFindingTriageChanged(makeEvent());

    expect(serviceMock.createTicket).not.toHaveBeenCalled();
    expect(serviceMock.updateTicketStatus).not.toHaveBeenCalled();
  });

  // -----------------------------------------------------------------------
  // Connection not configured
  // -----------------------------------------------------------------------

  it('skips when connection is not fully configured', async () => {
    repoMock.findConnectionByOrg.mockResolvedValue(makeConnection({ config: {} }));

    await listener.handleFindingTriageChanged(makeEvent());

    expect(serviceMock.createTicket).not.toHaveBeenCalled();
    expect(serviceMock.updateTicketStatus).not.toHaveBeenCalled();
  });

  // -----------------------------------------------------------------------
  // Status not in auto-create list and no existing ticket
  // -----------------------------------------------------------------------

  it('skips when new status is not in autoCreateOnStatuses and no existing ticket', async () => {
    repoMock.findTicketLinkByTriageId.mockResolvedValue(undefined);

    // 'fixed' is not in autoCreateOnStatuses ['triaged']
    await listener.handleFindingTriageChanged(makeEvent({ status: 'fixed' }));

    expect(serviceMock.createTicket).not.toHaveBeenCalled();
    expect(serviceMock.updateTicketStatus).not.toHaveBeenCalled();
  });

  // -----------------------------------------------------------------------
  // Error handling
  // -----------------------------------------------------------------------

  it('handles adapter errors gracefully (does not throw)', async () => {
    repoMock.findTicketLinkByTriageId.mockResolvedValue(undefined);
    serviceMock.createTicket.mockRejectedValue(new Error('Jira API rate limit'));

    // Should not throw — listener catches errors internally
    await listener.handleFindingTriageChanged(makeEvent({ status: 'triaged' }));

    expect(serviceMock.createTicket).toHaveBeenCalledTimes(1);
  });

  it('handles updateTicketStatus errors gracefully', async () => {
    repoMock.findTicketLinkByTriageId.mockResolvedValue(makeTicketLink());
    serviceMock.updateTicketStatus.mockRejectedValue(new Error('Network error'));

    // Should not throw
    await listener.handleFindingTriageChanged(makeEvent({ status: 'in_progress' }));

    expect(serviceMock.updateTicketStatus).toHaveBeenCalledTimes(1);
  });
});
