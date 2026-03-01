# Agent: tester

# Feature: #8 Smart Edge Routing

## Purpose

Write tests for smart edge routing path computation, performance, and animation compatibility.

## Skills

Load before starting: testing-patterns

## Subtasks

### Path Computation Tests

- [ ] Test that smart routing produces a valid SVG path string (starts with `M`, contains `L`/`C`/`Q` segments)
- [ ] Test that the path avoids a node positioned between source and target (verify path coordinates don't pass through node bounding box)
- [ ] Test that the path connects source handle position to target handle position (first point ≈ sourceX,sourceY; last point ≈ targetX,targetY)
- [ ] Test edge case: source and target on same horizontal line with no obstacles — path should be near-straight
- [ ] Test edge case: target is to the left of source (backward edge) — path should not cross through nodes

### Performance Tests

- [ ] Create a benchmark test with 50 nodes and 60 edges — measure path computation time
- [ ] Assert total computation time < 100ms for all paths combined
- [ ] Test that path computation is memoized — same node positions should return cached result

### Animation Compatibility Tests

- [ ] Test that `getPointAtLength`-based packet positioning returns valid coordinates along the computed path
- [ ] Test that position=0 returns a point near the source, position=1 returns a point near the target
- [ ] Test intermediate positions (0.25, 0.5, 0.75) return points roughly along the path

### Edge Type Registration Tests

- [ ] Test that Canvas renders edges using the smart routing type without errors
- [ ] Test that edge styling (port-color, dash, glow) still applies with smart routed paths

### Regression

- [ ] Run full test suite — all 439+ existing tests must pass
- [ ] Verify Phase 1 edge visual tests still pass
- [ ] Verify Phase 2 edge menu and heat map tests still pass

## Notes

- If using `@tisoap/react-flow-smart-edge`, mock the React Flow context (`useNodes`, `useEdges`) in tests
- For path collision tests, use simple bounding-box math to verify the path doesn't intersect obstacle nodes
- `getPointAtLength` requires a real SVG DOM element — use jsdom or mock the method in unit tests
- Performance tests can use `performance.now()` for timing assertions

## Completion Summary

<!-- Appended by orchestrator after agent completes. Do not fill manually. -->
