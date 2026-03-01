# Agent: implementer

# Feature: #12 Execution Path Heat Map

## Purpose

Add a post-execution overlay showing throughput on edges — thicker strokes and warmer colors for higher volume, with a toggle button in execution controls.

## Skills

Load before starting: none

## Subtasks

### Heat Map Color Ramp

- [x] In `frontend/src/components/workflow/edge-colors.ts`, add a `getHeatMapColor(normalizedValue: number, isDark: boolean): string` function
- [x] Color ramp: blue (low) → yellow (medium) → red (high), using `normalizedValue` from 0.0 to 1.0
- [x] Use interpolation across at least 3 color stops: `#3b82f6` (blue) → `#eab308` (yellow) → `#ef4444` (red)
- [x] Return appropriate light/dark theme variants
- [x] Add a `getHeatMapStrokeWidth(normalizedValue: number): number` function — returns 2 (min) to 8 (max)

### Heat Map Data Computation

- [x] Create `frontend/src/components/workflow/useEdgeHeatMap.ts` hook
- [x] Accept `edges: Edge[]` and `dataFlows: DataPacket[]` as inputs
- [x] Compute per-edge metrics: packet count and total byte volume for each `(sourceNode, targetNode)` pair by filtering `dataFlows`
- [x] Normalize values to 0.0–1.0 range relative to the max across all edges (so the busiest edge is 1.0)
- [x] Return a `Map<string, { normalizedCount: number; normalizedVolume: number; packetCount: number; totalBytes: number }>` keyed by edge ID
- [x] Memoize with `useMemo` keyed on `edges` length + `dataFlows` length + `dataFlows` reference

### UI Toggle

- [x] In `workflowUiStore.ts`, add `showHeatMap: boolean` state (default `false`) and `toggleHeatMap: () => void` action
- [x] Only meaningful in execution mode — toggling to design mode should visually hide heat map (but preserve the toggle state)

### Toggle Button in Execution Controls

- [x] Add a heat map toggle button in the execution timeline area — either in `PlaybackControls.tsx` or as a sibling control near the timeline
- [x] Use a `Flame` or `Thermometer` icon from lucide-react
- [x] Button should be a toggle: active state with accent background when heat map is on
- [x] Only visible when `mode === 'execution'` and a `selectedRunId` exists

### DataFlowEdge Integration

- [x] In `DataFlowEdge.tsx`, accept heat map data via edge `data` prop: `data.heatMapColor?: string`, `data.heatMapStrokeWidth?: number`
- [x] When heat map is enabled and in execution mode, override the edge stroke color with the heat map color and stroke width with the heat map width
- [x] Keep the existing glow, dimming, and pulse animations — heat map overlays on top of the base edge color
- [x] When heat map is disabled, render the edge normally (existing behavior)

### Wire into Canvas

- [x] In `Canvas.tsx` or `canvas-connections.ts`, use the `useEdgeHeatMap` hook to compute heat map data
- [x] When `showHeatMap` is true, inject `heatMapColor` and `heatMapStrokeWidth` into each edge's `data` prop during the edge-update `useEffect` in `canvas-connections.ts`
- [x] Pass `showHeatMap` state from `workflowUiStore` to control whether heat map data is injected

### Legend (optional but recommended)

- [x] Add a small color ramp legend in the corner of the canvas when heat map is active
- [x] Show "Low" (blue) to "High" (red) with the gradient bar
- [x] Position: bottom-left, above the Controls panel, or top-right corner
- [x] Auto-hide when heat map is toggled off

### Polish

- [x] Ensure edges with zero data flow (no packets) render as thin blue (lowest heat) when heat map is on, not invisible
- [x] Verify the color ramp is distinguishable in both light and dark themes
- [x] Verify the heat map looks correct on a graph with a single edge (normalized to 1.0)
- [x] Confirm Phase 1 edge visuals are unaffected when heat map is OFF

## Notes

- `DataPacket` type in `executionTimeline/types.ts` has `sourceNode`, `targetNode`, `size` (bytes), `timestamp` — all needed for heat map computation
- `dataFlows` is already consumed by `canvas-connections.ts` in the edge-update `useEffect` — extend that same effect
- The `workflowUiStore` uses `zustand/persist` — adding `showHeatMap` to persisted state is fine (user preference)
- Edge data props flow through: `canvas-connections.ts` `useEffect` → `setEdges` → React Flow → `DataFlowEdge` component
- Use `useMemo` to avoid recomputing heat map on every render — only when `dataFlows` reference changes

## Completion Summary

<!-- Appended by orchestrator after agent completes. Do not fill manually. -->
