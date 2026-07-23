# Local Usability — Phase 1: Scopes CRUD (Targets) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Add a "Targets" (scopes) home base: create/list/edit/delete scopes (name + domains/repos/IP ranges + notes) via a new backend CRUD slice and a new frontend page, org-scoped, following existing conventions verbatim.

**Architecture:** New `scopes` Drizzle table → NestJS `ScopesModule` (module/controller/service/repository/dto) copied from the `agent-skills` slice → regenerate `openapi.json` → frontend `scopesApi` (raw `api.*` HTTP helpers, not the generated client) + react-query hooks + a `TargetsPage` mirroring `SchedulesPage` + nav entry + route.

**Tech Stack:** NestJS + Drizzle/Postgres (drizzle-kit push), Zod DTOs (`nestjs-zod`), React + TanStack Query + shadcn/ui, `bun:test`.

## Global Constraints

- **Org scoping:** every route resolves `organizationId` via `requireOrganizationId(auth)` (from `@CurrentAuth()`); every repository query ANDs `eq(scopes.organizationId, organizationId)`. Use the `agent-skills` `.notNull()` org style (NOT the nullable `secrets.ts` fallback). Local dev org id is `DEFAULT_ORGANIZATION_ID` (`backend/src/auth/constants.ts`).
- **Auth:** global `AuthGuard`/`RolesGuard` (APP_GUARD) already run on every route. GET/GET:id open to any authenticated role; POST/PATCH/DELETE `@Roles('ADMIN')`.
- **Migrations:** schema-diff push via `bun run migration:push` (from `backend/`). Do NOT hand-write SQL in `backend/drizzle/`.
- **Secrets excluded:** scopes store target inputs but NEVER secret values (Phase 2 concern; schema has no secret column).
- **Frontend data:** use raw `api.get/post/patch/del` with local TS types (see Task 5), NOT `@sentris/backend-client` regeneration.
- **Field contract (used across tasks):** a Scope has `id`, `organizationId`, `name` (1–191 chars, required), `description` (nullable notes), `domains: string[]`, `repos: string[]`, `ipRanges: string[]`, `runtimeValues: Record<string,unknown>` (default `{}`; Phase-2 prefill map, present in schema now but not edited by the UI in Phase 1), `createdBy` (nullable), `createdAt`, `updatedAt`. Unique on `(organizationId, name)`.
- **Routing** is in `frontend/src/routes.tsx` (NOT App.tsx); nav is in `frontend/src/components/layout/AppLayout.tsx` `navigationItems` (NOT SidebarNav.tsx).
- Commit after every task with a conventional message.

---

## File Structure

Backend (new): `backend/src/database/schema/scopes.ts`; `backend/src/scopes/{scopes.module,scopes.controller,scopes.service,scopes.repository}.ts` + `backend/src/scopes/dto/scopes.dto.ts`; tests under `backend/src/scopes/__tests__/`. Modified: `backend/src/database/schema/index.ts` (re-export), `backend/src/app.module.ts` (register module), `openapi.json` (regenerated).

Frontend (new): `frontend/src/services/api/scopes.ts`; `frontend/src/types/scopes.ts`; `frontend/src/hooks/queries/useScopeQueries.ts`; `frontend/src/pages/TargetsPage.tsx` + `frontend/src/pages/targets/{index.ts,TargetsTable.tsx,TargetRow.tsx}`; `frontend/src/components/targets/{TargetEditorDialog.tsx,useTargetEditorState.ts}`; tests under `__tests__/`. Modified: `frontend/src/services/api/index.ts` (register `scopes`), `frontend/src/lib/queryKeys.ts` (targets block), `frontend/src/routes.tsx` (route), `frontend/src/components/layout/AppLayout.tsx` (nav item).

---

### Task 1: `scopes` schema + migration

**Files:** Create `backend/src/database/schema/scopes.ts`; Modify `backend/src/database/schema/index.ts`.

**Interfaces produced:** `scopes` pgTable; `ScopeRecord = typeof scopes.$inferSelect`; `NewScopeRecord = typeof scopes.$inferInsert`.

- [ ] **Step 1: Create the schema** — mirror `backend/src/database/schema/agent-skills.ts` structure exactly (uuid pk, org varchar(191) notNull, timestamps withTimezone, index + uniqueIndex, `$inferSelect/$inferInsert` exports):

```ts
import {
  pgTable,
  uuid,
  varchar,
  text,
  jsonb,
  timestamp,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

export const scopes = pgTable(
  'scopes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: varchar('organization_id', { length: 191 }).notNull(),
    name: varchar('name', { length: 191 }).notNull(),
    description: text('description'),
    domains: text('domains').array().notNull().default([]),
    repos: text('repos').array().notNull().default([]),
    ipRanges: text('ip_ranges').array().notNull().default([]),
    runtimeValues: jsonb('runtime_values').$type<Record<string, unknown>>().notNull().default({}),
    createdBy: varchar('created_by', { length: 191 }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    orgIdx: index('scopes_org_idx').on(table.organizationId),
    orgNameUnique: uniqueIndex('scopes_org_name_uidx').on(table.organizationId, table.name),
  }),
);

export type ScopeRecord = typeof scopes.$inferSelect;
export type NewScopeRecord = typeof scopes.$inferInsert;
```

- [ ] **Step 2: Re-export** — append `export * from './scopes';` to `backend/src/database/schema/index.ts`.

- [ ] **Step 3: Apply migration** — Run: `cd backend && bun run migration:push`. Expected: drizzle-kit reports creating table `scopes` with no destructive prompts. Verify: `docker exec sentris-postgres psql -U <user> -d <db> -c '\d scopes'` shows the columns (get user/db from `backend/.env` `DATABASE_URL`; the Postgres container is `sentris-postgres` on host port 5433).

- [ ] **Step 4: Commit** — `git add backend/src/database/schema/scopes.ts backend/src/database/schema/index.ts && git commit -m "feat(scopes): add scopes table schema"`

---

### Task 2: Backend ScopesModule (CRUD slice) + unit tests

**Files:** Create `backend/src/scopes/scopes.module.ts`, `scopes.controller.ts`, `scopes.service.ts`, `scopes.repository.ts`, `dto/scopes.dto.ts`, `__tests__/scopes.service.spec.ts`, `__tests__/scopes.repository.spec.ts`. Modify `backend/src/app.module.ts`.

**Interfaces produced (consumed by Phase 2/3):**

- `ScopesService.listScopes(auth) / getScope(auth,id) / createScope(auth,dto) / updateScope(auth,id,dto) / deleteScope(auth,id)` returning `ScopeResponse`.
- `ScopeResponse` shape = the field contract in Global Constraints.
- REST: `GET /api/v1/scopes`, `GET /api/v1/scopes/:id`, `POST /api/v1/scopes`, `PATCH /api/v1/scopes/:id`, `DELETE /api/v1/scopes/:id` (global prefix `api/v1`).

- [ ] **Step 1: DTOs** — In `dto/scopes.dto.ts`, mirror `backend/src/agent-skills/dto/agent-skills.dto.ts` (zod + `createZodDto`). Define:
  - `CreateScopeSchema = z.object({ name: z.string().min(1).max(191), description: z.string().max(2000).nullish(), domains: z.array(z.string()).default([]), repos: z.array(z.string()).default([]), ipRanges: z.array(z.string()).default([]), runtimeValues: z.record(z.unknown()).default({}) })` → `class CreateScopeDto extends createZodDto(CreateScopeSchema)`.
  - `UpdateScopeSchema` = same fields all `.optional()` → `UpdateScopeDto`.
  - `ScopeResponseSchema` = the full field contract (id uuid, organizationId, name, description nullable, domains/repos/ipRanges arrays, runtimeValues record, createdBy nullable, createdAt/updatedAt ISO strings) → `ScopeResponse`.

- [ ] **Step 2: Repository** — `scopes.repository.ts` mirrors `agent-skills.repository.ts`: `@Inject(DRIZZLE_TOKEN) db`, methods `listByOrganization(organizationId)`, `findById(id, organizationId)`, `create(data: NewScopeRecord)`, `update(id, organizationId, data: Partial<...>)`, `delete(id, organizationId)`. Every query ANDs `eq(scopes.organizationId, organizationId)`. `create` maps unique-violation (`getPostgresErrorCode(error) === PG_ERROR.UNIQUE_VIOLATION`) → `ConflictException('A scope with this name already exists')`. `update`/`delete` throw `NotFoundException` when nothing returned.

- [ ] **Step 3: Service** — `scopes.service.ts` mirrors `agent-skills.service.ts`: `requireOrganizationId(auth)` first in every method, build partial `updateData` with per-field `!== undefined` guards in `updateScope`, `mapToResponse(record)` converts `ScopeRecord` → `ScopeResponse` (dates `.toISOString()`), `createScope` sets `createdBy: auth?.userId ?? null`.

- [ ] **Step 4: Controller** — `scopes.controller.ts` mirrors `agent-skills.controller.ts`: `@ApiTags('scopes') @Controller('scopes')`; `@Get()`, `@Get(':id')` (with `ParseUUIDPipe`), `@Post() @Roles('ADMIN')`, `@Patch(':id') @Roles('ADMIN')`, `@Delete(':id') @Roles('ADMIN') @HttpCode(204)`; each uses `@CurrentAuth() auth` and `ZodValidationPipe`.

- [ ] **Step 5: Module + registration** — `scopes.module.ts` (`imports: [DatabaseModule]`, controllers `[ScopesController]`, providers `[ScopesService, ScopesRepository]`, `exports: [ScopesService]`). In `backend/src/app.module.ts`: import `ScopesModule` and add to the `coreModules` array.

- [ ] **Step 6: Unit tests** — Mirror `backend/src/agent-skills/__tests__/*`:
  - `scopes.service.spec.ts`: mock the repository; assert each method calls `requireOrganizationId` semantics (throws when no org), maps to response, and `updateScope` only sets provided fields.
  - `scopes.repository.spec.ts` (if the agent-skills repo has one; otherwise a service-level test covering conflict/not-found via a mock repo). Cover: create returns record; findById filters by org; update/delete NotFound path; create ConflictException on unique violation.
    Run: `cd backend && bun test src/scopes/` → all pass, pristine.

- [ ] **Step 7: Boot check** — confirm the backend restarts cleanly with the new module (PM2 watch reloads it): `curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3211/health/ready` returns 200 after edit. (Auth-gated routes will 401 without a session — that's expected; the health check confirms the module wired without a Nest DI error.)

- [ ] **Step 8: Commit** — `git add backend/src/scopes backend/src/app.module.ts && git commit -m "feat(scopes): add scopes CRUD module"`

---

### Task 3: Regenerate OpenAPI contract

**Files:** Modify `openapi.json`.

- [ ] **Step 1: Regenerate** — Run: `cd backend && bun run generate:openapi` (writes the repo-root `openapi.json`). Expected: the diff adds the `/api/v1/scopes` paths and Scope schemas; no unrelated churn.
- [ ] **Step 2: Sanity** — `git diff --stat openapi.json` shows only additions for scopes. If unrelated paths changed, investigate before committing.
- [ ] **Step 3: Commit** — `git add openapi.json && git commit -m "chore(scopes): regenerate OpenAPI contract"`

---

### Task 4: Frontend data layer (types, api, query hooks)

**Files:** Create `frontend/src/types/scopes.ts`, `frontend/src/services/api/scopes.ts`, `frontend/src/hooks/queries/useScopeQueries.ts`. Modify `frontend/src/services/api/index.ts`, `frontend/src/lib/queryKeys.ts`. Test: `frontend/src/hooks/queries/__tests__/useScopeQueries.test.tsx`.

**Interfaces produced (consumed by Task 5 + Phase 2/3):**

- `Scope` type (mirrors `ScopeResponse`).
- `scopesApi.list()/get(id)/create(payload)/update(id,payload)/remove(id)`.
- `useScopes()/useScope(id)/useCreateScope()/useUpdateScope()/useDeleteScope()`.
- `queryKeys.targets.{root,all,detail}`.

- [ ] **Step 1: Types** — `frontend/src/types/scopes.ts`: `export interface Scope { id; organizationId; name; description?: string | null; domains: string[]; repos: string[]; ipRanges: string[]; runtimeValues: Record<string, unknown>; createdBy?: string | null; createdAt: string; updatedAt: string; }`; plus `CreateScopeInput` / `UpdateScopeInput` (partial) types.

- [ ] **Step 2: API service** — `frontend/src/services/api/scopes.ts` using the raw helpers exported on `api` (`api.get/post/patch/del`) against `/api/v1/scopes`:

```ts
import { api } from './http'; // whichever module exports httpGet/httpPost/... — mirror an existing raw-helper consumer
export const scopesApi = {
  list: () => api.get<Scope[]>('/api/v1/scopes'),
  get: (id: string) => api.get<Scope>(`/api/v1/scopes/${id}`),
  create: (payload: CreateScopeInput) => api.post<Scope>('/api/v1/scopes', payload),
  update: (id: string, payload: UpdateScopeInput) =>
    api.patch<Scope>(`/api/v1/scopes/${id}`, payload),
  remove: (id: string) => api.del<void>(`/api/v1/scopes/${id}`),
};
```

(Confirm the exact raw-helper import path/signatures from `frontend/src/services/api/index.ts` — the reference shows `get/post/put/patch/del` on the `api` aggregator. Match how another resource that uses raw helpers calls them; keep base-path prefixing consistent with sibling services.) Register in `frontend/src/services/api/index.ts`: `import { scopesApi } from './scopes';` + `scopes: scopesApi,`.

- [ ] **Step 3: Query keys** — add to `frontend/src/lib/queryKeys.ts`:

```ts
targets: {
  root: () => ['targets', getOrgScope()] as const,
  all: () => ['targets', getOrgScope(), 'all'] as const,
  detail: (id: string) => ['targets', getOrgScope(), id] as const,
},
```

- [ ] **Step 4: Query hooks** — `useScopeQueries.ts` mirrors `useScheduleQueries.ts`: `useScopes()` (`queryKey: queryKeys.targets.all()`, `queryFn: api.scopes.list`), `useScope(id)`, and `useCreateScope/useUpdateScope/useDeleteScope` mutations that `qc.invalidateQueries({ queryKey: queryKeys.targets.root() })` on success.

- [ ] **Step 5: Test** — `__tests__/useScopeQueries.test.tsx`: mock `api.scopes`, render `useScopes` via a QueryClientProvider wrapper, assert it returns the list; assert `useCreateScope` calls `api.scopes.create` and invalidates. Run: `cd frontend && bun test src/hooks/queries/__tests__/useScopeQueries.test.tsx`.

- [ ] **Step 6: Commit** — `git add frontend/src/types/scopes.ts frontend/src/services/api/scopes.ts frontend/src/services/api/index.ts frontend/src/hooks/queries/useScopeQueries.ts frontend/src/hooks/queries/__tests__/useScopeQueries.test.tsx frontend/src/lib/queryKeys.ts && git commit -m "feat(targets): add scopes frontend data layer"`

---

### Task 5: Targets page (list + editor dialog) + nav + route

**Files:** Create `frontend/src/pages/TargetsPage.tsx`, `frontend/src/pages/targets/{index.ts,TargetsTable.tsx,TargetRow.tsx}`, `frontend/src/components/targets/{TargetEditorDialog.tsx,useTargetEditorState.ts}`. Modify `frontend/src/routes.tsx`, `frontend/src/components/layout/AppLayout.tsx`. Test: `frontend/src/pages/__tests__/TargetsPage.test.tsx`.

**Interfaces consumed:** `useScopes/useCreateScope/useUpdateScope/useDeleteScope` (Task 4); `Scope` type.

- [ ] **Step 1: Editor state hook** — `useTargetEditorState.ts` mirrors `frontend/src/components/schedules/useScheduleEditorState.ts`: local form state `{ name, description, domains: string[], repos: string[], ipRanges: string[] }`, reset on `open`/`mode`/`scope` change, `handleSubmit` calls `api.scopes.create`/`update` (or the mutation hooks), manages `submitting`/`formError`, calls `onSaved(saved, mode)` + `onClose()`. Arrays entered as newline/comma-separated textareas parsed to `string[]` (trim + drop empties).

- [ ] **Step 2: Editor dialog** — `TargetEditorDialog.tsx` mirrors `ScheduleEditorDrawer.tsx` (`Dialog`/`DialogContent`): name `Input`, description `Textarea`, three `Textarea`s for domains/repos/ipRanges (one entry per line), Cancel + Save footer (Save disabled while submitting or when name empty), inline `formError`.

- [ ] **Step 3: Row + table** — `TargetRow.tsx` (presentational: name, a truncated summary like "3 domains · 1 repo · 2 IPs", Updated-time, Edit/Delete icon buttons with tooltips) and `TargetsTable.tsx` (shadcn `Table`; `EmptyState` icon=Target, title "No targets yet", description "Create a target to save a scope you run templates against.", action = "New target" button when `canManageWorkflows`; `TableSkeleton` while loading). Reuse the shared list/tile UI used by Schedules where practical.

- [ ] **Step 4: Page** — `TargetsPage.tsx` mirrors `SchedulesPage.tsx` (simpler — no bulk/sort needed for MVP): `useDocumentTitle('Targets')`, `useScopes()`, a `PageToolbar` (or a simple header with a "New target" button gated on `hasAdminRole(roles)`), `ErrorBanner` on error, `TargetsTable`, and the editor dialog wired via an open/mode/active-scope state (inline `useState`, or a small `useTargetEditorDrawer` hook mirroring `pages/schedules/useScheduleEditorDrawer.ts`). Delete uses `useConfirmDialog` + `useDeleteScope`, success toasts via `useToast`.

- [ ] **Step 5: Route + nav** — In `frontend/src/routes.tsx`: `const TargetsPage = lazyWithRetry(() => import('@/pages/TargetsPage').then((m) => ({ default: m.TargetsPage })));` + `<Route path="/targets" element={<ErrorBoundary><TargetsPage /></ErrorBoundary>} />`. In `AppLayout.tsx`: add `{ name: 'Targets', href: '/targets', icon: Target }` to `navigationItems` (import `Target` from `lucide-react`), placed near Workflows/Schedules.

- [ ] **Step 6: Component test** — `TargetsPage.test.tsx` mirrors `pages/__tests__/*` conventions (bun:test + testing-library, mock `useScopeQueries` + auth store): (a) renders a list of scopes; (b) empty state shows "No targets yet" + admin "New target"; (c) clicking "New target" opens the editor; (d) submitting the editor calls create. Run: `cd frontend && bun test src/pages/__tests__/TargetsPage.test.tsx`.

- [ ] **Step 7: Typecheck + lint** — `cd frontend && bunx tsc --noEmit`; `bunx eslint src/pages/TargetsPage.tsx src/components/targets`. Both clean (no `any`).

- [ ] **Step 8: Commit** — `git add frontend/src/pages/TargetsPage.tsx frontend/src/pages/targets frontend/src/components/targets frontend/src/routes.tsx frontend/src/components/layout/AppLayout.tsx frontend/src/pages/__tests__/TargetsPage.test.tsx && git commit -m "feat(targets): add Targets page with scope CRUD UI"`

---

## Browser Verification (gate before Phase 2)

Against the running stack (frontend :5173) with an authenticated session:

1. **Targets nav appears** — the sidebar shows a "Targets" item; clicking it routes to `/targets`.
2. **Empty state** — with no scopes, the page shows "No targets yet" + a "New target" button.
3. **Create** — click "New target", fill name = "Example Corp", domains = `example.com`, `app.example.com`, notes, Save → the dialog closes, a toast shows, and the new target appears in the list with "2 domains".
4. **Persistence** — reload `/targets`; the target is still listed (confirms the DB round-trip, not just client state).
5. **Edit** — edit the target, add a repo, Save → the row's summary updates to include "1 repo".
6. **Delete** — delete the target, confirm → it disappears; reload confirms it's gone.
7. **No console errors** — the browser console shows no red errors during the flow.

Capture what renders (page text / screenshot) and confirm each expectation before starting Phase 2.

## Self-Review

- Spec coverage: scopes table (T1), CRUD backend+tests (T2), contract (T3), frontend data (T4), page+nav+route+tests (T5), browser gate. ✓
- Placeholder scan: raw-helper import path in Task 4 Step 2 is the one "confirm against sibling" item — the implementer verifies the exact `api.get/post/patch/del` signature from `services/api/index.ts` (the reference confirms these exist on `api`). No other open items.
- Type consistency: `Scope`/`ScopeResponse` field set is identical across backend DTO (T2), OpenAPI (T3), and frontend type (T4). `queryKeys.targets` names match between T4 and T5.
