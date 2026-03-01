import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import type { Node, NodeMouseHandler, ReactFlowInstance } from 'reactflow';

import type { NodeData, FrontendNodeData } from '@/schemas/node';

interface UseCanvasNodeInteractionsDeps {
  nodes: Node<NodeData>[];
  setNodes: Dispatch<SetStateAction<Node<NodeData>[]>>;
  reactFlowInstance: ReactFlowInstance | null;
  mode: string;
  selectedNodeId: string | null;
  selectedNode: Node<NodeData> | null;
  setSelectedNode: Dispatch<SetStateAction<Node<NodeData> | null>>;
  selectNode: (nodeId: string) => void;
  selectEvent: (eventId: string | null) => void;
  onCloseScheduleSidebar?: (() => void) | undefined;
  onCloseWebhooksSidebar?: (() => void) | undefined;
  isPlacementActive: boolean;
  placementComponentId: string | null;
  clearPlacement: () => void;
  createNodeFromComponent: (componentId: string, clientX: number, clientY: number) => void;
  hasUserInteractedRef: MutableRefObject<boolean>;
}

/**
 * Canvas node interaction callbacks: click, double-click, pane click,
 * tap-to-place (mobile), and validation dock node focus.
 */
export function useCanvasNodeInteractions({
  nodes,
  setNodes,
  reactFlowInstance,
  mode,
  selectedNode,
  setSelectedNode,
  selectNode,
  selectEvent,
  onCloseScheduleSidebar,
  onCloseWebhooksSidebar,
  isPlacementActive,
  placementComponentId,
  clearPlacement,
  createNodeFromComponent,
  hasUserInteractedRef,
}: UseCanvasNodeInteractionsDeps) {
  const handleCanvasTap = useCallback(
    (event: React.MouseEvent | React.TouchEvent) => {
      if (mode !== 'design') return;
      if (!isPlacementActive || !placementComponentId) return;

      let clientX: number;
      let clientY: number;

      if ('touches' in event) {
        const touch = event.changedTouches?.[0] || event.touches?.[0];
        if (!touch) return;
        clientX = touch.clientX;
        clientY = touch.clientY;
      } else {
        clientX = event.clientX;
        clientY = event.clientY;
      }

      createNodeFromComponent(placementComponentId, clientX, clientY);
      clearPlacement();
      event.preventDefault();
      event.stopPropagation();
    },
    [createNodeFromComponent, mode, isPlacementActive, placementComponentId, clearPlacement],
  );

  const onNodeClick: NodeMouseHandler = useCallback(
    (event, node) => {
      if (mode === 'execution') {
        event.preventDefault();
        event.stopPropagation();
        selectNode(node.id);
        selectEvent(null);
        return;
      }

      if (selectedNode?.id === node.id) {
        setSelectedNode(null);
        return;
      }

      onCloseScheduleSidebar?.();
      setSelectedNode(node as Node<NodeData>);
    },
    [mode, selectNode, selectEvent, onCloseScheduleSidebar, selectedNode, setSelectedNode],
  );

  const onNodeDoubleClick: NodeMouseHandler = useCallback(
    (event, node) => {
      if (mode !== 'design') return;

      const nodeData = node.data as FrontendNodeData;
      const componentRef = nodeData?.componentId || nodeData?.componentSlug;
      const isTextBlock = componentRef === 'core.ui.text';

      if (isTextBlock) {
        event.stopPropagation();
        setSelectedNode(node as Node<NodeData>);
      }
    },
    [mode, setSelectedNode],
  );

  const onPaneClick = useCallback(
    (event: React.MouseEvent) => {
      hasUserInteractedRef.current = true;

      if (mode === 'design' && isPlacementActive && placementComponentId) {
        createNodeFromComponent(placementComponentId, event.clientX, event.clientY);
        clearPlacement();
        return;
      }

      setSelectedNode(null);
      onCloseScheduleSidebar?.();
      onCloseWebhooksSidebar?.();
    },
    [
      mode,
      isPlacementActive,
      placementComponentId,
      clearPlacement,
      createNodeFromComponent,
      onCloseScheduleSidebar,
      onCloseWebhooksSidebar,
      setSelectedNode,
      hasUserInteractedRef,
    ],
  );

  const handleValidationNodeClick = useCallback(
    (nodeId: string) => {
      const node = nodes.find((n) => n.id === nodeId);
      if (!node || !reactFlowInstance) return;

      setNodes((nds) =>
        nds.map((n) => ({
          ...n,
          selected: n.id === nodeId,
        })),
      );

      setSelectedNode(node as Node<NodeData>);

      reactFlowInstance.fitView({
        padding: 2,
        duration: 300,
        nodes: [{ id: nodeId }],
      });
    },
    [nodes, reactFlowInstance, setNodes, setSelectedNode],
  );

  return {
    handleCanvasTap,
    onNodeClick,
    onNodeDoubleClick,
    onPaneClick,
    handleValidationNodeClick,
  };
}
