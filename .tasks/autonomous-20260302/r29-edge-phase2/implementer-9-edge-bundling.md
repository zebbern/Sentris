# Agent: implementer

# Feature: #9 Edge Bundling

## Purpose

Multiple edges from the same source merge into a visual trunk, then fan out to targets — reducing visual clutter in fan-out patterns.

## Skills

Load before starting: none

## Subtasks

### Edge Bundling Algorithm

- [x] Create `frontend/src/components/workflow/edgeBundling.ts` with a `computeEdgeBundles(edges, nodes)` function
- [x] Identify fan-out groups: edges sharing the same `source` node (group by `edge.source`)
- [x] For each group with 3+ edges, compute a trunk path: from the source handle outward along a shared segment (80-120px horizontal from source), then fan out to individual targets
- [x] Return a `EdgeBundle[]` where each group has: `sourceNodeId`, `trunkPath` (SVG path string), and `fanOutTargets` (per-target SVG path strings with edge IDs)
- [x] Handle edge cases: single-edge groups (no bundling needed), edges to the same target, backward edges (filtered by MIN_BUNDLE_SIZE=3)

### Trunk Geometry

- [x] The trunk segment extends horizontally from the source handle by configurable distance (max 120px or 30% of average target distance, whichever is smaller, min 40px)
- [x] At the trunk end, fan-out paths distribute toward their targets using quadratic bezier curves
- [x] Use smooth quadratic bezier curves for the fan-out transitions (not sharp corners)
- [x] The trunk is thicker (6px) than individual fan-out paths (3px)

### SVG Overlay Layer

- [x] Create `frontend/src/components/workflow/EdgeBundleLayer.tsx` as a custom SVG layer rendered over React Flow's canvas
- [x] Use React Flow's `useViewport()` hook to get the current pan/zoom transform so the overlay aligns with the canvas
- [x] Render trunk paths as `<path>` elements with appropriate stroke width and color
- [x] The bundle layer is rendered inside the React Flow component as a child (uses useNodes/useEdges/useViewport hooks)
- [ ] When bundling is active, hide the individual React Flow edges that are part of a bundle — SKIPPED per orchestrator's overlay-only approach: individual edges remain visible, overlay adds visual grouping cue

### Color and Style

- [x] Trunk color: use the source port color if all edges in the bundle share the same port color, otherwise use slate (default)
- [x] Fan-out paths: each uses its own port color from the original edge data
- [ ] Preserve dash patterns — SKIPPED: trunk always uses solid stroke since it's an overlay indicator, not a replacement
- [ ] Heat map mode — SKIPPED: bundling is design-mode only, heat map is execution-mode only

### Integration with Canvas

- [x] Add `edgeBundling: boolean` state to `workflowUiStore` (default: `false`) with a toggle action
- [x] Add a bundling toggle button in the canvas toolbar (top-right panel, next to smart routing)
- [x] When enabled, compute bundles and render the overlay; when disabled, show standard individual edges
- [x] Bundle computation is memoized via `useMemo` — only recomputes when edges, nodes, or toggle changes

### Interaction Compatibility

- [ ] Bundled edges must still be interactive — N/A: overlay is pointer-events-none, individual edges remain fully interactive
- [ ] Right-click on a fan-out path — N/A: right-click goes to the underlying React Flow edge
- [ ] Clicking a bundled trunk — N/A: overlay is decorative only
- [ ] In execution mode — N/A: bundling is design-mode only per orchestrator constraint

### Smart Routing Compatibility

- [x] Smart routing applies to individual edges independently; bundling overlay trunk is always horizontal
- [x] The trunk segment is always a straight horizontal extension — no obstacle avoidance needed
- [x] Both features can be enabled simultaneously without visual conflicts (overlay is semi-transparent)

### Performance

- [x] Bundle computation is O(E + N) — single pass over edges for grouping, single pass over nodes for rect lookup
- [x] Re-render only when edges or node positions change (useMemo dependencies)
- [ ] Profile on a graph with 50 nodes and 30 fan-out edges — not profiled (no running dev env), but algorithm is O(E+N) with no DOM queries

### Polish

- [ ] Smooth transitions when toggling bundling on/off — not implemented (instant toggle)
- [x] Bundling only triggers for 3+ edges from same source (MIN_BUNDLE_SIZE = 3)
- [x] Trunk length capped at 120px and min 40px; uses 30% of avg target distance
- [x] Fan-in patterns (multiple sources → single target) are NOT bundled (only groups by source)
- [x] Phase 1 edge visuals and Phase 2 features are preserved — overlay is additive, individual edges unchanged

## Notes

- React Flow renders each edge independently via `edgeTypes` — there is no built-in bundling. The overlay approach avoids fighting React Flow's rendering model.
- Fan-out is common in this workflow system: one node's output often connects to multiple downstream nodes
- The `EdgeBundleLayer` should use React Flow's `useNodes()` and `useEdges()` hooks to get current state
- Consider using `d3-shape` for smooth fan-out path generation if manual Bezier computation becomes complex
- This is the highest-risk feature — if implementation proves too complex, a P1 fallback is simply reducing fan-out visual clutter with curved edge spacing (no actual trunk merging)
- Edge data includes `sourcePortColor`, `isBranching`, `portType` — all needed for correct bundle styling

## Completion Summary

<!-- Appended by orchestrator after agent completes. Do not fill manually. -->
