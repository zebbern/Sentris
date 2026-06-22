import { beforeEach, describe, expect, it, mock, vi } from 'bun:test';
import { cleanup, waitFor } from '@testing-library/react';
import { renderHookWithProviders } from '@/test/render-with-providers';

const getPartsMock = vi.fn();

mock.module('@/services/api', () => ({
  api: {
    agents: {
      getParts: getPartsMock,
    },
  },
  API_V1_URL: 'http://localhost:3211/api/v1',
  getApiAuthHeaders: vi.fn().mockResolvedValue({ Authorization: 'Bearer test-token' }),
}));

import { useAgentTranscript } from '../useAgentTranscript';

beforeEach(() => {
  cleanup();
  getPartsMock.mockReset();
});

describe('useAgentTranscript', () => {
  it('loads transcript parts through the agent API query service', async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    getPartsMock.mockResolvedValueOnce({
      agentRunId: 'agent-run-1',
      workflowRunId: 'run-1',
      nodeRef: 'agent-node',
      cursor: 7,
      parts: [],
    });

    const { result } = renderHookWithProviders(() => useAgentTranscript('agent-run-1'));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(getPartsMock).toHaveBeenCalledWith('agent-run-1');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.current.cursor).toBe(7);
    expect(result.current.messages).toEqual([]);
    expect(result.current.parts).toEqual([]);
    expect(result.current.steps).toEqual([]);
  });
});
