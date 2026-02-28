import { useCallback, useMemo, useState } from 'react';
import { humanizeApiError } from '@/lib/humanizeApiError';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import type { SecretSummary } from '@/schemas/secret';
import {
  useSecrets,
  useCreateSecret,
  useUpdateSecret,
  useRotateSecret,
  useDeleteSecret,
} from '@/hooks/queries/useSecretQueries';
import { useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/queryKeys';
import { useAuthStore } from '@/store/authStore';
import { hasAdminRole } from '@/utils/auth';
import { track, Events } from '@/features/analytics/events';
import { logger } from '@/lib/logger';
import { useToast } from '@/components/ui/use-toast';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useConfirmDialog } from '@/hooks/useConfirmDialog';
import { useBulkSelection } from '@/hooks/useBulkSelection';
import { useSortableList } from '@/hooks/useSortableList';
import type { FormState, EditFormState } from './secrets-manager/types';
import { INITIAL_FORM, INITIAL_EDIT_FORM } from './secrets-manager/types';
import {
  validateSecretName,
  parseTags,
  formatTags,
  normalizeDescriptionInput,
  normalizeTagsForUpdate,
  areTagsEqual,
} from './secrets-manager/helpers';
import { CreateSecretForm } from './secrets-manager/CreateSecretForm';
import { EditSecretDialog } from './secrets-manager/EditSecretDialog';
import { SecretsTable } from './secrets-manager/SecretsTable';

export function SecretsManager() {
  useDocumentTitle('Secrets');
  const roles = useAuthStore((state) => state.roles);
  const canManageSecrets = hasAdminRole(roles);
  const isReadOnly = !canManageSecrets;
  const queryClient = useQueryClient();
  const organizationId = useAuthStore((state) => state.organizationId);
  const { data: secrets = [], isLoading: loading, error: secretsError } = useSecrets();
  const error = secretsError?.message ?? null;

  const getSecretId = useCallback((s: SecretSummary) => s.id, []);

  const {
    orderedItems: orderedSecrets,
    sensors,
    collisionDetection,
    handleDragEnd,
  } = useSortableList({
    items: secrets,
    getId: getSecretId,
    storageKey: `shipsec:sort:secrets:${organizationId}`,
  });
  const createSecretMutation = useCreateSecret();
  const updateSecretMutation = useUpdateSecret();
  const rotateSecretMutation = useRotateSecret();
  const deleteSecretMutation = useDeleteSecret();

  const [formState, setFormState] = useState<FormState>(INITIAL_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const disableCreate = isReadOnly || isSubmitting;

  const { toast } = useToast();
  const { confirm, dialogProps } = useConfirmDialog();

  const {
    selectedIds,
    toggleId,
    toggleAll,
    clearSelection,
    isAllSelected,
    isIndeterminate,
    selectedCount,
  } = useBulkSelection(orderedSecrets);

  const handleBulkDelete = async () => {
    const count = selectedCount;
    const ok = await confirm({
      title: `Delete ${count} secret${count !== 1 ? 's' : ''}`,
      description: `Are you sure you want to delete ${count} secret${count !== 1 ? 's' : ''}? This action permanently removes them and their encrypted versions.`,
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!ok) return;

    const ids = Array.from(selectedIds);
    const results = await Promise.allSettled(ids.map((id) => deleteSecretMutation.mutateAsync(id)));
    const succeeded = results.filter((r) => r.status === 'fulfilled').length;
    const failed = results.filter((r) => r.status === 'rejected').length;

    clearSelection();

    if (failed === 0) {
      toast({
        title: 'Secrets deleted',
        description: `Deleted ${succeeded} secret${succeeded !== 1 ? 's' : ''}.`,
      });
    } else {
      toast({
        title: 'Partial failure',
        description: `Deleted ${succeeded} of ${count} secrets (${failed} failed).`,
        variant: 'destructive',
      });
    }
  };

  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [editingSecret, setEditingSecret] = useState<SecretSummary | null>(null);
  const [editFormState, setEditFormState] = useState<EditFormState>(INITIAL_EDIT_FORM);
  const [editError, setEditError] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const disableEditing = isReadOnly || isEditing;

  const handleChange =
    (field: keyof FormState) =>
    (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      setFormState((prev) => ({
        ...prev,
        [field]: event.target.value,
      }));
    };

  const handleEditChange =
    (field: keyof EditFormState) =>
    (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      setEditFormState((prev) => ({
        ...prev,
        [field]: event.target.value,
      }));
    };

  const isFormValid = useMemo(() => {
    return validateSecretName(formState.name) === null && formState.value.trim().length > 0;
  }, [formState.name, formState.value]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setFormError(null);

    if (!canManageSecrets) {
      setFormError('Only workspace administrators can create or update secrets.');
      return;
    }

    if (!isFormValid) {
      setFormError('Name and secret value are required.');
      return;
    }

    setIsSubmitting(true);
    const normalizedName = formState.name.trim();
    const normalizedTags = parseTags(formState.tags);
    try {
      await createSecretMutation.mutateAsync({
        name: normalizedName,
        value: formState.value,
        description: formState.description.trim() || undefined,
        tags: normalizedTags,
      });
      // Avoid leaking raw secret identifiers to analytics; send derived metadata only.
      track(Events.SecretCreated, {
        has_tags: Boolean(normalizedTags?.length),
        tag_count: normalizedTags?.length,
        name_length: normalizedName.length,
      });
      toast({
        title: 'Secret created',
        description: 'Secret created. You can now reference it from workflows.',
      });
      setFormState(INITIAL_FORM);
    } catch (err: unknown) {
      const message = humanizeApiError(err);
      setFormError(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const openEditDialog = (secret: SecretSummary) => {
    setEditingSecret(secret);
    setEditFormState({
      name: secret.name,
      description: secret.description ?? '',
      tags: formatTags(secret.tags),
      value: '',
    });
    setEditError(null);
    setIsEditDialogOpen(true);
  };

  const handleEditDialogChange = (open: boolean) => {
    setIsEditDialogOpen(open);
    if (!open) {
      setEditingSecret(null);
      setEditFormState(INITIAL_EDIT_FORM);
      setEditError(null);
      setIsEditing(false);
    }
  };

  const handleEditSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!editingSecret) {
      return;
    }

    if (!canManageSecrets) {
      setEditError('Only workspace administrators can modify secrets.');
      return;
    }

    setEditError(null);
    setIsEditing(true);

    const trimmedName = editFormState.name.trim();
    const normalizedDescription = normalizeDescriptionInput(editFormState.description);
    const existingDescription = normalizeDescriptionInput(editingSecret.description ?? '');
    const normalizedTags = normalizeTagsForUpdate(editFormState.tags);
    const newSecretValue = editFormState.value.trim();

    const metadataChanged =
      trimmedName !== editingSecret.name ||
      normalizedDescription !== existingDescription ||
      !areTagsEqual(editingSecret.tags, normalizedTags);
    const shouldRotate = newSecretValue.length > 0;

    try {
      let latest = editingSecret;

      if (metadataChanged) {
        latest = await updateSecretMutation.mutateAsync({
          id: editingSecret.id,
          input: {
            name: trimmedName,
            description: normalizedDescription,
            tags: normalizedTags,
          },
        });
      }

      if (shouldRotate) {
        latest = await rotateSecretMutation.mutateAsync({
          id: editingSecret.id,
          input: { value: newSecretValue },
        });
      }

      const actions: string[] = [];
      if (metadataChanged) actions.push('updated');
      if (shouldRotate) actions.push('rotated');
      const actionSummary =
        actions.length === 0 ? 'unchanged' : `${actions.join(' and ')} successfully`;

      toast({
        title: 'Secret updated',
        description: `Secret "${latest.name}" ${actionSummary}.`,
      });
      handleEditDialogChange(false);
    } catch (err: unknown) {
      const message = humanizeApiError(err);
      setEditError(message);
    } finally {
      setIsEditing(false);
    }
  };

  const handleDeleteSecret = async (secret: SecretSummary) => {
    const ok = await confirm({
      title: 'Delete secret',
      description: `Are you sure you want to delete "${secret.name}"? This action permanently removes the secret and its encrypted versions. Workflows referencing this secret will need to be updated.`,
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    try {
      await deleteSecretMutation.mutateAsync(secret.id);
      track(Events.SecretDeleted, { name_length: secret.name.trim().length });
      toast({ title: 'Secret deleted', description: `Secret "${secret.name}" deleted.` });
    } catch (err: unknown) {
      toast({
        title: 'Delete failed',
        description: humanizeApiError(err),
        variant: 'destructive',
      });
    }
  };

  const handleRefresh = useCallback(() => {
    queryClient
      .invalidateQueries({ queryKey: queryKeys.secrets.all() })
      .catch((err: unknown) => logger.error('Failed to refresh secrets', err));
  }, [queryClient]);

  return (
    <div className="flex-1 bg-background" aria-busy={loading}>
      <div className="container mx-auto py-4 md:py-8 px-3 md:px-4">
        {isReadOnly && (
          <div className="mb-4 md:mb-6 rounded-md border border-border/60 bg-muted/30 px-3 md:px-4 py-2 md:py-3 text-xs md:text-sm text-muted-foreground">
            You have read-only access. Viewing secrets metadata is allowed, but only administrators
            can create, rotate, or delete secrets.
          </div>
        )}

        <div className="grid gap-4 md:gap-6 xl:grid-cols-[1fr,3fr]">
          <CreateSecretForm
            formState={formState}
            onChange={handleChange}
            onSubmit={handleSubmit}
            formError={formError}
            isFormValid={isFormValid}
            disableCreate={disableCreate}
            isSubmitting={isSubmitting}
          />

          <SecretsTable
            secrets={orderedSecrets}
            loading={loading}
            error={error}
            isReadOnly={isReadOnly}
            onRefresh={handleRefresh}
            sensors={sensors}
            collisionDetection={collisionDetection}
            onDragEnd={handleDragEnd}
            selectedIds={selectedIds}
            toggleId={toggleId}
            toggleAll={toggleAll}
            isAllSelected={isAllSelected}
            isIndeterminate={isIndeterminate}
            selectedCount={selectedCount}
            onBulkDelete={handleBulkDelete}
            onEdit={openEditDialog}
            onDelete={handleDeleteSecret}
          />
        </div>
      </div>

      <EditSecretDialog
        isOpen={isEditDialogOpen}
        onOpenChange={handleEditDialogChange}
        editFormState={editFormState}
        onChange={handleEditChange}
        onSubmit={handleEditSubmit}
        editError={editError}
        disableEditing={disableEditing}
        isEditing={isEditing}
      />

      <ConfirmDialog {...dialogProps} />
    </div>
  );
}
