import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react';
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
import { ValidationDock } from './ValidationDock';
import { DataFlowEdge } from '../timeline/DataFlowEdge';
import { PlacementIndicator } from './PlacementIndicator';
import { ConnectionLine } from './ConnectionLine';
import { ConnectionPreviewContext, type ConnectingFromHandle } from './connection-preview-context';
import { useComponents } from '@/hooks/queries/useComponentQueries';
import { useExecutionStore } from '@/store/executionStore';
import { useWorkflowStore } from '@/store/workflowStore';
import { useExecutionTimelineStore } from '@/store/executionTimelineStore';
import { useWorkflowUiStore } from '@/store/workflowUiStore';
import type { NodeData } from '@/schemas/node';
import { useToast } from '@/components/ui/use-toast';
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
import { useEdgeHeatMap } from './useEdgeHeatMap';
import { HeatMapLegend } from './HeatMapLegend';
import { useCanvasViewport } from './canvas-viewport';
import { useCanvasNodeInteractions } from './canvas-node-interactions';
import { useResolvedScheduleContext, type ScheduleContextProps } from './canvas-schedule-context';
import { getNodeStatusColor } from './canvas-minimap-colors';
import { CanvasConfigPanel } from './canvas-config-panel';
import { useNodeStatusSync } from './canvas-status-sync';
import { EdgeContextMenu } from './EdgeContextMenu';
import {
  deleteEdge,
  insertNodeAtEdge,
  highlightFullPath,
  clearPathHighlights,
} from './edge-context-actions';

const nodeTypes = { workflow: WorkflowNode, terminal: TerminalNode };
const edgeTypes = { dataFlow: DataFlowEdge, default: DataFlowEdge };

interface CanvasProps extends ScheduleContextProps {
  className?: string;
  nodes: Node<NodeData>[];
  edges: Edge[];
  setNodes: Dispatch<SetStateAction<Node<NodeData>[]>>;
  setEdges: Dispatch<SetStateAction<Edge[]>>;
  onNodesChange: (changes: NodeChange[]) => void;
  onEdgesChange: (changes: EdgeChange[]) => void;
  workflowId?: string | null;
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
  onNodeSelectionChange,
  onSnapshot,
  schedulePanelExpanded,
  webhooksPanelExpanded,
  ...scheduleProps
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
  const showHeatMap = useWorkflowUiStore((state) => state.showHeatMap);

  // --- Edge context menu state ---
  const [edgeContextMenu, setEdgeContextMenu] = useState<{
    position: { x: number; y: number };
    edgeId: string;
  } | null>(null);

  // --- Connection preview state (drag-to-connect) ---
  const [connectingFromHandle, setConnectingFromHandle] = useState<ConnectingFromHandle | null>(
    null,
  );

  const onConnectStart = useCallback(
    (
      _event: React.MouseEvent | React.TouchEvent,
      params: {
        nodeId: string | null;
        handleId: string | null;
        handleType: 'source' | 'target' | null;
      },
    ) => {
      if (mode !== 'design') return;
      if (!params.nodeId || !params.handleId || params.handleType !== 'source') return;

      const sourceNode = nodes.find((n) => n.id === params.nodeId);
      if (!sourceNode) return;

      let portColor = 'green';
      let portType: ConnectingFromHandle['portType'] = 'regular';

      if (params.handleId === 'tools') {
        portColor = 'purple';
        portType = 'tool';
      } else {
        const componentRef = (sourceNode.data.componentId ?? sourceNode.data.componentSlug) as
          | string
          | undefined;
        const comp = componentRef ? getComponent(componentRef) : null;
        if (comp) {
          const outputPort = comp.outputs?.find((o) => o.id === params.handleId);
          if (outputPort?.isBranching) {
            portType = 'branching';
            portColor = outputPort.branchColor || 'amber';
          }
        }
      }

      setConnectingFromHandle({
        nodeId: params.nodeId,
        handleId: params.handleId,
        portColor,
        portType,
      });
    },
    [mode, nodes, getComponent],
  );

  const onConnectEnd = useCallback(() => {
    setConnectingFromHandle(null);
  }, []);
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

  const schedule = useResolvedScheduleContext(scheduleProps);
  const applyEdgesChange = onEdgesChange;

  // Compute edge heat map — only active when showHeatMap is on and in execution mode
  const edgeHeatMap = useEdgeHeatMap(edges, dataFlows);
  const activeHeatMap = showHeatMap && mode === 'execution' ? edgeHeatMap : null;

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
    heatMap: activeHeatMap,
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

  useNodeStatusSync({ mode, nodeStates, setNodes });

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
    onCloseScheduleSidebar: schedule.resolvedOnCloseScheduleSidebar,
    onCloseWebhooksSidebar: schedule.resolvedOnCloseWebhooksSidebar,
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

  // --- Edge context menu handlers ---
  const onEdgeContextMenu = useCallback((event: React.MouseEvent, edge: Edge) => {
    event.preventDefault();
    setEdgeContextMenu({
      position: { x: event.clientX, y: event.clientY },
      edgeId: edge.id,
    });
  }, []);

  const closeEdgeContextMenu = useCallback(() => {
    setEdgeContextMenu(null);
  }, []);

  const handleDeleteEdge = useCallback(
    (edgeId: string) => {
      deleteEdge(edgeId, edges, setEdges, setNodes, markDirty, onSnapshot);
    },
    [edges, setEdges, setNodes, markDirty, onSnapshot],
  );

  const handleInsertNodeAtEdge = useCallback(
    (edgeId: string) => {
      insertNodeAtEdge(edgeId, edges, setPlacement, clearPlacement, workflowId ?? null, toast);
    },
    [edges, setPlacement, clearPlacement, workflowId, toast],
  );

  const handleHighlightPath = useCallback(
    (edgeId: string) => {
      highlightFullPath(edgeId, edges, setEdges);
    },
    [edges, setEdges],
  );

  const entryPointActionsValue = useMemo(
    () => ({
      onOpenScheduleSidebar: schedule.resolvedOnOpenScheduleSidebar ?? (() => {}),
      onOpenWebhooksSidebar: schedule.resolvedOnOpenWebhooksSidebar ?? (() => {}),
      onScheduleCreate: schedule.resolvedOnScheduleCreate,
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
      schedule.resolvedOnOpenScheduleSidebar,
      schedule.resolvedOnOpenWebhooksSidebar,
      schedule.resolvedOnScheduleCreate,
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
            className={`flex-1 relative bg-background overflow-hidden${connectingFromHandle ? ' connecting-from-port' : ''}`}
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
            <HeatMapLegend />
            <ConnectionPreviewContext.Provider value={connectingFromHandle}>
              <ReactFlow
                nodes={nodes}
                edges={edges}
                onNodesChange={onNodesChange}
                onEdgesChange={handleEdgesChange}
                onConnect={onConnect}
                onConnectStart={onConnectStart}
                onConnectEnd={onConnectEnd}
                connectionLineComponent={ConnectionLine}
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
                onPaneClick={(event) => {
                  onPaneClick(event);
                  closeEdgeContextMenu();
                  clearPathHighlights(setEdges);
                }}
                onEdgeContextMenu={onEdgeContextMenu}
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
                  nodeColor={getNodeStatusColor}
                />
              </ReactFlow>
            </ConnectionPreviewContext.Provider>

            {edgeContextMenu && (
              <EdgeContextMenu
                position={edgeContextMenu.position}
                edgeId={edgeContextMenu.edgeId}
                isDesignMode={mode === 'design'}
                onClose={closeEdgeContextMenu}
                onDelete={handleDeleteEdge}
                onInsertNode={handleInsertNodeAtEdge}
                onHighlightPath={handleHighlightPath}
              />
            )}
          </div>

          {mode === 'design' && selectedNode && (
            <CanvasConfigPanel
              selectedNode={selectedNode}
              isMobile={isMobile}
              configPanelWidth={configPanelWidth}
              onClose={() => setSelectedNode(null)}
              onUpdateNode={handleUpdateNode}
              workflowId={workflowId}
              schedule={schedule}
            />
          )}
        </div>
      </div>
    </EntryPointActionsContext.Provider>
  );
}
