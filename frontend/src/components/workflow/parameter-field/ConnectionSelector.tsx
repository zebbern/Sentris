import { useEffect, useMemo, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { logger } from '@/lib/logger';
import { useIntegrationConnections } from '@/hooks/queries/useIntegrationQueries';
import { getCurrentUserId } from '@/lib/currentUser';
import { env } from '@/config/env';

interface ConnectionSelectorProps {
  value: string | undefined;
  onChange: (value: string | undefined) => void;
  onUpdateParameter?: (paramId: string, value: unknown) => void;
  disabled: boolean;
  isRemoveGithubComponent: boolean;
}

/**
 * ConnectionSelector — GitHub integration connection picker.
 * Auto-selects when only one connection is available and supports
 * connection-mode / manual-mode switching for `github.org.membership.remove`.
 */
export function ConnectionSelector({
  value,
  onChange,
  onUpdateParameter,
  disabled,
  isRemoveGithubComponent,
}: ConnectionSelectorProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const autoSelectedConnectionRef = useRef(false);

  const currentUserId = useMemo(() => getCurrentUserId(), []);
  const {
    data: integrationConnections = [],
    isLoading: integrationLoading,
    error: integrationQueryError,
  } = useIntegrationConnections(currentUserId);
  const integrationError = integrationQueryError?.message ?? null;

  const githubConnections = useMemo(
    () => integrationConnections.filter((connection) => connection.provider === 'github'),
    [integrationConnections],
  );

  const selectedValue = typeof value === 'string' && value.trim().length > 0 ? value.trim() : '';

  // Auto-select when there's exactly one GitHub connection
  useEffect(() => {
    if (integrationLoading) return;

    if (selectedValue) {
      autoSelectedConnectionRef.current = true;
      return;
    }

    if (githubConnections.length === 1 && !autoSelectedConnectionRef.current) {
      const [firstConnection] = githubConnections;
      if (firstConnection) {
        autoSelectedConnectionRef.current = true;
        onChange(firstConnection.id);
        if (isRemoveGithubComponent) {
          onUpdateParameter?.('authMode', 'connection');
          onUpdateParameter?.('clientId', undefined);
          onUpdateParameter?.('clientSecret', undefined);
        }
      }
    }
  }, [
    githubConnections,
    integrationLoading,
    selectedValue,
    onChange,
    onUpdateParameter,
    isRemoveGithubComponent,
  ]);

  const handleRefreshConnections = async () => {
    try {
      await queryClient.invalidateQueries({ queryKey: ['integrationConnections'] });
    } catch (error: unknown) {
      logger.error('Failed to refresh integration connections', error);
    }
  };

  const isDisabled = disabled || integrationLoading;

  return (
    <div className="space-y-2">
      <select
        value={selectedValue}
        onChange={(event) => {
          autoSelectedConnectionRef.current = true;
          const nextValue = event.target.value;
          if (nextValue === '') {
            onChange(undefined);
            if (isRemoveGithubComponent) {
              onUpdateParameter?.('authMode', 'manual');
            }
          } else {
            onChange(nextValue);
            if (isRemoveGithubComponent) {
              onUpdateParameter?.('authMode', 'connection');
              onUpdateParameter?.('clientId', undefined);
              onUpdateParameter?.('clientSecret', undefined);
            }
          }
        }}
        className="w-full px-3 py-2 text-sm border rounded-md bg-background"
        disabled={isDisabled}
        aria-label="Select GitHub connection"
      >
        <option value="">Select a GitHub connection…</option>
        {githubConnections.map((connection) => (
          <option key={connection.id} value={connection.id}>
            {connection.providerName} · {connection.userId}
          </option>
        ))}
      </select>

      {integrationLoading && <p className="text-xs text-muted-foreground">Loading connections…</p>}
      {integrationError && <p className="text-sm text-destructive">{integrationError}</p>}
      {!integrationLoading && githubConnections.length === 0 && (
        <p className="text-xs text-muted-foreground">
          No active GitHub connections yet. Connect GitHub from the Connections manager.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {env.VITE_ENABLE_CONNECTIONS && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => navigate('/integrations')}
            disabled={disabled}
          >
            Manage connections
          </Button>
        )}
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => void handleRefreshConnections()}
          disabled={integrationLoading || disabled}
        >
          {integrationLoading ? 'Refreshing…' : 'Refresh'}
        </Button>
        {selectedValue && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => {
              onChange(undefined);
              if (isRemoveGithubComponent) {
                onUpdateParameter?.('authMode', 'manual');
              }
            }}
            disabled={disabled}
          >
            Clear selection
          </Button>
        )}
      </div>
    </div>
  );
}
