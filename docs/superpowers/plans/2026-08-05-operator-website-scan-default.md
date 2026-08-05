# Template-backed Operator Workflow Authoring Plan

**Goal:** Make common workflow-creation requests—starting with an authorized website security scan—produce a compile-valid, reviewable draft from the maintained Template Library instead of asking the model to regenerate a large graph.

**Architecture:** Add two typed Operator commands. `list_workflow_templates` returns a bounded catalog with exact runtime-input descriptors. `propose_workflow_from_template` materializes one active template through `TemplateService`, applies validated non-secret runtime defaults, and stores the exact credential-safe graph snapshot in the existing Operator draft action. The existing compiler, draft detail, Builder hydration, apply boundary, and run boundary remain canonical. Freeform `propose_workflow_draft` stays available only when no suitable template exists.

**Success criteria:**

- A broad website-scan request with a supplied target selects a suitable official template and creates a compile-valid unsaved draft.
- The supplied target is placed only into an exact declared runtime input and survives opening the draft in Builder.
- Unknown, mistyped, or secret runtime defaults are rejected.
- Template proposal does not create a workflow, increment popularity, or launch a run.
- The exact proposed graph remains stable even if the source template changes after proposal.

## Tasks

1. Add shared schemas and command definitions for bounded template discovery and template-backed proposals.
2. Factor TemplateService's graph preparation into one non-saving materialization method shared by the existing Use Template flow and Operator.
3. Wire the commands through OperatorCommandService and the existing OperatorWorkflowAuthoringService draft lifecycle.
4. Update the Operator prompt to prefer a matching maintained template, with freeform authoring as the fallback.
5. Update the Operator architecture record, run focused contract tests/type checks, then verify the real Operator-to-Builder journey in the browser without saving or running it.
