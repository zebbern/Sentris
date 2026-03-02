# Agent: tester-workflow

## Purpose

Write component tests for 8 workflow builder components: the core WorkflowNode, ConfigPanel, ValidationDock, RunWorkflowDialog, and 4 node subcomponents (NodeHeader, NodeInputPorts, NodeOutputPorts, EdgeContextMenu).

## Skills

Load before starting: testing-patterns

## Subtasks

### Setup

- [ ] Review the existing test at `frontend/src/components/workflow/__tests__/WorkflowNode.text-block.test.tsx` for patterns: provider wrappers, mock data shapes, assertion style
- [ ] Create a shared test helper (or inline per file) for wrapping components in required providers: `ReactFlowProvider`, `MemoryRouter`, `QueryClientProvider`

### workflow/node/ subcomponents

- [ ] Create `frontend/src/components/workflow/node/__tests__/NodeHeader.test.tsx` — test header renders component name and icon; test status indicator shows correct icon/color for running, completed, failed states; test click handler fires when header is clickable
- [ ] Create `frontend/src/components/workflow/node/__tests__/NodeInputPorts.test.tsx` — test renders correct number of input ports from props; test connection indicator styling for connected vs unconnected ports; test port labels display
- [ ] Create `frontend/src/components/workflow/node/__tests__/NodeOutputPorts.test.tsx` — test renders correct number of output ports; test connected vs unconnected styling; test port labels
- [ ] Create `frontend/src/components/workflow/__tests__/EdgeContextMenu.test.tsx` — test menu renders at specified position; test delete/insert-node/highlight-path callbacks fire on click; test menu closes on Escape key and click-outside; test disabled state when not in design mode

### workflow/ core components

- [ ] Create `frontend/src/components/workflow/__tests__/WorkflowNode.test.tsx` — test node renders with component name and category badge; test node shows status section when in execution mode; test selected state styling; test entry-point node renders entry-point body instead of parameters
- [ ] Create `frontend/src/components/workflow/__tests__/ConfigPanel.test.tsx` — test panel renders component info section for a selected node; test panel renders parameter fields; test onClose callback fires when close is clicked; test loading state when component data is not yet available
- [ ] Create `frontend/src/components/workflow/__tests__/ValidationDock.test.tsx` — test displays validation issues with node names and messages; test click on an issue calls onNodeClick with correct nodeId; test shows "all valid" state when no issues exist; test expand/collapse behavior when issues exceed threshold
- [ ] Create `frontend/src/components/workflow/__tests__/RunWorkflowDialog.test.tsx` — test dialog renders runtime input fields from props; test required field validation prevents submit; test file upload input renders for file-type inputs; test onRun callback receives correct input values on submit

### Validation

- [ ] Run all new tests and verify 0 failures

## Notes

- Mock Zustand stores (`useWorkflowStore`, `useExecutionTimelineStore`, `useWorkflowUiStore`, `useThemeStore`) at module level with `mock.module` or `vi.mock`
- Mock `useComponents` (TanStack Query hook) to return a static component index
- For WorkflowNode, wrap in `ReactFlowProvider` — the node uses `useReactFlow` internally
- The existing `WorkflowNode.text-block.test.tsx` shows the exact provider wrapping pattern and mock data shapes to follow
- EdgeContextMenu is a pure presentational component with simple props — straightforward to test without heavy mocking
- ConfigPanel has 13+ props — create a `createDefaultProps()` factory to reduce boilerplate

## Completion Summary

<!-- Appended by orchestrator after agent completes. Do not fill manually. -->
