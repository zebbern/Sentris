import { describe, it, expect, afterAll, afterEach, mock } from 'bun:test';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { GlobalAuthContext } from '../../../auth/auth-context-def';
import type { FrontendAuthProvider } from '../../../auth/types';
import type { ReactNode } from 'react';
import { realModuleExports } from '@/test/restore-mocks';

// ---------------------------------------------------------------------------
// Mocks — stub out heavy dependencies that ProtectedRoute imports
// ---------------------------------------------------------------------------

mock.module('../../../store/authStore', () => ({
  useAuthStore: ((selector?: (s: any) => any) => {
    const state = {
      adminUsername: 'admin',
      adminPassword: 'admin-pass',
      organizationId: 'local-dev',
      token: 'test-token',
      userId: 'user-1',
      roles: ['ADMIN'],
      provider: 'local',
    };
    return selector ? selector(state) : state;
  }) as any,
  DEFAULT_ORG_ID: 'local-dev',
}));

mock.module('../AuthModal', () => ({
  AuthModal: () => <div data-testid="auth-modal">Auth Modal</div>,
}));

mock.module('../AdminLoginForm', () => ({
  AdminLoginForm: () => <div data-testid="admin-login-form">Admin Login Form</div>,
}));

import { ProtectedRoute } from '../ProtectedRoute';

afterEach(cleanup);

afterAll(() => {
  mock.module('../../../store/authStore', () => realModuleExports('@/store/authStore'));
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockProvider(overrides: Partial<FrontendAuthProvider> = {}): FrontendAuthProvider {
  return {
    name: 'local',
    context: {
      user: {
        id: 'user-1',
        email: 'test@example.com',
        organizationId: 'org-1',
        organizationRole: 'admin',
      },
      token: { token: 'tok_123' },
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

function renderProtectedRoute(
  provider: FrontendAuthProvider,
  props: Partial<React.ComponentProps<typeof ProtectedRoute>> = {},
  children: ReactNode = <div data-testid="protected-content">Protected Content</div>,
) {
  return render(
    <MemoryRouter>
      <GlobalAuthContext.Provider value={{ provider, providerName: provider.name }}>
        <ProtectedRoute {...props}>{children}</ProtectedRoute>
      </GlobalAuthContext.Provider>
    </MemoryRouter>,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ProtectedRoute', () => {
  it('renders children when authenticated and not loading', () => {
    const provider = createMockProvider();
    renderProtectedRoute(provider);

    expect(screen.getByTestId('protected-content')).toBeDefined();
    expect(screen.getByText('Protected Content')).toBeDefined();
  });

  it('renders loading state when isLoading=true', () => {
    const provider = createMockProvider({
      context: {
        user: null,
        token: null,
        isLoading: true,
        isAuthenticated: false,
      },
    });
    renderProtectedRoute(provider);

    expect(screen.getByText('Checking authentication...')).toBeDefined();
    expect(screen.queryByTestId('protected-content')).toBeNull();
  });

  it('does NOT render children when not authenticated and requireAuth=true (default)', () => {
    const provider = createMockProvider({
      context: {
        user: null,
        token: null,
        isLoading: false,
        isAuthenticated: false,
      },
    });
    renderProtectedRoute(provider);

    expect(screen.queryByTestId('protected-content')).toBeNull();
    expect(screen.getByText('Authentication Required')).toBeDefined();
  });

  it('renders children regardless of auth state when requireAuth=false', () => {
    const provider = createMockProvider({
      context: {
        user: null,
        token: null,
        isLoading: false,
        isAuthenticated: false,
      },
    });
    renderProtectedRoute(provider, { requireAuth: false });

    expect(screen.getByTestId('protected-content')).toBeDefined();
  });

  it('renders children when user has a matching role', () => {
    const provider = createMockProvider({
      context: {
        user: {
          id: 'user-1',
          email: 'admin@example.com',
          organizationId: 'org-1',
          organizationRole: 'admin',
        },
        token: { token: 'tok_123' },
        isLoading: false,
        isAuthenticated: true,
      },
    });
    renderProtectedRoute(provider, { roles: ['ADMIN'] });

    expect(screen.getByTestId('protected-content')).toBeDefined();
  });

  it('renders access denied when user does NOT have the required role', () => {
    const provider = createMockProvider({
      context: {
        user: {
          id: 'user-1',
          email: 'viewer@example.com',
          organizationId: 'org-1',
          organizationRole: 'viewer',
        },
        token: { token: 'tok_123' },
        isLoading: false,
        isAuthenticated: true,
      },
    });
    renderProtectedRoute(provider, { roles: ['ADMIN'] });

    expect(screen.queryByTestId('protected-content')).toBeNull();
    expect(screen.getByText('Insufficient Permissions')).toBeDefined();
  });

  it('renders children when role includes wildcard "*"', () => {
    const provider = createMockProvider({
      context: {
        user: {
          id: 'user-1',
          email: 'anyone@example.com',
          organizationId: 'org-1',
          organizationRole: 'viewer',
        },
        token: { token: 'tok_123' },
        isLoading: false,
        isAuthenticated: true,
      },
    });
    renderProtectedRoute(provider, { roles: ['*'] });

    expect(screen.getByTestId('protected-content')).toBeDefined();
  });

  it('renders org-required state when requireOrg=true and user has no organizationId', () => {
    const provider = createMockProvider({
      context: {
        user: {
          id: 'user-1',
          email: 'no-org@example.com',
          // no organizationId
        },
        token: { token: 'tok_123' },
        isLoading: false,
        isAuthenticated: true,
      },
    });
    renderProtectedRoute(provider, { requireOrg: true });

    expect(screen.queryByTestId('protected-content')).toBeNull();
    expect(screen.getByText('Organization Required')).toBeDefined();
  });

  it('renders custom fallback when provided and user is not authenticated', () => {
    const provider = createMockProvider({
      context: {
        user: null,
        token: null,
        isLoading: false,
        isAuthenticated: false,
      },
    });
    renderProtectedRoute(provider, {
      fallback: <div data-testid="custom-fallback">Custom Fallback</div>,
    });

    expect(screen.getByTestId('custom-fallback')).toBeDefined();
    expect(screen.queryByTestId('protected-content')).toBeNull();
  });
});
