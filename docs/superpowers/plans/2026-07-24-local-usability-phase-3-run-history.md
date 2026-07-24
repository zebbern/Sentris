# Local Usability — Phase 3: Run↔Scope Linkage + Per-Target Run History — Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development.

**Goal:** Tag each workflow run with the Target (scope) it was launched against, and show a Target's run history on a new detail page.

**Architecture:** Add nullable `scopeId` to `workflow_runs`; thread it through the single run-creation chokepoint (`prepareRunPayload` → `runRepository.upsert`, set in BOTH `values` and `updateValues`) and out through the run summary + a `scopeId` list filter. Frontend: the Run dialog remembers the target picked in the Phase-2 "Prefill from target" selector and sends `scopeId` on run; a new `TargetDetailPage` (`/targets/:id`, `/targets/:id/runs`) mirrors `WebhookEditorPage`'s route-driven tabs and lists the scope's runs. No finding counts yet (Phase 5).

**Tech Stack:** NestJS + Drizzle (drizzle-kit push), Zod DTOs, generated `@sentris/backend-client`, React + TanStack Query + shadcn/ui, `bun:test`.

## Global Constraints

- Migrations: `bun run migration:push` (schema-diff), no hand-written SQL.
- `scopeId` is nullable everywhere; existing runs (no scope) keep working. It is `uuid('scope_id')`, no FK constraint (matches how `workflowId`/`parentRunId` are unconstrained on this table).
- **Dual-set rule:** `runRepository.upsert` runs twice per run (prepare, then start). Set `scopeId` in BOTH `values` and `updateValues` using the `if (input.scopeId !== undefined)` guard — mirror `parentRunId` exactly. Missing one side nulls it on the second upsert.
- Org scoping unchanged: every run query already ANDs `organizationId`; the `scopeId` filter is additive.
- After backend DTO change, regenerate `openapi.json` (`cd backend && bun run generate:openapi`) AND the client (`cd packages/backend-client && bun run generate`) so `RunWorkflowRequestDto`/list types carry `scopeId`.
- No `any` in production. Commit after each task.

## File Structure

Backend (modify): `database/schema/workflow-runs.ts`, `workflows/repository/workflow-run.repository.ts`, `workflows/workflow-run.service.ts`, `workflows/dto/workflow-graph.dto.ts`, `workflows/workflows.controller.ts`, `workflows/workflow-runs.controller.ts`. Tests under the respective `__tests__/`.
Contract (modify): `openapi.json`, `packages/backend-client/src/client.ts`.
Frontend (modify): `components/workflow/RunWorkflowDialog.tsx`, `features/workflow-builder/hooks/useWorkflowRunner.tsx`, `features/workflow-builder/WorkflowBuilder.tsx`, `store/execution/executionLifecycleStore.ts`, `services/api/executions.ts`, `hooks/queries/useRunQueries.ts`, `hooks/queries/useScopeQueries.ts` (add `useScopeRuns`), `routes.tsx`, `pages/targets/TargetRow.tsx`. Create: `pages/TargetDetailPage.tsx`, `pages/target-detail/{useTargetDetail.ts, index.ts}`.

---

### Task 1: Backend — thread `scopeId` through run creation + listing (+ tests)

**Files:** Modify the 6 backend files above; tests in `workflows/repository/__tests__/` and `workflows/__tests__/`.

**Interfaces produced:** `POST /workflows/:id/run` accepts `scopeId?: string(uuid)`; `GET /workflows/runs?scopeId=` filters; run summaries include `scopeId: string | null`.

- [ ] **Step 1: Schema** — In `database/schema/workflow-runs.ts` add `scopeId: uuid('scope_id'),` (after `parentNodeRef`) and index `scopeOrgCreatedAtIdx: index('workflow_runs_org_scope_created_at_idx').on(table.organizationId, table.scopeId, table.createdAt),`. Run `cd backend && bun run migration:push` (confirm it adds the column, no destructive prompts). Verify: `docker exec sentris-postgres psql -U sentris -d sentris_instance_0 -c '\d workflow_runs'` shows `scope_id`.

- [ ] **Step 2: Repository** — In `workflow-run.repository.ts`: add `scopeId?: string | null` to `CreateWorkflowRunInput`; in `upsert()` add to BOTH blocks: `if (input.scopeId !== undefined) { values.scopeId = input.scopeId ?? null; }` and the same for `updateValues` (mirror `parentRunId`). Add an optional `scopeId?: string` to the `list()` options and push `eq(workflowRunsTable.scopeId, options.scopeId)` into the `conditions` array when present.

- [ ] **Step 3: Service** — In `workflow-run.service.ts`: add `scopeId?: string` to `WorkflowRunRequest` and `PreparedRunPayload`; in `prepareRunPayload` read `const scopeId = request.scopeId;`, pass `scopeId` into the upsert at ~line 323, and include `scopeId` in the returned `PreparedRunPayload`; in `startPreparedRun` pass `scopeId: prepared.scopeId` into the upsert at ~line 227; add `scopeId?: string` to `listRuns` options (pass through to `runRepository.list`); add `scopeId: run.scopeId ?? null` to `WorkflowRunSummary` and set it in `buildSummaryRecord`.

- [ ] **Step 4: DTO + controllers** — In `dto/workflow-graph.dto.ts` add `scopeId: z.string().uuid().optional(),` to `BaseRunWorkflowRequestSchema`, and `scopeId: z.string().uuid().optional(),` to `ListRunsQuerySchema`. In `workflows.controller.ts` `run()`, pass `scopeId: body.scopeId` into the `prepareRunPayload` request object. In `workflow-runs.controller.ts` list handler, pass `scopeId: query.scopeId` into `listRuns(...)`.

- [ ] **Step 5: Tests** — Add/extend:
  - Repository test: `upsert` with `scopeId` sets it; a second `upsert` (conflict) with `scopeId` still present keeps it (dual-set); `list({ scopeId })` filters. (Mirror existing repo test style; if the repo test mock can't assert predicates, assert `scopeId` lands in the `values`/`updateValues` objects.)
  - Service test: `prepareRunPayload({ scopeId })` → upsert called with that `scopeId`; `PreparedRunPayload.scopeId` set; `startPreparedRun` upsert carries it; `listRuns({ scopeId })` forwards it.
    Run `cd backend && bun test src/workflows/` — all pass. Confirm backend health 200 after hot reload.

- [ ] **Step 6: Commit** — `git add backend/src/database/schema/workflow-runs.ts backend/src/workflows && git commit -m "feat(runs): thread scopeId through run creation and listing"`

---

### Task 2: Regenerate OpenAPI + backend-client

**Files:** `openapi.json`, `packages/backend-client/src/client.ts`.

- [ ] **Step 1:** `cd backend && bun run generate:openapi`. Confirm the `RunWorkflowRequestDto`/`PrepareRunRequestDto` schemas gain `scopeId` and the runs-list query gains `scopeId`. `git diff --stat openapi.json`.
- [ ] **Step 2:** `cd packages/backend-client && bun run generate` (runs `openapi-typescript`). Confirm `src/client.ts` regenerates with `scope_id`/`scopeId` in the run request type.
- [ ] **Step 3:** `cd frontend && bunx tsc --noEmit` still clean (no consumers broken).
- [ ] **Step 4: Commit** — `git add openapi.json packages/backend-client/src/client.ts && git commit -m "chore(runs): regenerate contract with scopeId"`

---

### Task 3: Frontend — send `scopeId` on run from the Prefill selection

**Files:** `components/workflow/RunWorkflowDialog.tsx`, `features/workflow-builder/hooks/useWorkflowRunner.tsx`, `features/workflow-builder/WorkflowBuilder.tsx`, `store/execution/executionLifecycleStore.ts`, `services/api/executions.ts`, `hooks/queries/useRunQueries.ts` (add `scopeId` to `ExecutionRun` + `normalizeRun`). Test: extend `RunWorkflowDialog.scope-prefill.test.tsx`.

- [ ] **Step 1: Dialog remembers the picked scope** — In `RunWorkflowDialog.tsx`, add `const [selectedScopeId, setSelectedScopeId] = useState<string | null>(null);`. In `handlePrefillFromScope`, also `setSelectedScopeId(scope.id)`. Reset it to `null` in the same effect that resets `inputs` on `open` change. Change the `onRun` prop type to `(inputs: Record<string, unknown>, scopeId?: string | null) => void` and call `onRun(inputs, selectedScopeId)` in `handleRun`. (Also fix the Phase-2 Minor: bind the Select's `value` to `selectedScopeId ?? ''` so the trigger shows the chosen target.)

- [ ] **Step 2: Thread through the runner** — In `WorkflowBuilder.tsx`, change the dialog's `onRun` to `(inputs, scopeId) => state.executeWorkflow({ inputs, versionId: state.pendingVersionId, scopeId })`. In `useWorkflowRunner.tsx`, add `scopeId?: string | null` to `executeWorkflow`'s options and pass it into `startExecution(workflowId, { inputs, versionId, version, scopeId })`.

- [ ] **Step 3: Store + API** — In `executionLifecycleStore.ts` `startExecution` options add `scopeId?: string | null`; pass through to `api.executions.start(workflowId, options)`. In `services/api/executions.ts` `start()` add `scopeId?: string | null` to options and include `scopeId: options.scopeId ?? undefined` in the `payload` object passed to `apiClient.runWorkflow` (typed now that Task 2 regenerated the client).

- [ ] **Step 4: Surface scopeId in run lists** — In `useRunQueries.ts`, add `scopeId?: string | null` to `ExecutionRun` and set it in `normalizeRun` from the raw response.

- [ ] **Step 5: Test** — Extend `RunWorkflowDialog.scope-prefill.test.tsx`: after selecting "Example Corp" and clicking Run, assert `onRun` is called with `(inputs, 's1')` (the scope id). Run `cd frontend && bun test src/components/workflow/`.

- [ ] **Step 6: Typecheck/lint + commit** — `cd frontend && bunx tsc --noEmit`; `bunx eslint <touched files>`. `git add <touched files> && git commit -m "feat(runs): send scopeId when running against a target"`

---

### Task 4: Target detail page with Run History tab

**Files:** Create `pages/TargetDetailPage.tsx`, `pages/target-detail/{useTargetDetail.ts,index.ts}`; add `useScopeRuns(scopeId)` to `hooks/queries/useScopeQueries.ts`; modify `routes.tsx`, `pages/targets/TargetRow.tsx`. Test: `pages/__tests__/TargetDetailPage.test.tsx`.

**Interfaces consumed:** `useScope(id)`, `api.executions.listRuns({ scopeId })` (add if missing — the executions api list should accept a `scopeId` filter passed through to `GET /workflows/runs?scopeId=`).

- [ ] **Step 1: Runs-by-scope query** — Add `useScopeRuns(scopeId: string)` to `useScopeQueries.ts`: `useQuery({ queryKey: queryKeys.targets.detail(scopeId).concat('runs'), queryFn: () => api.executions.listRuns({ scopeId, limit: 50 }), enabled: !!scopeId })`. Confirm `api.executions.listRuns` accepts/forwards a `scopeId` filter (add it to the options + the `apiClient.listRuns` query params if not present).

- [ ] **Step 2: Detail hook** — `pages/target-detail/useTargetDetail.ts` mirrors `useWebhookEditor.ts`: `useParams<{id:string}>()`, route-driven `activeTab` (`'overview' | 'runs'` from path suffix `/runs`), `navigateToTab(tab)` → `navigate('/targets/'+id or '/targets/'+id+'/runs')`, `useScope(id)`, and `useScopeRuns(id)` for the runs tab.

- [ ] **Step 2b: Detail page** — `TargetDetailPage.tsx` (thin) with shadcn `Tabs` (Overview: scope name/description/domains/repos/ipRanges summary; Run History: a table of `useScopeRuns` results — Workflow name, Status badge via `getStatusBadgeClassFromStatus`/`formatStatusText`, Started `formatStartTime`, Duration `formatDuration`, Trigger; `EmptyState` "No runs yet — run a workflow against this target to see history here." when empty). No finding-count column (Phase 5).

- [ ] **Step 3: Routes + link** — In `routes.tsx`: lazy `TargetDetailPage` + `<Route path="/targets/:id" ...>` and `<Route path="/targets/:id/runs" ...>` (mirror the webhook 4-route pattern; the list `/targets` stays). In `TargetRow.tsx`, make the target name a link/button to `/targets/${scope.id}` (navigate on click; keep Edit/Delete as-is).

- [ ] **Step 4: Test** — `TargetDetailPage.test.tsx`: mock `useScope` + `useScopeRuns`; (a) renders the scope name + Overview; (b) Run History tab shows a run row with status; (c) empty runs → "No runs yet" empty state. Run `cd frontend && bun test src/pages/__tests__/TargetDetailPage.test.tsx`.

- [ ] **Step 5: Typecheck/lint + commit** — `cd frontend && bunx tsc --noEmit`; eslint touched files. `git add <touched> && git commit -m "feat(targets): add target detail page with run history"`

---

## Browser Verification (gate before Phase 4) — SAFE, no external scanning

Do NOT launch a real recon run against a live external domain. Verify safely:

1. **Detail page + tabs:** From Targets, click a target's name → lands on `/targets/:id`; Overview shows its domains/repos; a "Run History" tab exists. Empty target → "No runs yet".
2. **scopeId is sent on run:** Open a workflow's Run dialog, pick a target in "Prefill from target", and use the browser's network panel (read_network_requests) to confirm the `POST /workflows/:id/run` body includes `scopeId`. (Cancel/observe — do not let a recon workflow execute against a real host; if a run does start, it targets only the seeded test values.)
3. **Run History displays linked runs:** Seed a `workflow_runs` row via psql with `scope_id` = the target's id (a benign/COMPLETED status, an existing local-dev `workflow_id`), then open that target's Run History tab and confirm the seeded run appears with the correct status. (This verifies the query + UI without executing anything.)
4. No console errors.

## Self-Review

- Coverage: schema+threading+tests (T1), contract regen (T2), frontend send-scopeId (T3), detail page+history (T4), safe browser gate. ✓
- Placeholder scan: T3 Step 3 / T4 Step 1 both say "add the `scopeId` filter to `api.executions.listRuns` if not present" — the implementer confirms and adds. No fabricated APIs.
- Type consistency: `scopeId` is `string | null` across DTO, summary, `ExecutionRun`, and the run-request chain; `onRun(inputs, scopeId)` signature matches between dialog (T3 S1) and WorkflowBuilder (T3 S2).
