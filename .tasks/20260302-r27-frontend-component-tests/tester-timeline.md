# Agent: tester-timeline

## Purpose

Write component tests for 9 timeline/execution components: ExecutionTimeline, ExecutionInspector, NodeIOInspector, RunSelector, RunInfoDisplay, PlaybackControls, TimelineTrack, EventCard, and AgentRunCard.

## Skills

Load before starting: testing-patterns

## Subtasks

### Simpler presentational components (start here)

- [ ] Create `frontend/src/components/timeline/__tests__/RunInfoDisplay.test.tsx` — test renders run start time, event count, and duration; test status badge shows correct variant for running/completed/failed; test version mismatch indicator when run version differs from current workflow version; test live indicator shows when run is live
- [ ] Create `frontend/src/components/timeline/execution-timeline/__tests__/PlaybackControls.test.tsx` — test play/pause button toggles state via callback; test step-forward and step-backward buttons fire callbacks; test speed selector dropdown shows available speeds and fires onSpeedChange; test "Go Live" button appears in live mode; test heat map and smart routing toggle buttons
- [ ] Create `frontend/src/components/timeline/execution-timeline/__tests__/TimelineTrack.test.tsx` — test track renders event markers at correct positions; test playhead renders in replay mode; test mouse-down on track fires onMouseDown; test wheel event fires onWheel for zoom; test agent markers render when provided
- [ ] Create `frontend/src/components/timeline/event-inspector/__tests__/EventCard.test.tsx` — test renders event type icon and message preview; test expand/collapse toggle shows full payload; test selected state styling; test "full message" button appears for long messages; test diagnostics button fires callback

### Store-dependent components

- [ ] Create `frontend/src/components/timeline/__tests__/ExecutionTimeline.test.tsx` — mock `useExecutionTimelineStore` with factory defaults; test timeline renders PlaybackControls, TimelineTrack, and TimelineOverview; test no-render when `showTimeline` is false; test live mode shows "Go Live" affordance
- [ ] Create `frontend/src/components/timeline/__tests__/RunSelector.test.tsx` — mock `useWorkflowRuns` to return a list of runs; test dropdown renders run list with status badges; test selecting a run fires navigation; test trigger filter tabs (all/manual/schedule) filter the list; test "load more" button appears when hasMore is true
- [ ] Create `frontend/src/components/timeline/__tests__/NodeIOInspector.test.tsx` — mock `useExecutionNodeIO` to return sample input/output data; test renders input and output sections for selected node; test loading state shows spinner; test truncated data shows "view full" button; test empty state when no node is selected
- [ ] Create `frontend/src/components/timeline/__tests__/ExecutionInspector.test.tsx` — mock stores and query hooks; test renders RunSelector and ExecutionTimeline; test tab navigation between Events, Artifacts, Agent Trace, Network, Node I/O panels; test stop/rerun action buttons render for appropriate run states

### Complex component

- [ ] Create `frontend/src/components/timeline/agent-trace/__tests__/AgentRunCard.test.tsx` — mock `useAgentTranscript` and `useChat` from `@ai-sdk/react`; test renders agent run with loading state; test renders transcript messages when data is available; test selected state highlights the card; test live indicator when `live` prop is true

### Validation

- [ ] Run all new tests and verify 0 failures

## Notes

- Most timeline components read from `useExecutionTimelineStore` — mock with `mock.module` returning a function that accepts a selector and returns default values
- `PlaybackControls` and `TimelineTrack` are pure presentational — all state is passed via props, making them easy to test
- `RunInfoDisplay` is a small presentational component (95 lines) — good warm-up
- `RunSelector` uses `useWorkflowRuns` (TanStack Query), `useNavigate` (react-router), and multiple stores — mock all at module level
- `AgentRunCard` uses `@ai-sdk/react` `useChat` hook — mock the entire module to return static messages
- `ExecutionInspector` is 597 lines and orchestrates many sub-panels — focus on high-level rendering and tab switching, not deep child behavior

## Completion Summary

<!-- Appended by orchestrator after agent completes. Do not fill manually. -->
