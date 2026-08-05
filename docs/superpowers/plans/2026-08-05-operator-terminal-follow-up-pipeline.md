# Operator Terminal Follow-up Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render an Operator-launched run and its automatic terminal follow-up as one timeline
pipeline with one run card and preserved deterministic evidence.

**Architecture:** Add `run_follow_up` ownership to the existing pure display-turn projection in
`OperatorTimeline`. The frontend derives ownership from exact durable `runId` values; backend
turns, actions, messages, and Temporal histories remain unchanged.

**Tech Stack:** React 19, TypeScript, Testing Library, Bun test, in-app Browser verification.

## Global Constraints

- Do not change backend, shared, or Temporal contracts.
- Preserve unmatched follow-ups and standalone manual inspections.
- Do not add client state, API requests, dependencies, or a second pipeline renderer.
- Do not commit or push until the user explicitly requests it.

---

### Task 1: Project terminal follow-ups into their source run pipeline

**Files:**

- Modify: `frontend/src/features/operator/OperatorTimeline.tsx`
- Test: `frontend/src/features/operator/__tests__/OperatorTimeline.test.tsx`
- Verify: `docs/superpowers/specs/2026-08-05-operator-terminal-follow-up-pipeline-design.md`

**Interfaces:**

- Consumes: `OperatorTurnView.journey`, `OperatorActionView.runId`, and the existing
  `Map<turnId, displayTurnId>` projection.
- Produces: one display-turn map covering `execute_plan` and matched `run_follow_up` turns, plus
  group-scoped deterministic investigation follow-ups.

- [x] **Step 1: Add the failing rendered regression**

  Extend the existing completed-plan fixture with a `run_follow_up` turn, generated user message,
  succeeded `get_run` action, assistant summary, and terminal evidence. Assert:

  ```ts
  expect(container.querySelectorAll('[data-operator-turn-group]')).toHaveLength(1);
  expect(screen.queryByText(/^Automatic follow-up for workflow run /)).not.toBeInTheDocument();
  expect(screen.getAllByRole('link', { name: /workflow run/i })).toHaveLength(1);
  expect(screen.getByRole('region', { name: 'Recorded run results' })).toBeInTheDocument();
  ```

- [x] **Step 2: Run the regression and confirm the current duplicate presentation**

  Run:

  ```powershell
  bun --cwd=frontend test src/features/operator/__tests__/OperatorTimeline.test.tsx
  ```

  Expected: the new assertion fails because the automatic follow-up is a second turn and its
  evidence/run card are rendered outside the source group.

- [x] **Step 3: Extend the pure display projection**

  Replace `planExecutionDisplayTurnIds` with a projection that first resolves plan execution and
  then exact run ownership:

  ```ts
  function operatorJourneyDisplayTurnIds(
    turns: OperatorTurnView[],
    actions: OperatorActionView[],
  ): ReadonlyMap<string, string>;
  ```

  Index succeeded `run_workflow` and `retry_run` actions by `runId`, resolve their existing display
  turn, and map matching `run_follow_up` turns to it. Leave unmatched follow-ups unmapped.

- [x] **Step 4: Render evidence inside its resolved display group**

  Associate the latest answered inspection with its display group. Render `InvestigationFollowUps`
  after that group's events and remove the global post-timeline rendering. Add:

  ```ts
  showRunActivity: boolean;
  ```

  to `InvestigationFollowUps`; pass `false` when the group already has a matching launch action and
  `true` for standalone manual inspections.

- [x] **Step 5: Run focused verification**

  ```powershell
  bun --cwd=frontend test src/features/operator/__tests__/OperatorTimeline.test.tsx
  bun --cwd=frontend run typecheck
  bun --cwd=frontend x eslint src/features/operator/OperatorTimeline.tsx src/features/operator/__tests__/OperatorTimeline.test.tsx --cache --cache-location ../.cache/eslint/frontend/ --cache-strategy content
  ```

  Expected: all commands exit 0.

- [x] **Step 6: Verify the real completed session**

  Reload `/operator/f223ab95-02d1-4f7e-a8e0-697ccafa3be2` in the in-app browser and verify one
  coherent pipeline, no generated automatic-follow-up bubble, exactly one run card, visible
  terminal evidence/summary, no framework overlay, and no relevant console errors.

- [x] **Step 7: Inspect the final diff without committing**

  ```powershell
  git diff --check
  git status --short --branch
  ```

  Preserve `Agent Pipeline Live v4.dc.html` as user-owned untracked work.
