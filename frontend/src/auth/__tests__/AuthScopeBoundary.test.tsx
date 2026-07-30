import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';

import { AuthScopeBoundary } from '../AuthScopeBoundary';
import { queryKeys } from '@/lib/queryKeys';
import { getAuthHeaders } from '@/services/api/client';
import { useAuthStore } from '@/store/authStore';

function ActiveOrganizationData() {
  const query = useQuery({
    queryKey: queryKeys.integrations.providers(),
    queryFn: async () => useAuthStore.getState().organizationId,
    staleTime: Infinity,
  });

  return <div data-testid="active-org-data">{query.data ?? 'loading'}</div>;
}

describe('AuthScopeBoundary', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    localStorage.clear();
    useAuthStore.getState().clear();
    useAuthStore.getState().setAuthContext({
      token: 'clerk-token',
      userId: 'user-1',
      organizationId: 'org-a',
      roles: ['ADMIN'],
      provider: 'clerk',
    });
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    });
  });

  afterEach(() => {
    cleanup();
    queryClient.clear();
    useAuthStore.getState().clear();
  });

  it('remounts observers and headers onto the newly active Clerk organization', async () => {
    render(
      <AuthScopeBoundary>
        <QueryClientProvider client={queryClient}>
          <ActiveOrganizationData />
        </QueryClientProvider>
      </AuthScopeBoundary>,
    );

    await waitFor(() => expect(screen.getByTestId('active-org-data').textContent).toBe('org-a'));
    expect(queryClient.getQueryData<string>(['integrationProviders', 'org-a'])).toBe('org-a');

    act(() => {
      useAuthStore.getState().setAuthContext({
        organizationId: 'org-b',
        roles: ['MEMBER'],
        provider: 'clerk',
      });
    });

    await waitFor(() => expect(screen.getByTestId('active-org-data').textContent).toBe('org-b'));
    expect(queryClient.getQueryData<string>(['integrationProviders', 'org-b'])).toBe('org-b');
    expect((await getAuthHeaders())['X-Organization-Id']).toBe('org-b');
  });
});
