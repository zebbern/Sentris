import { beforeEach, describe, expect, mock, vi, it } from 'bun:test';
import type { TicketLinkResponse } from '@sentris/shared';

const httpGetMock = vi.fn();

mock.module('@/services/api/client', () => ({
  httpGet: httpGetMock,
  httpPost: vi.fn(),
  httpPut: vi.fn(),
  httpDel: vi.fn(),
}));

import { ticketingApi } from '../ticketing';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ticketingApi.getFindingTicket', () => {
  it('accepts the explicit unresolved ticket-link contract', async () => {
    const unresolved: TicketLinkResponse = {
      id: 'ac145d3c-99e6-47b2-bda6-2cab2023f565',
      findingTriageId: '3cfde7c0-dfaf-4a6b-87fd-b92b688c4f48',
      provider: 'jira',
      externalId: null,
      externalUrl: null,
      syncStatus: 'unknown',
      reconciliationRequired: true,
      lastSyncedAt: null,
      createdAt: '2026-07-26T11:00:00.000Z',
    };
    httpGetMock.mockResolvedValueOnce(unresolved);

    await expect(ticketingApi.getFindingTicket('finding-1')).resolves.toEqual(unresolved);
    expect(httpGetMock).toHaveBeenCalledWith('/findings/finding-1/ticket');
  });

  it('rejects legacy unresolved placeholders that could become empty clickable links', async () => {
    httpGetMock.mockResolvedValueOnce({
      id: 'ac145d3c-99e6-47b2-bda6-2cab2023f565',
      findingTriageId: '3cfde7c0-dfaf-4a6b-87fd-b92b688c4f48',
      provider: 'jira',
      externalId: 'sentris-pending:3cfde7c0-dfaf-4a6b-87fd-b92b688c4f48',
      externalUrl: '',
      syncStatus: 'unknown',
      lastSyncedAt: null,
      createdAt: '2026-07-26T11:00:00.000Z',
    });

    await expect(ticketingApi.getFindingTicket('finding-1')).rejects.toThrow();
  });
});
