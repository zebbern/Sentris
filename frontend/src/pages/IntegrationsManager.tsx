import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { useToast } from '@/components/ui/use-toast';
import { ErrorBanner } from '@/components/ui/error-banner';
import { useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/queryKeys';
import { getCurrentUserId } from '@/lib/currentUser';

import {
  useIntegrationProviders,
  useIntegrationConnections,
} from '@/hooks/queries/useIntegrationQueries';

import { getProviderConnection } from './integrations/utils';
import type { IntegrationProvider } from './integrations/utils';
import { ProviderConfigDialog } from './integrations/ProviderConfigDialog';
import { IntegrationCallbackBridge } from './integrations/IntegrationCallbackBridge';
import { IntegrationListTable } from './integrations/IntegrationListTable';
import { ProviderCard, ProviderCardSkeleton } from './integrations/ProviderCard';
import { useOAuthConnection } from './integrations/OAuthConnectionFlow';

export function IntegrationsManager() {
  useDocumentTitle('Connections');
  const navigate = useNavigate();
  const location = useLocation();
  const userId = getCurrentUserId();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const {
    data: providers = [],
    isLoading: loadingProviders,
    error: providersError,
  } = useIntegrationProviders();
  const {
    data: connections = [],
    isLoading: loadingConnections,
    error: connectionsError,
  } = useIntegrationConnections(userId);

  const error = providersError?.message ?? connectionsError?.message ?? null;

  const [configProvider, setConfigProvider] = useState<IntegrationProvider | null>(null);
  const [customScopes, setCustomScopes] = useState<Record<string, string>>({});

  const parseAdditionalScopes = (input: string | undefined): string[] => {
    if (!input) return [];
    return Array.from(
      new Set(
        input
          .split(/[\s,]+/)
          .map((scope) => scope.trim())
          .filter(Boolean),
      ),
    );
  };

  const buildRequestedScopes = (provider: IntegrationProvider): string[] => {
    const baseScopes = provider.defaultScopes ?? [];
    const extraScopes = parseAdditionalScopes(customScopes[provider.id]);
    return Array.from(new Set([...baseScopes, ...extraScopes]));
  };

  const {
    connectingProvider,
    refreshingConnectionId,
    deletingConnectionId,
    handleConnect,
    handleRefresh,
    handleDisconnect,
    handleManualReconnect,
    handleProviderConfigCompleted,
    handleConnectionComplete,
  } = useOAuthConnection({ userId, providers, buildRequestedScopes });

  useEffect(() => {
    if (!error) return;
    toast({ title: 'Integration error', description: error, variant: 'destructive' });
  }, [error, toast]);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const connectedProvider = params.get('connected');
    if (connectedProvider) {
      toast({
        title: 'Connection established',
        description: `Successfully connected to ${connectedProvider}.`,
      });
      params.delete('connected');
      navigate({ pathname: location.pathname, search: params.toString() }, { replace: true });
    }
  }, [location.pathname, location.search, navigate, toast]);

  const connectionByProvider = useMemo(() => {
    return new Map(connections.map((connection) => [connection.provider, connection]));
  }, [connections]);

  const handleConnectOrConfigure = (provider: IntegrationProvider) => {
    if (!provider.isConfigured) {
      setConfigProvider(provider);
      return;
    }
    handleConnect(provider);
  };

  const handleScopesNormalize = (providerId: string, value: string) => {
    const normalized = parseAdditionalScopes(value);
    if (normalized.length > 0) {
      setCustomScopes((prev) => ({ ...prev, [providerId]: normalized.join(' ') }));
      toast({
        title: 'Scopes added',
        description: `Queued ${normalized.join(', ')} for next connection attempt.`,
      });
    }
  };

  return (
    <div className="flex-1 bg-background" aria-busy={loadingProviders || loadingConnections}>
      <div className="container mx-auto py-4 md:py-8 px-3 md:px-4">
        {error && (
          <ErrorBanner
            message={error}
            onRetry={() => {
              queryClient.invalidateQueries({ queryKey: queryKeys.integrations.providers() });
              queryClient.invalidateQueries({
                queryKey: queryKeys.integrations.connections(userId),
              });
            }}
            className="mb-4 md:mb-6"
          />
        )}

        <section className="mb-10">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-lg font-semibold">Active connections</h2>
              <p className="text-sm text-muted-foreground">
                Tokens are refreshed automatically when possible. You can also refresh or disconnect
                manually.
              </p>
            </div>
          </div>
          <IntegrationListTable
            connections={connections}
            providers={providers}
            isLoading={loadingConnections && !error}
            refreshingConnectionId={refreshingConnectionId}
            deletingConnectionId={deletingConnectionId}
            connectingProvider={connectingProvider}
            onRefresh={handleRefresh}
            onDisconnect={handleDisconnect}
            onReconnect={handleManualReconnect}
          />
        </section>

        <section>
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-lg font-semibold">Available providers</h2>
              <p className="text-sm text-muted-foreground">
                Connect a provider to issue OAuth tokens and reuse them across your workflows.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {providers.map((provider) => (
              <ProviderCard
                key={provider.id}
                provider={provider}
                connection={getProviderConnection(provider.id, connectionByProvider)}
                isConnecting={connectingProvider === provider.id}
                requestedScopes={buildRequestedScopes(provider)}
                additionalScopesValue={customScopes[provider.id] ?? ''}
                onScopesChange={(id, value) =>
                  setCustomScopes((prev) => ({ ...prev, [id]: value }))
                }
                onScopesNormalize={handleScopesNormalize}
                onConnect={handleConnectOrConfigure}
                onConfigure={() => setConfigProvider(provider)}
              />
            ))}
          </div>

          {(loadingProviders || loadingConnections) && !error && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
              {Array.from({ length: 3 }).map((_, idx) => (
                <ProviderCardSkeleton key={`skeleton-${idx}`} />
              ))}
            </div>
          )}
        </section>
      </div>

      <ProviderConfigDialog
        provider={configProvider}
        open={configProvider !== null}
        onClose={() => setConfigProvider(null)}
        onCompleted={(action, provider) => {
          setConfigProvider(null);
          handleProviderConfigCompleted(action, provider);
        }}
      />

      <IntegrationCallbackBridge onConnected={handleConnectionComplete} />
    </div>
  );
}
