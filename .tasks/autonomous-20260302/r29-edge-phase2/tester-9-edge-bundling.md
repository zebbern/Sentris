# Agent: tester

# Feature: #9 Edge Bundling

## Purpose

Write tests for edge bundling algorithm, SVG overlay rendering, interaction compatibility, and performance.

## Skills

Load before starting: testing-patterns

## Subtasks

### Bundle Algorithm Tests

- [ ] Create `frontend/src/utils/__tests__/edgeBundling.test.ts`
- [ ] Test with 3 edges from same source to different targets: verify one bundle group with correct trunk and fan-out paths
- [ ] Test with edges from different sources: verify no bundling (each group has 1 edge)
- [ ] Test with mixed: 3 edges from node A, 1 edge from node B — verify one bundle + one unbundled edge
- [ ] Test single edge from a source: no bundling applied
- [ ] Test edge case: two edges from same source to same target — verify bundling handles duplicates
- [ ] Test fan-in pattern (multiple sources → one target): verify NOT bundled (only fan-out)

### Trunk Geometry Tests

- [ ] Test trunk path starts at source handle position
- [ ] Test trunk extends horizontally by expected distance
- [ ] Test fan-out paths end near their respective target positions
- [ ] Test fan-out angles are evenly distributed when 3+ targets exist

### SVG Overlay Tests

- [ ] Create `frontend/src/components/workflow/__tests__/EdgeBundleLayer.test.tsx`
- [ ] Test renders SVG paths for bundled edges when `edgeBundlingEnabled` is true
- [ ] Test renders nothing when `edgeBundlingEnabled` is false
- [ ] Test trunk path uses correct color from source port
- [ ] Test fan-out paths use individual edge port colors

### Toggle Tests

- [ ] Test `workflowUiStore` `toggleEdgeBundling` flips `edgeBundlingEnabled` state
- [ ] Test individual edges are hidden when bundling is active

### Interaction Tests

- [ ] Test hovering a fan-out path triggers edge highlight
- [ ] Test right-click on fan-out opens context menu for that edge (integration with #10)

### Performance Tests

- [ ] Test bundle computation with 50 edges from 10 sources completes in < 50ms
- [ ] Test the computation is memoized — same input produces same output reference

### Regression

- [ ] Run full test suite — all 439+ existing tests must pass
- [ ] Verify Phase 1, #10, #12, and #8 tests still pass

## Notes

- Mock React Flow viewport hooks (`useViewport`, `useNodes`, `useEdges`) in overlay tests
- Bundle algorithm tests are pure unit tests — no React rendering needed
- Use `performance.now()` for timing assertions in performance tests
- SVG path validation: check that output strings match valid SVG path `d` attribute syntax

## Completion Summary

<!-- Appended by orchestrator after agent completes. Do not fill manually. -->
