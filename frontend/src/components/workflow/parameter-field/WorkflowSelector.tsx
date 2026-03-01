import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { api } from '@/services/api';
import { useWorkflowStore } from '@/store/workflowStore';
import { useWorkflowsList } from '@/hooks/queries/useWorkflowQueries';

interface WorkflowSelectorProps {
  parameterId: string;
  value: string | undefined;
  onChange: (value: string | undefined) => void;
  onUpdateParameter?: (paramId: string, value: unknown) => void;
  disabled: boolean;
  parameters?: Record<string, unknown>;
}

/**
 * WorkflowSelector — Sub-workflow picker for `core.workflow.call` components.
 * Syncs the selected workflow's entrypoint inputs into dynamic ports.
 */
export function WorkflowSelector({
  parameterId,
  value,
  onChange,
  onUpdateParameter,
  disabled,
  parameters,
}: WorkflowSelectorProps) {
  const currentBuilderWorkflowId = useWorkflowStore((state) => state.metadata.id);

  const {
    data: rawWorkflowList = [],
    isLoading: workflowListLoading,
    error: workflowListError,
  } = useWorkflowsList();

  const workflowOptions = useMemo(
    () =>
      rawWorkflowList
        .filter((w) => w.id !== currentBuilderWorkflowId)
        .map((w) => ({ id: w.id, name: w.name }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [rawWorkflowList, currentBuilderWorkflowId],
  );

  const workflowOptionsError = workflowListError?.message ?? null;
  const [workflowPortSyncError, setWorkflowPortSyncError] = useState<string | null>(null);

  const selectedWorkflowId =
    typeof value === 'string' && value.trim().length > 0 ? value.trim() : '';

  const syncCallWorkflowPorts = useCallback(
    async (workflowId: string) => {
      setWorkflowPortSyncError(null);
      try {
        const workflow = await api.workflows.get(workflowId);
        const graph = workflow.graph;
        const entrypoint = graph.nodes.find((node) => node.type === 'core.workflow.entrypoint');

        const runtimeInputsCandidate = (
          entrypoint?.data?.config as Record<string, unknown> | undefined
        )?.runtimeInputs;

        const runtimeInputs = Array.isArray(runtimeInputsCandidate) ? runtimeInputsCandidate : [];

        onUpdateParameter?.('childWorkflowName', workflow.name);
        onUpdateParameter?.('childRuntimeInputs', runtimeInputs);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        setWorkflowPortSyncError(message);
        onUpdateParameter?.('childRuntimeInputs', []);
      }
    },
    [onUpdateParameter],
  );

  // Auto-sync entrypoint inputs when workflow is selected but ports aren't loaded yet
  useEffect(() => {
    if (!selectedWorkflowId) return;
    const existingRuntimeInputs = parameters?.childRuntimeInputs;
    const shouldSync = !Array.isArray(existingRuntimeInputs) || existingRuntimeInputs.length === 0;
    if (!shouldSync) return;
    void syncCallWorkflowPorts(selectedWorkflowId);
  }, [selectedWorkflowId, parameters, syncCallWorkflowPorts]);

  const isDisabled = disabled || workflowListLoading;

  return (
    <div className="space-y-2">
      <select
        id={parameterId}
        value={selectedWorkflowId}
        onChange={(event) => {
          const nextValue = event.target.value;
          onChange(nextValue || undefined);

          if (!nextValue) {
            onUpdateParameter?.('childRuntimeInputs', []);
            onUpdateParameter?.('childWorkflowName', undefined);
            return;
          }

          void syncCallWorkflowPorts(nextValue);
        }}
        className="w-full px-3 py-2 text-sm border rounded-md bg-background"
        disabled={isDisabled}
      >
        <option value="">Select a workflow…</option>
        {workflowOptions.map((workflow) => (
          <option key={workflow.id} value={workflow.id}>
            {workflow.name}
          </option>
        ))}
      </select>

      {workflowOptionsError && (
        <p className="text-sm text-destructive">Failed to load workflows: {workflowOptionsError}</p>
      )}
      {workflowPortSyncError && (
        <p className="text-sm text-destructive">
          Failed to load entrypoint inputs: {workflowPortSyncError}
        </p>
      )}

      {selectedWorkflowId && (
        <div className="flex items-center justify-between">
          <p className="text-xs text-muted-foreground">
            Selecting a workflow syncs its entrypoint inputs into dynamic ports.
          </p>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => void syncCallWorkflowPorts(selectedWorkflowId)}
            disabled={isDisabled}
          >
            Refresh ports
          </Button>
        </div>
      )}
    </div>
  );
}
