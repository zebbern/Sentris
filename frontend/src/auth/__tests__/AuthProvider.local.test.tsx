import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';

import { AuthProvider } from '../AuthProvider';
import { useAuth } from '../useAuth';
import { useAuthStoreIntegration } from '../store-integration';
import { useAuthStore } from '@/store/authStore';

const originalFetch = globalThis.fetch;

function LocalAuthStateProbe() {
  useAuthStoreIntegration();
  const { isAuthenticated, isLoading } = useAuth();

  return (
    <output>{isLoading ? 'loading' : isAuthenticated ? 'authenticated' : 'unauthenticated'}</output>
  );
}

describe('LocalAuthProvider', () => {
  beforeEach(() => {
    localStorage.clear();
    useAuthStore.getState().clear();
    globalThis.fetch = mock(
      async () => new Response(null, { status: 401 }),
    ) as unknown as typeof fetch;
  });

  afterEach(() => {
    cleanup();
    globalThis.fetch = originalFetch;
    useAuthStore.getState().clear();
  });

  it('keeps a newly established local session authenticated while provider context catches up', async () => {
    render(
      <AuthProvider>
        <LocalAuthStateProbe />
      </AuthProvider>,
    );

    await waitFor(() => expect(screen.getByText('unauthenticated')).toBeInTheDocument());

    await act(async () => {
      useAuthStore.getState().setLocalSessionAuthenticated(true);
      await Promise.resolve();
    });

    expect(screen.getByText('authenticated')).toBeInTheDocument();
    expect(useAuthStore.getState().localSessionAuthenticated).toBeTrue();
  });
});
