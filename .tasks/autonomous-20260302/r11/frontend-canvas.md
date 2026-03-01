# Agent: frontend (Canvas Decomposition)

## Purpose

Decompose `frontend/src/components/workflow/Canvas.tsx` (521 lines) by extracting schedule context resolution, deduplicating ConfigPanel rendering, and replacing hardcoded MiniMap colors. Target: reduce Canvas.tsx below 400 lines. Pure structural refactoring — no behavior changes.

## Skills

Load before starting: none

## Subtasks

### Context

- [x] Read `frontend/src/components/workflow/Canvas.tsx` in full (~521 lines) to understand the component structure
- [x] Read the existing extracted Canvas sibling files to understand the naming and export conventions: `canvas-viewport.ts`, `canvas-node-factory.ts`, `canvas-connections.ts`, `canvas-node-updater.ts`, `canvas-node-interactions.ts`

### Extract schedule context resolution hook

- [x] Create `frontend/src/components/workflow/canvas-schedule-context.ts` — extract `useResolvedScheduleContext()` hook that encapsulates the 15 resolved schedule/webhook props (lines ~152–167 of Canvas.tsx). The hook takes the optional CanvasProps schedule/webhook fields and returns resolved values by falling back to `useOptionalWorkflowSchedulesContext()`
- [x] Update `Canvas.tsx` — replace the 15 inline `resolved*` variable assignments with a single `const { resolvedWorkflowSchedules, resolvedSchedulesLoading, ... } = useResolvedScheduleContext(...)` call

### Extract MiniMap node color constants

- [x] Create `frontend/src/components/workflow/canvas-minimap-colors.ts` — export a `NODE_STATUS_COLORS` constant mapping status strings (`running`, `success`, `error`, `default`) to hex colors, and a `getNodeStatusColor(node: Node<NodeData>): string` helper function
- [x] Update `Canvas.tsx` — replace the inline `nodeColor` callback (lines ~451–463) with `nodeColor={getNodeStatusColor}`

### Deduplicate ConfigPanel rendering

- [x] Create `frontend/src/components/workflow/canvas-config-panel.tsx` — extract a `CanvasConfigPanel` component that takes the common ConfigPanel props + `isMobile`, `configPanelWidth`, and `onClose`. It internally handles the mobile portal vs desktop inline rendering (lines ~469–515)
- [x] Update `Canvas.tsx` — replace the duplicated mobile/desktop ConfigPanel blocks with `<CanvasConfigPanel ... />`

### Wire up and verify

- [x] Verify `Canvas.tsx` line count is below 400 after all extractions
- [x] Run `get_errors` on `Canvas.tsx` and all new files to confirm no TypeScript errors
- [x] Search for imports of `Canvas` to verify existing consumers are unaffected (the root export stays in place)
- [x] Verify no circular imports between new and existing Canvas sibling files

## Notes

- **Existing pattern**: Canvas already has 5 extracted sibling files (`canvas-viewport.ts`, `canvas-node-factory.ts`, `canvas-connections.ts`, `canvas-node-updater.ts`, `canvas-node-interactions.ts`). Follow the same `canvas-*.ts` / `canvas-*.tsx` naming convention.
- **Schedule context hook** (lines 152–167): Resolves ~15 props by falling back from explicit CanvasProps to `useOptionalWorkflowSchedulesContext()`. The hook should accept the optional prop values and return the resolved values.
- **ConfigPanel duplication** (lines 469–515): Both mobile (portal) and desktop (inline) render `<ConfigPanel>` with identical props — only the wrapper differs. The extracted component handles both cases.
- **MiniMap colors** (lines 451–463): 4 hardcoded hex values — `#f59e0b` (running/amber), `#10b981` (success/green), `#ef4444` (error/red), `#6b7280` (default/gray). A separate `STATUS_COLORS` already exists in `components/timeline/network/utils.ts` but for HTTP status codes, not node execution status — do not reuse it.
- **No behavioral changes**: All visual output and interactions must remain identical.
- **`canvas-config-panel.tsx`** needs `.tsx` extension since it renders JSX (portal + ConfigPanel). The other two extractions are plain `.ts`.

## Completion Summary

<!-- Appended by orchestrator after agent completes. Do not fill manually. -->
