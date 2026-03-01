# Triage: Round 14 — Decompose PublishTemplateModal & CommandPalette

## Identified Issues

| ID  | Severity | File                                                       | Issue                                                                                                  | LOC |
| --- | -------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | --- |
| 1   | S1       | `frontend/src/features/templates/PublishTemplateModal.tsx` | Component too large (994 LOC), contains types, utilities, 4 sub-components, and 4 step views inline    | 994 |
| 2   | S1       | `frontend/src/features/command-palette/CommandPalette.tsx` | Component too large (877 LOC), contains types, scoring utils, 8 command builders, and rendering inline | 877 |

## EXECUTION_PLAN

1. **frontend-decompose** — Extract sub-components and utilities from both files into sibling files. Target: both parents under 300 lines.
2. **tester-verify** — Run full test suite to confirm no regressions.

### Agent Assignments

| Agent              | Skills                                | Purpose                                        |
| ------------------ | ------------------------------------- | ---------------------------------------------- |
| frontend-decompose | none                                  | Decompose both components into smaller modules |
| tester-verify      | testing-patterns, terminal-management | Verify all 398 tests still pass                |

### Ordering

Phase 1: frontend-decompose (independent)
Phase 2: tester-verify (depends on Phase 1)
