import { afterEach, describe, expect, it, mock } from 'bun:test';

mock.module('../client', () => ({
  API_V1_URL: 'http://localhost/api/v1',
  getAuthHeaders: async () => ({ Authorization: 'Bearer test' }),
}));

import { templatesApi } from '../templates';

describe('templatesApi.importCommunity', () => {
  afterEach(() => {
    mock.restore();
  });

  it('POSTs to /templates/community/import', async () => {
    const fetchMock = mock(
      async () =>
        new Response(JSON.stringify({ id: 'tmpl-1', name: 'Demo', isOfficial: false }), {
          status: 201,
          headers: { 'Content-Type': 'application/json' },
        }),
    );
    (globalThis as { fetch: typeof fetch }).fetch = fetchMock as unknown as typeof fetch;

    const result = await templatesApi.importCommunity({ id: 'demo-passive-lookup' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const call = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const [url, init] = call;
    expect(url).toBe('http://localhost/api/v1/templates/community/import');
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({ id: 'demo-passive-lookup' });
    expect(result.id).toBe('tmpl-1');
  });
});
