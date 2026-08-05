# Operator Terminal Follow-up Question Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a durable automatic run follow-up ask at most one consequential question and then
finish from the same recorded run evidence.

**Architecture:** Add a patch-gated review model mode that exposes only the existing
`request_user_input` command. Reuse the canonical action/Temporal Update boundary for the answer,
then use the existing text-only summary mode for the final response.

**Tech Stack:** TypeScript, Temporal TypeScript SDK 1.14.1, AI SDK tools, Bun test.

## Global Constraints

- Preserve replay compatibility with `patched('operator-run-follow-up-question-v1')`.
- At most one question; no general loop and no tool after the answer.
- Do not commit or push until the user explicitly requests it.
- Preserve the user-owned untracked `Agent Pipeline Live v4.dc.html`.

---

### Task 1: Add the bounded durable question path

**Files:**

- Modify: `worker/src/temporal/workflows/operator-turn-workflow.ts`
- Modify: `worker/src/temporal/workflows/__tests__/operator-turn-workflow.test.ts`
- Modify: `worker/src/temporal/activities/operator.activity.ts`
- Modify: `worker/src/temporal/activities/__tests__/operator.activity.test.ts`
- Modify: `AGENTS.md`

**Interfaces:**

- Consumes: existing `request_user_input` command, action ledger, decision Update, and
  `run_follow_up_summary` mode.
- Produces: new internal `run_follow_up_review` model mode and patch-gated workflow branch.

- [x] **Step 1: Write failing workflow and activity tests**

  Add a run-follow-up fixture where review returns one `request_user_input` call, an early durable
  answer resumes it, and the final model call receives the question call history. Assert exactly
  one question action and one final completion. Add no-question and pre-patch assertions. Add an
  activity assertion that review tools contain only `request_user_input`.

- [x] **Step 2: Confirm RED**

  Run:

  ```powershell
  bun --cwd=worker test src/temporal/workflows/__tests__/operator-turn-workflow.test.ts src/temporal/activities/__tests__/operator.activity.test.ts
  ```

  Expected: fail because `run_follow_up_review` and its patch-gated action path do not exist.

- [x] **Step 3: Implement the minimal patched workflow path**

  Add `run_follow_up_review` to `OperatorModelStepInput`, expose only
  `buildOperatorTools(['request_user_input'])`, and give it bounded instructions. In
  `runRunFollowUpJourney`, keep the old summary path when the patch is false. On the new path,
  complete immediately when review has no tool call; otherwise execute one valid question through
  `prepareAndExecuteOperatorAction`, then call text-only `run_follow_up_summary` with the durable
  tool-call history. Complete deterministically if the question is rejected.

- [x] **Step 4: Confirm GREEN and update architecture text**

  Run the focused worker test command again. Update `AGENTS.md` so the architecture describes the
  optional one-question branch instead of claiming every follow-up is always text-only.

- [x] **Step 5: Run proportional integrated verification**

  ```powershell
  bun --cwd=worker run typecheck
  bun --cwd=frontend test src/features/operator/__tests__/OperatorTimeline.test.tsx
  bun --cwd=frontend run typecheck
  git diff --check
  ```

  Inspect the real instance-0 Operator UI, including the sticky decision surface and the existing
  completed follow-up pipeline. Do not commit or push.
