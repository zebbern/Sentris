# Agent: tester

# Feature: #12 Execution Path Heat Map

## Purpose

Write unit tests for heat map color ramp, stroke width computation, edge heat map hook, and toggle behavior.

## Skills

Load before starting: testing-patterns

## Subtasks

### Color Ramp Tests

- [ ] Create tests in `frontend/src/components/workflow/__tests__/edge-colors.test.ts` (extend existing if present)
- [ ] Test `getHeatMapColor(0, isDark)` returns blue
- [ ] Test `getHeatMapColor(0.5, isDark)` returns yellow-ish
- [ ] Test `getHeatMapColor(1.0, isDark)` returns red
- [ ] Test `getHeatMapStrokeWidth(0)` returns minimum (2)
- [ ] Test `getHeatMapStrokeWidth(1)` returns maximum (8)
- [ ] Test `getHeatMapStrokeWidth(0.5)` returns midpoint (5)
- [ ] Verify light and dark variants produce different values

### useEdgeHeatMap Hook Tests

- [ ] Create `frontend/src/components/workflow/__tests__/useEdgeHeatMap.test.ts`
- [ ] Test with empty `dataFlows` returns empty map
- [ ] Test with one edge and 5 packets: normalizedCount should be 1.0
- [ ] Test with two edges where one has 10 packets and other has 2: verify normalization (10→1.0, 2→0.2)
- [ ] Test that byte volume normalization works correctly
- [ ] Test that edges with zero matching packets are excluded from the map (or return 0.0 normalized)

### Toggle Tests

- [ ] Test `workflowUiStore` `toggleHeatMap` flips `showHeatMap` state
- [ ] Test default `showHeatMap` is `false`

### DataFlowEdge Integration Tests

- [ ] Test DataFlowEdge renders with heat map color when `data.heatMapColor` is provided and mode is execution
- [ ] Test DataFlowEdge ignores heat map data when mode is design
- [ ] Test DataFlowEdge renders normally when heat map data is absent

### Regression

- [ ] Run full test suite — all 439+ existing tests must pass
- [ ] Verify Phase 1 edge visual tests still pass

## Notes

- Use `renderHook` from React Testing Library for `useEdgeHeatMap` tests
- Mock `executionTimelineStore` for `dataFlows` data
- Color interpolation tests should use approximate matching (hex values may differ slightly)

## Completion Summary

<!-- Appended by orchestrator after agent completes. Do not fill manually. -->
