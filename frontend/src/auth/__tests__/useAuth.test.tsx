import { describe, it, expect, afterEach } from 'bun:test';
import { cleanup, renderHook } from '@testing-library/react';
import { GlobalAuthContext } from '../auth-context-def';
import { useAuth, useAuthProvider } from '../useAuth';
import type { FrontendAuthProvider } from '../types';
import type { ReactNode } from 'react';

afterEach(cleanup);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal mock FrontendAuthProvider for test context. */
function createMockProvider(overrides: Partial<FrontendAuthProvider> = {}): FrontendAuthProvider {
  return {
    name: 'test',
    context: {
      user: {
        id: 'user-1',
        email: 'test@example.com',
        firstName: 'Test',
        lastName: 'User',
        organizationId: 'org-1',
        organizationName: 'Test Org',
        organizationRole: 'admin',
      },
      token: { token: 'tok_test123' },
      isLoading: false,
      isAuthenticated: true,
    },
    signIn: () => {},
    signUp: () => {},
    signOut: () => {},
    SignInComponent: () => null,
    SignUpComponent: () => null,
    UserButtonComponent: () => null,
    initialize: () => {},
    cleanup: () => {},
    ...overrides,
  };
}

/** Wraps the hook render in a GlobalAuthContext.Provider. */
function renderWithAuth<T>(hook: () => T, provider: FrontendAuthProvider | null) {
  return renderHook(hook, {
    wrapper: ({ children }: { children: ReactNode }) => (
      <GlobalAuthContext.Provider value={{ provider, providerName: provider?.name ?? 'none' }}>
        {children}
      </GlobalAuthContext.Provider>
    ),
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useAuth', () => {
  it('returns the auth context from the provider', () => {
    const provider = createMockProvider();
    const { result } = renderWithAuth(() => useAuth(), provider);

    expect(result.current.isAuthenticated).toBe(true);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.user?.id).toBe('user-1');
    expect(result.current.user?.email).toBe('test@example.com');
    expect(result.current.token?.token).toBe('tok_test123');
  });

  it('returns fallback when no provider is set', () => {
    const { result } = renderWithAuth(() => useAuth(), null);

    expect(result.current.isAuthenticated).toBe(false);
    expect(result.current.isLoading).toBe(true);
    expect(result.current.user).toBeNull();
    expect(result.current.token).toBeNull();
    expect(result.current.error).toBe('No auth provider available');
  });

  it('reflects isLoading=true from the provider', () => {
    const provider = createMockProvider({
      context: {
        user: null,
        token: null,
        isLoading: true,
        isAuthenticated: false,
      },
    });
    const { result } = renderWithAuth(() => useAuth(), provider);

    expect(result.current.isLoading).toBe(true);
    expect(result.current.isAuthenticated).toBe(false);
  });
});

describe('useAuthProvider', () => {
  it('returns the full provider object including signIn/signOut/signUp', () => {
    const signInFn = () => {};
    const signOutFn = () => {};
    const signUpFn = () => {};

    const provider = createMockProvider({
      signIn: signInFn,
      signOut: signOutFn,
      signUp: signUpFn,
    });
    const { result } = renderWithAuth(() => useAuthProvider(), provider);

    expect(result.current.name).toBe('test');
    expect(result.current.signIn).toBe(signInFn);
    expect(result.current.signOut).toBe(signOutFn);
    expect(result.current.signUp).toBe(signUpFn);
  });

  it('returns fallback provider when no provider is set in context', () => {
    const { result } = renderWithAuth(() => useAuthProvider(), null);

    expect(result.current.name).toBe('none');
    expect(result.current.context.isAuthenticated).toBe(false);
    expect(result.current.context.isLoading).toBe(true);
    expect(result.current.context.user).toBeNull();
  });
});
