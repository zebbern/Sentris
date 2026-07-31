import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import { cleanup, renderHook } from '@testing-library/react';

mock.module('@/services/api', () => ({
  API_V1_URL: 'http://localhost:3211/api/v1',
  getApiAuthHeaders: async () => ({ 'X-Organization-Id': 'local-dev' }),
}));

import { useAgentChatTransport } from '../useAgentChatTransport';

const originalFetch = globalThis.fetch;
const fetchMock = mock(async (_input: RequestInfo | URL, _init?: RequestInit) => {
  return new Response('data: [DONE]\n\n', {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  });
});

describe('useAgentChatTransport', () => {
  beforeEach(() => {
    fetchMock.mockClear();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    cleanup();
    globalThis.fetch = originalFetch;
  });

  it('includes the local session cookie on the agent chat stream request', async () => {
    const { result } = renderHook(() => useAgentChatTransport('agent-run-1'));

    await result.current!.sendMessages({
      trigger: 'submit-message',
      chatId: 'agent-run-1',
      messageId: undefined,
      messages: [],
      abortSignal: undefined,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      credentials: 'include',
    });
  });
});
