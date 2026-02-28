import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/use-toast';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { ExternalLink, KeyRound, Plug, RefreshCcw, Trash2 } from 'lucide-react';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorBanner } from '@/components/ui/error-banner';
import { PageToolbar } from '@/components/shared/PageToolbar';

import {
  useIntegrationProviders,
  useIntegrationConnections,
  useRefreshConnection,
  useDisconnectIntegration,
} from '@/hooks/queries/useIntegrationQueries';
import { useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/queryKeys';
import { getCurrentUserId } from '@/lib/currentUser';
import { api } from '@/services/api';
import { env } from '@/config/env';

import { formatTimestamp, getProviderConnection } from './integrations/utils';
import type { IntegrationProvider, IntegrationConnection } from './integrations/utils';
import { ProviderConfigDialog } from './integrations/ProviderConfigDialog';
import { logger } from '@/lib/logger';
import { isAllowedOAuthDomain } from '@/utils/urlSecurity';
import { IntegrationCallbackBridge } from './integrations/IntegrationCallbackBridge';

export function IntegrationsManager() {
  useDocumentTitle('Integrations');
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
  const refreshConnectionMutation = useRefreshConnection();
  const disconnectMutation = useDisconnectIntegration();

  const error = providersError?.message ?? connectionsError?.message ?? null;

  const [configProvider, setConfigProvider] = useState<IntegrationProvider | null>(null);
  const [connectingProvider, setConnectingProvider] = useState<string | null>(null);
  const [refreshingConnectionId, setRefreshingConnectionId] = useState<string | null>(null);
  const [deletingConnectionId, setDeletingConnectionId] = useState<string | null>(null);
  const [customScopes, setCustomScopes] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!error) {
      return;
    }

    toast({
      title: 'Integration error',
      description: error,
      variant: 'destructive',
    });
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

  const parseAdditionalScopes = (input: string | undefined): string[] => {
    if (!input) {
      return [];
    }
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

  const handleConnect = async (provider: IntegrationProvider) => {
    // errors are auto-managed by react-query

    if (!provider.isConfigured) {
      setConfigProvider(provider);
      return;
    }

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

  const handleConfigureProvider = (provider: IntegrationProvider) => {
    // errors are auto-managed by react-query
    setConfigProvider(provider);
  };

  const handleRefresh = async (connection: IntegrationConnection) => {
    // errors are auto-managed by react-query
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
    // errors are auto-managed by react-query
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
    setConfigProvider(null);

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

    toast({
      title,
      description,
    });
  };

  const handleConnectionComplete = (connection: IntegrationConnection) => {
    queryClient.invalidateQueries({ queryKey: queryKeys.integrations.connections() });
    toast({
      title: `${connection.providerName} connected`,
      description: 'Credentials stored successfully.',
    });
  };

  return (
    <div className="flex-1 bg-background">
      <div className="container mx-auto py-8 px-4">
        <PageToolbar className="mb-4 md:mb-6" />

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

          {loadingConnections && connections.length === 0 ? (
            <div className="overflow-x-auto border rounded-lg">
              <Table className="table-fixed w-full">
                <TableHeader>
                  <TableRow>
                    <TableHead>Provider</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="hidden sm:table-cell">Scopes</TableHead>
                    <TableHead className="hidden md:table-cell">Expires</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {Array.from({ length: 3 }).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell>
                        <Skeleton className="h-4 w-[120px] mb-1" />
                        <Skeleton className="h-3 w-[80px]" />
                      </TableCell>
                      <TableCell>
                        <Skeleton className="h-5 w-[60px] rounded-full" />
                      </TableCell>
                      <TableCell className="hidden sm:table-cell">
                        <div className="flex gap-2">
                          <Skeleton className="h-5 w-[50px] rounded-full" />
                          <Skeleton className="h-5 w-[70px] rounded-full" />
                        </div>
                      </TableCell>
                      <TableCell className="hidden md:table-cell">
                        <Skeleton className="h-4 w-[100px]" />
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          <Skeleton className="h-8 w-8 rounded-md" />
                          <Skeleton className="h-8 w-8 rounded-md" />
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : !loadingConnections && connections.length === 0 ? (
            <div className="border rounded-lg bg-muted/30">
              <EmptyState
                icon={Plug}
                title="No active connections yet"
                description="Connect a provider below to start using OAuth-protected APIs in your workflows."
                className="py-10"
              />
            </div>
          ) : (
            <div className="overflow-x-auto border rounded-lg">
              <Table className="table-fixed w-full">
                <TableHeader>
                  <TableRow>
                    <TableHead>Provider</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="hidden sm:table-cell">Scopes</TableHead>
                    <TableHead className="hidden md:table-cell">Expires</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {connections.map((connection) => {
                    const isRefreshing = refreshingConnectionId === connection.id;
                    const isDeleting = deletingConnectionId === connection.id;
                    const provider = providers.find((item) => item.id === connection.provider);
                    const canRefresh = connection.supportsRefresh && connection.hasRefreshToken;

                    return (
                      <TableRow key={connection.id}>
                        <TableCell>
                          <div className="font-medium">{connection.providerName}</div>
                          <div className="text-xs text-muted-foreground">{connection.userId}</div>
                        </TableCell>
                        <TableCell className="whitespace-nowrap">
                          <Badge
                            variant={connection.status === 'active' ? 'secondary' : 'destructive'}
                            className="uppercase tracking-wide"
                          >
                            {connection.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="hidden sm:table-cell">
                          <div className="flex flex-wrap gap-2">
                            {connection.scopes.map((scope) => (
                              <Badge key={scope} variant="outline" className="text-[11px]">
                                {scope}
                              </Badge>
                            ))}
                            {connection.scopes.length === 0 && (
                              <span className="text-xs text-muted-foreground">(none)</span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-sm text-muted-foreground hidden md:table-cell">
                          {formatTimestamp(connection.expiresAt ?? null)}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-2">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="gap-2"
                              disabled={isRefreshing || !canRefresh}
                              onClick={() => handleRefresh(connection)}
                            >
                              <RefreshCcw className="h-4 w-4" />
                              {isRefreshing ? 'Refreshing…' : 'Refresh'}
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="gap-2"
                              disabled={isDeleting}
                              onClick={() => handleDisconnect(connection)}
                            >
                              <Trash2 className="h-4 w-4" />
                              {isDeleting ? 'Removing…' : 'Remove'}
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              className="gap-2"
                              onClick={() => handleManualReconnect(connection)}
                              disabled={
                                connectingProvider === connection.provider ||
                                !provider?.isConfigured
                              }
                            >
                              <Plug className="h-4 w-4" />
                              Reconnect
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
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
            {providers.map((provider) => {
              const connection = getProviderConnection(provider.id, connectionByProvider);
              const isConnecting = connectingProvider === provider.id;
              const requestedScopes = buildRequestedScopes(provider);
              const additionalScopesValue = customScopes[provider.id] ?? '';
              const configuredBadge = provider.isConfigured ? (
                <Badge variant="secondary">Configured</Badge>
              ) : (
                <Badge variant="outline">Setup required</Badge>
              );

              // Get colored logo URL using Logo.dev (recommended alternative to Clearbit Logo API)
              // Reference: https://clearbit.com/blog/the-future-of-clearbits-free-tools
              const getLogoUrl = (providerId: string) => {
                // Map provider IDs to domain names for Logo.dev
                const domainMap: Record<string, string> = {
                  github: 'github.com',
                  zoom: 'zoom.us',
                  // Add more providers as needed: 'provider-id': 'domain.com'
                };

                const domain = domainMap[providerId.toLowerCase()];
                if (!domain || !env.VITE_LOGO_DEV_PUBLIC_KEY) return null;

                // Logo.dev provides colored brand logos via CDN (free alternative to Clearbit)
                // Read public key from environment variable
                return `https://img.logo.dev/${domain}?token=${env.VITE_LOGO_DEV_PUBLIC_KEY}`;
              };

              const logoUrl = getLogoUrl(provider.id);

              return (
                <div
                  key={provider.id}
                  className="border rounded-lg p-5 bg-card flex flex-col gap-4 relative"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-start gap-3">
                      {logoUrl && (
                        <div className="h-10 w-10 flex-shrink-0 rounded-full bg-white dark:bg-muted flex items-center justify-center p-1.5 mt-0.5 border border-border/50 shadow-sm">
                          <img
                            src={logoUrl}
                            alt={`${provider.name} logo`}
                            className="h-full w-full object-contain rounded-full"
                            onError={(e) => {
                              // Hide logo container if image fails to load
                              e.currentTarget.parentElement!.style.display = 'none';
                            }}
                          />
                        </div>
                      )}
                      <div>
                        <h3 className="text-lg font-semibold">{provider.name}</h3>
                        <p className="text-sm text-muted-foreground">{provider.description}</p>
                      </div>
                    </div>
                    {configuredBadge}
                  </div>

                  <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                    {requestedScopes.map((scope) => (
                      <Badge key={scope} variant="outline" className="text-[11px]">
                        {scope}
                      </Badge>
                    ))}
                  </div>

                  <div className="space-y-2">
                    <Label
                      htmlFor={`additional-scopes-${provider.id}`}
                      className="text-xs font-medium"
                    >
                      Additional scopes
                    </Label>
                    <Input
                      id={`additional-scopes-${provider.id}`}
                      value={additionalScopesValue}
                      placeholder={
                        {
                          github: 'repo delete_repo',
                          zoom: 'recording:read chat:write',
                        }[provider.id] || 'scope1 scope2'
                      }
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault();
                          const normalized = parseAdditionalScopes(additionalScopesValue);
                          if (normalized.length > 0) {
                            setCustomScopes((prev) => ({
                              ...prev,
                              [provider.id]: normalized.join(' '),
                            }));
                            toast({
                              title: 'Scopes added',
                              description: `Queued ${normalized.join(', ')} for next connection attempt.`,
                            });
                          }
                        }
                      }}
                      onChange={(event) =>
                        setCustomScopes((prev) => ({
                          ...prev,
                          [provider.id]: event.target.value,
                        }))
                      }
                    />
                    <p className="text-xs text-muted-foreground">
                      Separate scopes with spaces or commas. Press Enter to normalize them. Default
                      scopes stay included automatically.
                    </p>
                  </div>

                  {connection ? (
                    <p className="text-xs text-muted-foreground">
                      Last updated {formatTimestamp(connection.updatedAt)}
                    </p>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      No active token stored for this provider.
                    </p>
                  )}

                  <div className="flex items-center gap-2 mt-auto">
                    <Button
                      onClick={() => handleConnect(provider)}
                      disabled={isConnecting}
                      className="gap-2"
                    >
                      <Plug className="h-4 w-4" />
                      {isConnecting ? 'Starting…' : connection ? 'Reconnect' : 'Connect'}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-2"
                      disabled={isConnecting}
                      onClick={() => handleConfigureProvider(provider)}
                    >
                      <KeyRound className="h-4 w-4" />
                      Manage credentials
                    </Button>
                  </div>

                  {/* Docs button - absolute bottom right */}
                  {provider.docsUrl && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="absolute bottom-2 right-2 h-8 w-8 p-0"
                      onClick={() => window.open(provider.docsUrl, '_blank', 'noopener noreferrer')}
                      title="View documentation"
                    >
                      <ExternalLink className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              );
            })}
          </div>

          {(loadingProviders || loadingConnections) && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
              {Array.from({ length: 3 }).map((_, idx) => (
                <div
                  key={`skeleton-${idx}`}
                  className="border rounded-lg p-5 bg-card flex flex-col gap-4"
                >
                  <div className="flex items-start gap-3">
                    <Skeleton className="h-10 w-10 rounded-full flex-shrink-0" />
                    <div className="flex-1 space-y-2">
                      <Skeleton className="h-5 w-[140px]" />
                      <Skeleton className="h-3 w-[200px]" />
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Skeleton className="h-5 w-[60px]" />
                    <Skeleton className="h-5 w-[50px]" />
                  </div>
                  <Skeleton className="h-9 w-[100px]" />
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      <ProviderConfigDialog
        provider={configProvider}
        open={configProvider !== null}
        onClose={() => setConfigProvider(null)}
        onCompleted={handleProviderConfigCompleted}
      />

      {/* Hidden portal slot to inject new connections from callback */}
      <IntegrationCallbackBridge onConnected={handleConnectionComplete} />
    </div>
  );
}
