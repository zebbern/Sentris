import { useCallback, useRef, type Dispatch, type SetStateAction } from 'react';
import type { Node, Edge } from 'reactflow';

import type { NodeData, FrontendNodeData } from '@/schemas/node';

export interface UseNodeUpdaterDeps {
  nodes: Node<NodeData>[];
  edges: Edge[];
  setNodes: Dispatch<SetStateAction<Node<NodeData>[]>>;
  setEdges: Dispatch<SetStateAction<Edge[]>>;
  markDirty: () => void;
  onSnapshot?: (nodes?: Node<NodeData>[], edges?: Edge[]) => void;
}

/**
 * Hook that manages node parameter updates with debounced snapshot history.
 * Handles dynamic output/input edge cleanup and input mapping cleanup.
 */
export function useNodeUpdater({
  nodes,
  edges,
  setNodes,
  setEdges,
  markDirty,
  onSnapshot,
}: UseNodeUpdaterDeps) {
  const snapshotDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleUpdateNode = useCallback(
    (nodeId: string, data: Partial<FrontendNodeData>) => {
      let updatedNodes = nodes.map((node) =>
        node.id === nodeId ? { ...node, data: { ...node.data, ...data } } : node,
      );

      let updatedEdges = edges;
      const edgesToRemove: Edge[] = [];

      // Check for dynamic outputs change (e.g. Entry Point inputs renamed)
      const dynamicOutputs = data.dynamicOutputs;
      if (dynamicOutputs && Array.isArray(dynamicOutputs)) {
        const validOutputIds = new Set(dynamicOutputs.map((p: { id: string }) => p.id));
        updatedEdges.forEach((edge) => {
          if (
            edge.source === nodeId &&
            edge.sourceHandle &&
            !validOutputIds.has(edge.sourceHandle)
          ) {
            edgesToRemove.push(edge);
          }
        });
      }

      // Check for dynamic inputs change
      const dynamicInputs = data.dynamicInputs;
      if (dynamicInputs && Array.isArray(dynamicInputs)) {
        const validInputIds = new Set(dynamicInputs.map((p: { id: string }) => p.id));
        updatedEdges.forEach((edge) => {
          if (
            edge.target === nodeId &&
            edge.targetHandle &&
            !validInputIds.has(edge.targetHandle)
          ) {
            edgesToRemove.push(edge);
          }
        });
      }

      // Perform cleanup if edges were invalidated
      if (edgesToRemove.length > 0) {
        updatedEdges = updatedEdges.filter((e) => !edgesToRemove.includes(e));

        // Cleanup input mappings on target nodes of removed edges
        updatedNodes = updatedNodes.map((node) => {
          const incomingRemovedEdges = edgesToRemove.filter((e) => e.target === node.id);
          if (incomingRemovedEdges.length === 0) return node;

          const originalInputs = (node.data.inputs as Record<string, unknown>) || {};
          const keysToRemove = new Set(
            incomingRemovedEdges
              .filter((e) => e.targetHandle && originalInputs[e.targetHandle])
              .map((e) => e.targetHandle as string),
          );

          if (keysToRemove.size === 0) return node;

          // Build new inputs object excluding the keys to remove
          const inputs = Object.fromEntries(
            Object.entries(originalInputs).filter(([key]) => !keysToRemove.has(key)),
          );

          if (Object.keys(inputs).length === Object.keys(originalInputs).length) return node;

          return {
            ...node,
            data: {
              ...node.data,
              inputs,
            },
          };
        });
      }

      setNodes(updatedNodes);
      setEdges(updatedEdges);

      // Debounce history snapshot to avoid creating history entries for every keystroke
      if (snapshotDebounceRef.current) {
        clearTimeout(snapshotDebounceRef.current);
      }

      snapshotDebounceRef.current = setTimeout(() => {
        onSnapshot?.(updatedNodes, updatedEdges);
        snapshotDebounceRef.current = null;
      }, 500);

      // Mark workflow as dirty immediately so Save button enables
      markDirty();
    },
    [nodes, edges, setNodes, setEdges, markDirty, onSnapshot],
  );

  return handleUpdateNode;
}
