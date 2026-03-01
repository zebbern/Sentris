# Agent: tester

# Feature: #10 Right-Click Edge Menu

## Purpose

Write unit and integration tests for the edge context menu, graph traversal utility, and edge context actions.

## Skills

Load before starting: testing-patterns

## Subtasks

### Graph Traversal Tests

- [ ] Create `frontend/src/utils/__tests__/graphTraversal.test.ts`
- [ ] Test `findFullPath` with a simple linear chain: A→B→C — clicking edge A→B should return all 2 edge IDs
- [ ] Test with a branching graph: A→B, A→C, B→D — clicking edge A→B should follow downstream through B→D
- [ ] Test with a diamond: A→B, A→C, B→D, C→D — verify all edges returned
- [ ] Test with a single edge (no upstream/downstream beyond source and target)
- [ ] Test with an edge ID that doesn't exist — should return empty set

### Edge Context Actions Tests

- [ ] Create `frontend/src/components/workflow/__tests__/edge-context-actions.test.ts`
- [ ] Test `deleteEdge`: verify edge is removed from edges array, input mappings on target node are cleaned up
- [ ] Test `insertNodeAtEdge`: verify original edge is removed and replaced with two new edges, placement mode is activated
- [ ] Test `highlightFullPath`: verify matching edges get `isHighlighted = true`, non-matching get `false`
- [ ] Test `highlightFullPath` toggle: calling again clears all highlights

### EdgeContextMenu Component Tests

- [ ] Create `frontend/src/components/workflow/__tests__/EdgeContextMenu.test.tsx`
- [ ] Test renders all menu items: Delete Edge, Insert Node Here, Add Label, Highlight Full Path
- [ ] Test clicking "Delete Edge" calls the delete callback
- [ ] Test clicking outside the menu calls `onClose`
- [ ] Test "Add Label" is disabled
- [ ] Test menu is positioned at the provided coordinates

### Canvas Integration Tests

- [ ] Verify right-clicking an edge opens the context menu (mock `onEdgeContextMenu`)
- [ ] Verify native context menu is prevented
- [ ] Verify context menu closes when pane is clicked
- [ ] Verify context menu does not appear in execution mode

### Regression

- [ ] Run full test suite — all 439+ existing tests must pass
- [ ] Verify Phase 1 edge visual tests still pass

## Notes

- Use Vitest + React Testing Library for component tests
- Mock React Flow's edge coordinates for positioning tests
- The `onEdgeContextMenu` handler is a React Flow prop — test it by simulating the callback

## Completion Summary

<!-- Appended by orchestrator after agent completes. Do not fill manually. -->
