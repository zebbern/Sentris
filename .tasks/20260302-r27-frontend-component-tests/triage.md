# Triage: Round 27 — Frontend Component Tests

## EXECUTION_PLAN

### Steps (3 parallel testers + 1 reviewer)

| Order | Agent                     | Task Summary                                                                                                                                                       |
| ----- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1a    | tester-workflow           | Workflow core + node subcomponents: WorkflowNode, ConfigPanel, ValidationDock, RunWorkflowDialog, NodeHeader, NodeInputPorts, NodeOutputPorts, EdgeContextMenu     |
| 1b    | tester-timeline           | Timeline components: ExecutionTimeline, ExecutionInspector, NodeIOInspector, RunSelector, RunInfoDisplay, PlaybackControls, TimelineTrack, EventCard, AgentRunCard |
| 1c    | tester-templates-terminal | Templates + terminal: PublishTemplateModal, UseTemplateModal, ConfigureStepForm, StepIndicator, JsonPreview, WorkflowPreview, NodeTerminalPanel, TerminalDockPanel |
| 2     | code-reviewer             | Review all new component test files                                                                                                                                |

### Parallel Groups

- Group 1: Steps 1a, 1b, 1c (parallel)
- Group 2: Step 2 (after all Step 1 agents complete)
