import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { ClerkAuthProvider } from './providers/clerk-provider';
import type { FrontendAuthProvider, FrontendAuthProviderComponent } from './types';
import { useAuthStore } from '../store/authStore';
import { GlobalAuthContext } from './auth-context-def';
import { logger } from '@/lib/logger';
import { env } from '@/config/env';
import { buildFrontendApiUrl } from '@/config/api-url';

// Auth provider registry - easy to add new providers
// Determine which provider to use based on environment
function getAuthProviderName(): string {
  // Priority: explicit env var > dev mode default (local) > auto-detect
  const envProvider = env.VITE_AUTH_PROVIDER;
  const hasClerkKey =
    typeof env.VITE_CLERK_PUBLISHABLE_KEY === 'string' &&
    env.VITE_CLERK_PUBLISHABLE_KEY.trim().length > 0;

  // In dev mode, default to local auth unless VITE_AUTH_PROVIDER is explicitly set
  if (import.meta.env.DEV && !envProvider) {
    return 'local';
  }

  // If explicitly set to 'local', always use local auth
  if (envProvider === 'local') {
    return 'local';
  }

  // If explicitly set to clerk, use it (if key is available)
  if (envProvider === 'clerk') {
    if (!hasClerkKey) {
      logger.warn(
        'Auth provider set to Clerk, but no publishable key configured. Falling back to local auth.',
      );
      return 'local';
    }
    return 'clerk';
  }

  // If explicitly set to another provider, use it
  if (envProvider && authProviders[envProvider]) {
    return envProvider;
  }

  // In production, use Clerk if key is available, otherwise local
  if (hasClerkKey) {
    return 'clerk';
  }

  // Final fallback to local
  return 'local';
}

type ProviderComponentProps = React.PropsWithChildren<{
  onProviderChange?: (provider: FrontendAuthProvider | null) => void;
}>;

// Local auth provider for development
const LocalAuthProvider: FrontendAuthProviderComponent = ({
  children,
  onProviderChange,
}: ProviderComponentProps) => {
  const localSessionAuthenticated = useAuthStore((state) => state.localSessionAuthenticated);
  const setLocalSessionAuthenticated = useAuthStore((state) => state.setLocalSessionAuthenticated);
  const userId = useAuthStore((state) => state.userId);
  const organizationId = useAuthStore((state) => state.organizationId);
  const [isValidatingSession, setIsValidatingSession] = useState(true);

  useEffect(() => {
    let cancelled = false;

    void fetch(buildFrontendApiUrl('/api/v1/auth/validate'), {
      credentials: 'include',
    })
      .then((response) => {
        if (!cancelled) {
          setLocalSessionAuthenticated(response.ok);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setLocalSessionAuthenticated(false);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsValidatingSession(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [setLocalSessionAuthenticated]);

  // Create provider that reacts to store state
  const localProvider = useMemo<FrontendAuthProvider>(() => {
    return {
      name: 'local',
      context: {
        user: localSessionAuthenticated
          ? {
              id: userId || 'admin',
              organizationId: organizationId || 'local-dev',
              organizationRole: 'ADMIN',
            }
          : null,
        token: null,
        isLoading: isValidatingSession,
        isAuthenticated: localSessionAuthenticated,
        error: null,
      },
      signIn: () => {
        logger.warn('Local auth: signIn not implemented - use AdminLoginForm');
      },
      signUp: () => {
        logger.warn('Local auth: signUp not implemented');
      },
      signOut: async () => {
        // Clear session cookie via backend logout endpoint
        try {
          await fetch(buildFrontendApiUrl('/api/v1/auth/logout'), {
            method: 'POST',
            credentials: 'include',
          });
        } catch (error: unknown) {
          logger.warn('Failed to clear session cookie:', error);
        }
        setLocalSessionAuthenticated(false);
        useAuthStore.getState().clear();
      },
      SignInComponent: () => <div>Sign in not available in local dev mode</div>,
      SignUpComponent: () => <div>Sign up not available in local dev mode</div>,
      UserButtonComponent: () => <div>User profile not available in local dev mode</div>,
      OrganizationSwitcherComponent: undefined,
      initialize: () => {
        // No initialization required for local auth
      },
      cleanup: () => {
        // No cleanup needed for local auth
      },
    };
  }, [
    isValidatingSession,
    localSessionAuthenticated,
    organizationId,
    setLocalSessionAuthenticated,
    userId,
  ]);

  useEffect(() => {
    localProvider.initialize();
    onProviderChange?.(localProvider);

    return () => {
      localProvider.cleanup();
      onProviderChange?.(null);
    };
  }, [localProvider, onProviderChange]);

  return <>{children}</>;
};

const authProviders: Record<string, FrontendAuthProviderComponent> = {
  clerk: ClerkAuthProvider,
  local: LocalAuthProvider,
  // Future providers can be added here:
  // auth0: Auth0AuthProvider,
  // firebase: FirebaseAuthProvider,
};

// Main auth provider component that selects the appropriate provider
export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const providerName = getAuthProviderName();
  const [currentProvider, setCurrentProvider] = useState<FrontendAuthProvider | null>(null);
  const ProviderComponent = authProviders[providerName] ?? LocalAuthProvider;

  const handleProviderChange = useCallback((provider: FrontendAuthProvider | null) => {
    setCurrentProvider(provider);
  }, []);

  const contextValue = useMemo(
    () => ({
      provider: currentProvider,
      providerName,
    }),
    [currentProvider, providerName],
  );

  return (
    <GlobalAuthContext.Provider value={contextValue}>
      <ProviderComponent onProviderChange={handleProviderChange}>{children}</ProviderComponent>
    </GlobalAuthContext.Provider>
  );
};
