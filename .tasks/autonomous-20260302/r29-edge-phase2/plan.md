# Plan: Phase 2 Edge Visual Features

## Overview

Four edge visual features extending Phase 1's port-color edges, flow pulse, branch differentiation, status glow, and drag-to-connect preview. Features are ordered by dependency and risk: right-click menu first (foundational edge interactions), then heat map (extends existing data), then smart routing (performance-sensitive), then edge bundling (highest complexity).

## Architecture Decisions

| Decision                                                                                          | Alternatives                                                 | Rationale                                                                                                                           |
| ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| Use Radix ContextMenu (shadcn) for edge right-click                                               | Custom positioning with Popover; native browser context menu | Consistent with existing shadcn/Radix UI system; accessible by default; already have DropdownMenu as pattern                        |
| No ContextMenu component exists yet — must add via shadcn CLI                                     | Build from scratch                                           | shadcn already used; `npx shadcn@latest add context-menu` generates the file                                                        |
| Heat map data sourced from existing `dataFlows: DataPacket[]` in executionTimelineStore           | Separate API endpoint; computed in backend                   | Data already available client-side with timestamps, sizes, sourceNode/targetNode. No backend work needed.                           |
| Heat map toggle added to `workflowUiStore` as `showHeatMap: boolean`                              | Local state in DataFlowEdge; query param                     | Consistent with existing UI toggle patterns in workflowUiStore (showTimeline, mode, etc.)                                           |
| Smart routing: evaluate `@tisoap/react-flow-smart-edge` first                                     | Custom A\* pathfinding on discretized grid                   | Library is maintained, React Flow 11 compatible, reduces effort. Fall back to custom if perf insufficient.                          |
| Edge bundling: custom SVG layer rendered over React Flow                                          | Modify DataFlowEdge to bundle                                | React Flow renders edges individually — bundling requires a separate overlay that computes merged trunk paths from fan-out patterns |
| Path highlighting for "Highlight Full Path" uses BFS on adjacency list derived from `edges` array | DFS; Zustand-stored graph                                    | BFS is simpler for shortest-path-style traversal; adjacency list is cheap to compute from edges array on-demand                     |

## Affected Files

| Action | File Path                                                  | Change Description                                                      |
| ------ | ---------------------------------------------------------- | ----------------------------------------------------------------------- |
| CREATE | `frontend/src/components/ui/context-menu.tsx`              | shadcn ContextMenu component (generated)                                |
| CREATE | `frontend/src/components/workflow/EdgeContextMenu.tsx`     | Right-click context menu for edges                                      |
| CREATE | `frontend/src/components/workflow/edge-context-actions.ts` | Edge context menu action handlers (delete, insert node, highlight path) |
| CREATE | `frontend/src/utils/graphTraversal.ts`                     | BFS/DFS utilities for path highlighting                                 |
| MODIFY | `frontend/src/components/timeline/DataFlowEdge.tsx`        | Add heat map stroke/color computation; add context menu event handler   |
| MODIFY | `frontend/src/components/workflow/Canvas.tsx`              | Add `onEdgeContextMenu` handler; wire heat map toggle                   |
| MODIFY | `frontend/src/components/workflow/edge-colors.ts`          | Add heat map color ramp function (blue→yellow→red)                      |
| MODIFY | `frontend/src/store/workflowUiStore.ts`                    | Add `showHeatMap` toggle                                                |
| MODIFY | `frontend/src/components/workflow/canvas-connections.ts`   | Support "Insert Node Here" edge-split logic                             |
| CREATE | `frontend/src/components/workflow/SmartEdgeRouter.tsx`     | Smart edge routing wrapper or config                                    |
| CREATE | `frontend/src/components/workflow/EdgeBundleLayer.tsx`     | Custom SVG overlay for bundled edges                                    |
| CREATE | `frontend/src/utils/edgeBundling.ts`                       | Edge bundling geometry computation                                      |
| MODIFY | `frontend/package.json`                                    | Add `@tisoap/react-flow-smart-edge` (if adopted)                        |

## Phases

| Phase | Feature                     | Purpose                                                                         | Depends On                                                |
| ----- | --------------------------- | ------------------------------------------------------------------------------- | --------------------------------------------------------- |
| 1     | #10 Right-Click Edge Menu   | Edge interaction foundation — context menu, delete, insert node, highlight path | —                                                         |
| 2     | #12 Execution Path Heat Map | Throughput visualization on edges during execution mode                         | — (parallel-safe with Phase 1 but ordered for simplicity) |
| 3     | #8 Smart Edge Routing       | Avoid node overlaps with orthogonal/smart routing                               | —                                                         |
| 4     | #9 Edge Bundling            | Fan-out trunk merging to reduce visual clutter                                  | Phase 3 (routing + bundling must be compatible)           |

## Dependencies

- Phase 1 has no cross-feature dependencies
- Phase 2 has no cross-feature dependencies
- Phase 4 (Edge Bundling) should come after Phase 3 (Smart Routing) so bundled paths can use the same routing strategy
- All features must preserve Phase 1 edge visuals (port-color, flow pulse, branch dash, status glow, connection preview)

## Risk Assessment

| Risk                                                   | Impact                                                | Mitigation                                                                                                                                     |
| ------------------------------------------------------ | ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Smart edge routing jank on 50+ nodes                   | High — visible lag, blocks adoption                   | Profile with React DevTools + Chrome Performance tab; set perf budget of 16ms frame time; consider memoized path cache keyed on node positions |
| Edge bundling conflicts with React Flow per-edge model | High — may require significant workaround             | Implement as SVG overlay layer, not modifying React Flow's internal edge rendering                                                             |
| Context menu positioning over SVG edges                | Medium — edge click coordinates need conversion       | Use React Flow's `onEdgeContextMenu` callback which provides mouse event with screen coordinates                                               |
| shadcn ContextMenu not yet installed                   | Low — trivial to add                                  | `npx shadcn@latest add context-menu`                                                                                                           |
| Heat map color ramp accessibility                      | Medium — red/green coloring excludes colorblind users | Use blue→yellow→red ramp (avoids red-green confusion); test with color blindness simulator                                                     |
