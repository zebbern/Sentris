# Triage: Phase 2 Edge Visual Features

## EXECUTION_PLAN

### Features

| #   | Feature                 | Effort      | Risk                                                                        |
| --- | ----------------------- | ----------- | --------------------------------------------------------------------------- |
| 8   | Smart Edge Routing      | High        | Medium — may need external package; performance critical on 50+ node graphs |
| 9   | Edge Bundling           | High        | High — conflicts with React Flow's per-edge rendering model                 |
| 10  | Right-Click Edge Menu   | Medium-High | Low — UI-only, uses existing patterns                                       |
| 12  | Execution Path Heat Map | Medium      | Low — data already in timeline store                                        |

### Ordering

1. **#10 Right-Click Edge Menu** — Least risky, builds foundational edge interaction primitives (onEdgeContextMenu, edge selection, path highlighting) reused by others.
2. **#12 Execution Path Heat Map** — Medium effort, self-contained, extends existing DataFlowEdge with throughput data already in the store.
3. **#8 Smart Edge Routing** — High effort, requires pathfinding or external package (`@tisoap/react-flow-smart-edge`). Independent of #9.
4. **#9 Edge Bundling** — Highest risk, complex geometry, may require custom SVG rendering outside React Flow's per-edge model. Should be last.

### Agent Assignments

| Phase | Agent       | Feature                     | Skills           |
| ----- | ----------- | --------------------------- | ---------------- |
| 1     | implementer | #10 Right-Click Edge Menu   | none             |
| 1     | tester      | #10 tests                   | testing-patterns |
| 2     | implementer | #12 Execution Path Heat Map | none             |
| 2     | tester      | #12 tests                   | testing-patterns |
| 3     | implementer | #8 Smart Edge Routing       | none             |
| 3     | tester      | #8 tests                    | testing-patterns |
| 4     | implementer | #9 Edge Bundling            | none             |
| 4     | tester      | #9 tests                    | testing-patterns |

### Constraints

- Each feature in its own commit
- Browser testing required after each feature
- Must NOT break Phase 1 edge visuals (port-color edges, flow pulse, branch differentiation, status glow, drag-to-connect preview)
- Performance critical — 50+ node graphs must remain jank-free
- 439/439 tests must continue passing
