import { useEffect, useRef } from 'react';
import { useAuth, useAuthProvider } from './auth-context';
import { useAuthStore } from '../store/authStore';
import { queryClient } from '@/lib/queryClient';
import { logger } from '@/lib/logger';
import { toSupportedRole } from '@/utils/auth';
import { env } from '@/config/env';

/**
 * Hook to integrate the new auth system with the existing Zustand store
 * This ensures backward compatibility while transitioning to the new auth system
 */
export function useAuthStoreIntegration() {
  const { user, token, isAuthenticated, isLoading, error } = useAuth();
  const authProvider = useAuthProvider();
  // Use selectors to avoid subscribing to the entire store — `useAuthStore()` with no
  // selector triggers a re-render on every `set()` call because Zustand creates a new
  // state object each time.
  const setAuthContext = useAuthStore((s) => s.setAuthContext);
  const clearStore = useAuthStore((s) => s.clear);
  const storedOrganizationId = useAuthStore((s) => s.organizationId);
  const storedUserId = useAuthStore((s) => s.userId);
  const localSessionAuthenticated = useAuthStore((s) => s.localSessionAuthenticated);
  // Track whether the auth provider has been established at least once.
  // On the very first render the GlobalAuthContext has no provider, so useAuth()
  // returns the fallback with isAuthenticated=false / isLoading=true. We must NOT
  // clear the query cache in that transient state.
  const providerReady = useRef(false);
  if (authProvider.name !== 'none') {
    providerReady.current = true;
  }

  // Clear query cache on logout (only after the real provider has been seen)
  useEffect(() => {
    if (providerReady.current && !isAuthenticated && !isLoading) {
      queryClient.cancelQueries();
      queryClient.clear();
    }
  }, [isAuthenticated, isLoading]);

  useEffect(() => {
    if (isLoading) {
      return; // Don't update store while loading
    }

    if (isAuthenticated && user && (token || authProvider.name === 'local')) {
      // User is authenticated - update store with auth data
      const providerForStore =
        authProvider.name === 'clerk'
          ? 'clerk'
          : authProvider.name === 'local'
            ? 'local'
            : 'custom';

      // For Clerk: use selected org, or "user's workspace" if no org
      let nextOrganizationId: string | undefined;
      let roles: string[];

      if (authProvider.name === 'clerk') {
        nextOrganizationId = user.organizationId || `workspace-${user.id}`;

        // If user is in their own workspace, they are ADMIN by default
        if (nextOrganizationId === `workspace-${user.id}`) {
          roles = ['ADMIN'];
        } else {
          // Organization roles are allowlisted and unknown or missing values fail closed.
          const supportedRole = toSupportedRole(user.organizationRole);
          roles = supportedRole ? [supportedRole] : [];
        }
      } else {
        nextOrganizationId = user.organizationId || undefined;
        const supportedRole = toSupportedRole(user.organizationRole);
        roles = supportedRole ? [supportedRole] : [];
      }

      const identityScopeChanged =
        storedUserId !== user.id || storedOrganizationId !== nextOrganizationId;
      if (identityScopeChanged) {
        void queryClient.cancelQueries();
        queryClient.clear();
      }

      setAuthContext({
        token: token?.token ?? null,
        userId: user.id,
        organizationId: nextOrganizationId,
        roles,
        provider: providerForStore,
      });
    } else if (!isAuthenticated && !(authProvider.name === 'local' && localSessionAuthenticated)) {
      // User is not authenticated - clear store but keep basic defaults
      clearStore();
    }

    // Handle auth errors
    if (error) {
      logger.error('Authentication error:', error);
    }
  }, [
    authProvider.name,
    isAuthenticated,
    user,
    token,
    isLoading,
    error,
    setAuthContext,
    clearStore,
    localSessionAuthenticated,
    storedOrganizationId,
    storedUserId,
  ]);

  return {
    isLoading,
    isAuthenticated,
    error,
  };
}

/**
 * Hook to sync auth provider state with the backend API configuration
 * This ensures the frontend and backend are using the same auth provider
 */
export function useAuthProviderSync() {
  const storeProvider = useAuthStore((s) => s.provider);
  const authProvider = useAuthProvider();
  const providerForStore = resolvedProviderForReturn(authProvider.name);

  useEffect(() => {
    // Check if frontend and backend auth providers are aligned
    const configuredFrontendProvider = env.VITE_AUTH_PROVIDER || providerForStore;
    const backendProvider = env.VITE_API_AUTH_PROVIDER || configuredFrontendProvider;

    if (configuredFrontendProvider !== backendProvider) {
      logger.warn(
        `Auth provider mismatch: frontend=${configuredFrontendProvider}, backend=${backendProvider}. ` +
          'This may cause authentication issues.',
      );
    }

    // Update store provider if needed
    if (storeProvider !== providerForStore) {
      useAuthStore.getState().setProvider(providerForStore);
    }
  }, [providerForStore, storeProvider]);

  return {
    provider: resolvedProviderForReturn(authProvider.name),
  };
}

function resolvedProviderForReturn(name: string): 'local' | 'clerk' | 'custom' {
  if (name === 'clerk') {
    return 'clerk';
  }
  if (name === 'local') {
    return 'local';
  }
  return 'custom';
}

/**
 * Migration utility to help transition from manual token management to provider-based auth
 */
export function useAuthMigration() {
  const { token: providerToken, isAuthenticated } = useAuth();
  const storeToken = useAuthStore((s) => s.token);
  const clearStore = useAuthStore((s) => s.clear);

  useEffect(() => {
    // If user has a manually set token in store but no provider auth,
    // we might need to migrate them
    if (storeToken && !isAuthenticated && !providerToken) {
      logger.info(
        'Found existing token in store. You may need to sign in with the new auth system to continue.',
      );

      // Optionally, you could attempt to validate the existing token
      // or prompt the user to sign in again
    }
  }, [storeToken, isAuthenticated, providerToken]);

  const migrateToProviderAuth = () => {
    // Clear the old auth data and redirect to sign in
    clearStore();
    // This will trigger the auth flow
  };

  return {
    needsMigration: !!storeToken && !isAuthenticated,
    migrateToProviderAuth,
  };
}
