import { useCallback, useMemo, useState } from 'react';
import { humanizeApiError } from '@/lib/humanizeApiError';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { useToast } from '@/components/ui/use-toast';
import { useCopyToClipboard } from '@/hooks/useCopyToClipboard';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useConfirmDialog } from '@/hooks/useConfirmDialog';
import { useApiKeys, useRevokeApiKey, useDeleteApiKey } from '@/hooks/queries/useApiKeyQueries';
import { useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/queryKeys';
import { useAuthStore } from '@/store/authStore';
import { hasAdminRole } from '@/utils/auth';
import { useBulkSelection } from '@/hooks/useBulkSelection';
import { useSortableList } from '@/hooks/useSortableList';
import type { components } from '@sentris/backend-client';
import { ApiKeysTable } from './api-keys-manager/ApiKeysTable';
import { CreateApiKeyDialog } from './api-keys-manager/CreateApiKeyDialog';

type ApiKeyResponseDto = components['schemas']['ApiKeyResponseDto'];

export function ApiKeysManager() {
  useDocumentTitle('API Keys');
  const roles = useAuthStore((state) => state.roles);
  const canManageKeys = hasAdminRole(roles);
  const isReadOnly = !canManageKeys;
  const queryClient = useQueryClient();

  const organizationId = useAuthStore((state) => state.organizationId);
  const { data: apiKeys = [], isLoading: loading, error: apiKeysError } = useApiKeys();
  const error = apiKeysError?.message ?? null;

  const getApiKeyId = useCallback((k: ApiKeyResponseDto) => k.id, []);

  const {
    orderedItems: orderedApiKeys,
    sensors,
    collisionDetection,
    handleDragEnd,
  } = useSortableList({
    items: apiKeys,
    getId: getApiKeyId,
    storageKey: `sentris:sort:apikeys:${organizationId}`,
  });
  const revokeApiKeyMutation = useRevokeApiKey();
  const deleteApiKeyMutation = useDeleteApiKey();

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const { toast } = useToast();
  const { copy } = useCopyToClipboard();
  const { confirm, dialogProps } = useConfirmDialog();

  const {
    selectedIds,
    toggleId,
    toggleAll,
    clearSelection,
    isAllSelected,
    isIndeterminate,
    selectedCount,
  } = useBulkSelection(orderedApiKeys);

  const hasActiveSelected = useMemo(
    () => orderedApiKeys.some((k) => selectedIds.has(k.id) && k.isActive),
    [orderedApiKeys, selectedIds],
  );

  const copyToClipboard = (text: string) => {
    void copy(text, { successDescription: 'API key copied to clipboard.' });
  };

  const handleRevoke = async (key: ApiKeyResponseDto) => {
    const ok = await confirm({
      title: 'Revoke API Key',
      description: `Are you sure you want to revoke the key "${key.name}"? Applications using this key will immediately stop working.`,
      confirmLabel: 'Revoke',
      destructive: true,
    });
    if (!ok) return;
    try {
      await revokeApiKeyMutation.mutateAsync(key.id);
      toast({ title: 'Key revoked', description: `API Key "${key.name}" revoked.` });
    } catch (err: unknown) {
      toast({
        title: 'Revoke failed',
        description: humanizeApiError(err),
        variant: 'destructive',
      });
    }
  };

  const handleDelete = async (key: ApiKeyResponseDto) => {
    const ok = await confirm({
      title: 'Delete API Key',
      description: `Are you sure you want to delete the key "${key.name}"? This action cannot be undone.`,
      confirmLabel: 'Delete',
    });
    if (!ok) return;
    try {
      await deleteApiKeyMutation.mutateAsync(key.id);
      toast({ title: 'Key deleted', description: `API Key "${key.name}" deleted.` });
    } catch (err: unknown) {
      toast({
        title: 'Delete failed',
        description: humanizeApiError(err),
        variant: 'destructive',
      });
    }
  };

  const handleBulkRevoke = async () => {
    const activeIds = orderedApiKeys
      .filter((k) => selectedIds.has(k.id) && k.isActive)
      .map((k) => k.id);
    const count = activeIds.length;
    if (count === 0) return;

    const ok = await confirm({
      title: `Revoke ${count} API key${count !== 1 ? 's' : ''}`,
      description: `Are you sure you want to revoke ${count} active key${count !== 1 ? 's' : ''}? Applications using these keys will immediately stop working.`,
      confirmLabel: 'Revoke',
      destructive: true,
    });
    if (!ok) return;

    const results = await Promise.allSettled(
      activeIds.map((id) => revokeApiKeyMutation.mutateAsync(id)),
    );
    const succeeded = results.filter((r) => r.status === 'fulfilled').length;
    const failed = results.filter((r) => r.status === 'rejected').length;

    clearSelection();

    if (failed === 0) {
      toast({
        title: 'Keys revoked',
        description: `Revoked ${succeeded} API key${succeeded !== 1 ? 's' : ''}.`,
      });
    } else {
      toast({
        title: 'Partial failure',
        description: `Revoked ${succeeded} of ${count} keys (${failed} failed).`,
        variant: 'destructive',
      });
    }
  };

  const handleBulkDelete = async () => {
    const count = selectedCount;
    const ok = await confirm({
      title: `Delete ${count} API key${count !== 1 ? 's' : ''}`,
      description: `Are you sure you want to delete ${count} API key${count !== 1 ? 's' : ''}? This action cannot be undone.`,
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!ok) return;

    const ids = Array.from(selectedIds);
    const results = await Promise.allSettled(ids.map((id) => deleteApiKeyMutation.mutateAsync(id)));
    const succeeded = results.filter((r) => r.status === 'fulfilled').length;
    const failed = results.filter((r) => r.status === 'rejected').length;

    clearSelection();

    if (failed === 0) {
      toast({
        title: 'Keys deleted',
        description: `Deleted ${succeeded} API key${succeeded !== 1 ? 's' : ''}.`,
      });
    } else {
      toast({
        title: 'Partial failure',
        description: `Deleted ${succeeded} of ${count} keys (${failed} failed).`,
        variant: 'destructive',
      });
    }
  };

  return (
    <div className="flex-1 bg-background" aria-busy={loading}>
      <div className="container mx-auto py-4 md:py-8 px-3 md:px-4">
        <ApiKeysTable
          apiKeys={apiKeys}
          orderedApiKeys={orderedApiKeys}
          loading={loading}
          error={error}
          isReadOnly={isReadOnly}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          onCreateOpen={() => setIsCreateOpen(true)}
          onRefresh={() => queryClient.invalidateQueries({ queryKey: queryKeys.apiKeys.all() })}
          sensors={sensors}
          collisionDetection={collisionDetection}
          onDragEnd={handleDragEnd}
          selectedIds={selectedIds}
          toggleId={toggleId}
          toggleAll={toggleAll}
          isAllSelected={isAllSelected}
          isIndeterminate={isIndeterminate}
          selectedCount={selectedCount}
          hasActiveSelected={hasActiveSelected}
          onBulkRevoke={handleBulkRevoke}
          onBulkDelete={handleBulkDelete}
          onRevoke={handleRevoke}
          onDelete={handleDelete}
        />
      </div>

      <CreateApiKeyDialog
        isOpen={isCreateOpen}
        onOpenChange={setIsCreateOpen}
        canManageKeys={canManageKeys}
        onCopy={copyToClipboard}
      />

      <ConfirmDialog {...dialogProps} />
    </div>
  );
}
