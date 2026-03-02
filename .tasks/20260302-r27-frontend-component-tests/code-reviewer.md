# Agent: code-reviewer

## Purpose

Review all new component test files created by the three tester agents for quality, coverage adequacy, and adherence to project testing conventions.

## Skills

Load before starting: testing-patterns

## Subtasks

### Workflow test files

- [ ] Review `frontend/src/components/workflow/__tests__/WorkflowNode.test.tsx` — check mock completeness, assertion quality, edge cases covered
- [ ] Review `frontend/src/components/workflow/__tests__/ConfigPanel.test.tsx` — check prop factory pattern, meaningful assertions, no testing of implementation details
- [ ] Review `frontend/src/components/workflow/__tests__/ValidationDock.test.tsx` — check validation scenario coverage, click handler assertions
- [ ] Review `frontend/src/components/workflow/__tests__/RunWorkflowDialog.test.tsx` — check form validation testing, submit behavior assertions
- [ ] Review `frontend/src/components/workflow/__tests__/EdgeContextMenu.test.tsx` — check keyboard and mouse interaction coverage
- [ ] Review `frontend/src/components/workflow/node/__tests__/NodeHeader.test.tsx` — check status state coverage
- [ ] Review `frontend/src/components/workflow/node/__tests__/NodeInputPorts.test.tsx` — check port rendering assertions
- [ ] Review `frontend/src/components/workflow/node/__tests__/NodeOutputPorts.test.tsx` — check port rendering assertions

### Timeline test files

- [ ] Review `frontend/src/components/timeline/__tests__/ExecutionTimeline.test.tsx` — check store mock pattern, conditional rendering tests
- [ ] Review `frontend/src/components/timeline/__tests__/ExecutionInspector.test.tsx` — check tab switching coverage, action button state tests
- [ ] Review `frontend/src/components/timeline/__tests__/NodeIOInspector.test.tsx` — check data display assertions, loading/empty states
- [ ] Review `frontend/src/components/timeline/__tests__/RunSelector.test.tsx` — check dropdown interaction, filter behavior
- [ ] Review `frontend/src/components/timeline/__tests__/RunInfoDisplay.test.tsx` — check metadata rendering, badge variants
- [ ] Review `frontend/src/components/timeline/execution-timeline/__tests__/PlaybackControls.test.tsx` — check control callback assertions
- [ ] Review `frontend/src/components/timeline/execution-timeline/__tests__/TimelineTrack.test.tsx` — check marker positioning, interaction handlers
- [ ] Review `frontend/src/components/timeline/event-inspector/__tests__/EventCard.test.tsx` — check event type variants
- [ ] Review `frontend/src/components/timeline/agent-trace/__tests__/AgentRunCard.test.tsx` — check AI SDK mock correctness

### Templates + terminal test files

- [ ] Review `frontend/src/features/templates/__tests__/PublishTemplateModal.test.tsx` — check step navigation coverage
- [ ] Review `frontend/src/features/templates/__tests__/UseTemplateModal.test.tsx` — check mutation mock, error state
- [ ] Review `frontend/src/features/templates/__tests__/ConfigureStepForm.test.tsx` — check form field coverage, validation
- [ ] Review `frontend/src/features/templates/__tests__/StepIndicator.test.tsx` — check step state variants
- [ ] Review `frontend/src/features/templates/__tests__/JsonPreview.test.tsx` — check expand/collapse, copy interaction
- [ ] Review `frontend/src/features/templates/__tests__/WorkflowPreview.test.tsx` — check SVG rendering assertions
- [ ] Review `frontend/src/components/terminal/__tests__/NodeTerminalPanel.test.tsx` — check xterm mock pattern, lifecycle
- [ ] Review `frontend/src/components/terminal/__tests__/TerminalDockPanel.test.tsx` — check tab management, resize

### Cross-cutting checks

- [ ] Verify all tests use `bun:test` imports (not vitest/jest) consistent with existing test files
- [ ] Check for proper `cleanup` calls or `afterEach` to prevent test state leakage
- [ ] Check no tests assert on implementation details (store internal state, CSS class names as primary assertions)
- [ ] Check for `any` type usage that should be properly typed in test mocks/fixtures
- [ ] Compile findings with severity: S0 (test bugs/false passes), S1 (missing coverage), S2 (style/minor)

## Notes

- This is a READ-ONLY review — do not modify any source files
- The reference test pattern is `frontend/src/components/workflow/__tests__/WorkflowNode.text-block.test.tsx`
- Key things to watch: mocks that are too loose (always passing), missing error case tests, tests that test the mock rather than the component
- Verify provider wrappers match what components actually need (ReactFlowProvider, MemoryRouter, QueryClientProvider)
- Flag any flaky test patterns: reliance on timing, non-deterministic data, animation-dependent assertions

## Completion Summary

<!-- Appended by orchestrator after agent completes. Do not fill manually. -->
