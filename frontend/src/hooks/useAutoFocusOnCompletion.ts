import { useEffect, useRef, useState, type MutableRefObject } from 'react';
import { TERMINAL_STATUSES, type ExecutionStatus } from '@sentris/shared';
import type { WorkflowUiState } from '@/store/workflowUiStore';

interface NodeIOEntry {
  nodeRef: string;
  componentId: string;
  status: string;
  outputs: Record<string, unknown> | null;
}

interface AutoFocusOptions {
  /** Currently selected run ID. */
  selectedRunId: string | null;
  /** Current execution status of the selected run. */
  runStatus: ExecutionStatus | undefined;
  /** Node I/O data for the selected run. */
  nodeIOData: { nodes: NodeIOEntry[] } | undefined;
  /** Count of artifacts produced by the run. */
  artifactCount: number;
  /** Whether the run contains agent trace data. */
  hasAgentTrace: boolean;
  /** Setter for the inspector tab. */
  setInspectorTab: (tab: WorkflowUiState['inspectorTab']) => void;
  /** Setter for the selected timeline node. */
  selectNode: (nodeId: string | null) => void;
  /** Ref that tracks whether the user manually changed tabs. */
  userOverrodeTab: MutableRefObject<boolean>;
}

/**
 * Automatically switches to the most relevant inspector tab (and selects the
 * most relevant timeline node) when a workflow run reaches a terminal status.
 *
 * Fires at most once per run. Skipped when the user has already manually
 * changed tabs (via `userOverrodeTab` ref). Only triggers on a live
 * non-terminal → terminal transition, not on initial load of completed runs.
 *
 * Returns an announcement string for screen readers (empty when idle).
 */
export function useAutoFocusOnCompletion({
  selectedRunId,
  runStatus,
  nodeIOData,
  artifactCount,
  hasAgentTrace,
  setInspectorTab,
  selectNode,
  userOverrodeTab,
}: AutoFocusOptions): string {
  const hasAutoFocused = useRef(false);
  const prevRunIdRef = useRef<string | null>(null);
  const prevStatusRef = useRef<ExecutionStatus | undefined>(undefined);
  const [announcement, setAnnouncement] = useState('');

  // Reset guards when the selected run changes.
  useEffect(() => {
    if (selectedRunId !== prevRunIdRef.current) {
      hasAutoFocused.current = false;
      userOverrodeTab.current = false;
      prevRunIdRef.current = selectedRunId;
      prevStatusRef.current = undefined;
      setAnnouncement('');
    }
  }, [selectedRunId, userOverrodeTab]);

  // Auto-focus logic — runs when run status / data settle.
  useEffect(() => {
    if (hasAutoFocused.current) return;
    if (userOverrodeTab.current) return;
    if (!selectedRunId) return;
    if (!runStatus) return;

    const isTerminal = (TERMINAL_STATUSES as readonly string[]).includes(runStatus);

    // Only trigger on a genuine non-terminal → terminal transition.
    // If prevStatusRef is undefined (first render for this run) and already
    // terminal, skip — the user navigated to an already-completed run.
    const prevStatus = prevStatusRef.current;
    prevStatusRef.current = runStatus;

    if (!isTerminal) return;

    const wasPreviouslyNonTerminal =
      prevStatus !== undefined && !(TERMINAL_STATUSES as readonly string[]).includes(prevStatus);

    if (!wasPreviouslyNonTerminal) return;

    hasAutoFocused.current = true;

    const nodes = nodeIOData?.nodes ?? [];

    // --- Tab selection (priority order) ---
    let tabLabel = '';
    if (artifactCount > 0) {
      setInspectorTab('artifacts');
      tabLabel = 'Artifacts';
      const producerNode = nodes.find((n) => n.outputs && Object.keys(n.outputs).length > 0);
      if (producerNode) selectNode(producerNode.nodeRef);
    } else if (hasAgentTrace) {
      setInspectorTab('agent');
      tabLabel = 'Agent';
      const agentNode = nodes.find((n) => n.componentId.startsWith('core.ai.'));
      if (agentNode) selectNode(agentNode.nodeRef);
    } else if (runStatus === 'FAILED' || runStatus === 'TERMINATED' || runStatus === 'TIMED_OUT') {
      setInspectorTab('logs');
      tabLabel = 'Logs';
      const failedNode = nodes.find((n) => n.status === 'failed');
      if (failedNode) selectNode(failedNode.nodeRef);
    } else {
      setInspectorTab('io');
      tabLabel = 'Input/Output';
      const lastNode = nodes[nodes.length - 1];
      if (lastNode) selectNode(lastNode.nodeRef);
    }

    setAnnouncement(`Run completed — switched to ${tabLabel} tab`);
  }, [
    selectedRunId,
    runStatus,
    nodeIOData,
    artifactCount,
    hasAgentTrace,
    setInspectorTab,
    selectNode,
    userOverrodeTab,
  ]);

  return announcement;
}
