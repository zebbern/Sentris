# Operator Create-and-Run Plan Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an explicit new-workflow create-and-run request use the existing durable three-step Operator plan journey.

**Architecture:** Extend the canonical plan command union with the existing template-backed proposal command. Guide the model to emit draft → apply → run with RFC 6901 bindings after exact template discovery; keep execution, approval, failure stopping, and summaries in the current plan workflow.

**Tech Stack:** TypeScript, Zod, Bun test, Temporal TypeScript SDK, Vercel AI SDK.

## Global Constraints

- Work on the user-approved `main` branch but do not commit or push until explicitly requested.
- Keep existing Workflow histories replay-safe; do not add a second executor or new Activity sequence.
- Use the existing typed action ledger and Ask/Auto approval behavior.
- Preserve the user-owned untracked `Agent Pipeline Live v4.dc.html` file.

---

### Task 1: Permit and guide the canonical create-and-run plan

**Files:**

- Modify: `packages/shared/src/operator.ts`
- Modify: `packages/shared/src/__tests__/operator.test.ts`
- Modify: `worker/src/temporal/activities/operator.activity.ts`

**Interfaces:**

- Consumes: `OperatorProposeWorkflowFromTemplateInputSchema`, `OperatorWorkflowDraftResultSchema`, `OperatorWorkflowApplyResultSchema`, `OperatorRunWorkflowInputSchema`, and `resolveOperatorPlanStepArguments()`.
- Produces: `OperatorPlanCommandName` support for `propose_workflow_from_template` and model guidance for a three-step template draft/apply/run plan.

- [x] **Step 1: Write the failing shared-contract test**

Add a test in `describe('Operator durable plans')` that parses the literal plan below and resolves the apply and run arguments from hand-written prior results:

```ts
const steps = OperatorProposePlanInputSchema.parse({
  title: 'Create and run website scan',
  steps: [
    {
      id: 'draft',
      label: 'Prepare workflow draft',
      commandName: 'propose_workflow_from_template',
      arguments: {
        templateId: '11111111-1111-4111-8111-111111111111',
        runtimeInputDefaults: { liveUrls: ['https://example.com'] },
      },
    },
    {
      id: 'save',
      label: 'Save workflow version',
      commandName: 'apply_workflow_draft',
      arguments: {},
      bindings: [{ sourceStepId: 'draft', sourcePointer: '/draftId', targetPointer: '/draftId' }],
    },
    {
      id: 'run',
      label: 'Run saved workflow',
      commandName: 'run_workflow',
      arguments: { inputs: { liveUrls: ['https://example.com'] } },
      bindings: [
        { sourceStepId: 'save', sourcePointer: '/workflowId', targetPointer: '/workflowId' },
        { sourceStepId: 'save', sourcePointer: '/versionId', targetPointer: '/versionId' },
      ],
    },
  ],
}).steps;
```

Assert that resolving `save` yields only the exact `draftId`, and resolving `run` yields the exact `workflowId`, `versionId`, and literal `inputs`.

- [x] **Step 2: Run the test and confirm the missing command fails**

Run:

```powershell
bun --cwd=packages/shared test src/__tests__/operator.test.ts
```

Expected: FAIL because `propose_workflow_from_template` is not yet a valid `OperatorPlanCommandName`.

- [x] **Step 3: Add the existing template proposal to the plan contract**

In `packages/shared/src/operator.ts`, add `propose_workflow_from_template` beside `propose_workflow_draft` in `OPERATOR_PLAN_COMMAND_NAMES` and map it to `OperatorProposeWorkflowFromTemplateInputSchema` in `OPERATOR_PLAN_COMMAND_SCHEMAS`. Do not change plan execution or effect classification.

- [x] **Step 4: Run the shared-contract test and confirm it passes**

Run:

```powershell
bun --cwd=packages/shared test src/__tests__/operator.test.ts
```

Expected: PASS.

- [x] **Step 5: Guide the model to use the canonical plan**

In `worker/src/temporal/activities/operator.activity.ts`, extend the new-workflow/template instruction with this behavior:

```text
When the user explicitly asks to create and run a new workflow, discover the exact template first, then propose one three-step plan: propose_workflow_from_template, apply_workflow_draft with draftId bound from the proposal result, and run_workflow with workflowId/versionId bound from the apply result. Use the same exact runtime-input IDs and values for the template defaults and run inputs. Do not emit the standalone workflow proposal before this plan.
```

Keep review-only workflow requests on the existing standalone proposal path.

- [x] **Step 6: Run focused worker and shared verification**

Run:

```powershell
bun --cwd=packages/shared test src/__tests__/operator.test.ts
bun --cwd=worker test src/temporal/activities/__tests__/operator.activity.test.ts src/temporal/workflows/__tests__/operator-turn-workflow.test.ts
bun --cwd=packages/shared run typecheck
bun --cwd=worker run typecheck
```

Expected: all commands pass without warnings introduced by this change.

- [x] **Step 7: Verify the real user journey in the browser**

On active instance 0, create a fresh Operator chat and ask it to create and run a vulnerability-scanning workflow against `http://scanme.nmap.org/`. Confirm the UI shows one three-step plan (template proposal, save, run), Run plan executes through the existing approval interaction, and the launched run link opens a run for the exact workflow/version created by step 2.

- [x] **Step 8: Review the diff and stop before git publication**

Run `git diff --check` and `git status -sb`. Confirm only the shared contract, its lasting behavior test, the model instruction, and these design/plan records changed. Do not stage, commit, or push until the user asks.

### Task 2: Reject misleading refusal text from successful compact summaries

**Files:**

- Modify: `worker/src/temporal/activities/operator.activity.ts`
- Modify: `worker/src/temporal/activities/__tests__/operator.activity.test.ts`

**Interfaces:**

- Consumes: the existing `isCapabilityRefusal()` classifier and the Workflow's existing empty-summary fallback.
- Produces: an empty compact-summary text result when a provider refuses to summarize already-successful durable actions.

- [x] **Step 1: Reproduce the real browser failure with a focused activity test**

The test supplies a successful `run_workflow` ledger result in `plan_summary` mode and a refusal-shaped model response, then expects the activity to return empty text so the deterministic Workflow fallback remains authoritative.

- [x] **Step 2: Confirm the test fails against the misleading refusal**

Run:

```powershell
bun --cwd=worker test src/temporal/activities/__tests__/operator.activity.test.ts --test-name-pattern "drops a capability refusal"
```

Expected before the fix: FAIL because the refusal text is returned.

- [x] **Step 3: Apply the existing refusal classifier to compact summaries**

Keep ordinary model behavior unchanged. For `plan_summary` and `run_follow_up_summary`, replace refusal-shaped text with an empty string; do not perform a second model call.

- [x] **Step 4: Re-run focused tests and typechecks**

The shared tests, Operator Activity/Workflow tests, shared typecheck, and worker typecheck must all pass.
