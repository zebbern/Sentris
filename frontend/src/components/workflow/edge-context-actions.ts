import type { Dispatch, SetStateAction } from 'react';
import type { Edge, Node } from '@xyflow/react';
import type { NodeData } from '@/schemas/node';
import { findFullPath } from '@/utils/graphTraversal';

/**
 * Delete an edge and clean up the target node's input mapping.
 * Mirrors the cleanup logic from canvas-connections.ts handleEdgesChange.
 */
export function deleteEdge(
  edgeId: string,
  edges: Edge[],
  setEdges: Dispatch<SetStateAction<Edge[]>>,
  setNodes: Dispatch<SetStateAction<Node<NodeData>[]>>,
  markDirty: () => void,
  onSnapshot?: (nodes?: Node<NodeData>[], edges?: Edge[]) => void,
): void {
  const edgeToRemove = edges.find((e) => e.id === edgeId);
  if (!edgeToRemove) return;

  // Clean up target node's input mapping
  if (edgeToRemove.targetHandle && edgeToRemove.targetHandle !== 'tools') {
    setNodes((nds) =>
      nds.map((node) => {
        if (node.id !== edgeToRemove.target) return node;

        const inputs = node.data.inputs as Record<string, unknown> | undefined;
        if (!inputs?.[edgeToRemove.targetHandle!]) return node;

        const { [edgeToRemove.targetHandle!]: _removed, ...remainingInputs } = inputs;
        return {
          ...node,
          data: { ...node.data, inputs: remainingInputs },
        };
      }),
    );
  }

  const newEdges = edges.filter((e) => e.id !== edgeId);
  setEdges(newEdges);
  markDirty();
  onSnapshot?.(undefined, newEdges);
}

/**
 * Insert a node at the midpoint of an edge by activating placement mode.
 * After the user selects a component, the original edge is split into two:
 *   source → newNode and newNode → target.
 */
export function insertNodeAtEdge(
  edgeId: string,
  edges: Edge[],
  _setPlacement: (componentId: string, componentName: string, workflowId: string | null) => void,
  _clearPlacement: () => void,
  _workflowId: string | null,
  toast: (opts: { title: string; description: string }) => void,
): void {
  const edge = edges.find((e) => e.id === edgeId);
  if (!edge) return;

  // Open the spotlight/component picker — store edge context so the
  // placement handler can split the edge after a component is dropped.
  // We signal this through a custom event that the spotlight can listen to.
  // For now, show a toast guiding the user, and activate placement mode
  // with a sentinel value that downstream code can detect.
  toast({
    title: 'Insert node',
    description:
      'Select a component from the sidebar, then click the canvas to place it. The edge will be split automatically.',
  });

  // Store the edge ID in sessionStorage so the canvas drop handler can
  // retrieve it and perform the split. This avoids drilling props through
  // many layers.
  sessionStorage.setItem('__insertAtEdge', edgeId);

  // We don't directly call setPlacement because the user hasn't chosen
  // a component yet. The sidebar spotlight / component list will call
  // setPlacement when the user picks one. The canvas drop/placement handler
  // will detect the __insertAtEdge sentinel and split the edge.
}

/**
 * Toggle highlight on the full path passing through the given edge.
 * If the edge is already highlighted, clear all highlights instead.
 */
export function highlightFullPath(
  edgeId: string,
  edges: Edge[],
  setEdges: Dispatch<SetStateAction<Edge[]>>,
): void {
  // Check if this edge is already highlighted — if so, clear all
  const currentEdge = edges.find((e) => e.id === edgeId);
  if (currentEdge?.data?.isPathHighlighted) {
    setEdges((eds) =>
      eds.map((e) => ({
        ...e,
        data: { ...e.data, isPathHighlighted: false },
      })),
    );
    return;
  }

  const pathEdgeIds = findFullPath(edges, edgeId);

  setEdges((eds) =>
    eds.map((e) => ({
      ...e,
      data: {
        ...e.data,
        isPathHighlighted: pathEdgeIds.has(e.id),
      },
    })),
  );
}

/**
 * Clear all path highlights from edges.
 */
export function clearPathHighlights(setEdges: Dispatch<SetStateAction<Edge[]>>): void {
  setEdges((eds) =>
    eds.map((e) => {
      if (!e.data?.isPathHighlighted) return e;
      return {
        ...e,
        data: { ...e.data, isPathHighlighted: false },
      };
    }),
  );
}
