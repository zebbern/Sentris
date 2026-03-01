import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { ExternalLink, KeyRound, Plug } from 'lucide-react';
import { env } from '@/config/env';

import { formatTimestamp } from './utils';
import type { IntegrationProvider, IntegrationConnection } from './utils';

/** Map provider IDs to domain names for Logo.dev */
const LOGO_DOMAIN_MAP: Record<string, string> = {
  github: 'github.com',
  zoom: 'zoom.us',
};

function getLogoUrl(providerId: string): string | null {
  const domain = LOGO_DOMAIN_MAP[providerId.toLowerCase()];
  if (!domain || !env.VITE_LOGO_DEV_PUBLIC_KEY) return null;
  return `https://img.logo.dev/${domain}?token=${env.VITE_LOGO_DEV_PUBLIC_KEY}`;
}

interface ProviderCardProps {
  provider: IntegrationProvider;
  connection: IntegrationConnection | undefined;
  isConnecting: boolean;
  requestedScopes: string[];
  additionalScopesValue: string;
  onScopesChange: (providerId: string, value: string) => void;
  onScopesNormalize: (providerId: string, value: string) => void;
  onConnect: (provider: IntegrationProvider) => void;
  onConfigure: (provider: IntegrationProvider) => void;
}

export function ProviderCard({
  provider,
  connection,
  isConnecting,
  requestedScopes,
  additionalScopesValue,
  onScopesChange,
  onScopesNormalize,
  onConnect,
  onConfigure,
}: ProviderCardProps) {
  const logoUrl = getLogoUrl(provider.id);
  const configuredBadge = provider.isConfigured ? (
    <Badge variant="secondary">Configured</Badge>
  ) : (
    <Badge variant="outline">Setup required</Badge>
  );

  return (
    <div className="border rounded-lg p-5 bg-card flex flex-col gap-4 relative">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          {logoUrl && (
            <div className="h-10 w-10 flex-shrink-0 rounded-full bg-white dark:bg-muted flex items-center justify-center p-1.5 mt-0.5 border border-border/50 shadow-sm">
              <img
                src={logoUrl}
                alt={`${provider.name} logo`}
                width={40}
                height={40}
                className="h-full w-full object-contain rounded-full"
                onError={(e) => {
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
        <Label htmlFor={`additional-scopes-${provider.id}`} className="text-xs font-medium">
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
              onScopesNormalize(provider.id, additionalScopesValue);
            }
          }}
          onChange={(event) => onScopesChange(provider.id, event.target.value)}
        />
        <p className="text-xs text-muted-foreground">
          Separate scopes with spaces or commas. Press Enter to normalize them. Default scopes stay
          included automatically.
        </p>
      </div>

      {connection ? (
        <p className="text-xs text-muted-foreground">
          Last updated {formatTimestamp(connection.updatedAt)}
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">No active token stored for this provider.</p>
      )}

      <div className="flex items-center gap-2 mt-auto">
        <Button onClick={() => onConnect(provider)} disabled={isConnecting} className="gap-2">
          <Plug className="h-4 w-4" />
          {isConnecting ? 'Starting…' : connection ? 'Reconnect' : 'Connect'}
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="gap-2"
          disabled={isConnecting}
          onClick={() => onConfigure(provider)}
        >
          <KeyRound className="h-4 w-4" />
          Manage credentials
        </Button>
      </div>

      {provider.docsUrl && (
        <Button
          variant="ghost"
          size="sm"
          className="absolute bottom-2 right-2 h-8 w-8 p-0"
          onClick={() => window.open(provider.docsUrl, '_blank', 'noopener noreferrer')}
          title="View documentation"
          aria-label="View documentation"
        >
          <ExternalLink className="h-4 w-4" />
        </Button>
      )}
    </div>
  );
}

export function ProviderCardSkeleton() {
  return (
    <div className="border rounded-lg p-5 bg-card flex flex-col gap-4">
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
  );
}
