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
    projectionVersion: 1,
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
    registerPendingWebhook: ReturnType<typeof mock>;
  };
  let repoMock: {
    findConnectionByOrg: ReturnType<typeof mock>;
    findTicketLinkByTriageId: ReturnType<typeof mock>;
  };

  beforeEach(() => {
    serviceMock = {
      createTicket: mock(() => Promise.resolve(makeTicketLink())),
      updateTicketStatus: mock(() => Promise.resolve()),
      registerPendingWebhook: mock(() => Promise.resolve()),
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
    expect(serviceMock.createTicket.mock.calls[0]![3]).toBe(1);
  });

  // -----------------------------------------------------------------------
  // Sync existing ticket
  // -----------------------------------------------------------------------

  it('syncs status when ticket already exists', async () => {
    repoMock.findTicketLinkByTriageId.mockResolvedValue(makeTicketLink());

    await listener.handleFindingTriageChanged(makeEvent({ status: 'in_progress' }));

    expect(repoMock.findTicketLinkByTriageId).toHaveBeenCalledWith('triage-1', ORG_ID);
    expect(serviceMock.updateTicketStatus).toHaveBeenCalledTimes(1);
    expect(serviceMock.updateTicketStatus).toHaveBeenCalledWith(
      ORG_ID,
      'triage-1',
      'in_progress',
      1,
    );
    expect(serviceMock.createTicket).not.toHaveBeenCalled();
  });

  it('skips a stale or replayed event after a newer projection version was applied', async () => {
    repoMock.findTicketLinkByTriageId.mockResolvedValue(
      makeTicketLink({ metadata: { lastAppliedProjectionVersion: 2 } }),
    );

    await listener.handleFindingTriageChanged(
      makeEvent({ status: 'in_progress', projectionVersion: 1 }),
    );

    expect(serviceMock.updateTicketStatus).not.toHaveBeenCalled();
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

  it('rejects an invalid projection version instead of acknowledging malformed ordering data', async () => {
    await expect(
      listener.handleFindingTriageChanged(makeEvent({ projectionVersion: 0 })),
    ).rejects.toThrow('projectionVersion');

    expect(repoMock.findConnectionByOrg).not.toHaveBeenCalled();
    expect(serviceMock.createTicket).not.toHaveBeenCalled();
    expect(serviceMock.updateTicketStatus).not.toHaveBeenCalled();
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

  it('propagates adapter errors so the durable outbox retries', async () => {
    repoMock.findTicketLinkByTriageId.mockResolvedValue(undefined);
    serviceMock.createTicket.mockRejectedValue(new Error('Jira API rate limit'));

    await expect(
      listener.handleFindingTriageChanged(makeEvent({ status: 'triaged' })),
    ).rejects.toThrow('Jira API rate limit');

    expect(serviceMock.createTicket).toHaveBeenCalledTimes(1);
  });

  it('propagates update errors so the durable outbox retries', async () => {
    repoMock.findTicketLinkByTriageId.mockResolvedValue(makeTicketLink());
    serviceMock.updateTicketStatus.mockRejectedValue(new Error('Network error'));

    await expect(
      listener.handleFindingTriageChanged(makeEvent({ status: 'in_progress' })),
    ).rejects.toThrow('Network error');

    expect(serviceMock.updateTicketStatus).toHaveBeenCalledTimes(1);
  });

  it('dispatches durable webhook registration events and propagates failures for retry', async () => {
    serviceMock.registerPendingWebhook.mockRejectedValue(
      new Error('Jira registration unavailable'),
    );
    const handleRegistration = (
      listener as unknown as {
        handleJiraWebhookRegistrationRequested: (event: {
          organizationId: string;
          connectionId: string;
          registrationVersion: number;
        }) => Promise<void>;
      }
    ).handleJiraWebhookRegistrationRequested;

    await expect(
      handleRegistration.call(listener, {
        organizationId: ORG_ID,
        connectionId: 'conn-1',
        registrationVersion: 2,
      }),
    ).rejects.toThrow('Jira registration unavailable');

    expect(serviceMock.registerPendingWebhook).toHaveBeenCalledWith({
      organizationId: ORG_ID,
      connectionId: 'conn-1',
      registrationVersion: 2,
    });
  });
});
