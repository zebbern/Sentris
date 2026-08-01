import { afterEach, beforeEach, describe, expect, it, mock, vi } from 'bun:test';
import { cleanup, waitFor } from '@testing-library/react';
import { skipToken } from '@tanstack/react-query';
import { queryKeys } from '@/lib/queryKeys';
import { renderHookWithProviders } from '@/test/render-with-providers';

const listMock = vi.fn();

mock.module('@/services/api', () => ({
  api: {
    secrets: { list: listMock, create: vi.fn(), update: vi.fn(), rotate: vi.fn(), delete: vi.fn() },
  },
}));

import { useSecrets } from '../useSecretQueries';

afterEach(cleanup);
beforeEach(() => listMock.mockReset());

describe('useSecrets', () => {
  it('uses skipToken and makes no request when disabled', () => {
    const { result, queryClient } = renderHookWithProviders(() => useSecrets({ enabled: false }));

    expect(result.current.fetchStatus).toBe('idle');
    expect(listMock).not.toHaveBeenCalled();
    expect(
      queryClient.getQueryCache().find({ queryKey: queryKeys.secrets.all() })?.options.queryFn,
    ).toBe(skipToken);
  });

  it('keeps the organization-scoped key, sorting, and stale time when enabled', async () => {
    listMock.mockResolvedValueOnce([
      { id: '2', name: 'ZULU' },
      { id: '1', name: 'ALPHA' },
    ]);

    const { result, queryClient } = renderHookWithProviders(() => useSecrets());
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(listMock).toHaveBeenCalledTimes(1);
    expect(result.current.data?.map((secret) => secret.name)).toEqual(['ALPHA', 'ZULU']);
    const query = queryClient.getQueryCache().find({ queryKey: queryKeys.secrets.all() });
    expect(query?.queryKey).toEqual(queryKeys.secrets.all());
    expect((query?.options as { staleTime?: number } | undefined)?.staleTime).toBe(5 * 60_000);
  });
});
