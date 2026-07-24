# Local Usability — Phase 3: Run↔Scope Linkage + Per-Target Run History — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox syntax.

**Goal:** Stamp each workflow run with the Target (scope) it was launched against, and surface a per-target Run History on a new Target detail page (`/targets/:id`, `/targets/:id/runs`).

**Architecture:** Backend: nullable `scopeId` uuid column on `workflow_runs` (+ `(org, scope, createdAt)` index), threaded through the single run-creation chokepoint — `prepareRunPayload` → `runRepository.upsert()` set in **both** `values` and `updateValues` (the dual-upsert trap), carried by `PreparedRunPayload` into `startPreparedRun`'s second upsert — then out through `WorkflowRunSummary` and an additive `scopeId` filter on `listRuns`. The run-request DTO and list-query DTO gain optional `scopeId`; the OpenAPI spec + `@sentris/backend-client` are regenerated. Frontend: the Run dialog remembers the Phase-2 "Prefill from target" selection and passes it via `onRun(inputs, scopeId)` → `WorkflowBuilder` → `useWorkflowRunner.executeWorkflow` → `executionLifecycleStore.startExecution` → `api.executions.start`. A new `TargetDetailPage` mirrors `WebhookEditorPage`'s route-driven Tabs and lists the scope's runs via `useScopeRuns(scopeId)`. No finding counts (Phase 5), no asset feed (Phase 4).

**Tech Stack:** NestJS + Drizzle (drizzle-kit push), Zod DTOs (`nestjs-zod`), generated `@sentris/backend-client` (openapi-typescript), React + TanStack Query + shadcn/ui, `bun:test`.

## Starting State (read before Task 1)

The working tree is NOT clean at the start of this phase — a prior session left partial, uncommitted Task-1 work on `main`:

- **Already applied (verify, don't re-apply):**
  - `backend/src/database/schema/workflow-runs.ts` — `scopeId: uuid('scope_id')` column + `workflow_runs_org_scope_created_at_idx` index on `(organizationId, scopeId, createdAt)`.
  - `backend/src/workflows/repository/workflow-run.repository.ts` — `scopeId?: string | null` on `CreateWorkflowRunInput`; the `if (input.scopeId !== undefined)` guard in **both** `values` (~line 60) and `updateValues` (~line 87), mirroring `parentRunId`; `scopeId?: string` on `list()` options with an `eq(workflowRunsTable.scopeId, …)` condition.
  - `backend/src/workflows/workflow-run.service.ts` — `scopeId?: string` on `WorkflowRunRequest`; `scopeId` on `PreparedRunPayload`; `scopeId` passed into the `prepareRunPayload` upsert (~line 328) and the `startPreparedRun` upsert (~line 243); `scopeId: string | null` declared on `WorkflowRunSummary`.
- **Known gaps in the in-flight edit (Task 1 closes these):**
  1. `PreparedRunPayload.scopeId` is typed `scopeId?: string` but `prepareRunPayload` assigns `request.scopeId ?? null` — a strict-mode type error. Fix: type it `scopeId?: string | null`.
  2. `buildSummaryRecord` (~line 699) does not set `scopeId`, yet `WorkflowRunSummary` requires it — `tsc` fails until `scopeId: run.scopeId ?? null` is added to the returned object.
  3. `listRuns` options (~line 452) lack `scopeId` (the `...options` spread already forwards to `runRepository.list`, so the type addition is the whole change).
  4. DTOs, controllers, tests, contract regen, and ALL frontend work are untouched.
- The superseded draft plan `docs/superpowers/plans/2026-07-24-local-usability-phase-3-run-history.md` is committed on `main` (`0e541179`). This document replaces it.

**Branch + plan-doc commit (before Task 1):** create `feat/phase-3-run-scope-linkage` from `main` (the uncommitted backend edits ride along in the working tree and are folded into Task 1's commit). First commit on the branch is this plan doc, removing the superseded draft in the same commit:
`git checkout -b feat/phase-3-run-scope-linkage && git add docs/superpowers/plans/2026-07-24-local-usability-phase-3-run-scope-linkage.md && git rm docs/superpowers/plans/2026-07-24-local-usability-phase-3-run-history.md && git commit -m "docs: add Phase 3 run-scope-linkage plan"`

## Global Constraints

- Migrations are push/diff based: `cd backend && bun run migration:push`. Do NOT hand-author `backend/drizzle/*.sql`. This is the **only** stack-touching command permitted; if run, say so explicitly in the task notes. Do NOT start Docker/PM2/dev servers — the Browser Verification gate is executed by the user, not the implementing agent.
- **Dual-upsert trap:** `runRepository.upsert()` runs twice per run (prepare, then start). Any new column must be set in BOTH `values` and `updateValues` behind the `if (input.x !== undefined)` guard — mirror `parentRunId` exactly — or the second upsert nulls it.
- `scopeId` is nullable everywhere; existing runs (no scope) keep working. It is `uuid('scope_id')` with **no FK constraint**, matching how `workflowId`/`parentRunId` are unconstrained on this table.
- Org scoping unchanged: every run query already ANDs `organizationId`; the `scopeId` filter is purely additive.
- Type consistency across the chain: DTO in `scopeId?: string(uuid)`; `PreparedRunPayload.scopeId?: string | null`; `WorkflowRunSummary.scopeId: string | null`; frontend `onRun(inputs, scopeId: string | null)`; `ExecutionRun.scopeId?: string | null`.
- After the backend DTO change, regenerate the repo-root `openapi.json` (`cd backend && bun run generate:openapi`) AND the client (`cd packages/backend-client && bun run generate`) before writing any frontend code that sends `scopeId` — `RunWorkflowPayload` is `components['schemas']['RunWorkflowRequestDto']`, so the frontend payload only typechecks after regen (hence Task 2 sits between Tasks 1 and 3).
- No `any` in production code. Match existing lint/format conventions. Commit after each task. No pushes to any remote; no merges.

## File Structure

- **Task 1 (backend, modify):** `backend/src/database/schema/workflow-runs.ts`, `backend/src/workflows/repository/workflow-run.repository.ts`, `backend/src/workflows/workflow-run.service.ts`, `backend/src/workflows/dto/workflow-graph.dto.ts`, `backend/src/workflows/workflows.controller.ts`, `backend/src/workflows/workflow-runs.controller.ts`. Tests: create `backend/src/workflows/repository/__tests__/workflow-run.repository.spec.ts`; extend `backend/src/workflows/__tests__/workflow-run.service.spec.ts`.
- **Task 2 (contract, regenerate):** `openapi.json` (repo root), `packages/backend-client/src/client.ts`.
- **Task 3 (frontend send-path, modify):** `frontend/src/components/workflow/RunWorkflowDialog.tsx`, `frontend/src/features/workflow-builder/WorkflowBuilder.tsx`, `frontend/src/features/workflow-builder/hooks/useWorkflowRunner.tsx`, `frontend/src/store/execution/executionLifecycleStore.ts`, `frontend/src/services/api/executions.ts`, `frontend/src/hooks/queries/useRunQueries.ts`. Test: extend `frontend/src/components/workflow/__tests__/RunWorkflowDialog.scope-prefill.test.tsx`.
- **Task 4 (frontend history):** Create `frontend/src/pages/TargetDetailPage.tsx`, `frontend/src/pages/target-detail/useTargetDetail.ts`, `frontend/src/pages/target-detail/index.ts`, `frontend/src/pages/__tests__/TargetDetailPage.test.tsx`. Modify `frontend/src/hooks/queries/useScopeQueries.ts`, `frontend/src/lib/queryKeys.ts`, `frontend/src/services/api/executions.ts`, `packages/backend-client/src/api-client.ts` (`listWorkflowRuns` options), `frontend/src/routes.tsx`, `frontend/src/pages/targets/TargetRow.tsx` (+ `TargetsTable.tsx` only if the row needs a prop threaded).

---

### Task 1: Backend — thread `scopeId` through run creation + listing (+ tests)

**Files:** the 6 backend files above; new repository spec; extended service spec.

**Interfaces produced:** `POST /workflows/:id/run` accepts `scopeId?: string(uuid)`; `GET /workflows/runs?scopeId=` filters; run summaries include `scopeId: string | null`.

- [ ] **Step 1: Reconcile the in-flight edits** — Read the three modified files and confirm every item in "Already applied" above is present exactly as described (schema column + index; repository dual-set guards + list filter; service threading). Do not re-apply; do not reformat.

- [ ] **Step 2: Failing tests first** —
  - Create `backend/src/workflows/repository/__tests__/workflow-run.repository.spec.ts` (mirror the `bun:test` + `vi` import style of `workflow-run.service.spec.ts`). Mock the drizzle chain so `upsert` captures what the repository builds:

    ```ts
    let capturedValues: Record<string, unknown> = {};
    let capturedSet: Record<string, unknown> = {};
    const db = {
      insert: () => ({
        values: (v: Record<string, unknown>) => ({
          onConflictDoUpdate: (opts: { set: Record<string, unknown> }) => {
            capturedValues = v;
            capturedSet = opts.set;
            return { returning: async () => [v] };
          },
        }),
      }),
    };
    const repo = new WorkflowRunRepository(db as never);
    ```

    Tests: (a) `upsert({ …base, scopeId: 's1' })` → `capturedValues.scopeId === 's1'` **AND** `capturedSet.scopeId === 's1'` (the dual-set assertion — this is the trap regression test); (b) `upsert({ …base })` with `scopeId` omitted → `'scopeId' in capturedValues === false` and `'scopeId' in capturedSet === false` (guard: an upsert that doesn't know about scope must not null it); (c) `upsert({ …base, scopeId: null })` → explicit `null` in both.

  - Extend `backend/src/workflows/__tests__/workflow-run.service.spec.ts`:
    - `prepareRunPayload('wf-1', { scopeId: 's1' }, authContext)` → `runRepo.upsert` called with `expect.objectContaining({ scopeId: 's1' })` and returned `payload.scopeId === 's1'`.
    - `prepareRunPayload('wf-1', {}, authContext)` → upsert called with `scopeId: null` (the `request.scopeId ?? null` default).
    - `startPreparedRun(prepared)` where `prepared.scopeId = 's1'` → upsert called with `expect.objectContaining({ scopeId: 's1' })` (carry-through to the second upsert).
    - Add `list: vi.fn().mockResolvedValue([])` to the `runRepo` mock; `listRuns(authContext, { scopeId: 's1' })` → `runRepo.list` called with `expect.objectContaining({ scopeId: 's1', organizationId: DEFAULT_ORGANIZATION_ID })`.
    - Add `scopeId: 's1'` to a `makeRunRecord` fixture used by an existing summary-path test (e.g. `getRun`) and assert the summary carries `scopeId: 's1'`; also assert a record without it yields `scopeId: null`.

- [ ] **Step 3: Run — fails.** `cd backend && bun test src/workflows/repository/__tests__/workflow-run.repository.spec.ts` (module compiles but service gaps break the suite) and `cd backend && bun test src/workflows/__tests__/workflow-run.service.spec.ts` — the new service assertions fail (`buildSummaryRecord` drops `scopeId`; `listRuns` won't accept the option).

- [ ] **Step 4: Implement the gaps** — in `workflow-run.service.ts`:
  1. `PreparedRunPayload`: change `scopeId?: string` → `scopeId?: string | null` (fixes the strict-mode error from the in-flight edit; optional so pre-Phase-3 payloads already serialized through Temporal deserialize cleanly — the upsert guard then simply skips).
  2. `listRuns` options: add `scopeId?: string;` (the existing `...options` spread forwards it to `runRepository.list`).
  3. `buildSummaryRecord`: add `scopeId: run.scopeId ?? null,` to the returned object.

- [ ] **Step 5: DTOs + controllers** — in `dto/workflow-graph.dto.ts`: add `scopeId: z.string().uuid().optional(),` to `BaseRunWorkflowRequestSchema` (~line 107; flows into both `RunWorkflowRequestSchema` and `PrepareRunRequestSchema` via extend) and to `ListRunsQuerySchema` (~line 144). In `workflows.controller.ts` `run()` (~line 326), add `scopeId: body.scopeId,` to the request object passed to `prepareRunPayload`. In `workflow-runs.controller.ts` `listRuns()` (~line 113), add `scopeId: query.scopeId,` to the options passed to `workflowRunService.listRuns`. (Also confirm the prepare-run endpoint that consumes `PrepareRunRequestSchema` forwards `scopeId` the same way if it builds the request object field-by-field.)

- [ ] **Step 6: Migration** — `cd backend && bun run migration:push`. Confirm the diff is additive only (adds `scope_id` + `workflow_runs_org_scope_created_at_idx`; no drops/truncates — abort and investigate if drizzle-kit proposes anything destructive). **Report explicitly in the task notes that the migration was run.**

- [ ] **Step 7: Run — passes.** `cd backend && bun test src/workflows` (all suites), then `cd backend && bun run typecheck` and `cd backend && bunx eslint src/workflows src/database/schema/workflow-runs.ts`.

- [ ] **Step 8: Commit** — `git add backend/src/database/schema/workflow-runs.ts backend/src/workflows && git commit -m "feat(runs): thread scopeId through run creation and listing"`

---

### Task 2: Regenerate OpenAPI + backend-client

**Files:** `openapi.json` (repo root — `backend/scripts/generate-openapi.ts` writes there), `packages/backend-client/src/client.ts`.

- [ ] **Step 1:** `cd backend && bun run generate:openapi`. Verify with `git diff openapi.json` that `RunWorkflowRequestDto` and `PrepareRunRequestDto` schemas gained `scopeId` and the `GET /api/v1/workflows/runs` parameters gained `scopeId`.
- [ ] **Step 2:** `cd packages/backend-client && bun run generate` (openapi-typescript over `../../openapi.json`). Verify `src/client.ts` now types `scopeId` on the run request body and the runs-list query.
- [ ] **Step 3:** No consumers broken: `cd packages/backend-client && bun run typecheck` and `cd frontend && bunx tsc --noEmit` both clean.
- [ ] **Step 4: Commit** — `git add openapi.json packages/backend-client/src/client.ts && git commit -m "chore(runs): regenerate contract with scopeId"`

---

### Task 3: Frontend — send `scopeId` on run from the Prefill selection

**Files:** `RunWorkflowDialog.tsx`, `WorkflowBuilder.tsx`, `useWorkflowRunner.tsx`, `executionLifecycleStore.ts`, `services/api/executions.ts`, `useRunQueries.ts`. Test: extend `RunWorkflowDialog.scope-prefill.test.tsx`.

**Interfaces produced:** `onRun: (inputs: Record<string, unknown>, scopeId: string | null) => void`; `executeWorkflow`/`startExecution`/`api.executions.start` options gain `scopeId`; `ExecutionRun.scopeId?: string | null`.

- [ ] **Step 1: Failing test** — extend `RunWorkflowDialog.scope-prefill.test.tsx`:
  - Update the two existing `onRun` assertions to expect the second argument: `expect(onRun).toHaveBeenCalledWith({ domains: [...] }, 's1')` (and the untouched-inputs test likewise with `'s1'`).
  - Add: clicking Run **without** selecting a target calls `onRun(inputs, null)`.
  - Add: after selecting "Example Corp", the Select's bound value is the scope id (the Phase-2 minor fix — assert via the select mock's value/selected state rather than radix internals).
    Run `cd frontend && bun test src/components/workflow/__tests__/RunWorkflowDialog.scope-prefill.test.tsx` — new/updated assertions fail.

- [ ] **Step 2: Dialog remembers the picked scope** — in `RunWorkflowDialog.tsx`:
  - `const [selectedScopeId, setSelectedScopeId] = useState<string | null>(null);`
  - `handlePrefillFromScope` additionally does `setSelectedScopeId(scope.id);`.
  - Reset `setSelectedScopeId(null)` inside the existing open-reset `useEffect` (~line 79).
  - Change the prop type to `onRun: (inputs: Record<string, unknown>, scopeId: string | null) => void` and call `onRun(inputs, selectedScopeId)` in `handleRun`.
  - **Phase-2 minor fix:** bind the Select — `<Select value={selectedScopeId ?? ''} onValueChange={handlePrefillFromScope}>` — so the trigger shows the chosen target.

- [ ] **Step 3: Thread through the runner** — in `WorkflowBuilder.tsx` (~line 99): `onRun={(inputs, scopeId) => state.executeWorkflow({ inputs, versionId: state.pendingVersionId, scopeId })}`. In `useWorkflowRunner.tsx`: add `scopeId?: string | null` to the `executeWorkflow` options in BOTH the state interface (~line 55) and the `useCallback` signature (~line 86); pass `scopeId: options?.scopeId ?? undefined` into `startExecution` (~line 125).

- [ ] **Step 4: Store + API** — in `executionLifecycleStore.ts`: add `scopeId?: string;` to the `startExecution` options interface (~line 37) — the implementation already forwards `options` verbatim to `api.executions.start`. In `services/api/executions.ts` `start()`: add `scopeId?: string;` to the options type and `scopeId: options.scopeId,` to the `payload` object (typed by the Task-2 regenerated `RunWorkflowRequestDto`).

- [ ] **Step 5: Surface `scopeId` on run objects** — in `useRunQueries.ts`: add `scopeId?: string | null;` to `ExecutionRun` and `scopeId: typeof run.scopeId === 'string' ? run.scopeId : null,` in `normalizeRun`.

- [ ] **Step 6: Run — passes.** `cd frontend && bun test src/components/workflow/` (prefill suite + regression on the other dialog tests).

- [ ] **Step 7: Typecheck + lint + commit** — `cd frontend && bunx tsc --noEmit`; `cd frontend && bunx eslint src/components/workflow/RunWorkflowDialog.tsx src/features/workflow-builder/WorkflowBuilder.tsx src/features/workflow-builder/hooks/useWorkflowRunner.tsx src/store/execution/executionLifecycleStore.ts src/services/api/executions.ts src/hooks/queries/useRunQueries.ts`. Then `git add frontend/src/components/workflow/RunWorkflowDialog.tsx frontend/src/components/workflow/__tests__/RunWorkflowDialog.scope-prefill.test.tsx frontend/src/features/workflow-builder/WorkflowBuilder.tsx frontend/src/features/workflow-builder/hooks/useWorkflowRunner.tsx frontend/src/store/execution/executionLifecycleStore.ts frontend/src/services/api/executions.ts frontend/src/hooks/queries/useRunQueries.ts && git commit -m "feat(runs): send scopeId when running against a target"`

---

### Task 4: Target detail page with Run History tab

**Files:** create `pages/TargetDetailPage.tsx`, `pages/target-detail/useTargetDetail.ts`, `pages/target-detail/index.ts`, `pages/__tests__/TargetDetailPage.test.tsx`; modify `hooks/queries/useScopeQueries.ts`, `lib/queryKeys.ts`, `services/api/executions.ts`, `packages/backend-client/src/api-client.ts`, `routes.tsx`, `pages/targets/TargetRow.tsx`.

**Interfaces consumed:** `useScope(id)` (exists), `api.executions.listRuns({ scopeId })` (filter added here), `getStatusBadgeClassFromStatus`/`formatStatusText` (`@/utils/statusBadgeStyles`), `formatStartTime`/`formatDuration` (`@/utils/timeFormat`), `EmptyState` (`@/components/ui/EmptyState`), shadcn `Tabs`.

- [ ] **Step 1: Failing test** — create `pages/__tests__/TargetDetailPage.test.tsx` (mirror the mocking style of `WebhookEditorPage.test.tsx` / `TargetsPage.test.tsx`; render inside a `MemoryRouter` with `initialEntries` and the two routes). Mock `@/hooks/queries/useScopeQueries` (`useScope`, `useScopeRuns`). Cases:
  - (a) at `/targets/s1`: renders the scope name and Overview content (domains list), and a "Run History" tab trigger exists;
  - (b) at `/targets/s1/runs` with one mocked run (`{ id: 'run-1', workflowName: 'Recon', status: 'COMPLETED', startTime: …, duration: 60000, triggerLabel: 'Manual run' }`): the row shows the workflow name and the formatted status text;
  - (c) at `/targets/s1/runs` with `runs: []`: shows the empty state ("No runs yet — run a workflow against this target to see history here.").
    Run `cd frontend && bun test src/pages/__tests__/TargetDetailPage.test.tsx` — fails (module missing).

- [ ] **Step 2: Runs-by-scope plumbing** —
  - `lib/queryKeys.ts`: add `runs: (id: string) => ['targets', getOrgScope(), id, 'runs'] as const,` under `targets`.
  - `packages/backend-client/src/api-client.ts` `listWorkflowRuns`: add `scopeId?: string;` to the options and `scopeId: options?.scopeId,` to the query object (typed by the Task-2 client).
  - `services/api/executions.ts` `listRuns`: add `scopeId?: string;` to the options (passes through to `apiClient.listWorkflowRuns`).
  - `hooks/queries/useScopeQueries.ts`: add a minimal run-summary type + hook:

    ```ts
    export interface ScopeRunSummary {
      id: string;
      workflowId: string;
      workflowName: string;
      status: string;
      startTime: string;
      duration?: number;
      triggerLabel?: string | null;
    }

    export function useScopeRuns(scopeId: string) {
      return useQuery({
        queryKey: queryKeys.targets.runs(scopeId),
        queryFn: async () => {
          const response = await api.executions.listRuns({ scopeId, limit: 50 });
          return (response.runs ?? []) as unknown as ScopeRunSummary[];
        },
        enabled: Boolean(scopeId),
      });
    }
    ```

- [ ] **Step 3: Detail hook + page** —
  - `pages/target-detail/useTargetDetail.ts` mirrors `useWebhookEditor.ts`'s route-driven tab pattern: `useParams<{ id: string }>()`, `useLocation()`; `activeTab = location.pathname.endsWith('/runs') ? 'runs' : 'overview'` (memoized); `navigateToTab(tab)` → `navigate(tab === 'runs' ? \`/targets/${id}/runs\` : \`/targets/${id}\`)`; `useScope(id)`+`useScopeRuns(id)`; return `{ id, scope, isLoading, runs, isLoadingRuns, activeTab, navigateToTab }`.
  - `pages/TargetDetailPage.tsx` (thin, mirrors `WebhookEditorPage.tsx` layout): back link to `/targets`, scope name + description header, `Tabs value={activeTab} onValueChange={navigateToTab}` with **Overview** (domains / repos / IP ranges summary lists from the scope) and **Run History** (a `Table`: Workflow, Status — `<span className={getStatusBadgeClassFromStatus(run.status)}>{formatStatusText(run.status)}</span>` —, Started `formatStartTime(run.startTime)`, Duration `formatDuration(run.duration ?? 0)`, Trigger `run.triggerLabel`; `EmptyState` with "No runs yet — run a workflow against this target to see history here." when empty). Loading → `Skeleton`s; missing scope → a small not-found state. **No finding-count column (Phase 5).**
  - `pages/target-detail/index.ts` re-exports the hook (mirror `pages/webhook-editor/index.ts` style).

- [ ] **Step 4: Routes + row link** — `routes.tsx`: add a lazy `TargetDetailPage` (mirror the `TargetsPage` `lazyWithRetry` pattern) and two routes under the existing layout, each wrapped in `ErrorBoundary` exactly like the `/webhooks/:id` cluster: `/targets/:id` and `/targets/:id/runs`. `pages/targets/TargetRow.tsx`: wrap the name in a `Link to={\`/targets/${scope.id}\`}`(react-router) with a hover-underline style; Edit/Delete buttons unchanged. (Thread nothing new through`TargetsTable` unless the compiler requires it.)

- [ ] **Step 5: Run — passes.** `cd frontend && bun test src/pages/__tests__/TargetDetailPage.test.tsx`, then regression `cd frontend && bun test src/pages/__tests__/TargetsPage.test.tsx`.

- [ ] **Step 6: Typecheck + lint + commit** — `cd frontend && bunx tsc --noEmit`; `cd packages/backend-client && bun run typecheck`; `cd frontend && bunx eslint src/pages/TargetDetailPage.tsx src/pages/target-detail src/pages/targets/TargetRow.tsx src/hooks/queries/useScopeQueries.ts src/lib/queryKeys.ts src/services/api/executions.ts src/routes.tsx`. Then `git add frontend/src/pages/TargetDetailPage.tsx frontend/src/pages/target-detail frontend/src/pages/__tests__/TargetDetailPage.test.tsx frontend/src/pages/targets/TargetRow.tsx frontend/src/hooks/queries/useScopeQueries.ts frontend/src/lib/queryKeys.ts frontend/src/services/api/executions.ts frontend/src/routes.tsx packages/backend-client/src/api-client.ts && git commit -m "feat(targets): add target detail page with run history"`

---

## Browser Verification (gate before Phase 4) — executed by the USER, SAFE, no external scanning

The implementing agent must NOT start the dev stack; hand these steps to the user against their running stack. Do NOT launch a real recon run against a live external domain.

1. **Detail page + tabs:** From Targets, click a target's name → lands on `/targets/:id`; Overview shows its domains/repos/IPs; the "Run History" tab navigates to `/targets/:id/runs`; a target with no runs shows "No runs yet". Browser back/forward moves between tabs (route-driven).
2. **scopeId is sent on run:** Open a workflow's Run dialog, pick a target in "Prefill from target" (the trigger now displays the chosen target), and confirm via the network panel that the `POST /api/v1/workflows/:id/run` body includes `scopeId`. Cancel/observe — do not let a recon workflow execute against a real host.
3. **Dual-upsert survival:** For a run that was started against a target, `psql`-check `select run_id, scope_id from workflow_runs order by created_at desc limit 5;` — `scope_id` is still set after the run started (i.e. survived the second upsert).
4. **Run History displays linked runs:** That target's Run History tab lists the run with resolved status/started/duration. (Alternative without running anything: seed a `workflow_runs` row via psql with `scope_id` = the target's id and a COMPLETED status, then confirm it appears.)
5. No console errors.

## Self-Review

- Coverage vs. spec Phase 3: schema + dual-upsert threading + summary + list filter + DTO (T1), contract regen (T2), dialog→API send-path + `ExecutionRun` surface (T3), detail page + route-driven tabs + `useScopeRuns` + row link (T4), safe user-run browser gate. The spec's "`countByScope` list filter" is delivered as the `scopeId` filter on `listRuns` (count = filtered list length; no separate endpoint needed until Phase 5). ✓
- Dual-upsert trap: guarded in both `values` and `updateValues` (verified in the in-flight edit) AND regression-tested by the new repository spec's dual-set + omitted-key assertions. `startPreparedRun` carries `prepared.scopeId` so the second upsert re-sets rather than nulls. ✓
- Starting-state honesty: the three known gaps in the uncommitted work are enumerated and closed by T1 Steps 4–5; nothing in the plan re-applies existing edits. ✓
- Placeholder scan: T1 Step 5's "confirm the prepare-run endpoint forwards `scopeId`" and T4 Step 4's "thread nothing through `TargetsTable` unless required" are the only verify-in-place items; both are bounded. No fabricated APIs — every consumed helper (`getStatusBadgeClassFromStatus`, `formatStatusText`, `formatStartTime`, `formatDuration`, `EmptyState`, `lazyWithRetry`) was located in the codebase.
- Type consistency: `scopeId` is `string(uuid) optional` at the DTO edge, `string | null` on summaries/`ExecutionRun`, `string | null` in `onRun`, `string | undefined` in the options chain (`?? undefined` at the runner boundary). `PreparedRunPayload.scopeId?: string | null` tolerates pre-Phase-3 serialized payloads. ✓
