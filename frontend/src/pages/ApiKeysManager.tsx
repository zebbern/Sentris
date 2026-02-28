import { useCallback, useEffect, useState } from 'react';
import { humanizeApiError } from '@/lib/humanizeApiError';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Copy, Trash2, ShieldOff, AlertTriangle, Key, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { getStatusBadgeClassFromStatus } from '@/utils/statusBadgeStyles';
import { DndContext } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { useSortableList } from '@/hooks/useSortableList';
import { SortableTableRow, DragHandle } from '@/components/ui/sortable';
import { useToast } from '@/components/ui/use-toast';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useConfirmDialog } from '@/hooks/useConfirmDialog';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorBanner } from '@/components/ui/error-banner';
import { Skeleton } from '@/components/ui/skeleton';
import {
  useApiKeys,
  useCreateApiKey,
  useRevokeApiKey,
  useDeleteApiKey,
  useApiKeyUiStore,
} from '@/hooks/queries/useApiKeyQueries';
import { useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/queryKeys';
import { useAuthStore } from '@/store/authStore';
import { hasAdminRole } from '@/utils/auth';
import type { CreateApiKeyInput } from '@/schemas/apiKey';
import type { components } from '@shipsec/backend-client';

type ApiKeyResponseDto = components['schemas']['ApiKeyResponseDto'];

const INITIAL_FORM: CreateApiKeyInput = {
  name: '',
  description: '',
  expiresAt: undefined,
  permissions: {
    workflows: {
      run: true, // Default to allowing run
      list: false,
      read: false,
    },
    runs: {
      read: true, // Default to allowing reading runs
      cancel: false,
    },
    audit: {
      read: false,
    },
  },
};

function formatDate(iso: string) {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(iso));
}

function truncateKey(keyHint: string) {
  return `...${keyHint}`;
}

export function ApiKeysManager() {
  useDocumentTitle('API Keys');
  const roles = useAuthStore((state) => state.roles);
  const canManageKeys = hasAdminRole(roles);
  const isReadOnly = !canManageKeys;
  const queryClient = useQueryClient();

  const organizationId = useAuthStore((state) => state.organizationId);
  const { data: apiKeys = [], isLoading: loading, error: apiKeysError, refetch } = useApiKeys();
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
    storageKey: `shipsec:sort:apikeys:${organizationId}`,
  });
  const createApiKeyMutation = useCreateApiKey();
  const revokeApiKeyMutation = useRevokeApiKey();
  const deleteApiKeyMutation = useDeleteApiKey();
  const lastCreatedKey = useApiKeyUiStore((state) => state.lastCreatedKey);
  const clearLastCreatedKey = useApiKeyUiStore((state) => state.clearLastCreatedKey);

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [formState, setFormState] = useState<CreateApiKeyInput>(INITIAL_FORM);
  const [createError, setCreateError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const { toast } = useToast();
  const { confirm, dialogProps } = useConfirmDialog();

  useEffect(() => {
    if (!successMessage) return;
    const timer = setTimeout(() => setSuccessMessage(null), 5000);
    return () => clearTimeout(timer);
  }, [successMessage]);

  const handleCreateOpenChange = (open: boolean) => {
    setIsCreateOpen(open);
    if (!open) {
      setFormState(INITIAL_FORM);
      setCreateError(null);
      clearLastCreatedKey(); // Clear sensitive key if dialog closed
    }
  };

  const handleInputChange = (field: keyof CreateApiKeyInput, value: any) => {
    setFormState((prev) => ({
      ...prev,
      [field]: value,
    }));
  };

  const handlePermissionChange = (
    category: 'workflows' | 'runs' | 'audit',
    action: string,
    checked: boolean,
  ) => {
    setFormState((prev) => ({
      ...prev,
      permissions: {
        ...prev.permissions,
        [category]: {
          ...(prev.permissions[category] as Record<string, boolean>),
          [action]: checked,
        },
      },
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canManageKeys) return;

    setCreateError(null);
    setIsSubmitting(true);

    try {
      await createApiKeyMutation.mutateAsync(formState);
      setSuccessMessage('API Key created successfully.');
      // Don't close dialog yet because we need to show the key
    } catch (err: unknown) {
      const message = humanizeApiError(err);
      setCreateError(message);
    } finally {
      setIsSubmitting(false);
    }
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
      setSuccessMessage(`API Key "${key.name}" revoked.`);
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
      setSuccessMessage(`API Key "${key.name}" deleted.`);
    } catch (err: unknown) {
      toast({
        title: 'Delete failed',
        description: humanizeApiError(err),
        variant: 'destructive',
      });
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast({ title: 'Copied', description: 'API key copied to clipboard.' });
  };

  return (
    <div className="flex-1 bg-background" aria-busy={loading}>
      <div className="container mx-auto py-4 md:py-8 px-3 md:px-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-4 md:mb-8">
          <div className="flex items-center gap-2">
            <Button
              onClick={() => setIsCreateOpen(true)}
              disabled={isReadOnly}
              className="self-start sm:self-auto"
            >
              Create new key
            </Button>
            <Button
              variant="outline"
              onClick={() => refetch()}
              disabled={loading}
              className="gap-2"
            >
              <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
              <span className="hidden sm:inline">Refresh</span>
            </Button>
          </div>
        </div>

        {error && (
          <ErrorBanner
            message={error}
            onRetry={() => queryClient.invalidateQueries({ queryKey: queryKeys.apiKeys.all() })}
            className="mb-4 md:mb-6"
          />
        )}

        {successMessage && (
          <div className="mb-4 md:mb-6 rounded-md bg-success/10 p-3 md:p-4 text-xs md:text-sm text-success">
            {successMessage}
          </div>
        )}

        <div className="border rounded-md bg-card overflow-hidden">
          <div className="overflow-x-auto">
            <DndContext
              sensors={sensors}
              collisionDetection={collisionDetection}
              onDragEnd={handleDragEnd}
            >
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10" />
                    <TableHead className="min-w-[120px]">Name</TableHead>
                    <TableHead className="min-w-[80px]">Key Hint</TableHead>
                    <TableHead className="min-w-[120px] hidden md:table-cell">
                      Permissions
                    </TableHead>
                    <TableHead className="min-w-[80px]">Status</TableHead>
                    <TableHead className="min-w-[100px] hidden sm:table-cell">Created</TableHead>
                    <TableHead className="min-w-[100px] hidden lg:table-cell">Last Used</TableHead>
                    <TableHead className="text-right min-w-[80px]">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading && apiKeys.length === 0 ? (
                    Array.from({ length: 4 }).map((_, idx) => (
                      <TableRow key={`skeleton-${idx}`}>
                        <TableCell>
                          <Skeleton className="h-4 w-4" />
                        </TableCell>
                        <TableCell>
                          <Skeleton className="h-4 w-[120px]" />
                          <Skeleton className="h-3 w-[80px] mt-1" />
                        </TableCell>
                        <TableCell>
                          <Skeleton className="h-4 w-[60px]" />
                        </TableCell>
                        <TableCell className="hidden md:table-cell">
                          <div className="flex gap-1">
                            <Skeleton className="h-5 w-[70px]" />
                            <Skeleton className="h-5 w-[50px]" />
                          </div>
                        </TableCell>
                        <TableCell>
                          <Skeleton className="h-5 w-[60px]" />
                        </TableCell>
                        <TableCell className="hidden sm:table-cell">
                          <Skeleton className="h-4 w-[80px]" />
                        </TableCell>
                        <TableCell className="hidden lg:table-cell">
                          <Skeleton className="h-4 w-[80px]" />
                        </TableCell>
                        <TableCell className="text-right">
                          <Skeleton className="h-8 w-8 ml-auto" />
                        </TableCell>
                      </TableRow>
                    ))
                  ) : apiKeys.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={8}>
                        <EmptyState
                          icon={Key}
                          title="No API keys"
                          description="Create your first API key to enable programmatic access."
                          className="py-10"
                        />
                      </TableCell>
                    </TableRow>
                  ) : (
                    <SortableContext
                      items={orderedApiKeys.map((k) => k.id)}
                      strategy={verticalListSortingStrategy}
                    >
                      {orderedApiKeys.map((key) => (
                        <SortableTableRow key={key.id} id={key.id}>
                          {({ handleProps }) => (
                            <>
                              <DragHandle {...handleProps} />
                              <TableCell className="font-medium">
                                <div className="truncate max-w-[150px] md:max-w-none">
                                  {key.name}
                                </div>
                                {key.description && (
                                  <div className="text-xs text-muted-foreground truncate max-w-[150px] md:max-w-none">
                                    {key.description}
                                  </div>
                                )}
                              </TableCell>
                              <TableCell className="font-mono text-xs">
                                {truncateKey(key.keyHint)}
                              </TableCell>
                              <TableCell className="hidden md:table-cell">
                                <div className="flex flex-wrap gap-1">
                                  {Object.entries(key.permissions).map(([resource, actions]) =>
                                    Object.entries(actions as Record<string, boolean>)
                                      .filter(([, enabled]) => enabled)
                                      .map(([action]) => (
                                        <Badge
                                          key={`${resource}:${action}`}
                                          variant="secondary"
                                          className="text-[10px]"
                                        >
                                          {resource}:{action}
                                        </Badge>
                                      )),
                                  )}
                                </div>
                              </TableCell>
                              <TableCell>
                                <Badge
                                  variant="outline"
                                  className={getStatusBadgeClassFromStatus(
                                    key.isActive ? 'active' : 'revoked',
                                    'text-xs',
                                  )}
                                >
                                  {key.isActive ? 'Active' : 'Revoked'}
                                </Badge>
                              </TableCell>
                              <TableCell className="text-muted-foreground text-xs hidden sm:table-cell">
                                {formatDate(key.createdAt)}
                              </TableCell>
                              <TableCell className="text-muted-foreground text-xs hidden lg:table-cell">
                                {key.lastUsedAt ? formatDate(key.lastUsedAt) : 'Never'}
                              </TableCell>
                              <TableCell className="text-right">
                                <div className="flex items-center justify-end gap-1">
                                  {key.isActive && (
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      title="Revoke Key"
                                      aria-label="Revoke key"
                                      onClick={() => handleRevoke(key)}
                                      disabled={isReadOnly}
                                      className="h-8 w-8"
                                    >
                                      <ShieldOff className="h-4 w-4" />
                                    </Button>
                                  )}
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    title="Delete Key"
                                    aria-label="Delete key"
                                    onClick={() => handleDelete(key)}
                                    disabled={isReadOnly}
                                    className="h-8 w-8"
                                  >
                                    <Trash2 className="h-4 w-4 text-destructive" />
                                  </Button>
                                </div>
                              </TableCell>
                            </>
                          )}
                        </SortableTableRow>
                      ))}
                    </SortableContext>
                  )}
                </TableBody>
              </Table>
            </DndContext>
          </div>
        </div>
      </div>

      {/* Create Dialog */}
      <Dialog open={isCreateOpen} onOpenChange={handleCreateOpenChange}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Create new API Key</DialogTitle>
            <DialogDescription>
              Create a new API key to access ShipSec programmatically.
            </DialogDescription>
          </DialogHeader>

          {lastCreatedKey ? (
            <div className="space-y-4">
              <div className="rounded-md bg-warning/10 dark:bg-warning/10 p-4 mb-4">
                <div className="flex">
                  <div className="flex-shrink-0">
                    <AlertTriangle className="h-5 w-5 text-warning" aria-hidden="true" />
                  </div>
                  <div className="ml-3">
                    <h3 className="text-sm font-medium text-warning">Save your secret key</h3>
                    <div className="mt-2 text-sm text-warning">
                      <p>
                        This is the only time we will show you the secret key. Make sure to copy it
                        now.
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <Label>Secret Key</Label>
                <div className="flex items-center gap-2">
                  <Input readOnly value={lastCreatedKey} className="font-mono bg-muted" />
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Copy secret key"
                    onClick={() => copyToClipboard(lastCreatedKey)}
                  >
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              <DialogFooter>
                <Button onClick={() => handleCreateOpenChange(false)}>Done</Button>
              </DialogFooter>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="name">Name</Label>
                <Input
                  id="name"
                  placeholder="e.g. CI/CD Runner"
                  value={formState.name}
                  onChange={(e) => handleInputChange('name', e.target.value)}
                  maxLength={100}
                  required
                  aria-required="true"
                  aria-describedby={createError ? 'create-api-key-error' : undefined}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="description">Description (Optional)</Label>
                <Input
                  id="description"
                  placeholder="What is this key used for?"
                  value={formState.description || ''}
                  onChange={(e) => handleInputChange('description', e.target.value)}
                  maxLength={500}
                />
              </div>

              <div className="space-y-3">
                <Label>Permissions</Label>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 border p-3 rounded-md">
                  <div className="space-y-2">
                    <Label className="text-xs uppercase text-muted-foreground font-semibold">
                      Workflows
                    </Label>
                    <div className="flex items-center space-x-2">
                      <Checkbox
                        id="perm-wf-run"
                        checked={formState.permissions.workflows.run}
                        onCheckedChange={(checked) =>
                          handlePermissionChange('workflows', 'run', checked as boolean)
                        }
                      />
                      <Label htmlFor="perm-wf-run" className="font-normal text-sm">
                        Run Workflows
                      </Label>
                    </div>
                    <div className="flex items-center space-x-2">
                      <Checkbox
                        id="perm-wf-list"
                        checked={formState.permissions.workflows.list}
                        onCheckedChange={(checked) =>
                          handlePermissionChange('workflows', 'list', checked as boolean)
                        }
                      />
                      <Label htmlFor="perm-wf-list" className="font-normal text-sm">
                        List Workflows
                      </Label>
                    </div>
                    <div className="flex items-center space-x-2">
                      <Checkbox
                        id="perm-wf-read"
                        checked={formState.permissions.workflows.read}
                        onCheckedChange={(checked) =>
                          handlePermissionChange('workflows', 'read', checked as boolean)
                        }
                      />
                      <Label htmlFor="perm-wf-read" className="font-normal text-sm">
                        Read Workflows
                      </Label>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label className="text-xs uppercase text-muted-foreground font-semibold">
                      Runs
                    </Label>
                    <div className="flex items-center space-x-2">
                      <Checkbox
                        id="perm-run-read"
                        checked={formState.permissions.runs.read}
                        onCheckedChange={(checked) =>
                          handlePermissionChange('runs', 'read', checked as boolean)
                        }
                      />
                      <Label htmlFor="perm-run-read" className="font-normal text-sm">
                        Read Runs
                      </Label>
                    </div>
                    <div className="flex items-center space-x-2">
                      <Checkbox
                        id="perm-run-cancel"
                        checked={formState.permissions.runs.cancel}
                        onCheckedChange={(checked) =>
                          handlePermissionChange('runs', 'cancel', checked as boolean)
                        }
                      />
                      <Label htmlFor="perm-run-cancel" className="font-normal text-sm">
                        Cancel Runs
                      </Label>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label className="text-xs uppercase text-muted-foreground font-semibold">
                      Audit
                    </Label>
                    <div className="flex items-center space-x-2">
                      <Checkbox
                        id="perm-audit-read"
                        checked={formState.permissions.audit.read}
                        onCheckedChange={(checked) =>
                          handlePermissionChange('audit', 'read', checked as boolean)
                        }
                      />
                      <Label htmlFor="perm-audit-read" className="font-normal text-sm">
                        Read Audit Logs
                      </Label>
                    </div>
                  </div>
                </div>
              </div>

              {createError && (
                <p id="create-api-key-error" className="text-sm text-destructive" role="alert">
                  {createError}
                </p>
              )}

              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => handleCreateOpenChange(false)}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={isSubmitting || !formState.name}>
                  {isSubmitting ? 'Creating...' : 'Create Key'}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      <ConfirmDialog {...dialogProps} />
    </div>
  );
}
