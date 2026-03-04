import { UnauthorizedException } from '@nestjs/common';
import { beforeEach, describe, expect, it, mock } from 'bun:test';

import type { TicketingRepository } from '../../ticketing.repository';
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
    findTicketLinkByExternalId: ReturnType<typeof mock>;
    updateTicketLink: ReturnType<typeof mock>;
  };

  let triageServiceMock: {
    upsertTriage: ReturnType<typeof mock>;
  };

  let dbMock: {
    select: ReturnType<typeof mock>;
  };

  // Helper to build the chainable select mock
  function makeSelectChain(rows: unknown[]) {
    return {
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve(rows),
        }),
      }),
    };
  }

  beforeEach(() => {
    repoMock = {
      findConnectionByWebhookSecret: mock(() => Promise.resolve(makeConnection())),
      findTicketLinkByExternalId: mock(() => Promise.resolve(makeTicketLink())),
      updateTicketLink: mock(() => Promise.resolve(makeTicketLink())),
    };

    triageServiceMock = {
      upsertTriage: mock(() =>
        Promise.resolve({ id: 'triage-1', status: 'fixed', findingOpensearchId: 'f-1' }),
      ),
    };

    // Mock for direct DB queries (findCurrentTriageStatus, getFindingOpensearchId)
    let selectCallCount = 0;
    dbMock = {
      select: mock(() => {
        selectCallCount++;
        // First call: findCurrentTriageStatus → returns current status
        if (selectCallCount === 1) {
          return makeSelectChain([{ status: 'in_progress' }]);
        }
        // Second call: getFindingOpensearchId → returns opensearch ID
        return makeSelectChain([{ findingOpensearchId: 'f-1' }]);
      }),
    };

    service = new JiraWebhookService(
      repoMock as unknown as TicketingRepository,
      triageServiceMock as unknown as FindingTriageService,
      dbMock as any,
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

  it('updates ticket_link sync status to synced after success', async () => {
    const payload = makeIssueUpdatedPayload('SEC-42', 'In Progress', 'Done');

    await service.handleWebhook(WEBHOOK_SECRET, '{}', undefined, payload);

    expect(repoMock.updateTicketLink).toHaveBeenCalledTimes(1);
    const [linkId, data] = repoMock.updateTicketLink.mock.calls[0]!;
    expect(linkId).toBe('link-1');
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
    repoMock.findTicketLinkByExternalId.mockReturnValue(Promise.resolve(undefined));

    const payload = makeIssueUpdatedPayload('SEC-999', 'Open', 'Done');
    const result = await service.handleWebhook(WEBHOOK_SECRET, '{}', undefined, payload);

    expect(result.status).toBe('ignored');
    expect(triageServiceMock.upsertTriage).not.toHaveBeenCalled();
  });

  it('returns ignored when ticket_link belongs to a different org (filtered at DB level)', async () => {
    // With org-scoped query, mismatched org returns undefined from DB
    repoMock.findTicketLinkByExternalId.mockReturnValue(Promise.resolve(undefined));

    const payload = makeIssueUpdatedPayload('SEC-42', 'Open', 'Done');
    const result = await service.handleWebhook(WEBHOOK_SECRET, '{}', undefined, payload);

    expect(result.status).toBe('ignored');
    expect(triageServiceMock.upsertTriage).not.toHaveBeenCalled();
  });

  // -----------------------------------------------------------------------
  // Unmapped status
  // -----------------------------------------------------------------------

  it('returns unmapped_status and marks link as error for unknown Jira status', async () => {
    const payload = makeIssueUpdatedPayload('SEC-42', 'Open', 'Custom Status');
    const result = await service.handleWebhook(WEBHOOK_SECRET, '{}', undefined, payload);

    expect(result.status).toBe('unmapped_status');
    expect(repoMock.updateTicketLink).toHaveBeenCalledWith('link-1', { syncStatus: 'error' });
    expect(triageServiceMock.upsertTriage).not.toHaveBeenCalled();
  });

  // -----------------------------------------------------------------------
  // Idempotency
  // -----------------------------------------------------------------------

  it('returns no_change when triage status already matches', async () => {
    // Current status is already 'fixed', and Jira status maps to 'fixed'
    let selectCallCount = 0;
    dbMock.select = mock(() => {
      selectCallCount++;
      if (selectCallCount === 1) {
        return makeSelectChain([{ status: 'fixed' }]); // already 'fixed'
      }
      return makeSelectChain([{ findingOpensearchId: 'f-1' }]);
    });

    const payload = makeIssueUpdatedPayload('SEC-42', 'In Progress', 'Done'); // Done → fixed
    const result = await service.handleWebhook(WEBHOOK_SECRET, '{}', undefined, payload);

    expect(result.status).toBe('no_change');
    expect(triageServiceMock.upsertTriage).not.toHaveBeenCalled();
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

  it('returns error and marks link when upsertTriage fails', async () => {
    triageServiceMock.upsertTriage.mockRejectedValue(new Error('DB error'));

    const payload = makeIssueUpdatedPayload('SEC-42', 'In Progress', 'Done');
    const result = await service.handleWebhook(WEBHOOK_SECRET, '{}', undefined, payload);

    expect(result.status).toBe('error');
    expect(repoMock.updateTicketLink).toHaveBeenCalledWith('link-1', { syncStatus: 'error' });
  });

  it('returns error when findingOpensearchId cannot be resolved', async () => {
    let selectCallCount = 0;
    dbMock.select = mock(() => {
      selectCallCount++;
      if (selectCallCount === 1) {
        return makeSelectChain([{ status: 'in_progress' }]);
      }
      return makeSelectChain([]); // findingOpensearchId not found
    });

    const payload = makeIssueUpdatedPayload('SEC-42', 'In Progress', 'Done');
    const result = await service.handleWebhook(WEBHOOK_SECRET, '{}', undefined, payload);

    expect(result.status).toBe('error');
  });

  // -----------------------------------------------------------------------
  // Reverse status mapping edge cases
  // -----------------------------------------------------------------------

  it('maps Jira status case-insensitively', async () => {
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
