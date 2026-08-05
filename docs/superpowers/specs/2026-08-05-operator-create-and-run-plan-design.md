# Operator Create-and-Run Plan Design

## Goal

Allow one explicit request to create a workflow and run it to continue through reviewable draft creation, saving, and launch without introducing a second orchestration path.

## Decision

Reuse the existing immutable Operator plan journey. Add `propose_workflow_from_template` to the bounded set of commands allowed in a three-to-eight-step plan. When the user explicitly asks to both create and run a new workflow, the model should first discover an exact maintained template, then propose this three-step plan:

1. `propose_workflow_from_template` with the selected template ID and exact non-secret runtime defaults.
2. `apply_workflow_draft`, binding `/draftId` from step 1 into `/draftId`.
3. `run_workflow`, binding `/workflowId` and `/versionId` from step 2 and supplying runtime inputs keyed by the exact IDs returned by template discovery.

The existing Run plan control starts the durable plan journey. Ask/Auto approval behavior remains unchanged. A rejection or authoritative action failure stops later steps. The existing action ledger, stable step IDs, run event pipeline, and result summary remain canonical.

## Alternatives Rejected

- Continuing the generic model loop after every draft would make ordinary review-only authoring less predictable and could reintroduce duplicate or improvised actions.
- A new `create_and_run_workflow` command or dedicated executor would duplicate the established proposal, apply, approval, and run boundaries.

## Compatibility

No existing plan history changes because stored plans contain exact command names and arguments. The new command is additive. The proposal is still unsaved and non-consequential; saving retains its existing consequential classification.

## Failure Handling

Plan schema validation rejects missing or conflicting bindings before persistence. At execution time, an invalid draft, rejected save, invalid runtime input, or failed launch stops the plan and records the exact failed step. No later action runs.

## Verification

- A shared-contract test must prove that a template proposal can be followed by bound apply and run steps and that both IDs resolve from the exact earlier results.
- Focused shared and worker tests must pass.
- A real browser/Gemini request must produce the three-step plan, allow the user to run it through approval, and visibly launch the exact saved workflow version.
