# Agent: frontend

## Purpose

Decompose `ActionCenterPage.tsx` (465 LOC) into focused sub-components and hooks, placed in a `pages/action-center/` subdirectory.

## Skills

Load before starting: none

## Subtasks

### Analysis

- [ ] Read `frontend/src/pages/ActionCenterPage.tsx` fully and identify the table, modal, filter/sort logic, and data-fetching boundaries
- [ ] Check `frontend/src/lib/queryKeys.ts` for existing Action Center query keys
- [ ] Check `frontend/src/hooks/queries/` for existing Action Center query hooks
- [ ] Identify all imports used by the page to plan extraction boundaries

### Extraction

- [ ] Create directory `frontend/src/pages/action-center/`
- [ ] Create `frontend/src/pages/action-center/ActionCenterTable.tsx` — extract the action items table (columns, row rendering, selection, status badges)
- [ ] Create `frontend/src/pages/action-center/ActionDetailModal.tsx` — extract the action detail modal (detail view, approve/reject/dismiss actions)
- [ ] Create `frontend/src/pages/action-center/useActionCenterFilters.ts` — extract filter state, sort logic, and search into a custom hook
- [ ] Create `frontend/src/pages/action-center/index.ts` — barrel export

### Integration

- [ ] Refactor `ActionCenterPage.tsx` to import from `action-center/` subdirectory and compose the extracted components
- [ ] Ensure `ActionCenterPage.tsx` remains the default export used by the router (check `App.tsx` lazy import)
- [ ] Verify the page loads correctly with filters, table, and modal all functioning

### Verification

- [ ] Run `bun run typecheck` and confirm no type errors
- [ ] Run `bun run lint` and confirm no lint errors in new files

## Notes

- Follow the project's frontend rules: TanStack Query for server data, Zustand only for client UI state.
- Read `frontend/docs/state.md` and `frontend/docs/performance.md` before writing code.
- The `ActionCenterPage.tsx` should shrink from 465 LOC to under 100 LOC — a composition of the extracted pieces.
- Keep the `React.lazy()` import in `App.tsx` pointing to the same file path.
- Maintain all existing functionality: filtering, sorting, pagination, modal open/close, action execution.

## Completion Summary

<!-- Appended by orchestrator after agent completes. Do not fill manually. -->
