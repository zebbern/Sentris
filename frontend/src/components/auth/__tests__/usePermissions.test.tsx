import { describe, it, expect, afterEach } from 'bun:test';
import { cleanup, renderHook } from '@testing-library/react';
import { GlobalAuthContext } from '../../../auth/auth-context-def';
import type { FrontendAuthProvider } from '../../../auth/types';
import { usePermissions } from '../usePermissions';
import type { ReactNode } from 'react';

afterEach(cleanup);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockProvider(overrides: Partial<FrontendAuthProvider> = {}): FrontendAuthProvider {
  return {
    name: 'test',
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

function renderPermissions(provider: FrontendAuthProvider) {
  return renderHook(() => usePermissions(), {
    wrapper: ({ children }: { children: ReactNode }) => (
      <GlobalAuthContext.Provider value={{ provider, providerName: provider.name }}>
        {children}
      </GlobalAuthContext.Provider>
    ),
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('usePermissions', () => {
  describe('hasRole', () => {
    it('returns true when user organizationRole matches (case-insensitive)', () => {
      const provider = createMockProvider({
        context: {
          user: { id: 'u1', organizationId: 'org-1', organizationRole: 'admin' },
          token: null,
          isLoading: false,
          isAuthenticated: true,
        },
      });
      const { result } = renderPermissions(provider);

      expect(result.current.hasRole(['ADMIN'])).toBe(true);
    });

    it('returns false when user has a different role', () => {
      const provider = createMockProvider({
        context: {
          user: { id: 'u1', organizationId: 'org-1', organizationRole: 'viewer' },
          token: null,
          isLoading: false,
          isAuthenticated: true,
        },
      });
      const { result } = renderPermissions(provider);

      expect(result.current.hasRole(['ADMIN'])).toBe(false);
    });

    it('returns true when roles include wildcard "*"', () => {
      const provider = createMockProvider({
        context: {
          user: { id: 'u1', organizationId: 'org-1', organizationRole: 'viewer' },
          token: null,
          isLoading: false,
          isAuthenticated: true,
        },
      });
      const { result } = renderPermissions(provider);

      expect(result.current.hasRole(['*'])).toBe(true);
    });

    it('returns false when user is not authenticated', () => {
      const provider = createMockProvider({
        context: {
          user: null,
          token: null,
          isLoading: false,
          isAuthenticated: false,
        },
      });
      const { result } = renderPermissions(provider);

      expect(result.current.hasRole(['ADMIN'])).toBe(false);
    });
  });

  describe('hasOrg', () => {
    it('returns true when user has an organizationId', () => {
      const provider = createMockProvider({
        context: {
          user: { id: 'u1', organizationId: 'org-1' },
          token: null,
          isLoading: false,
          isAuthenticated: true,
        },
      });
      const { result } = renderPermissions(provider);

      expect(result.current.hasOrg()).toBe(true);
    });

    it('returns false when user has no organizationId', () => {
      const provider = createMockProvider({
        context: {
          user: { id: 'u1' },
          token: null,
          isLoading: false,
          isAuthenticated: true,
        },
      });
      const { result } = renderPermissions(provider);

      expect(result.current.hasOrg()).toBe(false);
    });
  });

  describe('canAccess', () => {
    it('returns false when requireAuth=true and user is not authenticated', () => {
      const provider = createMockProvider({
        context: {
          user: null,
          token: null,
          isLoading: false,
          isAuthenticated: false,
        },
      });
      const { result } = renderPermissions(provider);

      expect(result.current.canAccess({ requireAuth: true })).toBe(false);
    });

    it('returns false when requireOrg=true and user has no org', () => {
      const provider = createMockProvider({
        context: {
          user: { id: 'u1' },
          token: null,
          isLoading: false,
          isAuthenticated: true,
        },
      });
      const { result } = renderPermissions(provider);

      expect(result.current.canAccess({ requireOrg: true })).toBe(false);
    });

    it('returns false when roles constraint not met', () => {
      const provider = createMockProvider({
        context: {
          user: { id: 'u1', organizationId: 'org-1', organizationRole: 'viewer' },
          token: null,
          isLoading: false,
          isAuthenticated: true,
        },
      });
      const { result } = renderPermissions(provider);

      expect(result.current.canAccess({ roles: ['ADMIN'] })).toBe(false);
    });

    it('returns true when all constraints are satisfied', () => {
      const provider = createMockProvider({
        context: {
          user: { id: 'u1', organizationId: 'org-1', organizationRole: 'admin' },
          token: null,
          isLoading: false,
          isAuthenticated: true,
        },
      });
      const { result } = renderPermissions(provider);

      expect(
        result.current.canAccess({ requireAuth: true, requireOrg: true, roles: ['ADMIN'] }),
      ).toBe(true);
    });

    it('returns true with no constraints', () => {
      const provider = createMockProvider({
        context: {
          user: { id: 'u1' },
          token: null,
          isLoading: false,
          isAuthenticated: true,
        },
      });
      const { result } = renderPermissions(provider);

      expect(result.current.canAccess()).toBe(true);
    });
  });
});
