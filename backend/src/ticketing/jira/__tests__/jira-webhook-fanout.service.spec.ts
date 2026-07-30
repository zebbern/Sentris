import { beforeEach, describe, expect, it, mock } from 'bun:test';

import type { FindingTriageService } from '../../../findings/finding-triage.service';
import type { TicketingRepository } from '../../ticketing.repository';
import type { TicketingService } from '../../ticketing.service';
import { JiraWebhookService } from '../jira-webhook.service';

const ORGANIZATION_ID = 'org-fanout';
const WEBHOOK_SECRET = 'webhook-secret';

function connection() {
  return {
    id: 'connection-1',
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
      autoCreateOnStatuses: ['in_progress'],
    },
  };
}

function link(id: string, findingTriageId: string) {
  return {
    id,
    findingTriageId,
    organizationId: ORGANIZATION_ID,
    provider: 'jira',
    externalId: 'SEC-42',
    externalUrl: 'https://example.atlassian.net/browse/SEC-42',
    syncStatus: 'synced',
    lastSyncedAt: null,
    metadata: {},
    createdAt: new Date('2026-07-29T10:00:00.000Z'),
  };
}

function webhookPayload() {
  return {
    webhookEvent: 'jira:issue_updated',
    issue: {
      key: 'SEC-42',
      // Deliberately stale: the current Jira lookup below says Done.
      fields: { status: { name: 'In Progress' } },
    },
    changelog: {
      items: [{ field: 'status', fromString: 'Open', toString: 'In Progress' }],
    },
  };
}

function selectRows(rowsByCall: Record<string, unknown>[][]) {
  const select = mock(() => {
    const rows = rowsByCall.shift() ?? [];
    return {
      from: () => ({
        where: () => Promise.resolve(rows),
      }),
    };
  });
  return { select };
}

describe('JiraWebhookService shared-issue convergence', () => {
  let repository: {
    findConnectionByWebhookSecret: ReturnType<typeof mock>;
    findTicketLinksByExternalId: ReturnType<typeof mock>;
    updateTicketLinksByIds: ReturnType<typeof mock>;
  };
  let triage: {
    upsertTriage: ReturnType<typeof mock>;
  };
  let ticketing: {
    getCurrentJiraIssue: ReturnType<typeof mock>;
  };

  beforeEach(() => {
    repository = {
      findConnectionByWebhookSecret: mock(() => Promise.resolve(connection())),
      findTicketLinksByExternalId: mock(() =>
        Promise.resolve([link('link-1', 'triage-1'), link('link-2', 'triage-2')]),
      ),
      updateTicketLinksByIds: mock(() => Promise.resolve()),
    };
    triage = {
      upsertTriage: mock((_auth, findingId: string) =>
        Promise.resolve({
          id: findingId === 'finding-1' ? 'triage-1' : 'triage-2',
          findingOpensearchId: findingId,
          status: 'fixed',
        }),
      ),
    };
    ticketing = {
      getCurrentJiraIssue: mock(() =>
        Promise.resolve({
          id: '10042',
          key: 'SEC-42',
          fields: { status: { id: '5', name: 'Done' } },
        }),
      ),
    };
  });

  it('uses one authoritative Jira status lookup and fans the result out to every org link', async () => {
    const db = selectRows([
      [
        {
          id: 'triage-1',
          status: 'fixed',
          findingOpensearchId: 'finding-1',
        },
        {
          id: 'triage-2',
          status: 'in_progress',
          findingOpensearchId: 'finding-2',
        },
      ],
    ]);
    const service = new JiraWebhookService(
      repository as unknown as TicketingRepository,
      triage as unknown as FindingTriageService,
      db as never,
      ticketing as unknown as TicketingService,
    );

    const result = await service.handleWebhook(WEBHOOK_SECRET, '{}', undefined, webhookPayload());

    expect(result).toEqual({ status: 'synced' });
    expect(ticketing.getCurrentJiraIssue).toHaveBeenCalledTimes(1);
    expect(ticketing.getCurrentJiraIssue).toHaveBeenCalledWith(ORGANIZATION_ID, 'SEC-42');
    expect(repository.findTicketLinksByExternalId).toHaveBeenCalledWith(
      'SEC-42',
      ORGANIZATION_ID,
      'jira',
    );
    expect(db.select).toHaveBeenCalledTimes(1);
    expect(triage.upsertTriage).toHaveBeenCalledTimes(1);
    expect(triage.upsertTriage.mock.calls[0]?.[1]).toBe('finding-2');
    expect(triage.upsertTriage.mock.calls[0]?.[2]).toEqual({ status: 'fixed' });
    expect(repository.updateTicketLinksByIds).toHaveBeenCalledWith(
      ['link-1', 'link-2'],
      ORGANIZATION_ID,
      expect.objectContaining({
        syncStatus: 'synced',
        lastSyncedAt: expect.any(Date),
      }),
    );
  });

  it('preserves verified when the shipped Done alias includes the current target status', async () => {
    repository.findTicketLinksByExternalId.mockResolvedValue([link('link-1', 'triage-1')]);
    const db = selectRows([
      [
        {
          id: 'triage-1',
          status: 'verified',
          findingOpensearchId: 'finding-1',
        },
      ],
    ]);
    const service = new JiraWebhookService(
      repository as unknown as TicketingRepository,
      triage as unknown as FindingTriageService,
      db as never,
      ticketing as unknown as TicketingService,
    );

    const result = await service.handleWebhook(WEBHOOK_SECRET, '{}', undefined, webhookPayload());

    expect(result).toEqual({ status: 'no_change' });
    expect(triage.upsertTriage).not.toHaveBeenCalled();
    expect(repository.updateTicketLinksByIds).toHaveBeenCalledWith(
      ['link-1'],
      ORGANIZATION_ID,
      expect.objectContaining({ syncStatus: 'synced' }),
    );
  });

  it("keeps accepted_risk on delayed and replayed Won't Do callbacks", async () => {
    repository.findTicketLinksByExternalId.mockResolvedValue([link('link-1', 'triage-1')]);
    ticketing.getCurrentJiraIssue.mockResolvedValue({
      id: '10042',
      key: 'SEC-42',
      fields: { status: { id: '6', name: "Won't Do" } },
    });
    const target = {
      id: 'triage-1',
      status: 'accepted_risk',
      findingOpensearchId: 'finding-1',
    };
    const db = selectRows([[target], [target]]);
    const service = new JiraWebhookService(
      repository as unknown as TicketingRepository,
      triage as unknown as FindingTriageService,
      db as never,
      ticketing as unknown as TicketingService,
    );

    const delayed = await service.handleWebhook(WEBHOOK_SECRET, '{}', undefined, webhookPayload());
    const replayed = await service.handleWebhook(WEBHOOK_SECRET, '{}', undefined, webhookPayload());

    expect(delayed).toEqual({ status: 'no_change' });
    expect(replayed).toEqual({ status: 'no_change' });
    expect(ticketing.getCurrentJiraIssue).toHaveBeenCalledTimes(2);
    expect(triage.upsertTriage).not.toHaveBeenCalled();
  });

  it('resolves each fanout target independently and breaks multiple valid aliases deterministically', async () => {
    repository.findConnectionByWebhookSecret.mockResolvedValue({
      ...connection(),
      config: {
        projectKey: 'SEC',
        issueTypeId: '10001',
        statusMapping: {
          in_progress: 'Shared',
          accepted_risk: 'Shared',
        },
        autoCreateOnStatuses: ['in_progress'],
      },
    });
    ticketing.getCurrentJiraIssue.mockResolvedValue({
      id: '10042',
      key: 'SEC-42',
      fields: { status: { id: '7', name: 'Shared' } },
    });
    const db = selectRows([
      [
        {
          id: 'triage-1',
          status: 'triaged',
          findingOpensearchId: 'finding-1',
        },
        {
          id: 'triage-2',
          status: 'new',
          findingOpensearchId: 'finding-2',
        },
      ],
    ]);
    const service = new JiraWebhookService(
      repository as unknown as TicketingRepository,
      triage as unknown as FindingTriageService,
      db as never,
      ticketing as unknown as TicketingService,
    );

    const result = await service.handleWebhook(WEBHOOK_SECRET, '{}', undefined, webhookPayload());

    expect(result).toEqual({ status: 'synced' });
    expect(triage.upsertTriage.mock.calls.map((call) => [call[1], call[2]])).toEqual([
      ['finding-1', { status: 'in_progress' }],
      ['finding-2', { status: 'accepted_risk' }],
    ]);
  });

  it('marks a target with no valid mapped transition as a non-retryable link error', async () => {
    repository.findConnectionByWebhookSecret.mockResolvedValue({
      ...connection(),
      config: {
        projectKey: 'SEC',
        issueTypeId: '10001',
        statusMapping: {
          in_progress: 'In Progress',
        },
        autoCreateOnStatuses: ['in_progress'],
      },
    });
    repository.findTicketLinksByExternalId.mockResolvedValue([link('link-1', 'triage-1')]);
    ticketing.getCurrentJiraIssue.mockResolvedValue({
      id: '10042',
      key: 'SEC-42',
      fields: { status: { id: '4', name: 'In Progress' } },
    });
    const db = selectRows([
      [
        {
          id: 'triage-1',
          status: 'verified',
          findingOpensearchId: 'finding-1',
        },
      ],
    ]);
    const service = new JiraWebhookService(
      repository as unknown as TicketingRepository,
      triage as unknown as FindingTriageService,
      db as never,
      ticketing as unknown as TicketingService,
    );

    const result = await service.handleWebhook(WEBHOOK_SECRET, '{}', undefined, webhookPayload());

    expect(result).toEqual({ status: 'error' });
    expect(triage.upsertTriage).not.toHaveBeenCalled();
    expect(repository.updateTicketLinksByIds).toHaveBeenCalledWith(['link-1'], ORGANIZATION_ID, {
      syncStatus: 'error',
    });
  });

  it('propagates an authoritative lookup failure so Jira receives a retryable non-2xx', async () => {
    const db = selectRows([]);
    ticketing.getCurrentJiraIssue.mockRejectedValue(new Error('Jira status lookup unavailable'));
    const service = new JiraWebhookService(
      repository as unknown as TicketingRepository,
      triage as unknown as FindingTriageService,
      db as never,
      ticketing as unknown as TicketingService,
    );

    await expect(
      service.handleWebhook(WEBHOOK_SECRET, '{}', undefined, webhookPayload()),
    ).rejects.toThrow('Jira status lookup unavailable');

    expect(ticketing.getCurrentJiraIssue).toHaveBeenCalledTimes(1);
    expect(triage.upsertTriage).not.toHaveBeenCalled();
    expect(repository.updateTicketLinksByIds).not.toHaveBeenCalled();
  });

  it('converges every shared link when a partial failure is replayed', async () => {
    const db = selectRows([
      [
        {
          id: 'triage-1',
          status: 'in_progress',
          findingOpensearchId: 'finding-1',
        },
        {
          id: 'triage-2',
          status: 'in_progress',
          findingOpensearchId: 'finding-2',
        },
      ],
      [
        {
          id: 'triage-1',
          status: 'fixed',
          findingOpensearchId: 'finding-1',
        },
        {
          id: 'triage-2',
          status: 'in_progress',
          findingOpensearchId: 'finding-2',
        },
      ],
    ]);
    let failedFindingTwo = false;
    triage.upsertTriage.mockImplementation((_auth, findingId: string) => {
      if (findingId === 'finding-2' && !failedFindingTwo) {
        failedFindingTwo = true;
        return Promise.reject(new Error('transient triage failure'));
      }
      return Promise.resolve({
        id: findingId === 'finding-1' ? 'triage-1' : 'triage-2',
        findingOpensearchId: findingId,
        status: 'fixed',
      });
    });
    const service = new JiraWebhookService(
      repository as unknown as TicketingRepository,
      triage as unknown as FindingTriageService,
      db as never,
      ticketing as unknown as TicketingService,
    );

    await expect(
      service.handleWebhook(WEBHOOK_SECRET, '{}', undefined, webhookPayload()),
    ).rejects.toThrow('transient triage failure');

    const result = await service.handleWebhook(WEBHOOK_SECRET, '{}', undefined, webhookPayload());

    expect(result).toEqual({ status: 'synced' });
    expect(ticketing.getCurrentJiraIssue).toHaveBeenCalledTimes(2);
    expect(triage.upsertTriage.mock.calls.map((call) => call[1])).toEqual([
      'finding-1',
      'finding-2',
      'finding-2',
    ]);
    expect(repository.updateTicketLinksByIds).toHaveBeenLastCalledWith(
      ['link-1', 'link-2'],
      ORGANIZATION_ID,
      expect.objectContaining({ syncStatus: 'synced' }),
    );
  });
});
