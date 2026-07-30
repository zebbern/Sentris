import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { env } from '@/config/env';

const DEFAULT_ORG_ENV = env.VITE_DEFAULT_ORG_ID || env.VITE_DEFAULT_ORG;
export const DEFAULT_ORG_ID =
  typeof DEFAULT_ORG_ENV === 'string' && DEFAULT_ORG_ENV.trim().length > 0
    ? DEFAULT_ORG_ENV.trim()
    : 'local-dev';

export type AuthProvider = 'local' | 'clerk' | 'custom';

interface AuthState {
  token: string | null;
  userId: string | null;
  organizationId: string;
  roles: string[];
  provider: AuthProvider;
  localSessionAuthenticated: boolean;
  setToken: (token: string | null) => void;
  setOrganizationId: (orgId: string) => void;
  setRoles: (roles: string[]) => void;
  setUserId: (userId: string | null) => void;
  setProvider: (provider: AuthProvider) => void;
  setLocalSessionAuthenticated: (authenticated: boolean) => void;
  setAuthContext: (context: {
    token?: string | null;
    userId?: string | null;
    organizationId?: string | null;
    roles?: string[] | null;
    provider?: AuthProvider;
  }) => void;
  clear: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      token: null,
      userId: null,
      organizationId: DEFAULT_ORG_ID,
      provider: 'local',
      setToken: (token) =>
        set({
          token: token && token.trim().length > 0 ? token.trim() : null,
        }),
      setUserId: (userId) =>
        set({ userId: userId && userId.trim().length > 0 ? userId.trim() : null }),
      setOrganizationId: (orgId) =>
        set({
          organizationId: orgId && orgId.trim().length > 0 ? orgId.trim() : DEFAULT_ORG_ID,
        }),
      setRoles: (roles) => set({ roles: Array.isArray(roles) ? roles : [] }),
      setProvider: (provider) => set({ provider }),
      localSessionAuthenticated: false,
      setLocalSessionAuthenticated: (authenticated) =>
        set({
          localSessionAuthenticated: authenticated,
          ...(authenticated
            ? {
                userId: 'admin',
                organizationId: DEFAULT_ORG_ID,
                roles: ['ADMIN'],
                provider: 'local' as const,
              }
            : {}),
        }),
      setAuthContext: (context) =>
        set((current) => {
          const hasTokenUpdate = context.token !== undefined;
          const sanitizedToken =
            hasTokenUpdate && context.token
              ? context.token.trim().length > 0
                ? context.token.trim()
                : null
              : hasTokenUpdate
                ? null
                : current.token;

          const hasUserUpdate = context.userId !== undefined;
          const sanitizedUserId =
            hasUserUpdate && context.userId
              ? context.userId.trim().length > 0
                ? context.userId.trim()
                : null
              : hasUserUpdate
                ? null
                : current.userId;

          const hasOrgUpdate = context.organizationId !== undefined;
          const sanitizedOrgId =
            hasOrgUpdate && typeof context.organizationId === 'string'
              ? context.organizationId.trim().length > 0
                ? context.organizationId.trim()
                : DEFAULT_ORG_ID
              : hasOrgUpdate && context.organizationId === null
                ? DEFAULT_ORG_ID
                : current.organizationId;

          const hasRolesUpdate = context.roles !== undefined;
          const sanitizedRoles =
            hasRolesUpdate && Array.isArray(context.roles) && context.roles.length > 0
              ? context.roles
              : hasRolesUpdate
                ? []
                : current.roles;

          const nextProvider = context.provider ?? current.provider;

          return {
            token: sanitizedToken,
            userId: sanitizedUserId,
            organizationId: sanitizedOrgId,
            roles: sanitizedRoles,
            provider: nextProvider,
          };
        }),
      roles: ['ADMIN'],
      clear: () =>
        set({
          token: null,
          userId: null,
          organizationId: DEFAULT_ORG_ID,
          roles: ['ADMIN'],
          provider: 'local',
          localSessionAuthenticated: false,
        }),
    }),
    {
      name: 'sentris-auth',
      version: 4,
      migrate: (persistedState, _version) => {
        if (!persistedState) {
          return persistedState;
        }
        const legacy = persistedState as Record<string, unknown>;
        const {
          token: _token,
          adminUsername: _adminUsername,
          adminPassword: _adminPassword,
          localSessionAuthenticated: _localSessionAuthenticated,
          ...safeState
        } = legacy;
        return {
          ...safeState,
          localSessionAuthenticated: false,
        };
      },
      partialize: (state) => ({
        userId: state.userId,
        organizationId: state.organizationId,
        roles: state.roles,
        provider: state.provider,
      }),
    },
  ),
);
