# Agent: tester-templates-terminal

## Purpose

Write component tests for 8 components across templates and terminal: PublishTemplateModal, UseTemplateModal, ConfigureStepForm, StepIndicator, JsonPreview, WorkflowPreview, NodeTerminalPanel, and TerminalDockPanel.

## Skills

Load before starting: testing-patterns

## Subtasks

### templates/ — simpler components (start here)

- [x] Create `frontend/src/features/templates/__tests__/StepIndicator.test.tsx` — test renders correct number of steps from `PUBLISH_STEPS`; test current step is highlighted; test completed steps show check icon; test future steps show muted styling
- [x] Create `frontend/src/features/templates/__tests__/JsonPreview.test.tsx` — test renders collapsed by default when `defaultOpen` is false; test expands on click to show JSON content; test copy button fires `onCopy` callback; test copied state shows checkmark icon; test displays formatted size badge
- [x] Create `frontend/src/features/templates/__tests__/WorkflowPreview.test.tsx` — test renders SVG with correct number of node rectangles from mock graph; test renders edges between connected nodes; test handles empty graph gracefully (no nodes/edges); test className prop is applied

### templates/ — form and modal components

- [x] Create `frontend/src/features/templates/__tests__/ConfigureStepForm.test.tsx` — test renders all form fields (name, description, category, tags, author); test submit fires `onSubmit` callback; test error message displays when `error` prop is set; test tag add/remove interactions; test loading state disables submit button
- [x] Create `frontend/src/features/templates/__tests__/UseTemplateModal.test.tsx` — test dialog renders with template name; test name input is pre-filled with "{template.name} - Copy"; test secret mapping fields render for templates with `requiredSecrets`; test submit fires mutation; test error state displays alert
- [x] Create `frontend/src/features/templates/__tests__/PublishTemplateModal.test.tsx` — mock `useTemplates` query hook; test dialog renders with StepIndicator at "configure" step; test step navigation progresses through configure → review → publish → done; test configure step renders ConfigureStepForm; test close fires `onOpenChange(false)`

### terminal/ components

- [x] Create `frontend/src/components/terminal/__tests__/NodeTerminalPanel.test.tsx` — mock `useXterm` hook and `useTimelineTerminalStream`; test panel renders with node ID header; test close button fires `onClose` callback; test copy and download buttons render; test embedded mode removes border/shadow styling
- [x] Create `frontend/src/components/terminal/__tests__/TerminalDockPanel.test.tsx` — mock `useWorkflowUiStore` to return docked terminals; test renders tab bar with terminal names; test clicking a tab switches active terminal; test collapse/expand toggle works; test close button removes terminal from dock; test empty state renders nothing

### Validation

- [x] Run all new tests and verify 0 failures

## Notes

- `StepIndicator`, `JsonPreview`, and `WorkflowPreview` are pure presentational components with simple props — easiest to test
- `ConfigureStepForm` has 18 props — create a `createDefaultProps()` factory
- `UseTemplateModal` uses `useUseTemplate` mutation hook — mock `@/hooks/queries/useTemplateQueries`
- `PublishTemplateModal` uses `fetch` internally for API calls — mock `getApiAuthHeaders` and the fetch call
- Terminal components depend on `useXterm` (xterm.js wrapper) — mock the entire hook to return `{ containerRef, terminalRef, fitAddonRef, isTerminalReady: true, isXtermLoaded: true }`
- `TerminalDockPanel` reads from `useWorkflowUiStore` (docked terminals, active ID, panel height, collapsed state) — mock with realistic defaults
- `WorkflowPreview` is pure SVG rendering with no external dependencies — test by checking SVG element count matches node/edge count

## Completion Summary

<!-- Appended by orchestrator after agent completes. Do not fill manually. -->
