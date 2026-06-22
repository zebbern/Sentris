import { beforeEach, describe, expect, it, mock, vi } from 'bun:test';

const fetchMock = vi.fn();

mock.module('@/services/api/client', () => ({
  getAuthHeaders: vi.fn().mockResolvedValue({ Authorization: 'Bearer test-token' }),
  API_V1_URL: 'http://localhost:3211/api/v1',
}));

import { agentsApi } from '../agents';

beforeEach(() => {
  fetchMock.mockReset();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});

describe('agentsApi.getParts', () => {
  it('fetches stored agent trace parts', async () => {
    const response = {
      agentRunId: 'agent-run-1',
      workflowRunId: 'run-1',
      nodeRef: 'agent-node',
      cursor: 3,
      parts: [],
    };
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(response),
    });

    const result = await agentsApi.getParts('agent-run-1');

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3211/api/v1/agents/agent-run-1/parts',
      {
        headers: { Authorization: 'Bearer test-token' },
      },
    );
    expect(result).toEqual(response);
  });
});
