# Agent: implementer

# Feature: #10 Right-Click Edge Menu

## Purpose

Add a context menu on edge right-click with actions: Delete Edge, Insert Node Here, Add Label, Highlight Full Path.

## Skills

Load before starting: none

## Subtasks

### Setup

- [x] Add shadcn ContextMenu component: run `npx shadcn@latest add context-menu` to generate `frontend/src/components/ui/context-menu.tsx`
- [x] Verify the generated component exports match shadcn conventions (ContextMenu, ContextMenuTrigger, ContextMenuContent, ContextMenuItem, etc.)

### Graph Traversal Utility

- [x] Create `frontend/src/utils/graphTraversal.ts` with a `findFullPath(edges, startEdgeId)` function that performs BFS/DFS to find all connected edges from source to terminal nodes (both upstream and downstream)
- [x] The function should accept an `Edge[]` array and an edge ID, return a `Set<string>` of edge IDs on the full path
- [x] Build an adjacency list from the edges array on each call (edges array is small enough; avoid premature caching)

### Edge Context Menu Component

- [x] Create `frontend/src/components/workflow/EdgeContextMenu.tsx` — a positioned context menu that renders at mouse coordinates
- [x] Props: `position: { x: number; y: number }`, `edgeId: string`, `onClose: () => void`, action callbacks
- [x] Menu items: "Delete Edge", "Insert Node Here", "Add Label" (disabled/placeholder for now), "Highlight Full Path"
- [x] Use shadcn ContextMenu components for styling consistency
- [x] Menu should close on click-away, Escape key, or action selection

### Action: Delete Edge

- [x] Create `frontend/src/components/workflow/edge-context-actions.ts` with `deleteEdge(edgeId, edges, setEdges, setNodes, markDirty, onSnapshot)` — reuse the edge-removal + input-mapping cleanup logic from `canvas-connections.ts` `handleEdgesChange`
- [x] Wire the "Delete Edge" menu item to call this action
- [x] Only available in design mode

### Action: Insert Node Here

- [x] Add `insertNodeAtEdge(edgeId, edges, nodes, setEdges, setNodes, markDirty, onSnapshot, setPlacement)` to `edge-context-actions.ts`
- [x] Compute the midpoint of the edge (average of sourceX/Y and targetX/Y, or midpoint of the Bezier curve)
- [x] Activate placement mode (via `usePlacementStore`) so the user picks a component, then split the original edge into two edges: source→newNode and newNode→target
- [x] Preserve sourcePortColor and portType on the first segment; use default on the second
- [x] Only available in design mode

### Action: Highlight Full Path

- [x] Add `highlightFullPath(edgeId, edges, setEdges)` to `edge-context-actions.ts` using the `findFullPath` utility
- [x] Set `data.isHighlighted = true` on all edges in the path, `false` on all others
- [x] Available in both design and execution modes
- [x] Clicking "Highlight Full Path" again or clicking the canvas pane should clear the highlight

### Wire into Canvas

- [x] In `Canvas.tsx`, add `onEdgeContextMenu` handler to the `<ReactFlow>` component — React Flow provides this callback with `(event: React.MouseEvent, edge: Edge)`
- [x] Store context menu state: `{ position: { x: number; y: number }; edgeId: string } | null`
- [x] Render `<EdgeContextMenu>` conditionally when state is set
- [x] Prevent the browser's native context menu on edges via `event.preventDefault()`
- [x] Close the context menu on pane click, node click, or edge click
- [x] Only show context menu in design mode (suppress in execution mode, or show read-only subset)

### Polish

- [x] Ensure keyboard accessibility: menu items focusable, Enter/Space activates, Escape closes
- [x] Add appropriate `aria-label` attributes to menu items
- [ ] Test with both light and dark themes
- [x] Verify Phase 1 edge visuals (port-color, flow pulse, branch dash, status glow, connection preview) are unaffected

## Notes

- React Flow v11 provides `onEdgeContextMenu` as a prop on the `<ReactFlow>` component — use this instead of custom event listeners
- The existing `handleEdgesChange` in `canvas-connections.ts` already handles edge deletion with input-mapping cleanup — reuse that logic
- No shadcn ContextMenu component exists yet in the project — it must be generated first
- The "Add Label" action can be a disabled placeholder for now (future feature)
- Existing dropdown menu pattern in `PlaybackControls.tsx` shows shadcn menu usage conventions

## Completion Summary

<!-- Appended by orchestrator after agent completes. Do not fill manually. -->
