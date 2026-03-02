# Plan: Round 26 — Browser Testing, Documentation Audit, Component Tests

## Overview

Three-pronged round: (1) full visual regression sweep of all frontend pages with screenshots, (2) documentation accuracy audit and fixes against the current codebase, and (3) component-level test coverage for four untested directories: `workflow/`, `timeline/`, `templates/`, and `terminal/`. Browser testing and doc research run in parallel (Phase 1), then doc fixes and visual fixes happen sequentially (Phases 2–3), and finally component tests are written (Phase 4).

## Architecture Decisions

| Decision                                                        | Alternatives                      | Rationale                                                                         |
| --------------------------------------------------------------- | --------------------------------- | --------------------------------------------------------------------------------- |
| Screenshot at 1920×1080 desktop viewport only                   | Also test mobile/tablet viewports | Scope control — mobile testing can be a separate round                            |
| Audit docs by cross-referencing codebase imports/routes/configs | Manual reading only               | Systematic codebase comparison catches stale references that reading alone misses |
| Component tests use `bun:test` + `@testing-library/react`       | Vitest, Jest                      | Consistent with existing test suite convention                                    |
| Test files in co-located `__tests__/` directories               | Separate test tree                | Matches existing project pattern                                                  |

## Affected Files

| Action | File Path                                                  | Change Description                                                  |
| ------ | ---------------------------------------------------------- | ------------------------------------------------------------------- |
| CREATE | `test-screenshots/round26/`                                | All page screenshots for visual regression check                    |
| MODIFY | `docs/**/*.md`, `docs/**/*.mdx`                            | Fix stale documentation (specific files TBD by researcher)          |
| MODIFY | `frontend/src/components/**`                               | Fix S0/S1 visual regressions (specific files TBD by browser-tester) |
| CREATE | `frontend/src/components/workflow/__tests__/*.test.tsx`    | Component tests for workflow builder components                     |
| CREATE | `frontend/src/components/timeline/__tests__/*.test.tsx`    | Component tests for timeline components                             |
| CREATE | `frontend/src/components/terminal/__tests__/*.test.tsx`    | Component tests for terminal components                             |
| CREATE | `frontend/src/features/templates/__tests__/*.test.tsx`     | Component tests for template publishing components                  |
| CREATE | `frontend/src/pages/template-library/__tests__/*.test.tsx` | Component tests for template library page components                |

## Phases

| Phase | Agents                     | Purpose                                                               | Depends On                                    |
| ----- | -------------------------- | --------------------------------------------------------------------- | --------------------------------------------- |
| 1     | browser-tester, researcher | Screenshot all pages + audit docs for accuracy                        | —                                             |
| 2     | doc-writer                 | Fix stale documentation identified by researcher                      | Phase 1 (researcher)                          |
| 3     | frontend                   | Fix S0/S1 visual regressions from browser testing                     | Phase 1 (browser-tester)                      |
| 4     | tester                     | Write component tests for workflow/, timeline/, templates/, terminal/ | Phase 3 (frontend fixes stabilize components) |

## Dependencies

- `doc-writer` needs the researcher's findings before starting — cannot run until researcher completes
- `frontend` needs browser-tester's regression list before starting — cannot run until browser-tester completes
- `tester` should run after frontend fixes are complete so tests are written against stable components
- `browser-tester` and `researcher` are fully independent and run in parallel

## Risk Assessment

- **Visual regressions may be data-dependent**: Some pages render differently with/without data. Mitigation: browser-tester should check both empty states and populated states where applicable.
- **Documentation may reference features not yet implemented or recently removed**: Mitigation: researcher cross-references against actual codebase exports/routes/configs.
- **Component tests for workflow/ may require complex mocking**: The workflow builder uses ReactFlow, stores, and many interconnected components. Mitigation: test individual components in isolation, mock ReactFlow context.
- **Terminal components depend on xterm.js**: Mitigation: mock xterm at module level, test the React wrapper logic only.
