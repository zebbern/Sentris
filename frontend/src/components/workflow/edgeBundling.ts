/**
 * Edge bundling: group edges by source node and compute trunk + fan-out
 * overlay geometry for visual fan-out indicators.
 *
 * This does NOT replace React Flow's per-edge rendering — it produces
 * additional SVG path data drawn as a semi-transparent overlay to
 * visually indicate fan-out bundles.
 */

import type { Edge, Node } from 'reactflow';

/** A single fan-out target with its own path from the fan-out point. */
export interface FanOutTarget {
  edgeId: string;
  targetNodeId: string;
  /** SVG path `d` string from the fan-out point to a position near the target. */
  path: string;
  /** Color for this individual fan-out stroke. */
  color: string | undefined;
}

/** A bundle of edges sharing the same source node. */
export interface EdgeBundle {
  sourceNodeId: string;
  /** SVG path `d` string for the trunk segment. */
  trunkPath: string;
  /** X,Y of the fan-out point (end of trunk). */
  fanOutPoint: { x: number; y: number };
  /** Individual fan-out paths to each target. */
  fanOutTargets: FanOutTarget[];
  /** Resolved trunk color (shared port color or slate fallback). */
  trunkColor: string | undefined;
  /** Number of edges in this bundle. */
  edgeCount: number;
}

interface NodeRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Minimum edges from same source to trigger bundling. */
const MIN_BUNDLE_SIZE = 3;

/** Maximum trunk length in px. */
const MAX_TRUNK_LENGTH = 120;

/** Fraction of average target distance to use for trunk length. */
const TRUNK_DISTANCE_FRACTION = 0.3;

/**
 * Build a lookup of node ID → bounding rect from React Flow nodes.
 * O(N) where N = node count.
 */
function buildNodeRectMap(nodes: Node[]): Map<string, NodeRect> {
  const map = new Map<string, NodeRect>();
  for (const node of nodes) {
    map.set(node.id, {
      x: node.position.x,
      y: node.position.y,
      width: node.width ?? 250,
      height: node.height ?? 80,
    });
  }
  return map;
}

/**
 * Compute edge bundles for an overlay indicator.
 *
 * Complexity: O(E + N) where E = edge count, N = node count.
 */
export function computeEdgeBundles(edges: Edge[], nodes: Node[]): EdgeBundle[] {
  if (edges.length === 0 || nodes.length === 0) return [];

  const nodeRects = buildNodeRectMap(nodes);

  // Group edges by source node — O(E)
  const groups = new Map<string, Edge[]>();
  for (const edge of edges) {
    const list = groups.get(edge.source);
    if (list) {
      list.push(edge);
    } else {
      groups.set(edge.source, [edge]);
    }
  }

  const bundles: EdgeBundle[] = [];

  for (const [sourceNodeId, groupEdges] of groups) {
    if (groupEdges.length < MIN_BUNDLE_SIZE) continue;

    const sourceRect = nodeRects.get(sourceNodeId);
    if (!sourceRect) continue;

    // Source handle position: right edge center
    const srcX = sourceRect.x + sourceRect.width;
    const srcY = sourceRect.y + sourceRect.height / 2;

    // Compute target positions (left edge center of each target)
    const targets: { edge: Edge; x: number; y: number }[] = [];
    for (const edge of groupEdges) {
      const targetRect = nodeRects.get(edge.target);
      if (!targetRect) continue;
      targets.push({
        edge,
        x: targetRect.x,
        y: targetRect.y + targetRect.height / 2,
      });
    }

    if (targets.length < MIN_BUNDLE_SIZE) continue;

    // Compute trunk length: min(MAX_TRUNK_LENGTH, TRUNK_DISTANCE_FRACTION * avg distance)
    const avgDist = targets.reduce((sum, t) => sum + Math.abs(t.x - srcX), 0) / targets.length;
    const trunkLength = Math.min(MAX_TRUNK_LENGTH, Math.max(40, avgDist * TRUNK_DISTANCE_FRACTION));

    const fanOutX = srcX + trunkLength;
    const fanOutY = srcY;

    // Trunk path: straight horizontal line from source to fan-out point
    const trunkPath = `M ${srcX} ${srcY} L ${fanOutX} ${fanOutY}`;

    // Fan-out paths: smooth quadratic bezier from fan-out point toward each target
    const fanOutTargets: FanOutTarget[] = targets.map((t) => {
      // Control point: 40% of remaining distance, vertically biased toward target
      const remainingDist = t.x - fanOutX;
      const cpX = fanOutX + Math.max(20, remainingDist * 0.4);
      const cpY = fanOutY + (t.y - fanOutY) * 0.6;

      // End the fan-out indicator partway to the target (60% of remaining)
      // so it doesn't overlap with the actual edge rendered by React Flow
      const endX = fanOutX + Math.max(30, remainingDist * 0.35);
      const endY = fanOutY + (t.y - fanOutY) * 0.5;

      const path = `M ${fanOutX} ${fanOutY} Q ${cpX} ${cpY} ${endX} ${endY}`;

      return {
        edgeId: t.edge.id,
        targetNodeId: t.edge.target,
        path,
        color: t.edge.data?.sourcePortColor,
      };
    });

    // Determine trunk color: if all edges share same port color, use it; otherwise undefined (slate)
    const portColors = new Set(groupEdges.map((e) => e.data?.sourcePortColor).filter(Boolean));
    const trunkColor = portColors.size === 1 ? [...portColors][0] : undefined;

    bundles.push({
      sourceNodeId,
      trunkPath,
      fanOutPoint: { x: fanOutX, y: fanOutY },
      fanOutTargets,
      trunkColor,
      edgeCount: targets.length,
    });
  }

  return bundles;
}
