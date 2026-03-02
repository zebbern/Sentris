# Agent: tester

## Purpose

Write component tests for four untested frontend directories: `workflow/`, `timeline/`, `templates/`, and `terminal/`.

## Skills

Load before starting: testing-patterns

## Subtasks

### workflow/ components (`frontend/src/components/workflow/`)

- [ ] Create `frontend/src/components/workflow/__tests__/Canvas.test.tsx` — test canvas rendering, node placement, zoom controls; mock ReactFlow
- [ ] Create `frontend/src/components/workflow/__tests__/ConfigPanel.test.tsx` — test panel opening/closing, tab switching, content rendering for different node types
- [ ] Create `frontend/src/components/workflow/__tests__/WorkflowNode.test.tsx` — test node rendering with different component types, status badges, port display, selection state
- [ ] Create `frontend/src/components/workflow/__tests__/ComponentBadge.test.tsx` — test badge rendering for different component categories, tooltip content
- [ ] Create `frontend/src/components/workflow/__tests__/ValidationDock.test.tsx` — test validation message display, error/warning counts, click-to-navigate
- [ ] Create `frontend/src/components/workflow/__tests__/RunWorkflowDialog.test.tsx` — test dialog open/close, runtime input rendering, submit behavior
- [ ] Create `frontend/src/components/workflow/__tests__/ConnectionLine.test.tsx` — test connection line rendering between nodes
- [ ] Create `frontend/src/components/workflow/__tests__/EdgeContextMenu.test.tsx` — test context menu appearance and action handlers
- [ ] Create `frontend/src/components/workflow/__tests__/HeatMapLegend.test.tsx` — test legend rendering with different data ranges
- [x] Create `frontend/src/components/workflow/__tests__/WorkflowSchedulesPanel.test.tsx` — test schedule list rendering, create/edit/delete actions
- [ ] Create `frontend/src/components/workflow/__tests__/WorkflowWebhooksPanel.test.tsx` — test webhook list rendering, create/edit actions

### workflow/node/ subcomponents (`frontend/src/components/workflow/node/`)

- [ ] Create `frontend/src/components/workflow/node/__tests__/NodeHeader.test.tsx` — test header rendering with component name, icon, status indicator
- [ ] Create `frontend/src/components/workflow/node/__tests__/NodeInputPorts.test.tsx` — test input port rendering, connection indicators, port labels
- [ ] Create `frontend/src/components/workflow/node/__tests__/NodeOutputPorts.test.tsx` — test output port rendering, connection indicators
- [ ] Create `frontend/src/components/workflow/node/__tests__/NodeStatusSection.test.tsx` — test status display for running/completed/failed/pending states
- [x] Create `frontend/src/components/workflow/node/__tests__/NodeProgressBar.test.tsx` — test progress bar rendering with different percentages
- [ ] Create `frontend/src/components/workflow/node/__tests__/TextBlockContent.test.tsx` — test text block markdown rendering, edit mode

### timeline/ components (`frontend/src/components/timeline/`)

- [ ] Create `frontend/src/components/timeline/__tests__/ExecutionTimeline.test.tsx` — test timeline rendering with mock execution data, node status markers
- [ ] Create `frontend/src/components/timeline/__tests__/RunSelector.test.tsx` — test run list rendering, selection behavior, status indicators
- [ ] Create `frontend/src/components/timeline/__tests__/RunInfoDisplay.test.tsx` — test run metadata display: duration, status, timestamps
- [ ] Create `frontend/src/components/timeline/__tests__/RunBreadcrumbs.test.tsx` — test breadcrumb rendering and navigation links
- [ ] Create `frontend/src/components/timeline/__tests__/NodeIOInspector.test.tsx` — test input/output display for selected nodes
- [ ] Create `frontend/src/components/timeline/__tests__/EventInspector.test.tsx` — test event detail rendering, diagnostics dialog trigger
- [ ] Create `frontend/src/components/timeline/__tests__/AgentTracePanel.test.tsx` — test agent trace rendering, transcript timeline, expandable text
- [ ] Create `frontend/src/components/timeline/__tests__/NetworkPanel.test.tsx` — test network request list, timing bars, request detail view

### timeline/ subcomponents

- [ ] Create `frontend/src/components/timeline/execution-timeline/__tests__/PlaybackControls.test.tsx` — test play/pause/step controls, speed selector
- [ ] Create `frontend/src/components/timeline/execution-timeline/__tests__/TimelineTrack.test.tsx` — test track rendering with node segments, click-to-select
- [ ] Create `frontend/src/components/timeline/execution-timeline/__tests__/TimelineStatusBar.test.tsx` — test status bar with aggregate execution info
- [ ] Create `frontend/src/components/timeline/event-inspector/__tests__/EventCard.test.tsx` — test event card rendering with different event types
- [ ] Create `frontend/src/components/timeline/agent-trace/__tests__/AgentRunCard.test.tsx` — test agent run card with status, duration, tool calls
- [ ] Create `frontend/src/components/timeline/agent-trace/__tests__/AgentTranscriptTimeline.test.tsx` — test transcript step rendering, expandable sections
- [ ] Create `frontend/src/components/timeline/network/__tests__/HeadersTable.test.tsx` — test header key-value rendering
- [ ] Create `frontend/src/components/timeline/network/__tests__/TimingBar.test.tsx` — test timing visualization with different durations

### templates/ components (`frontend/src/features/templates/` and `frontend/src/pages/template-library/`)

- [ ] Create `frontend/src/features/templates/__tests__/PublishTemplateModal.test.tsx` — test modal open/close, step navigation, form validation
- [ ] Create `frontend/src/features/templates/__tests__/ConfigureStepForm.test.tsx` — test form field rendering, input validation, default values
- [ ] Create `frontend/src/features/templates/__tests__/ReviewStep.test.tsx` — test review summary rendering, back/submit actions
- [ ] Create `frontend/src/features/templates/__tests__/PublishStep.test.tsx` — test publish confirmation, success/error states
- [ ] Create `frontend/src/features/templates/__tests__/StepIndicator.test.tsx` — test step indicator active/completed/pending states
- [ ] Create `frontend/src/features/templates/__tests__/WorkflowPreview.test.tsx` — test workflow preview rendering with mock workflow data
- [ ] Create `frontend/src/features/templates/__tests__/UseTemplateModal.test.tsx` — test modal open/close, template application flow
- [ ] Create `frontend/src/pages/template-library/__tests__/TemplateCard.test.tsx` — test card rendering with template metadata, click behavior
- [ ] Create `frontend/src/pages/template-library/__tests__/TemplateDetailModal.test.tsx` — test detail modal content, use/close actions
- [ ] Create `frontend/src/pages/template-library/__tests__/TemplateFilters.test.tsx` — test filter rendering, selection, clearing

### terminal/ components (`frontend/src/components/terminal/`)

- [ ] Create `frontend/src/components/terminal/__tests__/TerminalDockPanel.test.tsx` — test dock panel rendering, expand/collapse, terminal tab management
- [ ] Create `frontend/src/components/terminal/__tests__/NodeTerminalPanel.test.tsx` — test per-node terminal rendering, output display
- [ ] Create `frontend/src/components/terminal/__tests__/terminal-utils.test.ts` — test terminal utility functions (ANSI parsing, output formatting, etc.)

### Final validation

- [ ] Run all new tests: `bun test frontend/src/components/workflow/__tests__/ frontend/src/components/timeline/__tests__/ frontend/src/features/templates/__tests__/ frontend/src/pages/template-library/__tests__/ frontend/src/components/terminal/__tests__/`
- [ ] Verify all tests pass with 0 failures
- [ ] Verify no existing tests are broken by checking `bun test frontend/`

## Notes

- Use `bun:test` imports (`describe`, `it`, `expect`, `mock`, `beforeEach`, `afterEach`), NOT vitest
- Use `@testing-library/react` for rendering — follow patterns in existing tests like `frontend/src/pages/__tests__/DashboardPage.test.tsx`
- Call `cleanup()` in `afterEach` to prevent test isolation issues
- For ReactFlow-dependent components (Canvas, WorkflowNode, ConnectionLine), mock `@xyflow/react` at the module level
- For xterm-dependent components (terminal/), mock `@xterm/xterm` at the module level
- For components that use Zustand stores, mock the store module
- For components that use TanStack Query, wrap in a test `QueryClientProvider`
- The existing test `frontend/src/components/workflow/__tests__/WorkflowNode.text-block.test.tsx` is a good reference for workflow component test patterns
- Read the source file for each component before writing its test to understand props interfaces, dependencies, and edge cases
- Each test file should have 5–10 focused test cases covering: default render, props variations, user interactions, edge cases, and error states

## Completion Summary

<!-- Appended by orchestrator after agent completes. Do not fill manually. -->
