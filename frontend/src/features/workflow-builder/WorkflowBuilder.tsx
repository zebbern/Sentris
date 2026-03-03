import { useParams } from 'react-router-dom';
import { memo } from 'react';
import { ReactFlowProvider } from 'reactflow';
import { Sidebar } from '@/components/layout/Sidebar';
import { ExecutionInspector } from '@/components/timeline/ExecutionInspector';
import { RunBreadcrumbs } from '@/components/timeline/RunBreadcrumbs';
import { RunWorkflowDialog } from '@/components/workflow/RunWorkflowDialog';
import { WorkflowBuilderShell } from '@/components/workflow/WorkflowBuilderShell';
import { TerminalDockPanel } from '@/components/terminal/TerminalDockPanel';
import { PublishTemplateModal } from '@/features/templates/PublishTemplateModal';
import { VersionHistoryPanel } from '@/features/workflow-builder/components/VersionHistoryPanel';
import { WorkflowDesignerPane } from '@/features/workflow-builder/components/WorkflowDesignerPane';
import { WorkflowExecutionPane } from '@/features/workflow-builder/components/WorkflowExecutionPane';
import { WorkflowBuilderToolbar } from '@/features/workflow-builder/components/WorkflowBuilderToolbar';
import { HistoryDebugger } from '@/features/workflow-builder/components/HistoryDebugger';
import { useWorkflowBuilderState } from '@/features/workflow-builder/hooks/useWorkflowBuilderState';

const WorkflowBuilderContent = memo(function WorkflowBuilderContent() {
  const state = useWorkflowBuilderState();

  if (state.shouldShowInitialLoader) {
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
    <WorkflowBuilderToolbar
      workflowId={state.id}
      selectedRunId={state.selectedRunId}
      selectedRunStatus={state.selectedRun?.status ?? null}
      selectedRunOrgId={state.selectedRun?.organizationId ?? null}
      isInWorkflowBuilder={state.isInWorkflowBuilder}
      onRun={state.handleRun}
      onSave={state.handleSave}
      onImport={state.handleImportWorkflow}
      onExport={state.handleExportWorkflow}
      onPublishTemplate={() => state.setIsPublishModalOpen(true)}
      canManageWorkflows={state.canManageWorkflows}
      onUndo={state.undo}
      onRedo={state.redo}
      canUndo={state.canUndo}
      canRedo={state.canRedo}
      hasAnalyticsSink={state.hasAnalyticsSink}
      onToggleVersionHistory={() =>
        state.setVersionHistoryPanelOpen(!state.versionHistoryPanelOpen)
      }
    />
  );

  const designerCanvas = (
    <>
      <WorkflowDesignerPane
        workflowId={state.workflowId}
        workflowName={state.workflowName}
        nodes={state.nodes}
        edges={state.edges}
        setNodes={state.setNodes}
        setEdges={state.setEdges}
        onNodesChange={state.onNodesChange}
        onCaptureSnapshot={state.captureSnapshot}
        onEdgesChange={state.onEdgesChange}
        showSummary={state.mode === 'design'}
        onNavigateToSchedules={state.navigateToSchedules}
      />
      {state.mode === 'design' && state.showDemoComponents && <HistoryDebugger />}
    </>
  );

  const executionCanvas = (
    <WorkflowExecutionPane
      workflowId={state.workflowId}
      nodes={state.nodes}
      edges={state.edges}
      setNodes={state.setNodes}
      setEdges={state.setEdges}
      onNodesChange={state.onNodesChange}
      onEdgesChange={state.onEdgesChange}
    />
  );

  const canvasContent = state.mode === 'design' ? designerCanvas : executionCanvas;
  const inspectorContent =
    state.mode === 'execution' ? (
      <ExecutionInspector onRerunRun={state.handleRerunFromTimeline} />
    ) : null;

  const runDialogNode = (
    <RunWorkflowDialog
      open={state.runDialogOpen}
      onOpenChange={state.setRunDialogOpen}
      runtimeInputs={state.runtimeInputs}
      initialValues={state.prefilledRuntimeValues}
      onRun={(inputs) => state.executeWorkflow({ inputs, versionId: state.pendingVersionId })}
    />
  );

  return (
    <>
      <WorkflowBuilderShell
        mode={state.mode}
        topBar={topBarNode}
        isLibraryVisible={state.isLibraryVisible}
        onToggleLibrary={state.toggleLibrary}
        libraryContent={<Sidebar />}
        canvasContent={canvasContent}
        showScheduleSidebarContainer={false}
        isScheduleSidebarVisible={state.schedulesPanelOpen}
        scheduleSidebarContent={null}
        isInspectorVisible={state.isInspectorVisible}
        inspectorContent={inspectorContent}
        inspectorWidth={state.inspectorWidth}
        setInspectorWidth={state.setInspectorWidth}
        showLoadingOverlay={state.shouldShowInitialLoader}
        scheduleDrawer={null}
        runDialog={runDialogNode}
        isConfigPanelVisible={state.configPanelOpen}
        configPanelContent={null} // Will be portalled
        onUndo={state.undo}
        onRedo={state.redo}
        canUndo={state.canUndo}
        canRedo={state.canRedo}
        executionOverlay={
          state.selectedRun?.parentRunId ? (
            <RunBreadcrumbs
              currentRun={{
                id: state.selectedRun.id,
                workflowId: state.selectedRun.workflowId,
                workflowName: state.selectedRun.workflowName,
                parentRunId: state.selectedRun.parentRunId,
                parentNodeRef: state.selectedRun.parentNodeRef,
              }}
              variant="floating"
            />
          ) : null
        }
        terminalDockContent={<TerminalDockPanel />}
      />
      {!state.isNewWorkflow && state.workflowId && (
        <PublishTemplateModal
          workflowId={state.workflowId}
          workflowName={state.metadata.name || 'Untitled Workflow'}
          open={state.isPublishModalOpen}
          onOpenChange={state.setIsPublishModalOpen}
        />
      )}
      {!state.isNewWorkflow && state.workflowId && (
        <VersionHistoryPanel
          workflowId={state.workflowId}
          onLoadVersion={state.handleLoadVersion}
        />
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
