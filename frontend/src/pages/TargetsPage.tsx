import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { TooltipProvider } from '@/components/ui/tooltip';
import { useToast } from '@/components/ui/use-toast';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { ErrorBanner } from '@/components/ui/error-banner';
import { useConfirmDialog } from '@/hooks/useConfirmDialog';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { useScopes, useDeleteScope } from '@/hooks/queries/useScopeQueries';
import { queryKeys } from '@/lib/queryKeys';
import { useAuthStore } from '@/store/authStore';
import { hasAdminRole } from '@/utils/auth';
import type { Scope } from '@/types/scopes';
import { TargetEditorDialog, type TargetEditorMode } from '@/components/targets/TargetEditorDialog';
import { TargetsTable } from './targets';

export function TargetsPage() {
  useDocumentTitle('Targets');
  const { toast } = useToast();
  const { confirm, dialogProps } = useConfirmDialog();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const roles = useAuthStore((state) => state.roles);
  const canManage = hasAdminRole(roles);

  const { data: scopes = [], isLoading, error: scopesError } = useScopes();
  const error = scopesError?.message ?? null;

  const deleteScopeMutation = useDeleteScope();

  const [editorOpen, setEditorOpen] = useState(false);
  const [editorMode, setEditorMode] = useState<TargetEditorMode>('create');
  const [activeScope, setActiveScope] = useState<Scope | null>(null);

  const openCreateDialog = () => {
    setEditorMode('create');
    setActiveScope(null);
    setEditorOpen(true);
  };

  useEffect(() => {
    if (searchParams.get('create') !== '1') return;

    const next = new URLSearchParams(searchParams);
    next.delete('create');
    setSearchParams(next, { replace: true });

    if (canManage) {
      openCreateDialog();
    }
  }, [canManage, searchParams, setSearchParams]);

  const openEditDialog = (scope: Scope) => {
    setEditorMode('edit');
    setActiveScope(scope);
    setEditorOpen(true);
  };

  const closeDialog = () => {
    setEditorOpen(false);
  };

  const handleSaved = (saved: Scope, mode: TargetEditorMode) => {
    queryClient.invalidateQueries({ queryKey: queryKeys.targets.root() });
    toast({
      title: mode === 'create' ? 'Target created' : 'Target updated',
      description:
        mode === 'create' ? `"${saved.name}" has been added.` : `"${saved.name}" has been updated.`,
    });
  };

  const handleDelete = async (scope: Scope) => {
    const ok = await confirm({
      title: 'Delete target',
      description: `Are you sure you want to delete "${scope.name}"? This action cannot be undone.`,
      confirmLabel: 'Delete',
    });
    if (!ok) return;
    try {
      await deleteScopeMutation.mutateAsync(scope.id);
      toast({
        title: 'Target deleted',
        description: `"${scope.name}" has been deleted.`,
      });
    } catch {
      // Global MutationCache error handler shows the toast
    }
  };

  const hasData = scopes.length > 0;

  return (
    <TooltipProvider>
      <div className="flex-1 bg-background" aria-busy={isLoading}>
        <div className="container mx-auto px-3 md:px-4 py-4 md:py-8 space-y-4 md:space-y-6">
          {error && <ErrorBanner message={error} />}

          <TargetsTable
            scopes={scopes}
            isLoading={isLoading}
            hasData={hasData}
            canManage={canManage}
            error={!!scopesError}
            onEdit={openEditDialog}
            onDelete={handleDelete}
          />
        </div>
      </div>
      <TargetEditorDialog
        open={editorOpen}
        mode={editorMode}
        scope={activeScope}
        onClose={closeDialog}
        onSaved={handleSaved}
      />
      <ConfirmDialog {...dialogProps} />
    </TooltipProvider>
  );
}
