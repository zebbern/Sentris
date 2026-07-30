import { UnauthorizedException } from '@nestjs/common';
import { beforeEach, describe, expect, it, mock } from 'bun:test';

import type { TicketingRepository } from '../../ticketing.repository';
import type { TicketingService } from '../../ticketing.service';
import type { FindingTriageService } from '../../../findings/finding-triage.service';
import { JiraWebhookService } from '../jira-webhook.service';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const WEBHOOK_SECRET = 'wh-secret-abc123def456';
const ORGANIZATION_ID = 'org-1';

function makeConnection(overrides: Record<string, unknown> = {}) {
  return {
    id: 'conn-1',
    organizationId: ORGANIZATION_ID,
    provider: 'jira',
    webhookSecret: WEBHOOK_SECRET,
    config: {
      projectKey: 'SEC',
      issueTypeId: '10001',
      statusMapping: {
        triaged: 'Open',
        in_progress: 'In Progress',
        fixed: 'Done',
        verified: 'Done',
        wont_fix: "Won't Do",
        accepted_risk: "Won't Do",
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
    organizationId: ORGANIZATION_ID,
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

function makeIssueUpdatedPayload(
  issueKey: string,
  fromStatus: string,
  toStatus: string,
): Record<string, unknown> {
  return {
    webhookEvent: 'jira:issue_updated',
    issue: {
      key: issueKey,
      fields: { status: { name: toStatus, id: '10001' } },
    },
    changelog: {
      items: [{ field: 'status', fromString: fromStatus, toString: toStatus }],
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('JiraWebhookService', () => {
  let service: JiraWebhookService;

  let repoMock: {
    findConnectionByWebhookSecret: ReturnType<typeof mock>;
    findTicketLinksByExternalId: ReturnType<typeof mock>;
    updateTicketLinksByIds: ReturnType<typeof mock>;
  };

  let triageServiceMock: {
    upsertTriage: ReturnType<typeof mock>;
  };

  let dbMock: {
    select: ReturnType<typeof mock>;
  };

  let ticketingServiceMock: {
    getCurrentJiraIssue: ReturnType<typeof mock>;
  };

  function makeSelectChain(rows: unknown[]) {
    return {
      from: () => ({
        where: () => Promise.resolve(rows),
      }),
    };
  }

  beforeEach(() => {
    repoMock = {
      findConnectionByWebhookSecret: mock(() => Promise.resolve(makeConnection())),
      findTicketLinksByExternalId: mock(() => Promise.resolve([makeTicketLink()])),
      updateTicketLinksByIds: mock(() => Promise.resolve()),
    };

    triageServiceMock = {
      upsertTriage: mock(() =>
        Promise.resolve({ id: 'triage-1', status: 'fixed', findingOpensearchId: 'f-1' }),
      ),
    };

    dbMock = {
      select: mock(() =>
        makeSelectChain([
          {
            id: 'triage-1',
            status: 'in_progress',
            findingOpensearchId: 'f-1',
          },
        ]),
      ),
    };

    ticketingServiceMock = {
      getCurrentJiraIssue: mock(() =>
        Promise.resolve({
          id: '10042',
          key: 'SEC-42',
          fields: { status: { id: '5', name: 'Done' } },
        }),
      ),
    };

    service = new JiraWebhookService(
      repoMock as unknown as TicketingRepository,
      triageServiceMock as unknown as FindingTriageService,
      dbMock as any,
      ticketingServiceMock as unknown as TicketingService,
    );
  });

  // -----------------------------------------------------------------------
  // Happy path
  // -----------------------------------------------------------------------

  it('processes a valid issue status transition and updates triage', async () => {
    const payload = makeIssueUpdatedPayload('SEC-42', 'In Progress', 'Done');

    const result = await service.handleWebhook(WEBHOOK_SECRET, '{}', undefined, payload);

    expect(result.status).toBe('synced');
    expect(triageServiceMock.upsertTriage).toHaveBeenCalledTimes(1);

    const [auth, findingId, input, source] = triageServiceMock.upsertTriage.mock.calls[0]!;
    expect(auth.userId).toBe('system:jira-webhook');
    expect(auth.organizationId).toBe(ORGANIZATION_ID);
    expect(findingId).toBe('f-1');
    expect(input.status).toBe('fixed');
    expect(source).toBe('jira_webhook');
  });

  it('reverse-maps the resulting Jira status independently of the outbound transition name', async () => {
    repoMock.findConnectionByWebhookSecret.mockResolvedValue(
      makeConnection({
        config: {
          projectKey: 'SEC',
          issueTypeId: '10001',
          statusMapping: {
            fixed: {
              transitionName: 'Resolve issue',
              resultingStatus: 'Done',
            },
          },
          autoCreateOnStatuses: ['triaged'],
        },
      }),
    );
    const payload = makeIssueUpdatedPayload('SEC-42', 'In Progress', 'Done');

    const result = await service.handleWebhook(WEBHOOK_SECRET, '{}', undefined, payload);

    expect(result.status).toBe('synced');
    expect(triageServiceMock.upsertTriage.mock.calls[0]?.[2]).toEqual({ status: 'fixed' });
  });

  it('updates ticket_link sync status to synced after success', async () => {
    const payload = makeIssueUpdatedPayload('SEC-42', 'In Progress', 'Done');

    await service.handleWebhook(WEBHOOK_SECRET, '{}', undefined, payload);

    expect(repoMock.updateTicketLinksByIds).toHaveBeenCalledTimes(1);
    const [linkIds, organizationId, data] = repoMock.updateTicketLinksByIds.mock.calls[0]!;
    expect(linkIds).toEqual(['link-1']);
    expect(organizationId).toBe(ORGANIZATION_ID);
    expect(data.syncStatus).toBe('synced');
    expect(data.lastSyncedAt).toBeInstanceOf(Date);
  });

  // -----------------------------------------------------------------------
  // Unknown secret
  // -----------------------------------------------------------------------

  it('returns ignored when webhook secret is unknown', async () => {
    repoMock.findConnectionByWebhookSecret.mockReturnValue(Promise.resolve(undefined));

    const payload = makeIssueUpdatedPayload('SEC-42', 'Open', 'Done');
    const result = await service.handleWebhook('unknown-secret', '{}', undefined, payload);

    expect(result.status).toBe('ignored');
    expect(triageServiceMock.upsertTriage).not.toHaveBeenCalled();
  });

  // -----------------------------------------------------------------------
  // Event filtering
  // -----------------------------------------------------------------------

  it('ignores non-issue-updated events', async () => {
    const payload = { webhookEvent: 'jira:issue_created', issue: { key: 'SEC-42' } };
    const result = await service.handleWebhook(WEBHOOK_SECRET, '{}', undefined, payload);

    expect(result.status).toBe('ignored');
    expect(triageServiceMock.upsertTriage).not.toHaveBeenCalled();
  });

  it('ignores events without status change in changelog', async () => {
    const payload = {
      webhookEvent: 'jira:issue_updated',
      issue: { key: 'SEC-42' },
      changelog: { items: [{ field: 'summary', fromString: 'Old', toString: 'New' }] },
    };
    const result = await service.handleWebhook(WEBHOOK_SECRET, '{}', undefined, payload);

    expect(result.status).toBe('ignored');
  });

  it('ignores events with missing issue key', async () => {
    const payload = {
      webhookEvent: 'jira:issue_updated',
      issue: {},
      changelog: { items: [{ field: 'status', fromString: 'Open', toString: 'Done' }] },
    };
    const result = await service.handleWebhook(WEBHOOK_SECRET, '{}', undefined, payload);

    expect(result.status).toBe('ignored');
  });

  it('ignores events with invalid issue key format', async () => {
    const payload = {
      webhookEvent: 'jira:issue_updated',
      issue: { key: 'invalid-key-123' },
      changelog: { items: [{ field: 'status', fromString: 'Open', toString: 'Done' }] },
    };
    const result = await service.handleWebhook(WEBHOOK_SECRET, '{}', undefined, payload);

    expect(result.status).toBe('ignored');
  });

  // -----------------------------------------------------------------------
  // Ticket link not found
  // -----------------------------------------------------------------------

  it('returns ignored when no ticket_link exists for the issue', async () => {
    repoMock.findTicketLinksByExternalId.mockReturnValue(Promise.resolve([]));

    const payload = makeIssueUpdatedPayload('SEC-999', 'Open', 'Done');
    const result = await service.handleWebhook(WEBHOOK_SECRET, '{}', undefined, payload);

    expect(result.status).toBe('ignored');
    expect(triageServiceMock.upsertTriage).not.toHaveBeenCalled();
  });

  it('returns ignored when ticket_link belongs to a different org (filtered at DB level)', async () => {
    // With org-scoped query, mismatched org returns undefined from DB
    repoMock.findTicketLinksByExternalId.mockReturnValue(Promise.resolve([]));

    const payload = makeIssueUpdatedPayload('SEC-42', 'Open', 'Done');
    const result = await service.handleWebhook(WEBHOOK_SECRET, '{}', undefined, payload);

    expect(result.status).toBe('ignored');
    expect(triageServiceMock.upsertTriage).not.toHaveBeenCalled();
  });

  // -----------------------------------------------------------------------
  // Unmapped status
  // -----------------------------------------------------------------------

  it('returns unmapped_status and marks link as error for unknown Jira status', async () => {
    ticketingServiceMock.getCurrentJiraIssue.mockResolvedValue({
      id: '10042',
      key: 'SEC-42',
      fields: { status: { name: 'Custom Status' } },
    });
    const payload = makeIssueUpdatedPayload('SEC-42', 'Open', 'Custom Status');
    const result = await service.handleWebhook(WEBHOOK_SECRET, '{}', undefined, payload);

    expect(result.status).toBe('unmapped_status');
    expect(repoMock.updateTicketLinksByIds).toHaveBeenCalledWith(['link-1'], ORGANIZATION_ID, {
      syncStatus: 'error',
    });
    expect(triageServiceMock.upsertTriage).not.toHaveBeenCalled();
  });

  // -----------------------------------------------------------------------
  // Idempotency
  // -----------------------------------------------------------------------

  it('returns no_change when triage status already matches', async () => {
    // Current status is already 'fixed', and Jira status maps to 'fixed'
    dbMock.select = mock(() =>
      makeSelectChain([
        {
          id: 'triage-1',
          status: 'fixed',
          findingOpensearchId: 'f-1',
        },
      ]),
    );

    const payload = makeIssueUpdatedPayload('SEC-42', 'In Progress', 'Done'); // Done → fixed
    const result = await service.handleWebhook(WEBHOOK_SECRET, '{}', undefined, payload);

    expect(result.status).toBe('no_change');
    expect(triageServiceMock.upsertTriage).not.toHaveBeenCalled();
    expect(repoMock.updateTicketLinksByIds).toHaveBeenCalledTimes(1);
    expect(repoMock.updateTicketLinksByIds).toHaveBeenCalledWith(['link-1'], ORGANIZATION_ID, {
      syncStatus: 'synced',
      lastSyncedAt: expect.any(Date),
    });
  });

  // -----------------------------------------------------------------------
  // HMAC verification
  // -----------------------------------------------------------------------

  it('throws UnauthorizedException when HMAC signature is invalid', async () => {
    const payload = makeIssueUpdatedPayload('SEC-42', 'Open', 'Done');

    await expect(
      service.handleWebhook(WEBHOOK_SECRET, '{"test":"body"}', 'invalid-sig', payload),
    ).rejects.toThrow(UnauthorizedException);
  });

  // -----------------------------------------------------------------------
  // Error handling
  // -----------------------------------------------------------------------

  it('throws and marks the link when upsertTriage fails so Jira retries the delivery', async () => {
    triageServiceMock.upsertTriage.mockRejectedValue(new Error('DB error'));

    const payload = makeIssueUpdatedPayload('SEC-42', 'In Progress', 'Done');

    await expect(service.handleWebhook(WEBHOOK_SECRET, '{}', undefined, payload)).rejects.toThrow(
      'DB error',
    );
    expect(repoMock.updateTicketLinksByIds).toHaveBeenCalledWith(['link-1'], ORGANIZATION_ID, {
      syncStatus: 'error',
    });
  });

  it('successfully processes a retried delivery after a transient triage failure', async () => {
    triageServiceMock.upsertTriage
      .mockRejectedValueOnce(new Error('transient DB error'))
      .mockResolvedValueOnce({
        id: 'triage-1',
        status: 'fixed',
        findingOpensearchId: 'f-1',
      });
    dbMock.select = mock(() =>
      makeSelectChain([
        {
          id: 'triage-1',
          status: 'in_progress',
          findingOpensearchId: 'f-1',
        },
      ]),
    );

    const payload = makeIssueUpdatedPayload('SEC-42', 'In Progress', 'Done');
    await expect(service.handleWebhook(WEBHOOK_SECRET, '{}', undefined, payload)).rejects.toThrow(
      'transient DB error',
    );

    const result = await service.handleWebhook(WEBHOOK_SECRET, '{}', undefined, payload);

    expect(result.status).toBe('synced');
    expect(triageServiceMock.upsertTriage).toHaveBeenCalledTimes(2);
  });

  it('repairs ticket-link state when a retry observes that triage already succeeded', async () => {
    let selectCallCount = 0;
    dbMock.select = mock(() => {
      selectCallCount++;
      return makeSelectChain([
        {
          id: 'triage-1',
          status: selectCallCount === 1 ? 'in_progress' : 'fixed',
          findingOpensearchId: 'f-1',
        },
      ]);
    });
    repoMock.updateTicketLinksByIds
      .mockRejectedValueOnce(new Error('ticket link write failed'))
      .mockResolvedValueOnce(undefined);

    const payload = makeIssueUpdatedPayload('SEC-42', 'In Progress', 'Done');
    await expect(service.handleWebhook(WEBHOOK_SECRET, '{}', undefined, payload)).rejects.toThrow(
      'ticket link write failed',
    );

    const result = await service.handleWebhook(WEBHOOK_SECRET, '{}', undefined, payload);

    expect(result.status).toBe('no_change');
    expect(triageServiceMock.upsertTriage).toHaveBeenCalledTimes(1);
    expect(repoMock.updateTicketLinksByIds).toHaveBeenCalledTimes(2);
    expect(repoMock.updateTicketLinksByIds).toHaveBeenLastCalledWith(['link-1'], ORGANIZATION_ID, {
      syncStatus: 'synced',
      lastSyncedAt: expect.any(Date),
    });
  });

  it('throws and marks the link when its triage target cannot be resolved', async () => {
    dbMock.select = mock(() => makeSelectChain([]));

    const payload = makeIssueUpdatedPayload('SEC-42', 'In Progress', 'Done');
    await expect(service.handleWebhook(WEBHOOK_SECRET, '{}', undefined, payload)).rejects.toThrow(
      'Finding triage triage-1 is unavailable',
    );
    expect(repoMock.updateTicketLinksByIds).toHaveBeenCalledWith(['link-1'], ORGANIZATION_ID, {
      syncStatus: 'error',
    });
  });

  // -----------------------------------------------------------------------
  // Reverse status mapping edge cases
  // -----------------------------------------------------------------------

  it('maps Jira status case-insensitively', async () => {
    ticketingServiceMock.getCurrentJiraIssue.mockResolvedValue({
      id: '10042',
      key: 'SEC-42',
      fields: { status: { name: 'done' } },
    });
    const payload = makeIssueUpdatedPayload('SEC-42', 'Open', 'done'); // lowercase
    const result = await service.handleWebhook(WEBHOOK_SECRET, '{}', undefined, payload);

    expect(result.status).toBe('synced');
    const [, , input] = triageServiceMock.upsertTriage.mock.calls[0]!;
    expect(input.status).toBe('fixed');
  });

  it('handles connection with no config gracefully', async () => {
    repoMock.findConnectionByWebhookSecret.mockReturnValue(
      Promise.resolve(makeConnection({ config: null })),
    );

    const payload = makeIssueUpdatedPayload('SEC-42', 'Open', 'Done');
    const result = await service.handleWebhook(WEBHOOK_SECRET, '{}', undefined, payload);

    expect(result.status).toBe('unmapped_status');
  });
});
