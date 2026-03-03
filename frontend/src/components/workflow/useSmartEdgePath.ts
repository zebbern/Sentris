/**
 * Hook that computes an edge path — either a standard bezier or a smart
 * orthogonal path that routes around intermediate nodes.
 *
 * When `smartRouting` is enabled in workflowUiStore, uses the node-avoidance
 * algorithm from `edge-routing.ts`. Otherwise falls back to `getBezierPath`.
 */

import { useMemo } from 'react';
import { getBezierPath, Position, useNodes } from '@xyflow/react';

import { useWorkflowUiStore } from '@/store/workflowUiStore';
import { computeSmartEdgePath } from './edge-routing';

interface SmartEdgePathResult {
  /** SVG `d` attribute string. */
  path: string;
  /**
   * Whether the path is a generic (non-bezier) shape.
   * When true, packet animation should use `getPointAtLength` instead of
   * the bezier formula.
   */
  isGenericPath: boolean;
}

/**
 * Compute the edge path, respecting the smart routing toggle.
 */
export function useSmartEdgePath(
  sourceX: number,
  sourceY: number,
  targetX: number,
  targetY: number,
  sourceNodeId: string,
  targetNodeId: string,
): SmartEdgePathResult {
  const smartRouting = useWorkflowUiStore((s) => s.smartRouting);
  const nodes = useNodes();

  return useMemo(() => {
    if (!smartRouting) {
      const [path] = getBezierPath({
        sourceX,
        sourceY,
        sourcePosition: Position.Right,
        targetX,
        targetY,
        targetPosition: Position.Left,
      });
      return { path, isGenericPath: false };
    }

    const path = computeSmartEdgePath(
      sourceX,
      sourceY,
      targetX,
      targetY,
      nodes,
      sourceNodeId,
      targetNodeId,
    );
    return { path, isGenericPath: true };
  }, [smartRouting, sourceX, sourceY, targetX, targetY, nodes, sourceNodeId, targetNodeId]);
}
