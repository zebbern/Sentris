import { useExecutionStore } from '@/store/executionStore';
import { useWorkflowStore } from '@/store/workflowStore';

export function useWorkflowExecution(workflowId?: string | null) {
  const metadata = useWorkflowStore((s) => s.metadata);
  const targetWorkflowId = workflowId ?? metadata.id;

  // Granular selectors — only subscribe to fields this hook and its consumers use.
  // Avoids re-renders from high-churn SSE state (events, cursor, streamingMode).
  const storeWorkflowId = useExecutionStore((s) => s.workflowId);
  const runId = useExecutionStore((s) => s.runId);
  const status = useExecutionStore((s) => s.status);
  const runStatus = useExecutionStore((s) => s.runStatus);
  const nodeStates = useExecutionStore((s) => s.nodeStates);
  const startExecution = useExecutionStore((s) => s.startExecution);
  const stopExecution = useExecutionStore((s) => s.stopExecution);
  const reset = useExecutionStore((s) => s.reset);

  const activeWorkflowId = storeWorkflowId ?? runStatus?.workflowId ?? null;
  const isCurrentExecution = activeWorkflowId === targetWorkflowId;

  if (!isCurrentExecution) {
    return {
      runId,
      status: 'idle' as const,
      runStatus: null,
      nodeStates: {} as Record<string, never>,
      isCurrentExecution: false,
      // Keep actions available so we can start new runs
      startExecution,
      stopExecution,
      reset,
    };
  }

  return {
    runId,
    status,
    runStatus,
    nodeStates,
    isCurrentExecution: true,
    startExecution,
    stopExecution,
    reset,
  };
}
