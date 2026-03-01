import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react';
import { createPortal } from 'react-dom';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  type Node,
  type Edge,
  type NodeChange,
  type EdgeChange,
  type ReactFlowInstance,
} from 'reactflow';
import 'reactflow/dist/style.css';

import { WorkflowNode } from './WorkflowNode';
import { TerminalNode } from './TerminalNode';
import { ConfigPanel } from './ConfigPanel';
import { ValidationDock } from './ValidationDock';
import { DataFlowEdge } from '../timeline/DataFlowEdge';
import { PlacementIndicator } from './PlacementIndicator';
import { useComponents } from '@/hooks/queries/useComponentQueries';
import { useExecutionStore } from '@/store/executionStore';
import { useWorkflowStore } from '@/store/workflowStore';
import { useExecutionTimelineStore } from '@/store/executionTimelineStore';
import { useWorkflowUiStore } from '@/store/workflowUiStore';
import type { NodeData } from '@/schemas/node';
import { useToast } from '@/components/ui/use-toast';
import type { WorkflowSchedule } from '@sentris/shared';
import { cn } from '@/lib/utils';
import { useOptionalWorkflowSchedulesContext } from '@/features/workflow-builder/contexts/useWorkflowSchedulesContext';
import { usePlacementStore } from '@/components/layout/sidebar-state';
import { EntryPointActionsContext } from './entry-point-context';
import { useIsMobile } from '@/hooks/useIsMobile';
import { isEntryPointNode } from '@/utils/entryPointUtils';
import { logger } from '@/lib/logger';
import { useCanvasKeyboardShortcuts } from '@/hooks/useCanvasKeyboardShortcuts';
import {
  createNodeFromComponent as createNodeFromComponentUtil,
  type CreateNodeContext,
} from './canvas-node-factory';
import { useNodeUpdater } from './canvas-node-updater';
import { useCanvasConnections } from './canvas-connections';
import { useCanvasViewport } from './canvas-viewport';
import { useCanvasNodeInteractions } from './canvas-node-interactions';

const nodeTypes = { workflow: WorkflowNode, terminal: TerminalNode };
const edgeTypes = { dataFlow: DataFlowEdge, default: DataFlowEdge };

interface CanvasProps {
  className?: string;
  nodes: Node<NodeData>[];
  edges: Edge[];
  setNodes: Dispatch<SetStateAction<Node<NodeData>[]>>;
  setEdges: Dispatch<SetStateAction<Edge[]>>;
  onNodesChange: (changes: NodeChange[]) => void;
  onEdgesChange: (changes: EdgeChange[]) => void;
  workflowId?: string | null;
  workflowSchedules?: WorkflowSchedule[];
  schedulesLoading?: boolean;
  scheduleError?: string | null;
  onScheduleCreate?: () => void;
  onScheduleEdit?: (schedule: WorkflowSchedule) => void;
  onScheduleAction?: (
    schedule: WorkflowSchedule,
    action: 'pause' | 'resume' | 'run',
  ) => Promise<void> | void;
  onScheduleDelete?: (schedule: WorkflowSchedule) => Promise<void> | void;
  onViewSchedules?: () => void;
  onOpenScheduleSidebar?: () => void;
  onCloseScheduleSidebar?: () => void;
  onCloseWebhooksSidebar?: () => void;
  onClearNodeSelection?: () => void;
  onNodeSelectionChange?: (node: Node<NodeData> | null) => void;
  onSnapshot?: (nodes?: Node<NodeData>[], edges?: Edge[]) => void;
  schedulePanelExpanded?: boolean;
  webhooksPanelExpanded?: boolean;
}

export function Canvas({
  className,
  nodes,
  edges,
  setNodes,
  setEdges,
  onNodesChange,
  onEdgesChange,
  workflowId,
  workflowSchedules,
  schedulesLoading,
  scheduleError,
  onScheduleCreate,
  onScheduleEdit,
  onScheduleAction,
  onScheduleDelete,
  onViewSchedules,
  onOpenScheduleSidebar,
  onCloseScheduleSidebar,
  onCloseWebhooksSidebar,
  onNodeSelectionChange,
  onSnapshot,
  schedulePanelExpanded,
  webhooksPanelExpanded,
}: CanvasProps) {
  const [reactFlowInstance, setReactFlowInstance] = useState<ReactFlowInstance | null>(null);
  const [selectedNode, setSelectedNode] = useState<Node<NodeData> | null>(null);
  const canvasContainerRef = useRef<HTMLDivElement>(null);
  const { data: componentIndex } = useComponents();
  const getComponent = (ref: string) => {
    if (!componentIndex || !ref) return null;
    if (componentIndex.byId[ref]) return componentIndex.byId[ref];
    const idFromSlug = componentIndex.slugIndex[ref];
    if (idFromSlug && componentIndex.byId[idFromSlug]) return componentIndex.byId[idFromSlug];
    return null;
  };
  const nodeStates = useExecutionStore((s) => s.nodeStates);
  const markDirty = useWorkflowStore((s) => s.markDirty);
  const dataFlows = useExecutionTimelineStore((s) => s.dataFlows);
  const selectedNodeId = useExecutionTimelineStore((s) => s.selectedNodeId);
  const selectNode = useExecutionTimelineStore((s) => s.selectNode);
  const selectEvent = useExecutionTimelineStore((s) => s.selectEvent);
  const mode = useWorkflowUiStore((state) => state.mode);
  const { toast } = useToast();
  const setConfigPanelOpen = useWorkflowUiStore((s) => s.setConfigPanelOpen);
  const isMobile = useIsMobile();

  const isPlacementActiveForWorkflow = usePlacementStore((s) => s.isPlacementActiveForWorkflow);
  const placementComponentId = usePlacementStore((s) => s.componentId);
  const placementComponentName = usePlacementStore((s) => s.componentName);
  const clearPlacement = usePlacementStore((s) => s.clearPlacement);
  const setPlacement = usePlacementStore((s) => s.setPlacement);
  const isPlacementActive = isPlacementActiveForWorkflow(workflowId ?? null);

  useEffect(() => {
    setConfigPanelOpen(Boolean(selectedNode));
  }, [selectedNode, setConfigPanelOpen]);

  const scheduleContext = useOptionalWorkflowSchedulesContext();
  const resolvedWorkflowSchedules = workflowSchedules ?? scheduleContext?.schedules ?? [];
  const resolvedSchedulesLoading = schedulesLoading ?? scheduleContext?.isLoading ?? false;
  const resolvedScheduleError = scheduleError ?? scheduleContext?.error ?? null;
  const resolvedOnScheduleCreate = onScheduleCreate ?? scheduleContext?.onScheduleCreate;
  const resolvedOnScheduleEdit = onScheduleEdit ?? scheduleContext?.onScheduleEdit;
  const resolvedOnScheduleAction = onScheduleAction ?? scheduleContext?.onScheduleAction;
  const resolvedOnScheduleDelete = onScheduleDelete ?? scheduleContext?.onScheduleDelete;
  const resolvedOnViewSchedules = onViewSchedules ?? scheduleContext?.onViewSchedules;
  const resolvedOnOpenScheduleSidebar =
    onOpenScheduleSidebar ?? scheduleContext?.onOpenScheduleSidebar;
  const resolvedOnCloseScheduleSidebar =
    onCloseScheduleSidebar ?? scheduleContext?.onCloseScheduleSidebar;
  const resolvedOnCloseWebhooksSidebar =
    onCloseWebhooksSidebar ?? scheduleContext?.onCloseWebhooksSidebar;
  const resolvedOnOpenWebhooksSidebar = scheduleContext?.onOpenWebhooksSidebar;
  const applyEdgesChange = onEdgesChange;

  const configPanelWidth = 432;

  useEffect(() => {
    if (mode === 'execution') {
      setSelectedNode(null);
    }
  }, [mode]);

  const { handleEdgesChange, onConnect } = useCanvasConnections({
    nodes,
    edges,
    setNodes,
    setEdges,
    applyEdgesChange,
    getComponent,
    markDirty,
    mode,
    toast,
    selectedNodeId,
    onSnapshot,
    dataFlows,
  });

  const { canvasOpacity, hasUserInteractedRef } = useCanvasViewport({
    reactFlowInstance,
    nodes,
    edges,
    mode,
    selectedNodeId: selectedNode?.id || null,
    schedulePanelExpanded,
    webhooksPanelExpanded,
  });

  useEffect(() => {
    if (mode !== 'execution') {
      setNodes((nds) =>
        nds.map((node) => {
          if (node.data.status && node.data.status !== 'idle') {
            return {
              ...node,
              data: {
                ...node.data,
                status: 'idle',
              },
            };
          }
          return node;
        }),
      );
      return;
    }

    setNodes((nds) =>
      nds.map((node) => {
        const executionState = nodeStates[node.id];
        if (executionState && executionState !== node.data.status) {
          return {
            ...node,
            data: {
              ...node.data,
              status: executionState,
            },
          };
        }
        return node;
      }),
    );
  }, [mode, nodeStates, setNodes]);

  const onDragOver = useCallback(
    (event: React.DragEvent) => {
      if (mode !== 'design') return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
    },
    [mode],
  );

  const createNodeFromComponent = useCallback(
    (componentId: string, clientX: number, clientY: number) => {
      const ctx: CreateNodeContext = {
        reactFlowInstance,
        getComponent,
        nodes,
        edges,
        mode,
        workflowId,
        toast,
        onSnapshot,
        setNodes,
        markDirty,
      };
      createNodeFromComponentUtil(componentId, clientX, clientY, ctx);
    },
    [
      reactFlowInstance,
      setNodes,
      getComponent,
      markDirty,
      mode,
      nodes,
      edges,
      toast,
      workflowId,
      onSnapshot,
    ],
  );

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      if (mode !== 'design') return;
      const componentId = event.dataTransfer.getData('application/reactflow');
      if (!componentId) return;
      createNodeFromComponent(componentId, event.clientX, event.clientY);
    },
    [createNodeFromComponent, mode],
  );

  const {
    handleCanvasTap,
    onNodeClick,
    onNodeDoubleClick,
    onPaneClick,
    handleValidationNodeClick,
  } = useCanvasNodeInteractions({
    nodes,
    setNodes,
    reactFlowInstance,
    mode,
    selectedNodeId,
    selectedNode,
    setSelectedNode,
    selectNode,
    selectEvent,
    onCloseScheduleSidebar: resolvedOnCloseScheduleSidebar,
    onCloseWebhooksSidebar: resolvedOnCloseWebhooksSidebar,
    isPlacementActive,
    placementComponentId,
    clearPlacement,
    createNodeFromComponent,
    hasUserInteractedRef,
  });

  const handleUpdateNode = useNodeUpdater({
    nodes,
    edges,
    setNodes,
    setEdges,
    markDirty,
    onSnapshot,
  });

  useEffect(() => {
    if (selectedNode) {
      const updatedNode = nodes.find((n) => n.id === selectedNode.id);
      if (!updatedNode) {
        // Node was deleted, clear selection
        setSelectedNode(null);
      } else if (updatedNode !== selectedNode) {
        setSelectedNode(updatedNode as Node<NodeData>);
      }
    }
  }, [nodes, selectedNode]);

  useEffect(() => {
    onNodeSelectionChange?.(selectedNode);
  }, [selectedNode, onNodeSelectionChange]);

  useEffect(() => {
    if (mode !== 'design') return;
    if ((schedulePanelExpanded || webhooksPanelExpanded) && selectedNode) {
      setSelectedNode(null);
    }
  }, [schedulePanelExpanded, webhooksPanelExpanded, mode, selectedNode]);

  useCanvasKeyboardShortcuts({
    nodes,
    edges,
    setNodes,
    setEdges,
    setSelectedNode,
    markDirty,
    mode,
    onSnapshot,
    toast,
  });

  const entryPointActionsValue = useMemo(
    () => ({
      onOpenScheduleSidebar: resolvedOnOpenScheduleSidebar ?? (() => {}),
      onOpenWebhooksSidebar: resolvedOnOpenWebhooksSidebar ?? (() => {}),
      onScheduleCreate: resolvedOnScheduleCreate,
      setPlacement: (componentId: string, componentName: string) =>
        setPlacement(componentId, componentName, workflowId ?? null),
      selectEntryPoint: () => {
        const ep = nodes.find((n) => isEntryPointNode(n));
        if (ep) {
          setSelectedNode(ep);
          onNodeSelectionChange?.(ep);
        }
      },
    }),
    [
      resolvedOnOpenScheduleSidebar,
      resolvedOnOpenWebhooksSidebar,
      resolvedOnScheduleCreate,
      setPlacement,
      workflowId,
      nodes,
      onNodeSelectionChange,
    ],
  );

  return (
    <EntryPointActionsContext.Provider value={entryPointActionsValue}>
      <div className={className}>
        <div className="flex h-full">
          <div
            ref={canvasContainerRef}
            className="flex-1 relative bg-background overflow-hidden"
            style={{
              opacity: canvasOpacity,
              transition: 'opacity 200ms ease-in-out',
            }}
            onClick={handleCanvasTap}
            onTouchEnd={handleCanvasTap}
          >
            {isPlacementActive && placementComponentName && (
              <PlacementIndicator
                componentName={placementComponentName}
                onCancel={clearPlacement}
              />
            )}
            <ValidationDock
              nodes={nodes}
              edges={edges}
              mode={mode}
              onNodeClick={handleValidationNodeClick}
            />
            <ReactFlow
              nodes={nodes}
              edges={edges}
              onNodesChange={onNodesChange}
              onEdgesChange={handleEdgesChange}
              onConnect={onConnect}
              onInit={(instance: ReactFlowInstance) => {
                setReactFlowInstance(instance);
                if (nodes.length > 0) {
                  try {
                    instance.fitView({ padding: 0.2, duration: 0, maxZoom: 0.85 });
                  } catch (error: unknown) {
                    logger.warn('Failed to fit view on init:', error);
                  }
                }
              }}
              onDrop={onDrop}
              onDragOver={onDragOver}
              onNodeClick={onNodeClick}
              onNodeDoubleClick={onNodeDoubleClick}
              onPaneClick={onPaneClick}
              onMoveStart={() => {
                hasUserInteractedRef.current = true;
              }}
              nodeTypes={nodeTypes}
              edgeTypes={edgeTypes}
              nodesDraggable={mode === 'design'}
              nodesConnectable={mode === 'design'}
              edgesUpdatable={mode === 'design'}
              deleteKeyCode={mode === 'design' ? ['Backspace', 'Delete'] : []}
              elementsSelectable
              className={isPlacementActive ? '[&_.react-flow__pane]:!cursor-crosshair' : ''}
            >
              <Background
                gap={16}
                className="!bg-background [&>pattern>circle]:!fill-muted-foreground/30"
              />
              <Controls
                position="bottom-left"
                className="!bg-card !border !border-border !rounded-md !shadow-lg [&>button]:!bg-card [&>button]:!border-border [&>button]:!fill-foreground [&>button:hover]:!bg-accent max-md:!bottom-14"
              />
              <MiniMap
                position="bottom-right"
                pannable
                zoomable
                className="cursor-grab active:cursor-grabbing !bg-card !border !border-border !rounded-md"
                maskColor="hsl(var(--background) / 0.7)"
                nodeColor={(node: Node<NodeData>) => {
                  switch (node.data?.status) {
                    case 'running':
                      return '#f59e0b';
                    case 'success':
                      return '#10b981';
                    case 'error':
                      return '#ef4444';
                    default:
                      return '#6b7280';
                  }
                }}
              />
            </ReactFlow>
          </div>

          {mode === 'design' &&
            selectedNode &&
            (isMobile ? (
              createPortal(
                <div className="flex h-full w-full overflow-hidden bg-background">
                  <ConfigPanel
                    selectedNode={selectedNode}
                    onClose={() => setSelectedNode(null)}
                    onUpdateNode={handleUpdateNode}
                    workflowId={workflowId}
                    workflowSchedules={resolvedWorkflowSchedules}
                    schedulesLoading={resolvedSchedulesLoading}
                    scheduleError={resolvedScheduleError}
                    onScheduleCreate={resolvedOnScheduleCreate}
                    onScheduleEdit={resolvedOnScheduleEdit}
                    onScheduleAction={resolvedOnScheduleAction}
                    onScheduleDelete={resolvedOnScheduleDelete}
                    onViewSchedules={resolvedOnViewSchedules}
                  />
                </div>,
                document.getElementById('mobile-bottom-sheet-portal') || document.body,
              )
            ) : (
              <div
                className={cn(
                  'relative overflow-hidden transition-all duration-150 ease-out',
                  selectedNode ? 'opacity-100' : 'opacity-0 pointer-events-none',
                )}
                style={{
                  width: configPanelWidth,
                  transition: 'width 150ms ease-out, opacity 150ms ease-out',
                }}
              >
                <ConfigPanel
                  selectedNode={selectedNode}
                  onClose={() => setSelectedNode(null)}
                  onUpdateNode={handleUpdateNode}
                  workflowId={workflowId}
                  workflowSchedules={resolvedWorkflowSchedules}
                  schedulesLoading={resolvedSchedulesLoading}
                  scheduleError={resolvedScheduleError}
                  onScheduleCreate={resolvedOnScheduleCreate}
                  onScheduleEdit={resolvedOnScheduleEdit}
                  onScheduleAction={resolvedOnScheduleAction}
                  onScheduleDelete={resolvedOnScheduleDelete}
                  onViewSchedules={resolvedOnViewSchedules}
                />
              </div>
            ))}
        </div>
      </div>
    </EntryPointActionsContext.Provider>
  );
}
