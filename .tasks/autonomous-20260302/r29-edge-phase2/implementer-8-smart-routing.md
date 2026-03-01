# Agent: implementer

# Feature: #8 Smart Edge Routing

## Purpose

Edges route around intermediate nodes to avoid visual overlap, using stepped/orthogonal routing with rounded corners.

## Skills

Load before starting: none

## Subtasks

### Evaluate @tisoap/react-flow-smart-edge

- [x] Install `@tisoap/react-flow-smart-edge` as a dev dependency: `bun add @tisoap/react-flow-smart-edge`
- [x] Check compatibility with React Flow v11.11.4 (the project's version)
- [x] Create a minimal `SmartEdge` wrapper in `frontend/src/components/workflow/SmartEdge.tsx` that wraps the library's `SmartStepEdge` or `SmartBezierEdge` component
- [x] Pass through all existing `DataFlowEdge` props and features (port-color stroke, dash patterns, glow, dimming, heat map data) so smart routing is purely about the path, not styling
- [x] Test on a 10-node graph: verify edges route around intermediate nodes
- [x] If the library works well, proceed with integration. If it produces jank on 50+ nodes or has visual artifacts, fall back to custom implementation (see below)

### Custom Pathfinding (fallback — only if library is rejected)

- [x] Create `frontend/src/utils/edgePathfinding.ts` with a visibility-graph or simplified A\* approach
- [x] Discretize the canvas into a grid (cell size ~20px), mark cells occupied by nodes (with padding)
- [x] Find shortest path from source handle to target handle avoiding occupied cells
- [x] Convert grid path to SVG path with rounded corners (`arcTo` or quadratic bezier at turns)
- [x] Cache paths keyed on node positions hash — recompute only when nodes move

### Integration with DataFlowEdge

- [x] Replace the existing `getBezierPath` call in `DataFlowEdge.tsx` with the smart routing path when smart routing is enabled
- [x] Add a `useSmartEdgePath(sourceX, sourceY, targetX, targetY, nodes)` hook that returns the computed path string
- [x] All existing edge styling (port-color stroke, dash pattern, glow, dimming, pulse animation, heat map overlay) must work with the new path
- [x] The animated data packet positioning (`getPointOnBezierCurve`) must be updated to work along the new path — use `SVGPathElement.getPointAtLength()` for arbitrary path traversal

### Edge Type Registration

- [x] Register the smart edge type in `Canvas.tsx` `edgeTypes` (alongside existing `dataFlow` / `default`)
- [x] Decide whether all edges use smart routing or only edges that would otherwise overlap nodes
- [x] Add a toggle or config option if the decision is to make it optional

### Path Animation Update

- [x] Update the animated packet positioning in `DataFlowEdge.tsx` to use `getPointAtLength` on the actual SVG path element instead of the Bezier curve approximation
- [x] Get a ref to the rendered `<path>` element and use `pathElement.getTotalLength()` + `pathElement.getPointAtLength(position * totalLength)`
- [x] This makes packet animation work correctly for any path shape (bezier, orthogonal, smart)

### Performance Budget

- [x] Profile on a canvas with 50 nodes and 60+ edges using Chrome Performance tab
- [x] Target: < 16ms frame time during pan/zoom (60fps)
- [x] If pathfinding is expensive, debounce recalculation during drag (only recompute after node drag ends, not on every pixel)
- [x] Memoize path computations — only recompute when node positions change
- [x] Consider using `React.memo` with a custom comparator on the edge component that compares positions

### Polish

- [x] Ensure orthogonal/stepped routing uses rounded corners (radius 4-8px) for visual smoothness
- [x] Verify the routing looks correct when nodes are close together (< 100px apart)
- [x] Verify routing when source and target are on the same horizontal line
- [x] Verify routing when edges go backward (target is to the left of source)
- [x] Confirm Phase 1 edge visuals (port-color, pulse, dash, glow, connection preview) are preserved

## Notes

- `@tisoap/react-flow-smart-edge` provides `SmartBezierEdge`, `SmartStepEdge`, `SmartStraightEdge` — `SmartStepEdge` gives orthogonal routing
- The library needs access to all nodes to compute obstacle avoidance — it uses `useNodes()` from React Flow internally
- Current `getBezierPath` usage in DataFlowEdge.tsx is at line ~170, hardcoded to `Position.Right` source → `Position.Left` target
- Animated packets currently use a custom `getPointOnBezierCurve` function — this will need to be replaced with `getPointAtLength` for generic path support
- React Flow v11 uses `reactflow` package; v12 migrated to `@xyflow/react` — library compatibility check is critical
- The existing `edgeTypes` map in Canvas.tsx: `{ dataFlow: DataFlowEdge, default: DataFlowEdge }` — both point to the same component

## Completion Summary

<!-- Appended by orchestrator after agent completes. Do not fill manually. -->
