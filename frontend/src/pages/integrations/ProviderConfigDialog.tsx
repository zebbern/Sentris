import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Check, Copy, Loader2 } from 'lucide-react';

import { useProviderConfig } from '@/hooks/queries/useIntegrationQueries';
import { api } from '@/services/api';
import { formatTimestamp } from './utils';
import type { IntegrationProvider } from './utils';
import { useCopyToClipboard } from '@/hooks/useCopyToClipboard';

interface ProviderConfigDialogProps {
  provider: IntegrationProvider | null;
  open: boolean;
  onClose: () => void;
  onCompleted: (action: 'saved' | 'deleted', provider: IntegrationProvider) => void;
}

export function ProviderConfigDialog({
  provider,
  open,
  onClose,
  onCompleted,
}: ProviderConfigDialogProps) {
  const [saving, setSaving] = useState(false);
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [hasStoredSecret, setHasStoredSecret] = useState(false);
  const [configuredBy, setConfiguredBy] = useState<'environment' | 'user'>('user');
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { copy, isCopied } = useCopyToClipboard();

  const callbackUrl = provider
    ? `${window.location.origin}/integrations/callback/${provider.id}`
    : '';

  // --- Query hook for provider config (only fetches when dialog is open) ---
  const {
    data: configData,
    isLoading: loading,
    error: configError,
  } = useProviderConfig(provider?.id, open);

  // Reset form fields when dialog closes
  useEffect(() => {
    if (!open) {
      setClientSecret('');
      setError(null);
      return;
    }
    // Reset fields when dialog opens with a new provider
    setError(null);
    setClientId('');
    setClientSecret('');
    setHasStoredSecret(false);
    setConfiguredBy('user');
    setUpdatedAt(null);
  }, [open, provider?.id]);

  // Sync query data → local form state
  useEffect(() => {
    if (!configData || !open) return;
    setClientId(configData.clientId ?? '');
    setHasStoredSecret(configData.hasClientSecret);
    setConfiguredBy(configData.configuredBy);
    setUpdatedAt(configData.updatedAt ?? null);
  }, [configData, open]);

  // Propagate query error
  useEffect(() => {
    if (configError && open) {
      const message =
        configError instanceof Error
          ? configError.message
          : 'Failed to load provider configuration.';
      setError(message);
    }
  }, [configError, open]);

  const handleDialogOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      onClose();
    }
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!provider) {
      return;
    }

    const trimmedClientId = clientId.trim();
    const trimmedSecret = clientSecret.trim();

    if (trimmedClientId.length === 0) {
      setError('Client ID is required.');
      return;
    }

    if (!hasStoredSecret && trimmedSecret.length === 0) {
      setError('Client secret is required.');
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await api.integrations.upsertProviderConfig(provider.id, {
        clientId: trimmedClientId,
        ...(trimmedSecret.length > 0 ? { clientSecret: trimmedSecret } : {}),
      });
      onCompleted('saved', provider);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to save provider credentials.';
      setError(message);
    } finally {
      setSaving(false);
    }
  };

  const handleRemove = async () => {
    if (!provider) {
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await api.integrations.deleteProviderConfig(provider.id);
      onCompleted('deleted', provider);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to remove stored credentials.';
      setError(message);
      setSaving(false);
    }
  };

  const canRemove = configuredBy === 'user' && hasStoredSecret;
  const isBusy = loading || saving;

  const handleCopyRedirect = async () => {
    if (!callbackUrl) {
      return;
    }

    const success = await copy(callbackUrl, {
      successDescription: 'Redirect URL copied to clipboard.',
      errorDescription: 'Unable to copy redirect URL. Please copy it manually.',
      showToast: false,
    });
    if (!success) {
      setError('Unable to copy redirect URL. Please copy it manually.');
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleDialogOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {provider ? `Configure ${provider.name}` : 'Configure provider'}
          </DialogTitle>
          <DialogDescription>
            Provide the OAuth client credentials required to start authorization flows for this
            provider.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {configuredBy === 'environment' && (
            <p className="text-xs text-muted-foreground">
              This provider currently uses credentials from the server environment. Saving values
              here will override them for Sentris Flow.
            </p>
          )}

          {loading && (
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Loading current configuration…
            </p>
          )}

          {updatedAt && (
            <p className="text-xs text-muted-foreground">
              Last updated {formatTimestamp(updatedAt)}
            </p>
          )}

          <div className="space-y-2">
            <Label htmlFor="provider-client-id">OAuth client ID</Label>
            <Input
              id="provider-client-id"
              value={clientId}
              onChange={(event) => setClientId(event.target.value)}
              placeholder="e.g. github-client-id"
              autoComplete="off"
              disabled={isBusy}
              aria-describedby={error ? 'provider-config-error' : undefined}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="provider-client-secret">OAuth client secret</Label>
            <Input
              id="provider-client-secret"
              value={clientSecret}
              onChange={(event) => setClientSecret(event.target.value)}
              placeholder={
                hasStoredSecret ? 'Leave blank to keep existing secret' : 'Enter new client secret'
              }
              type="password"
              autoComplete="off"
              disabled={isBusy}
            />
          </div>

          {callbackUrl && (
            <div className="space-y-2">
              <Label htmlFor="provider-callback-url">Authorized redirect URL</Label>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <Input
                  id="provider-callback-url"
                  value={callbackUrl}
                  readOnly
                  className="sm:flex-1"
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleCopyRedirect}
                  className="gap-2"
                >
                  {isCopied(callbackUrl) ? (
                    <Check className="h-4 w-4" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                  {isCopied(callbackUrl) ? 'Copied' : 'Copy'}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Add this exact URL to the provider&apos;s allowed redirect list to avoid callback
                warnings.
              </p>
            </div>
          )}

          {error && (
            <p id="provider-config-error" className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}

          <DialogFooter className="gap-2 sm:justify-between sm:flex-row">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              {canRemove && (
                <Button
                  type="button"
                  variant="destructive"
                  onClick={handleRemove}
                  disabled={isBusy}
                >
                  Remove stored credentials
                </Button>
              )}
            </div>
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={onClose} disabled={isBusy}>
                Cancel
              </Button>
              <Button type="submit" disabled={isBusy}>
                {saving ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Saving…
                  </>
                ) : (
                  'Save credentials'
                )}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
