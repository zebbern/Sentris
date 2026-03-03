import { useState, useCallback, useMemo } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import type { Node as ReactFlowNode, Edge as ReactFlowEdge } from 'reactflow';
import { useToast } from '@/components/ui/use-toast';
import { useWorkflowStore } from '@/store/workflowStore';
import { useWorkflowUiStore } from '@/store/workflowUiStore';
import { useExecutionTimelineStore } from '@/store/executionTimelineStore';
import { useComponents } from '@/hooks/queries/useComponentQueries';
import { useAuthStore } from '@/store/authStore';
import { hasAdminRole } from '@/utils/auth';
import { useIsMobile } from '@/hooks/useIsMobile';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { getRunByIdFromCache } from '@/hooks/queries/useRunQueries';
import type { FrontendNodeData } from '@/schemas/node';
import { useWorkflowGraphControllers } from './useWorkflowGraphControllers';
import { useWorkflowHistory } from './useWorkflowHistory';
import { useWorkflowImportExport } from './useWorkflowImportExport';
import { useWorkflowChangeHandlers } from './useWorkflowChangeHandlers';
import { useDesignWorkflowPersistence } from './useDesignWorkflowPersistence';
import { useWorkflowExecutionLifecycle } from './useWorkflowExecutionLifecycle';
import { useWorkflowModeSwitching } from './useWorkflowModeSwitching';
import { useWorkflowLoader } from './useWorkflowLoader';
import { useRuntimeInputResolver } from './useRuntimeInputResolver';
import { useWorkflowRunner } from './useWorkflowRunner';
import { useWorkflowKeyboardShortcuts } from './useWorkflowKeyboardShortcuts';
import { computeGraphSignature } from '../workflowBuilderUtils';

const BUILDER_ROUTE_PREFIX = '/workflows';

/**
 * Orchestrates all workflow builder state, hooks, and side-effects.
 * Returns everything the WorkflowBuilderContent component needs to render.
 */
export function useWorkflowBuilderState() {
  const { id, runId: routeRunId } = useParams<{ id: string; runId?: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const isNewWorkflow = id === 'new';
  const isRunsRoute = location.pathname.includes('/runs') && !routeRunId;
  const isInWorkflowBuilder = location.pathname.match(/^\/workflows\/[^/]/) !== null;
  const metadata = useWorkflowStore((s) => s.metadata);
  const isDirty = useWorkflowStore((s) => s.isDirty);
  const setMetadata = useWorkflowStore((s) => s.setMetadata);
  const setWorkflowId = useWorkflowStore((s) => s.setWorkflowId);
  const markClean = useWorkflowStore((s) => s.markClean);
  const markDirty = useWorkflowStore((s) => s.markDirty);
  const resetWorkflow = useWorkflowStore((s) => s.resetWorkflow);
  const { toast } = useToast();

  // --- Graph controllers ---
  const { design: designGraph, execution: executionGraph } = useWorkflowGraphControllers({
    toast,
    onDesignGraphDirty: markDirty,
  });

  const {
    nodes: designNodes,
    edges: designEdges,
    setNodes: setDesignNodes,
    setEdges: setDesignEdges,
    onNodesChange: onDesignNodesChangeBase,
    onEdgesChange: onDesignEdgesChangeBase,
    nodesRef: designNodesRef,
    edgesRef: designEdgesRef,
    preservedStateRef: preservedDesignStateRef,
    savedSnapshotRef: designSavedSnapshotRef,
  } = designGraph;

  const {
    nodes: executionNodes,
    edges: executionEdges,
    setNodes: setExecutionNodes,
    setEdges: setExecutionEdges,
    onNodesChange: onExecutionNodesChangeBase,
    onEdgesChange: onExecutionEdgesChangeBase,
    nodesRef: executionNodesRef,
    edgesRef: executionEdgesRef,
    preservedStateRef: preservedExecutionStateRef,
    savedSnapshotRef: executionLoadedSnapshotRef,
  } = executionGraph;

  // --- UI state ---
  const [isPublishModalOpen, setIsPublishModalOpen] = useState(false);
  const roles = useAuthStore((state) => state.roles);
  const canManageWorkflows = hasAdminRole(roles);
  const mode = useWorkflowUiStore((s) => s.mode);
  const libraryOpen = useWorkflowUiStore((s) => s.libraryOpen);
  const toggleLibrary = useWorkflowUiStore((s) => s.toggleLibrary);
  const inspectorWidth = useWorkflowUiStore((s) => s.inspectorWidth);
  const setInspectorWidth = useWorkflowUiStore((s) => s.setInspectorWidth);
  const setMode = useWorkflowUiStore((s) => s.setMode);
  const showDemoComponents = useWorkflowUiStore((s) => s.showDemoComponents);
  const toggleDemoComponents = useWorkflowUiStore((s) => s.toggleDemoComponents);
  const configPanelOpen = useWorkflowUiStore((s) => s.configPanelOpen);
  const schedulesPanelOpen = useWorkflowUiStore((s) => s.schedulesPanelOpen);
  const versionHistoryPanelOpen = useWorkflowUiStore((s) => s.versionHistoryPanelOpen);
  const setVersionHistoryPanelOpen = useWorkflowUiStore((s) => s.setVersionHistoryPanelOpen);
  const setLibraryOpen = useWorkflowUiStore((s) => s.setLibraryOpen);

  const selectedRunId = useExecutionTimelineStore((state) => state.selectedRunId);
  const selectedRun = selectedRunId ? (getRunByIdFromCache(selectedRunId) ?? null) : null;
  const isMobile = useIsMobile();

  // --- History ---
  const { undo, redo, canUndo, canRedo, captureSnapshot, initializeHistory } = useWorkflowHistory({
    designGraph,
    onHistoryChange: markDirty,
  });

  // --- Mode-dependent graph accessors ---
  const nodes = useMemo(
    () => (mode === 'design' ? designNodes : executionNodes),
    [mode, designNodes, executionNodes],
  );
  const edges = useMemo(
    () => (mode === 'design' ? designEdges : executionEdges),
    [mode, designEdges, executionEdges],
  );

  const setNodes = mode === 'design' ? setDesignNodes : setExecutionNodes;
  const setEdges = mode === 'design' ? setDesignEdges : setExecutionEdges;
  const onNodesChangeBase =
    mode === 'design' ? onDesignNodesChangeBase : onExecutionNodesChangeBase;
  const onEdgesChangeBase =
    mode === 'design' ? onDesignEdgesChangeBase : onExecutionEdgesChangeBase;
  const workflowId = metadata.id;
  const workflowName = metadata.name || 'Untitled workflow';
  useDocumentTitle(workflowName);

  // --- Import/export ---
  const { handleImportWorkflow, handleExportWorkflow } = useWorkflowImportExport({
    canManageWorkflows,
    toast,
    metadata,
    nodes,
    edges,
    setDesignNodes,
    setDesignEdges,
    setExecutionNodes,
    setExecutionEdges,
    setMetadata,
    markDirty,
    resetWorkflow,
    setMode,
  });

  // --- Component index ---
  const { data: componentIndex } = useComponents();
  const getComponent = (ref: string) => {
    if (!componentIndex || !ref) return null;
    if (componentIndex.byId[ref]) return componentIndex.byId[ref];
    const idFromSlug = componentIndex.slugIndex[ref];
    if (idFromSlug && componentIndex.byId[idFromSlug]) return componentIndex.byId[idFromSlug];
    return null;
  };

  // --- Change handlers ---
  const { onNodesChange, onEdgesChange, navigateToSchedules } = useWorkflowChangeHandlers({
    mode,
    designNodesRef,
    executionNodesRef,
    designEdgesRef,
    onNodesChangeBase,
    onEdgesChangeBase,
    captureSnapshot,
    markDirty,
    toast,
    navigate,
    workflowId,
  });

  // --- Graph signature ---
  const buildGraphSignature = useCallback(
    (
      nodesSnapshot: ReactFlowNode<FrontendNodeData>[] | null,
      edgesSnapshot: ReactFlowEdge[] | null,
    ) => computeGraphSignature(nodesSnapshot, edgesSnapshot),
    [],
  );

  // --- Persistence ---
  const { handleSave, setLastSavedGraphSignature, setLastSavedMetadata } =
    useDesignWorkflowPersistence({
      canManageWorkflows,
      isDirty,
      isNewWorkflow,
      metadata,
      designNodes,
      designEdges,
      designNodesRef,
      designEdgesRef,
      designSavedSnapshotRef,
      markDirty,
      markClean,
      setWorkflowId,
      setMetadata,
      navigate,
      toast,
      computeGraphSignature: buildGraphSignature,
      workflowRoutePrefix: BUILDER_ROUTE_PREFIX,
    });

  // --- Execution lifecycle ---
  const { mostRecentRunId, fetchRuns, resetHistoricalTracking } = useWorkflowExecutionLifecycle({
    workflowId: isNewWorkflow ? 'new' : (id ?? null),
    metadata: { id: metadata.id ?? id ?? null, currentVersionId: metadata.currentVersionId },
    routeRunId,
    selectedRunId,
    mode,
    builderRoutePrefix: BUILDER_ROUTE_PREFIX,
    navigate,
    toast,
    setMode,
    designNodesRef,
    designEdgesRef,
    designSavedSnapshotRef,
    executionNodesRef,
    executionEdgesRef,
    preservedExecutionStateRef,
    executionLoadedSnapshotRef,
    setExecutionNodes,
    setExecutionEdges,
  });

  // --- Mode switching ---
  useWorkflowModeSwitching({
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
  });

  // --- Loader ---
  const { isLoading, setIsLoading } = useWorkflowLoader({
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
  });

  // --- Runtime inputs ---
  const { resolveRuntimeInputDefinitions, resolveRuntimeInputDefaults } = useRuntimeInputResolver({
    nodes,
    getComponent,
  });

  // --- Runner ---
  const {
    runDialogOpen,
    setRunDialogOpen,
    runtimeInputs,
    prefilledRuntimeValues,
    pendingVersionId,
    handleRun,
    handleRerunFromTimeline,
    executeWorkflow,
  } = useWorkflowRunner({
    canManageWorkflows,
    metadata,
    isDirty,
    isNewWorkflow,
    nodes,
    setNodes,
    toast,
    resolveRuntimeInputDefinitions,
    resolveRuntimeInputDefaults,
    fetchRuns,
    markClean,
    navigate,
    mostRecentRunId,
    setIsLoading,
    workflowRoutePrefix: BUILDER_ROUTE_PREFIX,
  });

  // --- Keyboard shortcuts ---
  useWorkflowKeyboardShortcuts({
    mode,
    isDirty,
    isNewWorkflow,
    handleSave,
    undo,
    redo,
    canUndo,
    canRedo,
    toggleDemoComponents,
    showDemoComponents,
    toast,
  });

  // --- Derived state ---
  const isLibraryVisible = libraryOpen && mode === 'design';
  const isInspectorVisible = mode === 'execution' || (selectedRunId !== null && mode !== 'design');

  const hasAnalyticsSink = useMemo(() => {
    if (selectedRunId) return true;
    return designNodes.some(
      (node) => (node.data?.componentId ?? node.data?.componentSlug) === 'core.analytics.sink',
    );
  }, [designNodes, selectedRunId]);

  const handleLoadVersion = useCallback(
    (graph: {
      nodes: unknown[];
      edges: unknown[];
      viewport?: { x: number; y: number; zoom: number };
    }) => {
      setDesignNodes(graph.nodes as ReactFlowNode<FrontendNodeData>[]);
      setDesignEdges(graph.edges as ReactFlowEdge[]);
      markDirty();
    },
    [setDesignNodes, setDesignEdges, markDirty],
  );

  const shouldShowInitialLoader =
    isLoading && designNodes.length === 0 && executionNodes.length === 0 && !isNewWorkflow;

  return {
    // Route info
    id,
    isNewWorkflow,
    isInWorkflowBuilder,

    // Graph state
    workflowId,
    workflowName,
    metadata,
    nodes,
    edges,
    designNodes,
    executionNodes,
    setNodes,
    setEdges,
    onNodesChange,
    onEdgesChange,

    // UI state
    mode,
    isPublishModalOpen,
    setIsPublishModalOpen,
    isLibraryVisible,
    isInspectorVisible,
    configPanelOpen,
    schedulesPanelOpen,
    versionHistoryPanelOpen,
    setVersionHistoryPanelOpen,
    toggleLibrary,
    inspectorWidth,
    setInspectorWidth,
    showDemoComponents,

    // Capabilities
    canManageWorkflows,
    canUndo,
    canRedo,
    hasAnalyticsSink,
    shouldShowInitialLoader,

    // Run state
    selectedRunId,
    selectedRun,
    runDialogOpen,
    setRunDialogOpen,
    runtimeInputs,
    prefilledRuntimeValues,
    pendingVersionId,

    // Handlers
    handleSave,
    handleRun,
    handleRerunFromTimeline,
    executeWorkflow,
    handleImportWorkflow,
    handleExportWorkflow,
    handleLoadVersion,
    undo,
    redo,
    captureSnapshot,
    navigateToSchedules,
  } as const;
}
