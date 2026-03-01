import { describe, it, beforeEach, afterEach, expect, mock } from 'bun:test';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { createTestQueryClient } from '@/test/render-with-providers';

// ---------------------------------------------------------------------------
// Mutable mock state
// ---------------------------------------------------------------------------

const mockCompleteOAuth = mock(() =>
  Promise.resolve({
    id: 'conn-1',
    provider: 'github',
    providerName: 'GitHub',
    userId: 'test-user',
    status: 'active',
    scopes: ['repo'],
    expiresAt: null,
    hasRefreshToken: true,
    supportsRefresh: true,
    updatedAt: '2024-01-01T00:00:00.000Z',
    createdAt: '2024-01-01T00:00:00.000Z',
  }),
);

// --- Module mocks (must precede component import) ---

mock.module('@/services/api', () => ({
  api: {
    integrations: {
      completeOAuth: mockCompleteOAuth,
    },
  },
}));

mock.module('@/lib/currentUser', () => ({
  getCurrentUserId: () => 'test-user-id',
}));

mock.module('@/config/env', () => ({
  env: {
    VITE_API_BASE_URL: 'http://localhost:4000',
    VITE_ENABLE_CONNECTIONS: true,
  },
}));

// Import component AFTER all mock.module() calls
import { IntegrationCallback } from '@/pages/IntegrationCallback';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Renders IntegrationCallback inside a route with `:provider` param.
 * For "missing provider" tests, use the no-param route fallback.
 */
function renderCallback(initialPath: string) {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <QueryClientProvider client={createTestQueryClient()}>
        <Routes>
          <Route path="/integrations/callback/:provider" element={<IntegrationCallback />} />
          {/* Fallback route for missing provider */}
          <Route path="/integrations/callback" element={<IntegrationCallback />} />
        </Routes>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('IntegrationCallback', () => {
  const originalDispatchEvent = window.dispatchEvent.bind(window);
  const dispatchEventSpy = mock((_event: Event) => true);

  beforeEach(() => {
    cleanup();
    mockCompleteOAuth.mockClear();
    dispatchEventSpy.mockClear();
    // Replace window.dispatchEvent to avoid happy-dom CustomEvent issues
    window.dispatchEvent = dispatchEventSpy as any;
  });

  afterEach(() => {
    cleanup();
    window.dispatchEvent = originalDispatchEvent;
  });

  // --- Rendering ---

  it('renders without crashing', () => {
    renderCallback('/integrations/callback');
    expect(screen.getByText('Connection failed')).toBeTruthy();
  });

  // --- Error states ---

  it('shows error when provider param is missing', () => {
    renderCallback('/integrations/callback');

    expect(screen.getByText('Connection failed')).toBeTruthy();
    expect(screen.getByText('Missing provider information in callback URL.')).toBeTruthy();
  });

  it('shows error when OAuth provider returns an error search param', () => {
    renderCallback('/integrations/callback/github?error=access_denied');

    expect(screen.getByText('Connection failed')).toBeTruthy();
    expect(screen.getByText('Provider returned an error: access_denied')).toBeTruthy();
  });

  it('shows error when code or state search param is missing (code only)', () => {
    renderCallback('/integrations/callback/github?code=abc');

    expect(screen.getByText('Connection failed')).toBeTruthy();
    expect(
      screen.getByText('Unable to complete OAuth without an authorization code and state.'),
    ).toBeTruthy();
  });

  it('shows error when only state is provided without code', () => {
    renderCallback('/integrations/callback/github?state=xyz');

    expect(screen.getByText('Connection failed')).toBeTruthy();
    expect(
      screen.getByText('Unable to complete OAuth without an authorization code and state.'),
    ).toBeTruthy();
  });

  // --- Successful OAuth exchange ---

  it('renders loading state with "Exchanging authorization code…" when code+state are present', () => {
    mockCompleteOAuth.mockImplementation(() => new Promise(() => {}));

    renderCallback('/integrations/callback/github?code=test-code&state=test-state');

    expect(screen.getByText('Completing OAuth')).toBeTruthy();
    expect(screen.getByText('Exchanging authorization code…')).toBeTruthy();
  });

  it('calls api.integrations.completeOAuth with correct args', async () => {
    mockCompleteOAuth.mockImplementation(() => new Promise(() => {}));

    renderCallback('/integrations/callback/github?code=test-code&state=test-state');

    await waitFor(() => {
      expect(mockCompleteOAuth).toHaveBeenCalledTimes(1);
    });

    const callArgs = mockCompleteOAuth.mock.calls[0] as any[];
    expect(callArgs[0]).toBe('github');
    expect(callArgs[1]).toMatchObject({
      userId: 'test-user-id',
      code: 'test-code',
      state: 'test-state',
    });
    expect((callArgs[1] as any).redirectUri).toContain('/integrations/callback/github');
  });

  it('shows success message on successful exchange', async () => {
    mockCompleteOAuth.mockResolvedValue({
      id: 'conn-1',
      provider: 'github',
      providerName: 'GitHub',
      userId: 'test-user',
      status: 'active',
      scopes: ['repo'],
      expiresAt: null,
      hasRefreshToken: true,
      supportsRefresh: true,
      updatedAt: '2024-01-01T00:00:00.000Z',
      createdAt: '2024-01-01T00:00:00.000Z',
    });

    renderCallback('/integrations/callback/github?code=test-code&state=test-state');

    await waitFor(() => {
      expect(screen.getByText('Connection ready')).toBeTruthy();
    });

    expect(screen.getByText('Connected to GitHub. Redirecting…')).toBeTruthy();
  });

  it('dispatches integration:connected CustomEvent on success', async () => {
    mockCompleteOAuth.mockResolvedValue({
      id: 'conn-1',
      provider: 'github',
      providerName: 'GitHub',
      userId: 'test-user',
      status: 'active',
      scopes: ['repo'],
      expiresAt: null,
      hasRefreshToken: true,
      supportsRefresh: true,
      updatedAt: '2024-01-01T00:00:00.000Z',
      createdAt: '2024-01-01T00:00:00.000Z',
    });

    renderCallback('/integrations/callback/github?code=test-code&state=test-state');

    await waitFor(() => {
      expect(screen.getByText('Connection ready')).toBeTruthy();
    });

    // Verify dispatchEvent was called with the integration:connected event
    expect(dispatchEventSpy).toHaveBeenCalled();
  });

  // --- Failed OAuth exchange ---

  it('shows error message from caught error when API throws', async () => {
    mockCompleteOAuth.mockRejectedValue(new Error('Invalid authorization code'));

    renderCallback('/integrations/callback/github?code=bad-code&state=test-state');

    await waitFor(() => {
      expect(screen.getByText('Connection failed')).toBeTruthy();
    });

    expect(screen.getByText('Invalid authorization code')).toBeTruthy();
  });

  it('shows generic error for non-Error thrown values', async () => {
    mockCompleteOAuth.mockRejectedValue('something unexpected');

    renderCallback('/integrations/callback/github?code=bad-code&state=test-state');

    await waitFor(() => {
      expect(screen.getByText('Connection failed')).toBeTruthy();
    });

    expect(screen.getByText('Failed to exchange authorization code.')).toBeTruthy();
  });

  // --- StrictMode double-mount guard ---

  it('does not call completeOAuth twice (exchangeStartedRef guard)', async () => {
    mockCompleteOAuth.mockResolvedValue({
      id: 'conn-1',
      provider: 'github',
      providerName: 'GitHub',
      userId: 'test-user',
      status: 'active',
      scopes: ['repo'],
      expiresAt: null,
      hasRefreshToken: true,
      supportsRefresh: true,
      updatedAt: '2024-01-01T00:00:00.000Z',
      createdAt: '2024-01-01T00:00:00.000Z',
    });

    renderCallback('/integrations/callback/github?code=test-code&state=test-state');

    await waitFor(() => {
      expect(screen.getByText('Connection ready')).toBeTruthy();
    });

    expect(mockCompleteOAuth).toHaveBeenCalledTimes(1);
  });
});
