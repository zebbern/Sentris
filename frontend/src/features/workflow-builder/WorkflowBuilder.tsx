import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { useState, useCallback, useMemo, memo } from 'react';
import {
  ReactFlowProvider,
  type Node as ReactFlowNode,
  type Edge as ReactFlowEdge,
} from 'reactflow';
import { TopBar } from '@/components/layout/TopBar';
import { Sidebar } from '@/components/layout/Sidebar';
import { ExecutionInspector } from '@/components/timeline/ExecutionInspector';
import { RunBreadcrumbs } from '@/components/timeline/RunBreadcrumbs';
import { RunWorkflowDialog } from '@/components/workflow/RunWorkflowDialog';
import { WorkflowBuilderShell } from '@/components/workflow/WorkflowBuilderShell';
import { TerminalDockPanel } from '@/components/terminal/TerminalDockPanel';
import { PublishTemplateModal } from '@/features/templates/PublishTemplateModal';
import { VersionHistoryPanel } from '@/features/workflow-builder/components/VersionHistoryPanel';
import { useWorkflowGraphControllers } from '@/features/workflow-builder/hooks/useWorkflowGraphControllers';
import { WorkflowDesignerPane } from '@/features/workflow-builder/components/WorkflowDesignerPane';
import { WorkflowExecutionPane } from '@/features/workflow-builder/components/WorkflowExecutionPane';
import { useWorkflowImportExport } from '@/features/workflow-builder/hooks/useWorkflowImportExport';
import { useDesignWorkflowPersistence } from '@/features/workflow-builder/hooks/useDesignWorkflowPersistence';
import { useWorkflowRunner } from '@/features/workflow-builder/hooks/useWorkflowRunner';
import { useWorkflowHistory } from '@/features/workflow-builder/hooks/useWorkflowHistory';
import { HistoryDebugger } from '@/features/workflow-builder/components/HistoryDebugger';
import { useToast } from '@/components/ui/use-toast';
import { useWorkflowStore } from '@/store/workflowStore';
import { useComponents } from '@/hooks/queries/useComponentQueries';
import { useWorkflowUiStore } from '@/store/workflowUiStore';
import { useExecutionTimelineStore } from '@/store/executionTimelineStore';
import { useWorkflowExecutionLifecycle } from '@/features/workflow-builder/hooks/useWorkflowExecutionLifecycle';
import { getRunByIdFromCache } from '@/hooks/queries/useRunQueries';
import type { FrontendNodeData } from '@/schemas/node';
import { useAuthStore } from '@/store/authStore';
import { hasAdminRole } from '@/utils/auth';
import { useIsMobile } from '@/hooks/useIsMobile';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { computeGraphSignature } from './workflowBuilderUtils';
import { useWorkflowChangeHandlers } from './hooks/useWorkflowChangeHandlers';
import { useWorkflowKeyboardShortcuts } from './hooks/useWorkflowKeyboardShortcuts';
import { useWorkflowLoader } from './hooks/useWorkflowLoader';
import { useWorkflowModeSwitching } from './hooks/useWorkflowModeSwitching';
import { useRuntimeInputResolver } from './hooks/useRuntimeInputResolver';

const WorkflowBuilderContent = memo(function WorkflowBuilderContent() {
  const { id, runId: routeRunId } = useParams<{ id: string; runId?: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const builderRoutePrefix = '/workflows';
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

  const { undo, redo, canUndo, canRedo, captureSnapshot, initializeHistory } = useWorkflowHistory({
    designGraph,
    onHistoryChange: markDirty,
  });

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

  const { data: componentIndex } = useComponents();
  const getComponent = (ref: string) => {
    if (!componentIndex || !ref) return null;
    if (componentIndex.byId[ref]) return componentIndex.byId[ref];
    const idFromSlug = componentIndex.slugIndex[ref];
    if (idFromSlug && componentIndex.byId[idFromSlug]) return componentIndex.byId[idFromSlug];
    return null;
  };

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

  const buildGraphSignature = useCallback(
    (
      nodesSnapshot: ReactFlowNode<FrontendNodeData>[] | null,
      edgesSnapshot: ReactFlowEdge[] | null,
    ) => computeGraphSignature(nodesSnapshot, edgesSnapshot),
    [],
  );

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
      workflowRoutePrefix: builderRoutePrefix,
    });

  const { mostRecentRunId, fetchRuns, resetHistoricalTracking } = useWorkflowExecutionLifecycle({
    workflowId: isNewWorkflow ? 'new' : (id ?? null),
    metadata: { id: metadata.id ?? id ?? null, currentVersionId: metadata.currentVersionId },
    routeRunId,
    selectedRunId,
    mode,
    builderRoutePrefix,
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

  const { resolveRuntimeInputDefinitions, resolveRuntimeInputDefaults } = useRuntimeInputResolver({
    nodes,
    getComponent,
  });

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
    workflowRoutePrefix: builderRoutePrefix,
  });

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

  if (shouldShowInitialLoader) {
    return (
      <div className="h-screen flex items-center justify-center bg-background">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
          <p className="text-muted-foreground">Loading workflow...</p>
        </div>
      </div>
    );
  }

  const topBarNode = (
    <TopBar
      workflowId={id}
      selectedRunId={selectedRunId}
      selectedRunStatus={selectedRun?.status ?? null}
      selectedRunOrgId={selectedRun?.organizationId ?? null}
      isInWorkflowBuilder={isInWorkflowBuilder}
      onRun={handleRun}
      onSave={handleSave}
      onImport={handleImportWorkflow}
      onExport={handleExportWorkflow}
      onPublishTemplate={() => setIsPublishModalOpen(true)}
      canManageWorkflows={canManageWorkflows}
      onUndo={undo}
      onRedo={redo}
      canUndo={canUndo}
      canRedo={canRedo}
      hasAnalyticsSink={hasAnalyticsSink}
      onToggleVersionHistory={() => setVersionHistoryPanelOpen(!versionHistoryPanelOpen)}
    />
  );

  const designerCanvas = (
    <>
      <WorkflowDesignerPane
        workflowId={workflowId}
        workflowName={workflowName}
        nodes={nodes}
        edges={edges}
        setNodes={setNodes}
        setEdges={setEdges}
        onNodesChange={onNodesChange}
        onCaptureSnapshot={captureSnapshot}
        onEdgesChange={onEdgesChange}
        showSummary={mode === 'design'}
        onNavigateToSchedules={navigateToSchedules}
      />
      {mode === 'design' && showDemoComponents && <HistoryDebugger />}
    </>
  );

  const executionCanvas = (
    <WorkflowExecutionPane
      workflowId={workflowId}
      nodes={nodes}
      edges={edges}
      setNodes={setNodes}
      setEdges={setEdges}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
    />
  );

  const canvasContent = mode === 'design' ? designerCanvas : executionCanvas;
  const inspectorContent =
    mode === 'execution' ? <ExecutionInspector onRerunRun={handleRerunFromTimeline} /> : null;

  const runDialogNode = (
    <RunWorkflowDialog
      open={runDialogOpen}
      onOpenChange={setRunDialogOpen}
      runtimeInputs={runtimeInputs}
      initialValues={prefilledRuntimeValues}
      onRun={(inputs) => executeWorkflow({ inputs, versionId: pendingVersionId })}
    />
  );

  return (
    <>
      <WorkflowBuilderShell
        mode={mode}
        topBar={topBarNode}
        isLibraryVisible={isLibraryVisible}
        onToggleLibrary={toggleLibrary}
        libraryContent={<Sidebar />}
        canvasContent={canvasContent}
        showScheduleSidebarContainer={false}
        isScheduleSidebarVisible={schedulesPanelOpen}
        scheduleSidebarContent={null}
        isInspectorVisible={isInspectorVisible}
        inspectorContent={inspectorContent}
        inspectorWidth={inspectorWidth}
        setInspectorWidth={setInspectorWidth}
        showLoadingOverlay={shouldShowInitialLoader}
        scheduleDrawer={null}
        runDialog={runDialogNode}
        isConfigPanelVisible={configPanelOpen}
        configPanelContent={null} // Will be portalled
        onUndo={undo}
        onRedo={redo}
        canUndo={canUndo}
        canRedo={canRedo}
        executionOverlay={
          selectedRun?.parentRunId ? (
            <RunBreadcrumbs
              currentRun={{
                id: selectedRun.id,
                workflowId: selectedRun.workflowId,
                workflowName: selectedRun.workflowName,
                parentRunId: selectedRun.parentRunId,
                parentNodeRef: selectedRun.parentNodeRef,
              }}
              variant="floating"
            />
          ) : null
        }
        terminalDockContent={<TerminalDockPanel />}
      />
      {!isNewWorkflow && workflowId && (
        <PublishTemplateModal
          workflowId={workflowId}
          workflowName={metadata.name || 'Untitled Workflow'}
          open={isPublishModalOpen}
          onOpenChange={setIsPublishModalOpen}
        />
      )}
      {!isNewWorkflow && workflowId && (
        <VersionHistoryPanel workflowId={workflowId} onLoadVersion={handleLoadVersion} />
      )}
    </>
  );
});

WorkflowBuilderContent.displayName = 'WorkflowBuilderContent';

export function WorkflowBuilder() {
  const { id } = useParams<{ id: string }>();
  return (
    <ReactFlowProvider key={id ?? 'new'}>
      <WorkflowBuilderContent />
    </ReactFlowProvider>
  );
}
