import { useEffect, useState } from 'react';
import { api } from '@/services/api';
import type { Scope } from '@/types/scopes';

export type TargetEditorMode = 'create' | 'edit';

interface TargetFormState {
  name: string;
  description: string;
  domains: string;
  repos: string;
  ipRanges: string;
}

interface UseTargetEditorStateOptions {
  open: boolean;
  mode: TargetEditorMode;
  scope?: Scope | null;
  onClose: () => void;
  onSaved?: (scope: Scope, mode: TargetEditorMode) => void;
}

const parseLines = (value: string): string[] =>
  value
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

export function useTargetEditorState({
  open,
  mode,
  scope,
  onClose,
  onSaved,
}: UseTargetEditorStateOptions) {
  const [form, setForm] = useState<TargetFormState>({
    name: '',
    description: '',
    domains: '',
    repos: '',
    ipRanges: '',
  });
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const resetForm = () => {
    setForm({
      name: scope?.name ?? '',
      description: scope?.description ?? '',
      domains: (scope?.domains ?? []).join('\n'),
      repos: (scope?.repos ?? []).join('\n'),
      ipRanges: (scope?.ipRanges ?? []).join('\n'),
    });
    setFormError(null);
  };

  useEffect(() => {
    if (open) {
      resetForm();
    }
  }, [open, mode, scope]);

  const handleFieldChange = <K extends keyof TargetFormState>(
    key: K,
    value: TargetFormState[K],
  ) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const handleSubmit = async () => {
    if (!form.name.trim()) {
      setFormError('Provide a target name.');
      return;
    }
    setFormError(null);

    const trimmedDescription = form.description.trim();
    const commonPayload = {
      name: form.name.trim(),
      description: trimmedDescription.length > 0 ? trimmedDescription : undefined,
      domains: parseLines(form.domains),
      repos: parseLines(form.repos),
      ipRanges: parseLines(form.ipRanges),
    };

    setSubmitting(true);
    try {
      const saved =
        mode === 'create'
          ? await api.scopes.create({ ...commonPayload, runtimeValues: {} })
          : await api.scopes.update(scope!.id, commonPayload);
      onSaved?.(saved, mode);
      onClose();
    } catch (error: unknown) {
      setFormError(error instanceof Error ? error.message : 'Failed to save target');
    } finally {
      setSubmitting(false);
    }
  };

  return {
    form,
    formError,
    submitting,
    handleFieldChange,
    handleSubmit,
  };
}
