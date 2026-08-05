# Operator Input-Change Contract Design

**Status:** Ready for review
**Date:** 2026-08-05

## Problem

The live `Change inputs` journey eventually produced the correct reviewed proposal, but Gemini
needed three `propose_run_input_changes` calls. The first supplied a number where a change object
was required; the second used an unsupported operation; only the third matched the current
`set`/`unset` discriminated union.

This is a model-facing contract problem, not a missing retry. The existing durable loop correctly
returned validation evidence and let the model repair its call, but users paid the latency and saw
two provider-formatting failures before the useful result. Gemini's current function-calling
guidance recommends strong, simple parameter types and notes that only a subset of OpenAPI schema
is supported: <https://ai.google.dev/gemini-api/docs/function-calling>.

## Goals

- Give every model provider one shallow, unambiguous input-change shape.
- Keep proposal review and launch as separate actions.
- Continue validating exact runtime-input IDs, values, secrets, immutable versions, and source
  scope at the canonical backend boundary.
- Preserve repaired model attempts for diagnostics without presenting them as primary product
  actions.
- Keep one shared contract from tool declaration through proposal storage and launch.

## Non-goals

- Provider-specific argument rewriting or accepting synonyms such as `replace`.
- Hiding real execution failures.
- Automatically launching a proposal.
- Changing the Temporal command sequence or adding another Operator executor.

## Considered Approaches

### 1. One canonical `set`/`unset` object (selected)

Replace the discriminated array with one shared value:

```ts
{
  set: [{ inputId: 'liveUrls', value: ['https://example.com/'] }],
  unset: ['scanIntensity'],
}
```

This removes the `anyOf`-shaped per-item union while preserving explicit set and unset semantics.
It is provider-neutral, strongly typed, and can be used unchanged by proposal and launch.

### 2. Keep the union and add examples

This is a smaller diff, but the ambiguous union remains in the generated tool schema. Prompt
examples may reduce failures for one model without fixing the contract for other providers.

### 3. Normalize malformed provider arguments

Mapping guessed values such as `replace` to `set` would make the backend permissive and
provider-aware. It can silently reinterpret intent and creates a second behavior path, so it is
rejected.

## Canonical Contract

`OperatorRunInputChangesSchema` becomes a strict object with:

- `set`: required array of strict `{ inputId, value }` objects; use `[]` when no values are set.
- `unset`: required array of runtime-input IDs; use `[]` when no values are removed.
- At least one operation and at most twenty operations in total.
- Unique IDs within each list and no ID present in both lists.

`propose_run_input_changes` accepts `{ sourceRunId, inputChanges }`.
`run_workflow.inputChanges` uses the same schema. The proposal result stores the same canonical
object, while its existing materialized `changes` list remains the read-only diff rendered to the
user.

The backend materializer applies `set` entries, then `unset` IDs, validates the resulting complete
runtime-input object, and rejects unknown IDs, secret inputs, invalid values, missing required
inputs, duplicates, overlaps, and no-op proposals exactly once at the existing command boundary.

## Durable and Compatibility Behavior

The Workflow still schedules the same model, prepare, and execute Activities in the same order.
Only Activity-produced command arguments and Activity implementation parsing change, so no
Temporal Workflow patch is required. Completed Activity results remain in history and are not
re-executed.

Before landing the migration, active `operatorTurnWorkflow` executions must be allowed to finish
or be cancelled in the local verification instance. No permanent legacy parser will be added; the
repository is not carrying two model-facing schemas. The generated backend client is updated in
the same commit.

## Recovered Attempt Presentation

Within one turn, an argument-validation failure is considered recovered only when a later action
with the same command succeeds. The successful action remains the primary timeline item. Earlier
recovered validation failures move under an expandable `Recovered attempts` disclosure with their
original error text intact.

Execution failures, approval rejections, cancellations, and failures without a later success stay
fully visible. This is presentation-only; the durable action ledger remains unchanged.

## Verification

Automated checks should prove:

- The shared schema accepts set-only, unset-only, and combined requests.
- It rejects empty requests, duplicates, overlaps, secret mutation, and more than twenty total
  operations.
- Proposal and launch consume the same canonical object and preserve immutable version, stored
  secrets, and source scope.
- A recovered validation failure is collapsed only when a later same-command action succeeds.
- An unrecovered or execution failure remains prominent.

Real browser verification on instance 0 must cover:

1. A `Change inputs` set proposal that renders a review card and does not launch a run.
2. An unset proposal for an optional declared input.
3. Launching one reviewed proposal and confirming the exact stored source version, scope, and
   resulting runtime inputs.

## Success Criteria

- Normal Gemini set and unset journeys use the new contract without union-operation errors.
- The user sees the successful reviewed proposal as the primary outcome.
- Audit evidence remains available.
- There is one canonical schema and no provider-specific compatibility layer.
