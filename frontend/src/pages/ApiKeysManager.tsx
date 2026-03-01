import { useCallback, useMemo, useState } from 'react';
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
import { useBulkMutation } from '@/hooks/useBulkMutation';
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

  const executeBulkRevoke = useBulkMutation({
    mutateAsync: (id: string) => revokeApiKeyMutation.mutateAsync(id),
    clearSelection,
    toast,
    messages: {
      successTitle: () => 'Keys revoked',
      successDescription: (n) => `Revoked ${n} API key${n !== 1 ? 's' : ''}.`,
      partialDescription: (s, total, f) => `Revoked ${s} of ${total} keys (${f} failed).`,
    },
  });

  const executeBulkDelete = useBulkMutation({
    mutateAsync: (id: string) => deleteApiKeyMutation.mutateAsync(id),
    clearSelection,
    toast,
    messages: {
      successTitle: () => 'Keys deleted',
      successDescription: (n) => `Deleted ${n} API key${n !== 1 ? 's' : ''}.`,
      partialDescription: (s, total, f) => `Deleted ${s} of ${total} keys (${f} failed).`,
    },
  });

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
    } catch {
      // Global MutationCache error handler shows the toast
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
    } catch {
      // Global MutationCache error handler shows the toast
    }
  };

  const handleBulkRevoke = async () => {
    const activeIds = orderedApiKeys
      .filter((k) => selectedIds.has(k.id) && k.isActive)
      .map((k) => k.id);
    if (activeIds.length === 0) return;

    const ok = await confirm({
      title: `Revoke ${activeIds.length} API key${activeIds.length !== 1 ? 's' : ''}`,
      description: `Are you sure you want to revoke ${activeIds.length} active key${activeIds.length !== 1 ? 's' : ''}? Applications using these keys will immediately stop working.`,
      confirmLabel: 'Revoke',
      destructive: true,
    });
    if (!ok) return;
    await executeBulkRevoke(activeIds);
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
    await executeBulkDelete(Array.from(selectedIds));
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
