# Plan: Round 27 — Frontend Component Tests

## Overview

Three parallel testers write component tests for the workflow builder, execution timeline, and templates/terminal areas. Each tester covers 8–9 high-value components with unit tests using `bun:test` + `@testing-library/react`. A code reviewer then audits all new test files for quality, coverage gaps, and anti-patterns.

## Architecture Decisions

| Decision                                           | Alternatives        | Rationale                                                                                                                                 |
| -------------------------------------------------- | ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Use `bun:test` + `@testing-library/react`          | Vitest, Jest        | Matches existing frontend test suite convention                                                                                           |
| Test files in co-located `__tests__/` dirs         | Separate test tree  | Matches existing project pattern (e.g., `workflow/__tests__/`)                                                                            |
| Skip `Canvas.tsx` from workflow tests              | Include it          | Canvas is a 599-line ReactFlow wrapper; meaningful unit testing requires mocking the entire ReactFlow internals — low ROI vs E2E coverage |
| Limit to 8–10 components per tester                | Test all components | Keeps each tester focused and within time budget; prioritizes highest-value components                                                    |
| Mock stores (Zustand) and queries (TanStack Query) | Use real stores     | Isolates component rendering logic from store/API behavior, which have separate test coverage                                             |

## Affected Files

| Action | File Path                                                                                 | Change Description                             |
| ------ | ----------------------------------------------------------------------------------------- | ---------------------------------------------- |
| CREATE | `frontend/src/components/workflow/__tests__/WorkflowNode.test.tsx`                        | Node rendering, status, ports, selection       |
| CREATE | `frontend/src/components/workflow/__tests__/ConfigPanel.test.tsx`                         | Panel open/close, content for node types       |
| CREATE | `frontend/src/components/workflow/__tests__/ValidationDock.test.tsx`                      | Validation messages, counts, click-to-navigate |
| CREATE | `frontend/src/components/workflow/__tests__/RunWorkflowDialog.test.tsx`                   | Dialog open/close, runtime inputs, submit      |
| CREATE | `frontend/src/components/workflow/__tests__/EdgeContextMenu.test.tsx`                     | Context menu display and action handlers       |
| CREATE | `frontend/src/components/workflow/node/__tests__/NodeHeader.test.tsx`                     | Header rendering with name, icon, status       |
| CREATE | `frontend/src/components/workflow/node/__tests__/NodeInputPorts.test.tsx`                 | Input port rendering, connection indicators    |
| CREATE | `frontend/src/components/workflow/node/__tests__/NodeOutputPorts.test.tsx`                | Output port rendering, connection indicators   |
| CREATE | `frontend/src/components/timeline/__tests__/ExecutionTimeline.test.tsx`                   | Timeline rendering, node status markers        |
| CREATE | `frontend/src/components/timeline/__tests__/ExecutionInspector.test.tsx`                  | Inspector panel, tabs, run data                |
| CREATE | `frontend/src/components/timeline/__tests__/NodeIOInspector.test.tsx`                     | Input/output display for selected nodes        |
| CREATE | `frontend/src/components/timeline/__tests__/RunSelector.test.tsx`                         | Run list, selection, status indicators         |
| CREATE | `frontend/src/components/timeline/__tests__/RunInfoDisplay.test.tsx`                      | Run metadata: duration, status, timestamps     |
| CREATE | `frontend/src/components/timeline/execution-timeline/__tests__/PlaybackControls.test.tsx` | Play/pause/step controls, speed selector       |
| CREATE | `frontend/src/components/timeline/execution-timeline/__tests__/TimelineTrack.test.tsx`    | Track rendering, playhead, markers             |
| CREATE | `frontend/src/components/timeline/event-inspector/__tests__/EventCard.test.tsx`           | Event card rendering for different types       |
| CREATE | `frontend/src/components/timeline/agent-trace/__tests__/AgentRunCard.test.tsx`            | Agent run card with status and transcript      |
| CREATE | `frontend/src/features/templates/__tests__/PublishTemplateModal.test.tsx`                 | Modal, step navigation, form validation        |
| CREATE | `frontend/src/features/templates/__tests__/UseTemplateModal.test.tsx`                     | Modal open/close, template application         |
| CREATE | `frontend/src/features/templates/__tests__/ConfigureStepForm.test.tsx`                    | Form fields, validation, defaults              |
| CREATE | `frontend/src/features/templates/__tests__/StepIndicator.test.tsx`                        | Step active/completed/pending states           |
| CREATE | `frontend/src/features/templates/__tests__/JsonPreview.test.tsx`                          | JSON preview expand/collapse, copy             |
| CREATE | `frontend/src/features/templates/__tests__/WorkflowPreview.test.tsx`                      | SVG preview rendering with mock graph          |
| CREATE | `frontend/src/components/terminal/__tests__/NodeTerminalPanel.test.tsx`                   | Terminal panel rendering, output display       |
| CREATE | `frontend/src/components/terminal/__tests__/TerminalDockPanel.test.tsx`                   | Dock panel tabs, expand/collapse, resize       |

## Phases

| Phase | Agents                                                      | Purpose                          | Depends On |
| ----- | ----------------------------------------------------------- | -------------------------------- | ---------- |
| 1     | tester-workflow, tester-timeline, tester-templates-terminal | Write component tests (parallel) | —          |
| 2     | code-reviewer                                               | Review all new test files        | Phase 1    |

## Dependencies

- All three testers are fully independent and run in parallel — no cross-dependencies
- `code-reviewer` must wait for all three testers to complete before starting review
- Existing test in `workflow/__tests__/WorkflowNode.text-block.test.tsx` provides pattern reference

## Risk Assessment

- **WorkflowNode has heavy store dependencies**: Multiple Zustand stores + TanStack Query hooks. Mitigation: mock stores at module level, test rendering output only.
- **ExecutionTimeline reads ~20 store selectors**: Mitigation: mock `useExecutionTimelineStore` with a factory that returns sensible defaults, override per test.
- **AgentRunCard uses `@ai-sdk/react` `useChat`**: Mitigation: mock the `useChat` hook and `useAgentTranscript` to return static data.
- **Terminal components depend on xterm.js**: Mitigation: mock `useXterm` hook entirely, test React wrapper logic only.
- **ConfigPanel has 13+ props**: Mitigation: create a factory function for default props, override per test case.
