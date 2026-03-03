/**
 * Smart edge routing — orthogonal paths that avoid intermediate nodes.
 *
 * When smart routing is enabled, edges use right-angle (orthogonal) paths
 * with rounded corners that detour around any intermediate node bounding
 * boxes instead of passing straight through them.
 */

import type { Node } from '@xyflow/react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

interface Point {
  x: number;
  y: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Padding around each node bbox to keep the path visually clear. */
const NODE_PADDING = 20;

/** Corner radius for orthogonal turns (quadratic bezier approximation). */
const CORNER_RADIUS = 8;

/** Minimum horizontal offset before the first turn (from source handle). */
const MIN_HORIZONTAL_OFFSET = 30;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Expand a rect by `pad` pixels on all sides. */
function padRect(r: Rect, pad: number): Rect {
  return {
    left: r.left - pad,
    top: r.top - pad,
    right: r.right + pad,
    bottom: r.bottom + pad,
  };
}

/** Check if two rects overlap. */
function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

/** Get the bounding rect for a React Flow node (after layout). */
function nodeToRect(node: Node): Rect | null {
  const w = node.measured?.width ?? (node.style?.width as number) ?? 200;
  const h = node.measured?.height ?? (node.style?.height as number) ?? 80;
  const x = node.position.x;
  const y = node.position.y;
  return { left: x, top: y, right: x + w, bottom: y + h };
}

// ---------------------------------------------------------------------------
// Path building
// ---------------------------------------------------------------------------

/**
 * Build an SVG path `d` string for an orthogonal route through a sequence
 * of waypoints, using quadratic bezier arcs at each corner.
 */
function waypointsToPath(points: Point[], radius: number): string {
  if (points.length < 2) return '';
  if (points.length === 2) {
    return `M ${points[0].x} ${points[0].y} L ${points[1].x} ${points[1].y}`;
  }

  const r = Math.max(0, radius);
  const parts: string[] = [`M ${points[0].x} ${points[0].y}`];

  for (let i = 1; i < points.length - 1; i++) {
    const prev = points[i - 1];
    const curr = points[i];
    const next = points[i + 1];

    // Segment lengths
    const dPrev = Math.hypot(curr.x - prev.x, curr.y - prev.y);
    const dNext = Math.hypot(next.x - curr.x, next.y - curr.y);

    // Clamp radius so it doesn't exceed half of either segment
    const effectiveR = Math.min(r, dPrev / 2, dNext / 2);

    if (effectiveR <= 0) {
      parts.push(`L ${curr.x} ${curr.y}`);
      continue;
    }

    // Unit vectors
    const ux1 = (curr.x - prev.x) / dPrev;
    const uy1 = (curr.y - prev.y) / dPrev;
    const ux2 = (next.x - curr.x) / dNext;
    const uy2 = (next.y - curr.y) / dNext;

    // Points where the arc starts and ends
    const arcStartX = curr.x - ux1 * effectiveR;
    const arcStartY = curr.y - uy1 * effectiveR;
    const arcEndX = curr.x + ux2 * effectiveR;
    const arcEndY = curr.y + uy2 * effectiveR;

    parts.push(`L ${arcStartX} ${arcStartY}`);
    parts.push(`Q ${curr.x} ${curr.y} ${arcEndX} ${arcEndY}`);
  }

  const last = points[points.length - 1];
  parts.push(`L ${last.x} ${last.y}`);

  return parts.join(' ');
}

// ---------------------------------------------------------------------------
// Core routing algorithm
// ---------------------------------------------------------------------------

/**
 * Compute a smart orthogonal path from (sourceX, sourceY) to (targetX, targetY)
 * that routes around any intermediate node bounding boxes.
 *
 * The algorithm:
 * 1. Collect padded bounding rects for all nodes other than source/target.
 * 2. Determine the "corridor" band between source and target.
 * 3. Find nodes that block the corridor.
 * 4. If none, return a simple 3-segment "smooth step" path.
 * 5. If blocked, compute a detour above or below (whichever has more room),
 *    generating an orthogonal path with rounded corners.
 *
 * Returns an SVG path `d` string.
 */
export function computeSmartEdgePath(
  sourceX: number,
  sourceY: number,
  targetX: number,
  targetY: number,
  allNodes: Node[],
  sourceNodeId: string,
  targetNodeId: string,
): string {
  // --- 1. Collect obstacle rects (padded) ---
  const obstacles: Rect[] = [];
  for (const node of allNodes) {
    if (node.id === sourceNodeId || node.id === targetNodeId) continue;
    const r = nodeToRect(node);
    if (r) obstacles.push(padRect(r, NODE_PADDING));
  }

  // Determine horizontal direction
  const goingRight = targetX >= sourceX;
  const leftX = Math.min(sourceX, targetX);
  const rightX = Math.max(sourceX, targetX);

  // Horizontal offset for the first and last segments
  const horizSpan = rightX - leftX;
  const hOffset = Math.max(MIN_HORIZONTAL_OFFSET, horizSpan * 0.15);

  // --- 2. The "corridor" between source and target ---
  const corridorTop = Math.min(sourceY, targetY);
  const corridorBottom = Math.max(sourceY, targetY);
  const corridor: Rect = {
    left: leftX,
    right: rightX,
    top: corridorTop - NODE_PADDING,
    bottom: corridorBottom + NODE_PADDING,
  };

  // --- 3. Find blocking nodes ---
  const blocking = obstacles.filter((r) => rectsOverlap(r, corridor));

  // --- 4. No blockers → simple smooth step ---
  if (blocking.length === 0) {
    return buildSmoothStepPath(sourceX, sourceY, targetX, targetY, goingRight, hOffset);
  }

  // --- 5. Route around blocking nodes ---
  // Determine the combined bounding box of all blocking nodes
  let blockTop = Infinity;
  let blockBottom = -Infinity;
  for (const r of blocking) {
    if (r.top < blockTop) blockTop = r.top;
    if (r.bottom > blockBottom) blockBottom = r.bottom;
  }

  // Decide whether to route above or below the blocking nodes.
  // Pick the side closer to the edge midpoint Y so detour is smaller.
  const midY = (sourceY + targetY) / 2;
  const spaceAbove = midY - blockTop;
  const spaceBelow = blockBottom - midY;

  const detourY =
    spaceAbove <= spaceBelow
      ? blockTop - NODE_PADDING // route above
      : blockBottom + NODE_PADDING; // route below

  // Build waypoints
  if (goingRight) {
    // Source → right → detour Y → across → back to targetY → target
    const exitX = sourceX + hOffset;
    const enterX = targetX - hOffset;

    const waypoints: Point[] = [
      { x: sourceX, y: sourceY },
      { x: exitX, y: sourceY },
      { x: exitX, y: detourY },
      { x: enterX, y: detourY },
      { x: enterX, y: targetY },
      { x: targetX, y: targetY },
    ];

    return waypointsToPath(deduplicateWaypoints(waypoints), CORNER_RADIUS);
  }

  // Going left (backwards edge) — route with more clearance
  const exitX = sourceX + hOffset;
  const enterX = targetX - hOffset;

  const waypoints: Point[] = [
    { x: sourceX, y: sourceY },
    { x: exitX, y: sourceY },
    { x: exitX, y: detourY },
    { x: enterX, y: detourY },
    { x: enterX, y: targetY },
    { x: targetX, y: targetY },
  ];

  return waypointsToPath(deduplicateWaypoints(waypoints), CORNER_RADIUS);
}

/**
 * Simple 3-segment smooth step path (no collision — direct route).
 * Goes: source → horizontal offset → vertical to target Y → target.
 */
function buildSmoothStepPath(
  sourceX: number,
  sourceY: number,
  targetX: number,
  targetY: number,
  goingRight: boolean,
  hOffset: number,
): string {
  if (goingRight) {
    const midX = (sourceX + targetX) / 2;
    const waypoints: Point[] = [
      { x: sourceX, y: sourceY },
      { x: midX, y: sourceY },
      { x: midX, y: targetY },
      { x: targetX, y: targetY },
    ];
    return waypointsToPath(deduplicateWaypoints(waypoints), CORNER_RADIUS);
  }

  // Backward edge — go right first, loop around
  const exitX = sourceX + hOffset;
  const enterX = targetX - hOffset;

  // Route above or below based on available space
  const detourY = Math.min(sourceY, targetY) - 60;
  const waypoints: Point[] = [
    { x: sourceX, y: sourceY },
    { x: exitX, y: sourceY },
    { x: exitX, y: detourY },
    { x: enterX, y: detourY },
    { x: enterX, y: targetY },
    { x: targetX, y: targetY },
  ];
  return waypointsToPath(deduplicateWaypoints(waypoints), CORNER_RADIUS);
}

/** Remove consecutive duplicate waypoints (same x,y). */
function deduplicateWaypoints(points: Point[]): Point[] {
  if (points.length <= 1) return points;
  const result: Point[] = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const prev = result[result.length - 1];
    if (Math.abs(points[i].x - prev.x) > 0.5 || Math.abs(points[i].y - prev.y) > 0.5) {
      result.push(points[i]);
    }
  }
  return result;
}
