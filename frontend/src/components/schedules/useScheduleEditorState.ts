import { useEffect, useMemo, useState } from 'react';
import type { WorkflowSchedule } from '@shipsec/shared';
import { api } from '@/services/api';
import { useWorkflow } from '@/hooks/queries/useWorkflowQueries';
import { ENTRY_COMPONENT_ID } from '@/utils/entryPointUtils';
import { normalizeRuntimeInputs } from '@/utils/runtimeInputUtils';
import type {
  RuntimeInputDefinition,
  ScheduleFormState,
  OverrideDraft,
  ScheduleEditorMode,
  WorkflowOption,
} from './scheduleTypes';
import { normalizeRuntimeInputType, validateCronExpression } from './scheduleTypes';

interface UseScheduleEditorStateOptions {
  open: boolean;
  mode: ScheduleEditorMode;
  schedule?: WorkflowSchedule | null;
  defaultWorkflowId?: string | null;
  workflowOptions: WorkflowOption[];
  onClose: () => void;
  onSaved?: (schedule: WorkflowSchedule, mode: ScheduleEditorMode) => void;
}

const getLocalTimezone = (): string => {
  try {
    const resolved = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return resolved ?? 'UTC';
  } catch {
    return 'UTC';
  }
};

const toOverrideDrafts = (
  overrides: Record<string, Record<string, unknown>> | undefined,
): OverrideDraft => {
  if (!overrides) return {};
  return Object.entries(overrides).reduce<OverrideDraft>((acc, [nodeId, value]) => {
    acc[nodeId] = JSON.stringify(value, null, 2);
    return acc;
  }, {});
};

export function useScheduleEditorState({
  open,
  mode,
  schedule,
  defaultWorkflowId,
  workflowOptions,
  onClose,
  onSaved,
}: UseScheduleEditorStateOptions) {
  const [form, setForm] = useState<ScheduleFormState>(() => ({
    workflowId: '',
    name: '',
    description: '',
    cronExpression: '0 9 * * *',
    timezone: getLocalTimezone(),
    humanLabel: '',
    overlapPolicy: 'skip',
    catchupWindowSeconds: '0',
  }));

  const {
    data: workflowDetail,
    isLoading: workflowLoading,
    error: workflowError,
  } = useWorkflow(open && form.workflowId ? form.workflowId : undefined);

  const [runtimeValues, setRuntimeValues] = useState<Record<string, unknown>>({});
  const [runtimeErrors, setRuntimeErrors] = useState<Record<string, string>>({});
  const [uploading, setUploading] = useState<Record<string, boolean>>({});
  const [nodeOverridesDraft, setNodeOverridesDraft] = useState<OverrideDraft>({});
  const [nodeOverrideErrors, setNodeOverrideErrors] = useState<Record<string, string>>({});
  const [pendingOverrideNode, setPendingOverrideNode] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [cronError, setCronError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [formSeed, setFormSeed] = useState(0);

  // Propagate workflow load error to form
  useEffect(() => {
    if (workflowError) {
      setFormError(
        workflowError instanceof Error ? workflowError.message : 'Unable to load workflow details',
      );
    }
  }, [workflowError]);

  const runtimeInputs = useMemo<RuntimeInputDefinition[]>(() => {
    if (!workflowDetail) return [];
    const entryNode = workflowDetail.graph.nodes.find(
      (node: any) => node.type === ENTRY_COMPONENT_ID,
    );
    return normalizeRuntimeInputs(
      (entryNode?.data?.config?.params as Record<string, unknown> | undefined)?.runtimeInputs,
    );
  }, [workflowDetail]);

  const resetForm = () => {
    const baseWorkflowId =
      mode === 'edit' && schedule
        ? schedule.workflowId
        : (defaultWorkflowId ?? schedule?.workflowId ?? '');
    setForm({
      workflowId: baseWorkflowId,
      name: schedule?.name ?? '',
      description: schedule?.description ?? '',
      cronExpression: schedule?.cronExpression ?? '0 9 * * *',
      timezone: schedule?.timezone ?? getLocalTimezone(),
      humanLabel: schedule?.humanLabel ?? '',
      overlapPolicy: schedule?.overlapPolicy ?? 'skip',
      catchupWindowSeconds: String(schedule?.catchupWindowSeconds ?? 0),
    });
    setRuntimeValues(schedule?.inputPayload.runtimeInputs ?? {});
    setRuntimeErrors({});
    setUploading({});
    setNodeOverridesDraft(toOverrideDrafts(schedule?.inputPayload.nodeOverrides));
    setNodeOverrideErrors({});
    setPendingOverrideNode('');
    setFormError(null);
    setCronError(null);
    setFormSeed((seed) => seed + 1);
  };

  useEffect(() => {
    if (open) {
      resetForm();
    }
  }, [open, mode, schedule, defaultWorkflowId]);

  const selectedWorkflow = useMemo(
    () => workflowOptions.find((workflow) => workflow.id === form.workflowId) ?? null,
    [workflowOptions, form.workflowId],
  );

  const workflowNodes = useMemo(() => {
    if (!workflowDetail) return [];
    return workflowDetail.graph.nodes.filter((node) => node.type !== ENTRY_COMPONENT_ID);
  }, [workflowDetail]);

  const availableOverrideNodes = useMemo(() => {
    const selected = new Set(Object.keys(nodeOverridesDraft));
    return workflowNodes.filter((node) => !selected.has(node.id));
  }, [nodeOverridesDraft, workflowNodes]);

  // ──── Handlers ────

  const handleFieldChange = <K extends keyof ScheduleFormState>(
    key: K,
    value: ScheduleFormState[K],
  ) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    if (key === 'cronExpression') {
      setCronError(validateCronExpression(String(value)));
    }
  };

  const handleWorkflowChange = (value: string) => {
    handleFieldChange('workflowId', value);
    setRuntimeValues({});
    setNodeOverridesDraft({});
    setNodeOverrideErrors({});
    setRuntimeErrors({});
  };

  const handleRuntimeInputChange = (input: RuntimeInputDefinition, value: unknown) => {
    const inputType = normalizeRuntimeInputType(input.type);
    setRuntimeErrors((prev) => {
      const { [input.id]: _removed, ...rest } = prev;
      return rest;
    });

    let parsedValue: unknown = value;
    if (inputType === 'number') {
      const numeric = value ? Number(value) : undefined;
      parsedValue = Number.isFinite(numeric) ? numeric : undefined;
    } else if (inputType === 'array') {
      const textValue = typeof value === 'string' ? value : '';
      const trimmed = textValue.trim();
      if (trimmed.length === 0) {
        parsedValue = undefined;
      } else {
        try {
          const parsed = JSON.parse(trimmed);
          parsedValue = Array.isArray(parsed)
            ? parsed
            : trimmed
                .split(',')
                .map((entry) => entry.trim())
                .filter(Boolean);
        } catch {
          parsedValue = trimmed
            .split(',')
            .map((entry) => entry.trim())
            .filter(Boolean);
        }
      }
    } else if (inputType === 'json') {
      try {
        parsedValue = value ? JSON.parse(String(value)) : undefined;
      } catch {
        setRuntimeErrors((prev) => ({ ...prev, [input.id]: 'Invalid JSON value' }));
        return;
      }
    }

    setRuntimeValues((prev) => ({ ...prev, [input.id]: parsedValue }));
  };

  const handleFileUpload = async (inputId: string, file: File) => {
    setUploading((prev) => ({ ...prev, [inputId]: true }));
    setRuntimeErrors((prev) => {
      const { [inputId]: _removed, ...rest } = prev;
      return rest;
    });
    try {
      const fileData = await api.files.upload(file);
      setRuntimeValues((prev) => ({ ...prev, [inputId]: fileData.id }));
    } catch (error: unknown) {
      setRuntimeErrors((prev) => ({
        ...prev,
        [inputId]: error instanceof Error ? error.message : 'File upload failed',
      }));
    } finally {
      setUploading((prev) => ({ ...prev, [inputId]: false }));
    }
  };

  const addOverrideNode = () => {
    if (!pendingOverrideNode) return;
    setNodeOverridesDraft((prev) => ({
      ...prev,
      [pendingOverrideNode]: nodeOverridesDraft[pendingOverrideNode] ?? '{\n}',
    }));
    setPendingOverrideNode('');
  };

  const removeOverrideNode = (nodeId: string) => {
    setNodeOverridesDraft((prev) => {
      const { [nodeId]: _removed, ...rest } = prev;
      return rest;
    });
    setNodeOverrideErrors((prev) => {
      const { [nodeId]: _removed, ...rest } = prev;
      return rest;
    });
  };

  const handleOverrideChange = (nodeId: string, value: string) => {
    setNodeOverridesDraft((prev) => ({ ...prev, [nodeId]: value }));
    if (!value.trim()) {
      setNodeOverrideErrors((prev) => {
        const { [nodeId]: _removed, ...rest } = prev;
        return rest;
      });
      return;
    }
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        setNodeOverrideErrors((prev) => {
          const { [nodeId]: _removed, ...rest } = prev;
          return rest;
        });
      } else {
        setNodeOverrideErrors((prev) => ({ ...prev, [nodeId]: 'Provide a JSON object' }));
      }
    } catch {
      setNodeOverrideErrors((prev) => ({ ...prev, [nodeId]: 'Invalid JSON object' }));
    }
  };

  // ──── Submit ────

  const handleSubmit = async () => {
    if (!form.workflowId) {
      setFormError('Select a workflow before continuing.');
      return;
    }
    if (!form.name.trim()) {
      setFormError('Provide a schedule name.');
      return;
    }
    if (!form.cronExpression.trim()) {
      setFormError('Provide a cron expression.');
      return;
    }
    const cronValidationError = validateCronExpression(form.cronExpression);
    if (cronValidationError) {
      setCronError(cronValidationError);
      setFormError('Fix the cron expression before saving.');
      return;
    }
    if (!form.timezone.trim()) {
      setFormError('Provide a timezone (e.g., UTC or America/New_York).');
      return;
    }

    // Validate required runtime inputs
    const missing: Record<string, string> = {};
    for (const input of runtimeInputs) {
      if (!input.required) continue;
      const hasValue =
        runtimeValues[input.id] !== undefined &&
        runtimeValues[input.id] !== null &&
        runtimeValues[input.id] !== '';
      if (!hasValue) {
        missing[input.id] = 'This field is required';
      }
    }
    if (Object.keys(missing).length > 0) {
      setRuntimeErrors(missing);
      return;
    }

    if (Object.keys(nodeOverrideErrors).length > 0) {
      setFormError('Resolve node override errors before saving.');
      return;
    }
    setFormError(null);

    // Build payload
    const normalizedRuntimeValues = Object.entries(runtimeValues).reduce<Record<string, unknown>>(
      (acc, [key, value]) => {
        if (value === undefined || value === null || value === '') return acc;
        acc[key] = value;
        return acc;
      },
      {},
    );
    const parsedOverrides = Object.entries(nodeOverridesDraft).reduce<
      Record<string, Record<string, unknown>>
    >((acc, [nodeId, value]) => {
      const trimmed = value.trim();
      if (!trimmed) return acc;
      acc[nodeId] = JSON.parse(trimmed) as Record<string, unknown>;
      return acc;
    }, {});

    const payload = {
      workflowId: form.workflowId,
      name: form.name.trim(),
      description: form.description.trim().length > 0 ? form.description.trim() : undefined,
      cronExpression: form.cronExpression.trim(),
      timezone: form.timezone.trim(),
      humanLabel: form.humanLabel.trim().length > 0 ? form.humanLabel.trim() : undefined,
      overlapPolicy: form.overlapPolicy,
      catchupWindowSeconds: Number(form.catchupWindowSeconds) || 0,
      inputPayload: {
        runtimeInputs: normalizedRuntimeValues,
        nodeOverrides: parsedOverrides as Record<
          string,
          { params: Record<string, unknown>; inputOverrides: Record<string, unknown> }
        >,
      },
    };

    setSubmitting(true);
    try {
      const saved =
        mode === 'create'
          ? await api.schedules.create(payload)
          : await api.schedules.update(schedule!.id, payload);
      onSaved?.(saved, mode);
      onClose();
    } catch (error: unknown) {
      setFormError(error instanceof Error ? error.message : 'Failed to save schedule');
    } finally {
      setSubmitting(false);
    }
  };

  return {
    form,
    workflowLoading,
    runtimeInputs,
    runtimeValues,
    runtimeErrors,
    uploading,
    nodeOverridesDraft,
    nodeOverrideErrors,
    pendingOverrideNode,
    formError,
    cronError,
    submitting,
    formSeed,
    selectedWorkflow,
    workflowNodes,
    availableOverrideNodes,
    handleFieldChange,
    handleWorkflowChange,
    handleRuntimeInputChange,
    handleFileUpload,
    addOverrideNode,
    removeOverrideNode,
    handleOverrideChange,
    setPendingOverrideNode,
    handleSubmit,
  };
}
