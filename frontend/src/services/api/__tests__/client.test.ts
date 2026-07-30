import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';

import { DEFAULT_ORG_ID, useAuthStore } from '@/store/authStore';
import { getAuthHeaders, httpGet } from '../client';
import { registerClerkTokenGetter } from '@/utils/clerk-token';

const originalFetch = globalThis.fetch;

describe('API client local-session boundary', () => {
  beforeEach(() => {
    localStorage.clear();
    useAuthStore.getState().clear();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    mock.restore();
  });

  it('does not recreate Basic authentication from browser state', async () => {
    useAuthStore.getState().setLocalSessionAuthenticated(true);

    const headers = await getAuthHeaders();

    expect(headers.Authorization).toBeUndefined();
    expect(headers['X-Organization-Id']).toBe(DEFAULT_ORG_ID);
  });

  it('includes the httpOnly session cookie on generic API requests', async () => {
    const fetchMock = mock((_input: RequestInfo | URL, _init?: RequestInit) =>
      Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 })),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await httpGet<{ ok: boolean }>('/health-check');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ credentials: 'include' });
  });

  it('does not pair a stale Clerk bearer with a newly selected organization', async () => {
    registerClerkTokenGetter(async () => null);
    useAuthStore.getState().setAuthContext({
      token: 'old-org-a-token',
      userId: 'user-1',
      organizationId: 'org-b',
      roles: ['MEMBER'],
      provider: 'clerk',
    });

    const headers = await getAuthHeaders();

    expect(headers.Authorization).toBeUndefined();
    expect(headers['X-Organization-Id']).toBe('org-b');
  });
});
