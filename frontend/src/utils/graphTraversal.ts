import type { Edge } from 'reactflow';

/**
 * Find the full path of connected edges from a starting edge,
 * traversing both upstream (toward sources) and downstream (toward targets).
 *
 * Uses BFS in both directions to collect all edges on the connected path.
 */
export function findFullPath(edges: Edge[], startEdgeId: string): Set<string> {
  const startEdge = edges.find((e) => e.id === startEdgeId);
  if (!startEdge) return new Set();

  // Build adjacency maps: nodeId → outgoing edges, nodeId → incoming edges
  const outgoingByNode = new Map<string, Edge[]>();
  const incomingByNode = new Map<string, Edge[]>();

  for (const edge of edges) {
    const outgoing = outgoingByNode.get(edge.source);
    if (outgoing) {
      outgoing.push(edge);
    } else {
      outgoingByNode.set(edge.source, [edge]);
    }

    const incoming = incomingByNode.get(edge.target);
    if (incoming) {
      incoming.push(edge);
    } else {
      incomingByNode.set(edge.target, [edge]);
    }
  }

  const pathEdgeIds = new Set<string>();
  const visitedNodes = new Set<string>();

  // BFS downstream from the start edge's target
  pathEdgeIds.add(startEdgeId);

  const downstreamQueue: string[] = [startEdge.target];
  visitedNodes.add(startEdge.target);

  while (downstreamQueue.length > 0) {
    const nodeId = downstreamQueue.shift()!;
    const outgoing = outgoingByNode.get(nodeId);
    if (!outgoing) continue;

    for (const edge of outgoing) {
      pathEdgeIds.add(edge.id);
      if (!visitedNodes.has(edge.target)) {
        visitedNodes.add(edge.target);
        downstreamQueue.push(edge.target);
      }
    }
  }

  // BFS upstream from the start edge's source
  visitedNodes.add(startEdge.source);

  const upstreamQueue: string[] = [startEdge.source];

  while (upstreamQueue.length > 0) {
    const nodeId = upstreamQueue.shift()!;
    const incoming = incomingByNode.get(nodeId);
    if (!incoming) continue;

    for (const edge of incoming) {
      pathEdgeIds.add(edge.id);
      if (!visitedNodes.has(edge.source)) {
        visitedNodes.add(edge.source);
        upstreamQueue.push(edge.source);
      }
    }
  }

  return pathEdgeIds;
}

/**
 * Get the set of node IDs that are part of the full path.
 */
export function findFullPathNodes(edges: Edge[], startEdgeId: string): Set<string> {
  const pathEdgeIds = findFullPath(edges, startEdgeId);
  const nodeIds = new Set<string>();

  for (const edge of edges) {
    if (pathEdgeIds.has(edge.id)) {
      nodeIds.add(edge.source);
      nodeIds.add(edge.target);
    }
  }

  return nodeIds;
}
