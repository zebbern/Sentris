import { useState } from 'react';
import { useToast } from '@/components/ui/use-toast';
import { useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/queryKeys';
import { api } from '@/services/api';
import { logger } from '@/lib/logger';
import { isAllowedOAuthDomain } from '@/utils/urlSecurity';
import {
  useRefreshConnection,
  useDisconnectIntegration,
} from '@/hooks/queries/useIntegrationQueries';
import type { IntegrationProvider, IntegrationConnection } from './utils';

interface UseOAuthConnectionOptions {
  userId: string;
  providers: IntegrationProvider[];
  buildRequestedScopes: (provider: IntegrationProvider) => string[];
}

export function useOAuthConnection({
  userId,
  providers,
  buildRequestedScopes,
}: UseOAuthConnectionOptions) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const refreshConnectionMutation = useRefreshConnection();
  const disconnectMutation = useDisconnectIntegration();

  const [connectingProvider, setConnectingProvider] = useState<string | null>(null);
  const [refreshingConnectionId, setRefreshingConnectionId] = useState<string | null>(null);
  const [deletingConnectionId, setDeletingConnectionId] = useState<string | null>(null);

  const handleConnect = async (provider: IntegrationProvider) => {
    setConnectingProvider(provider.id);
    try {
      const redirectUri = `${window.location.origin}/integrations/callback/${provider.id}`;
      const response = await api.integrations.startOAuth(provider.id, {
        userId,
        redirectUri,
        scopes: buildRequestedScopes(provider),
      });
      if (!isAllowedOAuthDomain(response.authorizationUrl)) {
        toast({
          title: 'Invalid OAuth provider URL',
          description: 'The authorization URL does not point to a known OAuth provider.',
          variant: 'destructive',
        });
        return;
      }
      window.location.href = response.authorizationUrl;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to start OAuth session';
      toast({
        title: 'Could not start OAuth flow',
        description: message,
        variant: 'destructive',
      });
    } finally {
      setConnectingProvider(null);
    }
  };

  const handleRefresh = async (connection: IntegrationConnection) => {
    setRefreshingConnectionId(connection.id);
    try {
      await refreshConnectionMutation.mutateAsync({ id: connection.id, userId });
      toast({
        title: 'Token refreshed',
        description: `${connection.providerName} token has been refreshed.`,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to refresh token';
      toast({
        title: 'Refresh failed',
        description: message,
        variant: 'destructive',
      });
    } finally {
      setRefreshingConnectionId(null);
    }
  };

  const handleDisconnect = async (connection: IntegrationConnection) => {
    setDeletingConnectionId(connection.id);
    try {
      await disconnectMutation.mutateAsync({ id: connection.id, userId });
      toast({
        title: 'Connection removed',
        description: `${connection.providerName} credentials have been deleted.`,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to disconnect';
      toast({
        title: 'Disconnect failed',
        description: message,
        variant: 'destructive',
      });
    } finally {
      setDeletingConnectionId(null);
    }
  };

  const handleManualReconnect = (connection: IntegrationConnection) => {
    const provider = providers.find((item) => item.id === connection.provider);
    if (!provider) {
      toast({
        title: 'Provider unavailable',
        description: 'The provider is no longer configured.',
        variant: 'destructive',
      });
      return;
    }
    handleConnect(provider);
  };

  const handleProviderConfigCompleted = (
    action: 'saved' | 'deleted',
    provider: IntegrationProvider,
  ) => {
    queryClient
      .invalidateQueries({ queryKey: queryKeys.integrations.providers() })
      .catch((err: unknown) => {
        logger.error('Failed to refresh providers', err);
      });

    const title =
      action === 'saved'
        ? `${provider.name} credentials saved`
        : `${provider.name} credentials removed`;
    const description =
      action === 'saved'
        ? 'You can now start a new OAuth flow for this provider.'
        : 'The provider will now rely on environment credentials if available.';

    toast({ title, description });
  };

  const handleConnectionComplete = (connection: IntegrationConnection) => {
    queryClient.invalidateQueries({ queryKey: queryKeys.integrations.connections() });
    toast({
      title: `${connection.providerName} connected`,
      description: 'Credentials stored successfully.',
    });
  };

  return {
    connectingProvider,
    refreshingConnectionId,
    deletingConnectionId,
    handleConnect,
    handleRefresh,
    handleDisconnect,
    handleManualReconnect,
    handleProviderConfigCompleted,
    handleConnectionComplete,
  };
}
