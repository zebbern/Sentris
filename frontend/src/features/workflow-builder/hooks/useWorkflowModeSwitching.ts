import { useEffect, useLayoutEffect, useRef } from 'react';
import type { Node as ReactFlowNode, Edge as ReactFlowEdge } from '@xyflow/react';
import {
  cloneNodes,
  cloneEdges,
  type GraphSnapshot,
} from '@/features/workflow-builder/hooks/useWorkflowGraphControllers';
import { useExecutionTimelineStore } from '@/store/executionTimelineStore';
import { useWorkflowUiStore } from '@/store/workflowUiStore';
import type { FrontendNodeData } from '@/schemas/node';

interface UseWorkflowModeSwitchingParams {
  id: string | undefined;
  routeRunId: string | undefined;
  isRunsRoute: boolean;
  mode: 'design' | 'execution';
  isMobile: boolean;
  setMode: (mode: 'design' | 'execution') => void;
  setLibraryOpen: (open: boolean) => void;
  // Design graph refs & setters
  designNodesRef: React.MutableRefObject<ReactFlowNode<FrontendNodeData>[]>;
  designEdgesRef: React.MutableRefObject<ReactFlowEdge[]>;
  preservedDesignStateRef: React.MutableRefObject<GraphSnapshot | null>;
  designSavedSnapshotRef: React.MutableRefObject<GraphSnapshot | null>;
  setDesignNodes: (nodes: ReactFlowNode<FrontendNodeData>[]) => void;
  setDesignEdges: (edges: ReactFlowEdge[]) => void;
  // Execution graph refs & setters
  executionNodesRef: React.MutableRefObject<ReactFlowNode<FrontendNodeData>[]>;
  executionEdgesRef: React.MutableRefObject<ReactFlowEdge[]>;
  preservedExecutionStateRef: React.MutableRefObject<GraphSnapshot | null>;
  setExecutionNodes: (nodes: ReactFlowNode<FrontendNodeData>[]) => void;
  setExecutionEdges: (edges: ReactFlowEdge[]) => void;
  // Execution lifecycle
  resetHistoricalTracking: () => void;
}

/**
 * Extracted from WorkflowBuilderContent: manages mode switching between
 * design and execution, URL-based mode sync.
 */
export function useWorkflowModeSwitching({
  id,
  routeRunId,
  isRunsRoute,
  mode,
  isMobile,
  setMode,
  setLibraryOpen,
  designNodesRef,
  designEdgesRef,
  preservedDesignStateRef,
  designSavedSnapshotRef,
  setDesignNodes,
  setDesignEdges,
  executionNodesRef,
  executionEdgesRef,
  preservedExecutionStateRef,
  setExecutionNodes,
  setExecutionEdges,
  resetHistoricalTracking,
}: UseWorkflowModeSwitchingParams) {
  // Handle mode switching: preserve and restore states cleanly
  const prevModeRef = useRef(mode);

  useLayoutEffect(() => {
    // Only run when mode actually changes
    if (prevModeRef.current === mode) {
      return;
    }

    prevModeRef.current = mode;

    if (mode === 'execution') {
      // Switching to execution mode: preserve current design state
      preservedDesignStateRef.current = {
        nodes: cloneNodes(designNodesRef.current),
        edges: cloneEdges(designEdgesRef.current),
      };

      // Reset run tracking refs to force the run loading effect to reload
      // This ensures we always load the correct version for the selected run
      resetHistoricalTracking();
      preservedExecutionStateRef.current = null;
      // The run loading useEffect will handle loading the correct state
    } else if (mode === 'design') {
      // Switching to design mode: preserve current execution state for potential restoration
      // Note: This is only used if user switches back to execution without changing the run
      preservedExecutionStateRef.current = {
        nodes: cloneNodes(executionNodesRef.current),
        edges: cloneEdges(executionEdgesRef.current),
      };

      // Restore design state from preserved state or saved snapshot
      // Check if preservedDesignStateRef has actual nodes (not empty from early mode switch)
      if (preservedDesignStateRef.current && preservedDesignStateRef.current.nodes.length > 0) {
        setDesignNodes(cloneNodes(preservedDesignStateRef.current.nodes));
        setDesignEdges(cloneEdges(preservedDesignStateRef.current.edges));
        preservedDesignStateRef.current = null;
      } else if (
        designSavedSnapshotRef.current &&
        designSavedSnapshotRef.current.nodes.length > 0
      ) {
        // Fall back to saved snapshot (the loaded workflow state)
        setDesignNodes(cloneNodes(designSavedSnapshotRef.current.nodes));
        setDesignEdges(cloneEdges(designSavedSnapshotRef.current.edges));
      }
      // If both are empty, design state should already be populated by workflow loading
    }
  }, [mode, setDesignNodes, setDesignEdges, setExecutionNodes, setExecutionEdges]);

  // Auto-open component library when switching to design mode on desktop
  useEffect(() => {
    if (mode === 'design' && !isMobile) {
      setLibraryOpen(true);
    }
  }, [mode, isMobile, setLibraryOpen]);

  // Track previous workflow ID to detect workflow switches
  const prevIdForResetRef = useRef<string | undefined>(undefined);

  // CRITICAL: This useLayoutEffect runs BEFORE any useEffect
  // It resets the timeline store and sets the correct mode based on URL
  // This prevents the URL sync effect from using stale selectedRunId from a previous workflow
  useLayoutEffect(() => {
    const isWorkflowChanged = prevIdForResetRef.current !== id;
    if (isWorkflowChanged) {
      prevIdForResetRef.current = id;
      // When landing on a workflow (not a run), clear any persisted run selection before URL sync
      if (!isRunsRoute && !routeRunId) {
        useExecutionTimelineStore.getState().reset();
      }
    }

    // Determine target mode based on URL
    const targetMode = isRunsRoute || routeRunId ? 'execution' : 'design';

    // Only call setMode if the mode is actually different
    // This prevents infinite re-renders from unnecessary state updates
    const currentMode = useWorkflowUiStore.getState().mode;
    if (currentMode !== targetMode) {
      setMode(targetMode);
    }
  }, [id, isRunsRoute, routeRunId, setMode]);

  // NOTE: URL is the source of truth for mode
  // - The useLayoutEffect above sets mode based on URL
  // - Tab clicks should call navigate() to change URL, not setMode()
  // - The URL change triggers useLayoutEffect which updates mode
}
