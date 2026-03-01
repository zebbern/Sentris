/**
 * Shared auth store mock factory for test files.
 *
 * Usage:
 * ```ts
 * import { createAuthStoreMock, DEFAULT_AUTH_ORG_ID } from '@/test/mocks/auth-store';
 *
 * // Static roles:
 * mock.module('@/store/authStore', () => createAuthStoreMock());
 *
 * // Mutable roles via getter:
 * let mockRoles = ['ADMIN'];
 * mock.module('@/store/authStore', () =>
 *   createAuthStoreMock({ roles: () => mockRoles }),
 * );
 * ```
 *
 * The factory returns `{ useAuthStore, DEFAULT_ORG_ID }`. The `useAuthStore`
 * function supports selector-based calls and exposes `.setState`, `.getState`,
 * `.subscribe`, and `.persist` stubs to match the Zustand store shape.
 */

export const DEFAULT_AUTH_ORG_ID = 'local-dev';

export interface AuthStoreMockOverrides {
  /** Static array or getter function for dynamic/mutable roles. */
  roles?: string[] | (() => string[]);
  token?: string | null;
  userId?: string | null;
  organizationId?: string;
  provider?: 'local' | 'cognito';
}

/**
 * Creates a mock object for `@/store/authStore`.
 *
 * Returns `{ useAuthStore, DEFAULT_ORG_ID }` suitable for spreading into a
 * `mock.module()` factory return value.
 */
export function createAuthStoreMock(overrides: AuthStoreMockOverrides = {}) {
  const getRoles = typeof overrides.roles === 'function' ? overrides.roles : undefined;
  const staticRoles = Array.isArray(overrides.roles) ? overrides.roles : ['ADMIN'];

  const buildState = () => ({
    roles: getRoles ? getRoles() : staticRoles,
    token: overrides.token ?? 'test-token',
    userId: overrides.userId ?? 'user-1',
    organizationId: overrides.organizationId ?? DEFAULT_AUTH_ORG_ID,
    provider: overrides.provider ?? ('local' as const),
  });

  const useAuthStoreMock = ((selector?: (state: any) => any) => {
    const state = buildState();
    return selector ? selector(state) : state;
  }) as any;

  useAuthStoreMock.setState = (_partial: any) => {};
  useAuthStoreMock.getState = () => buildState();
  useAuthStoreMock.subscribe = () => () => {};
  useAuthStoreMock.persist = { clearStorage: async () => {} };

  return {
    useAuthStore: useAuthStoreMock,
    DEFAULT_ORG_ID: overrides.organizationId ?? DEFAULT_AUTH_ORG_ID,
  };
}
