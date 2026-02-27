import { useState, useEffect, useRef, useCallback } from 'react';
import type { Node as ReactFlowNode, Edge as ReactFlowEdge } from 'reactflow';
import {
  cloneNodes,
  cloneEdges,
  type GraphSnapshot,
} from '@/features/workflow-builder/hooks/useWorkflowGraphControllers';
import { ENTRY_COMPONENT_ID, ENTRY_COMPONENT_SLUG } from '@/utils/entryPointUtils';
import { deserializeNodes, deserializeEdges } from '@/utils/workflowSerializer';
import { useExecutionStore } from '@/store/executionStore';
import { useExecutionTimelineStore } from '@/store/executionTimelineStore';
import { api, API_BASE_URL } from '@/services/api';
import { queryClient } from '@/lib/queryClient';
import { queryKeys } from '@/lib/queryKeys';
import { useWorkflowStore } from '@/store/workflowStore';
import { track, Events } from '@/features/analytics/events';
import { computeGraphSignature, ENTRY_DEFAULT_RUNTIME_INPUTS } from '../workflowBuilderUtils';
import type { FrontendNodeData } from '@/schemas/node';
import type { ToastContextValue } from '@/components/ui/toast-context';
import type { ComponentMetadata } from '@/schemas/component';

interface WorkflowMetadataShape {
  id: string | null;
  name: string;
  description: string;
  currentVersionId: string | null;
  currentVersion: number | null;
}

interface UseWorkflowLoaderParams {
  id: string | undefined;
  isNewWorkflow: boolean;
  routeRunId: string | undefined;
  selectedRunId: string | null;
  isRunsRoute: boolean;
  navigate: (path: string) => void;
  toast: ToastContextValue['toast'];
  // Workflow store
  setMetadata: (meta: Partial<WorkflowMetadataShape>) => void;
  setWorkflowId: (id: string) => void;
  markClean: () => void;
  resetWorkflow: () => void;
  // Design graph
  setDesignNodes: (nodes: ReactFlowNode<FrontendNodeData>[]) => void;
  setDesignEdges: (edges: ReactFlowEdge[]) => void;
  designNodesRef: React.MutableRefObject<ReactFlowNode<FrontendNodeData>[]>;
  designSavedSnapshotRef: React.MutableRefObject<GraphSnapshot | null>;
  // Execution graph
  setExecutionNodes: (nodes: ReactFlowNode<FrontendNodeData>[]) => void;
  setExecutionEdges: (edges: ReactFlowEdge[]) => void;
  executionNodesRef: React.MutableRefObject<ReactFlowNode<FrontendNodeData>[]>;
  executionEdgesRef: React.MutableRefObject<ReactFlowEdge[]>;
  executionLoadedSnapshotRef: React.MutableRefObject<GraphSnapshot | null>;
  // Persistence
  setLastSavedGraphSignature: (sig: string) => void;
  setLastSavedMetadata: (meta: { name: string; description: string }) => void;
  // History
  initializeHistory: (nodes: ReactFlowNode<FrontendNodeData>[], edges: ReactFlowEdge[]) => void;
  // Execution lifecycle
  fetchRuns: (params: { workflowId: string }) => Promise<any>;
  resetHistoricalTracking: () => void;
  // Component resolution
  getComponent: (ref: string) => ComponentMetadata | null;
}

/**
 * Extracted from WorkflowBuilderContent: handles loading a workflow by ID
 * (or initializing a new workflow), including API calls, store hydration,
 * and active-run detection.
 */
export function useWorkflowLoader({
  id,
  isNewWorkflow,
  routeRunId,
  selectedRunId,
  isRunsRoute,
  navigate,
  toast,
  setMetadata,
  setWorkflowId,
  markClean,
  resetWorkflow,
  setDesignNodes,
  setDesignEdges,
  designNodesRef,
  designSavedSnapshotRef,
  setExecutionNodes,
  setExecutionEdges,
  executionNodesRef,
  executionEdgesRef,
  executionLoadedSnapshotRef,
  setLastSavedGraphSignature,
  setLastSavedMetadata,
  initializeHistory,
  fetchRuns,
  resetHistoricalTracking,
  getComponent,
}: UseWorkflowLoaderParams) {
  const [isLoading, setIsLoading] = useState(false);

  const createEntryPointNode = useCallback((): ReactFlowNode<FrontendNodeData> => {
    const component = getComponent(ENTRY_COMPONENT_ID);
    const slug = component?.slug ?? ENTRY_COMPONENT_SLUG;
    return {
      id: `${slug}-${Date.now()}`,
      type: 'workflow',
      position: { x: 0, y: 0 },
      data: {
        label: component?.name ?? 'Entry Point',
        config: {
          params: {
            runtimeInputs: ENTRY_DEFAULT_RUNTIME_INPUTS.map((input) => ({ ...input })),
          },
          inputOverrides: {},
        },
        componentId: ENTRY_COMPONENT_ID,
        componentSlug: slug,
        componentVersion: component?.version ?? '1.0.0',
        inputs: {},
        status: 'idle',
      },
    };
  }, [getComponent]);

  // Track previous workflow ID to prevent unnecessary reloads
  const prevWorkflowIdRef = useRef<string | null | undefined>(undefined);

  // Load workflow on mount (if not new)
  // Only reload when workflow ID actually changes, not on mode changes
  useEffect(() => {
    // Skip if workflow ID hasn't changed (prevents reloading on mode switches)
    // Use undefined check to allow initial load
    if (prevWorkflowIdRef.current !== undefined && id === prevWorkflowIdRef.current) {
      return;
    }
    prevWorkflowIdRef.current = id ?? null;

    const metadata = useWorkflowStore.getState().metadata;

    // Keep store workflow id aligned with the routed workflow to avoid URL rewrites to the previous id
    if (!isNewWorkflow && id && metadata.id !== id) {
      setWorkflowId(id);
    }

    const loadWorkflow = async () => {
      // Reset execution state if switching workflows to prevent leaks
      // This ensures we don't show status/logs from a previous workflow
      const executionStore = useExecutionStore.getState();
      if (id && executionStore.workflowId !== id) {
        executionStore.reset();
        // Timeline store already reset synchronously above
      }

      if (isNewWorkflow) {
        if (designNodesRef.current.length === 0) {
          resetWorkflow();
          const entryNode = createEntryPointNode();
          // Initialize both design and execution states with the same initial state
          setDesignNodes([entryNode]);
          setDesignEdges([]);
          setExecutionNodes([entryNode]);
          setExecutionEdges([]);
          resetHistoricalTracking();

          // Initialize saved snapshot for new workflow
          designSavedSnapshotRef.current = {
            nodes: cloneNodes([entryNode]),
            edges: cloneEdges([]),
          };
          executionLoadedSnapshotRef.current = {
            nodes: cloneNodes([entryNode]),
            edges: cloneEdges([]),
          };

          const baseMetadata = useWorkflowStore.getState().metadata;
          setLastSavedGraphSignature(computeGraphSignature([entryNode], []));
          setLastSavedMetadata({
            name: baseMetadata.name,
            description: baseMetadata.description ?? '',
          });

          // Initialize undo/redo history with the initial state
          initializeHistory([entryNode], []);
        }
        track(Events.WorkflowBuilderLoaded, { is_new: true });
        return;
      }

      if (!id) return;

      setIsLoading(true);
      try {
        const workflow = await api.workflows.get(id);

        // Update workflow store
        setMetadata({
          id: workflow.id,
          name: workflow.name,
          description: workflow.description ?? '',
          currentVersionId: workflow.currentVersionId ?? null,
          currentVersion: workflow.currentVersion ?? null,
        });

        const hasRunContext = Boolean(routeRunId || selectedRunId);

        // Deserialize and set nodes/edges
        const workflowEdges = deserializeEdges(workflow);
        const workflowNodes = deserializeNodes(workflow);

        // Initialize design state with the loaded workflow
        setDesignNodes(workflowNodes);
        setDesignEdges(workflowEdges);

        // Initialize execution state only when there's no run context; otherwise the execution
        // lifecycle hook will load the appropriate version for the routed run.
        // IMPORTANT: Always initialize when execution nodes are empty to prevent blank canvas.
        const executionNodesEmpty = executionNodesRef.current.length === 0;
        const shouldInitializeExecution =
          executionNodesEmpty || (!hasRunContext && executionEdgesRef.current.length === 0);

        if (shouldInitializeExecution) {
          setExecutionNodes(cloneNodes(workflowNodes));
          setExecutionEdges(cloneEdges(workflowEdges));
        }

        resetHistoricalTracking();

        // Store saved snapshot (last saved state) for execution mode initialization
        designSavedSnapshotRef.current = {
          nodes: cloneNodes(workflowNodes),
          edges: cloneEdges(workflowEdges),
        };

        // Initialize execution loaded snapshot
        executionLoadedSnapshotRef.current = {
          nodes: cloneNodes(workflowNodes),
          edges: cloneEdges(workflowEdges),
        };

        // Mark as clean (no unsaved changes)
        markClean();
        const loadedSignature = computeGraphSignature(workflowNodes, workflowEdges);
        setLastSavedGraphSignature(loadedSignature);
        setLastSavedMetadata({
          name: workflow.name,
          description: workflow.description ?? '',
        });

        // Initialize undo/redo history with the loaded workflow
        initializeHistory(workflowNodes, workflowEdges);

        // Analytics: builder loaded (existing workflow)
        track(Events.WorkflowBuilderLoaded, {
          workflow_id: workflow.id,
          is_new: false,
          node_count: workflowNodes.length,
        });

        // Check for active runs to resume monitoring — only when opened via runs URL
        const openedInExecutionMode = Boolean(routeRunId) || isRunsRoute;
        // Skip runs fetch entirely in design mode to avoid the slow /workflows/runs call
        // Runs will be fetched on-demand when the user switches to execution mode
        try {
          const cachedRunsPage = queryClient.getQueryData<{ runs: any[]; hasMore: boolean }>(
            queryKeys.runs.byWorkflow(workflow.id),
          );
          const runs = openedInExecutionMode
            ? (cachedRunsPage?.runs ??
              (await fetchRuns({ workflowId: workflow.id }).then(
                () =>
                  queryClient.getQueryData<{ runs: any[]; hasMore: boolean }>(
                    queryKeys.runs.byWorkflow(workflow.id),
                  )?.runs ?? [],
              )))
            : (cachedRunsPage?.runs ?? []);

          if (runs && runs.length > 0) {
            const latestRun = runs[0];
            if (latestRun && latestRun.id && latestRun.status) {
              const isActive = ['QUEUED', 'RUNNING'].includes(latestRun.status);
              if (isActive) {
                // Resume monitoring in execution store (always - this is background work)
                useExecutionStore.getState().monitorRun(latestRun.id, workflow.id);

                // Only switch timeline to live mode if we opened via execution URL
                // This prevents the jarring switch from design to execution when opening from workflow list
                if (openedInExecutionMode) {
                  useExecutionTimelineStore.getState().selectRun(latestRun.id, 'live');

                  toast({
                    title: 'Resumed live monitoring',
                    description: `Connected to active run ${latestRun.id.slice(-6)}`,
                  });
                }
              }
            }
          }
        } catch (error: unknown) {
          console.error('Failed to check for active runs:', error);
        }
      } catch (error: unknown) {
        console.error('Failed to load workflow:', error);

        // Check if it's a network error (backend not available)
        const isNetworkError =
          error instanceof Error &&
          (error.message.includes('Network Error') || error.message.includes('ECONNREFUSED'));

        if (isNetworkError) {
          toast({
            variant: 'destructive',
            title: 'Cannot connect to backend',
            description: `Ensure the backend is running at ${API_BASE_URL}.`,
          });
        } else {
          toast({
            variant: 'destructive',
            title: 'Failed to load workflow',
            description: error instanceof Error ? error.message : 'Unknown error',
          });
        }

        navigate('/');
      } finally {
        setIsLoading(false);
      }
    };

    loadWorkflow();
  }, [
    id,
    isNewWorkflow,
    navigate,
    setMetadata,
    setWorkflowId,
    setDesignNodes,
    setDesignEdges,
    setExecutionNodes,
    setExecutionEdges,
    resetWorkflow,
    markClean,
    setLastSavedGraphSignature,
    setLastSavedMetadata,
    createEntryPointNode,
    routeRunId,
    selectedRunId,
    resetHistoricalTracking,
    initializeHistory,
    fetchRuns,
  ]);

  return { isLoading, setIsLoading };
}
