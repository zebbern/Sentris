import type { Node as ReactFlowNode, Edge as ReactFlowEdge } from 'reactflow';
import { serializeNodes, serializeEdges } from '@/utils/workflowSerializer';
import type { FrontendNodeData } from '@/schemas/node';

/**
 * Default runtime inputs for the Entry Point node.
 */
export const ENTRY_DEFAULT_RUNTIME_INPUTS = [
  {
    id: 'input1',
    label: 'Input 1',
    type: 'array',
    required: true,
    description: '',
  },
] as const;

/**
 * Compute a deterministic JSON signature of a graph (nodes + edges).
 * Used to detect unsaved changes by comparing against the last-saved signature.
 */
export const computeGraphSignature = (
  nodesSnapshot: ReactFlowNode<FrontendNodeData>[] | null,
  edgesSnapshot: ReactFlowEdge[] | null,
): string => {
  const normalizedNodes = serializeNodes(nodesSnapshot ?? [])
    .map((node) => ({
      ...node,
      data: {
        ...node.data,
        config: node.data.config ?? {},
      },
    }))
    .sort((a, b) => a.id.localeCompare(b.id));

  const normalizedEdges = serializeEdges(edgesSnapshot ?? []).sort((a, b) =>
    a.id.localeCompare(b.id),
  );

  return JSON.stringify({
    nodes: normalizedNodes,
    edges: normalizedEdges,
  });
};
