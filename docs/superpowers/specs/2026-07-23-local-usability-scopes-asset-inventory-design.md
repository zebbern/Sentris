# Design: Local Usability — Targets/Scopes, Asset Inventory, and Smooth First-Run

**Date:** 2026-07-23
**Status:** Approved for planning
**Scope owner:** local/self-host single-user usability

## 1. Problem & Goals

Sentris runs well but a local, single-user operator has no "home base." There is no
concept of a saved target, no memory of what was discovered across runs, and the
first-run path from `bun run dev` to a completed workflow has rough edges. This design
adds two capabilities the user prioritized:

- **A. Target/Scope management at "full asset inventory" depth** — create scopes
  (name + domains/repos/IP ranges + notes), run any template against a scope with its
  runtime inputs prefilled, and auto-feed discovered assets (subdomains, hosts, open
  ports, HTTP probes, DNS records, URLs, IPs) from recon runs back into the scope's
  asset inventory, tracked over time, with per-scope run history.
- **B. Smooth first-run** — spotlight the templates that run with zero credentials,
  give the onboarding checklist real actions, fix the Template Library empty state, and
  offer a one-click "try it" run.

### Non-goals

- Auth / user management / multi-user (explicitly out).
- Email / PagerDuty notification channels (explicitly out).
- Making the first-run work fully offline. **Decision:** the Template Library's live
  GitHub sync stays the population mechanism; first-run assumes outbound internet. We do
  not wire the local seed script into `bun run dev` in this work.
- Org-global asset identity, fuzzy run→scope attribution, and asset staleness detection
  (see Decided Defaults).

### Key facts that shaped this design

- **Greenfield.** There is no target/scope/asset entity anywhere today. Every "scope"
  in the codebase is OAuth/permission/org scoping, not a target scope.
- **A runtime "target" is just a runtime input.** Domains/repos/IPs are entries in the
  Entry Point node's `data.config.params.runtimeInputs`, addressed by string `id`
  (`domains`, `packageSpecs`, `knownSubdomains`, …). Values travel as a flat
  `Record<inputId, value>` in `request.inputs`. So "run against a scope" is a **prefill**
  problem, not a new execution path.
- **Findings are not persisted structurally.** `normalizeFindings.ts` is display-only
  (Findings panel + Discord report); nothing stores its output. Structured recon results
  exist only as raw tool JSON inside `node_io.outputs`. OpenSearch is populated only when
  the user wired a `core.analytics.sink` node — which most recon runs do not.
- **One run-creation chokepoint.** Every creation path (manual, scheduled, webhook,
  internal child/loop) funnels through `WorkflowRunService.prepareRunPayload()`
  ([workflow-run.service.ts:284](../../../backend/src/workflows/workflow-run.service.ts)).
- **One node-output chokepoint.** Every node's outputs land in Postgres at
  `NodeIORepository.recordCompletion`
  ([node-io.repository.ts:91](../../../backend/src/node-io/node-io.repository.ts)) via
  `NodeIOIngestService.persistEvent` NODE_IO_COMPLETION branch — org-scoped, per run,
  regardless of analytics-sink wiring.
- **"Zero secrets" ≠ "zero setup."** 30/35 templates need no secret, but ~22 still need
  Docker + a security-tool image pull + a live authorized target. Only **~8 net-only
  templates** truly run with just outbound internet: `cve-impact-research-brief`,
  `kev-fresh-cve-watch-brief`, `npm-dependency-cve-hunt`, `cna-routing-resolver`,
  `cve-novelty-duplicate-gate`, `security-fix-without-cve-watch`,
  `supply-chain-takeover-precursor-hunt`, and `graphql-exposure-triage` (the last needs a
  live target endpoint). The best "try it" seeds are the CVE/KEV research briefs, which
  need only a text/ID input.

## 2. Architecture Decision

**Asset auto-feed = backend post-run ingestion at the `node_io` chokepoint
(Approach A).**

Considered and rejected:

- **B — Worker/analytics-sink write-path.** Sees full pre-spill data, but only fires
  when a `core.analytics.sink` node exists, missing most recon runs. Rejected as the
  primary mechanism. Its one good idea — stamping `scope_id` onto OpenSearch docs for
  per-scope finding counts — is retained as an optional Phase 5 enhancement.
- **C — Frontend-derived view (no asset table).** Recompute inventory from raw node
  outputs on each view. Cheapest, but no over-time tracking, no diffing, repeated
  object-storage refetch. Does not meet the "tracked over time" requirement. Kept only as
  a fallback if the asset table is deferred.

**A** is the only option that satisfies all three hard requirements together —
auto-feed from _any_ recon run, true over-time tracking, and per-scope dedup at rest —
and reuses the cleanest patterns in the codebase: `agent-skills.ts` for the CRUD slice
and `finding-triage.ts` for an org-scoped, externally-keyed augmentation table.

**Resilience principle:** ingestion is decoupled from `node_io` persistence via an
`EventEmitter2` event (mirroring `finding.triage.changed`). An extractor failure or a
spilled payload must never break the run-record write path. The extractor is driven
entirely off the existing `NORMALIZER_MAP` + asset-key field priority, not tool-specific
parsing, so it stays resilient to varying recon output shapes.

## 3. Data Model

Two new Drizzle tables, following the `agent-skills.ts` convention verbatim (uuid pk
`defaultRandom`, `organizationId` `varchar(191).notNull()` — **not** the nullable
`secrets.ts` style — `withTimezone` timestamps, org index + composite unique index,
`$inferSelect`/`$inferInsert` exports, re-exported from
`backend/src/database/schema/index.ts`). Migrations are **push/diff-based**
(`bun run migration:push`) — no hand-written SQL files.

### `scopes` — `backend/src/database/schema/scopes.ts`

| Column                  | Type                                                | Notes                                                                           |
| ----------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------- |
| `id`                    | uuid pk defaultRandom                               |                                                                                 |
| `organizationId`        | varchar(191) notNull                                |                                                                                 |
| `name`                  | varchar(191) notNull                                |                                                                                 |
| `description`           | text (nullable)                                     | notes                                                                           |
| `domains`               | text[].notNull().default([])                        | human-facing scope definition                                                   |
| `repos`                 | text[].notNull().default([])                        |                                                                                 |
| `ipRanges`              | text[].notNull().default([])                        |                                                                                 |
| `runtimeValues`         | jsonb `Record<string,unknown>` notNull default `{}` | machine prefill map keyed by runtime-input id; **secret-typed inputs excluded** |
| `createdBy`             | varchar(191) (nullable)                             |                                                                                 |
| `createdAt`/`updatedAt` | timestamp withTimezone defaultNow notNull           |                                                                                 |

Indexes: `scopes_org_idx (organizationId)`; unique `scopes_org_name_uidx (organizationId, name)`.

Rationale for both structured arrays _and_ `runtimeValues`: arrays are what the editor
collects; `runtimeValues` is the prefill contract that drops straight into the Run
dialog's `initialValues`. Phase 2 derives `runtimeValues` from the arrays by default and
stores explicit overrides for templates whose target input is named unexpectedly.

### `asset_inventory` — `backend/src/database/schema/assets.ts`

| Column                           | Type                                                  | Notes                                                                                                                             |
| -------------------------------- | ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `id`                             | uuid pk defaultRandom                                 |                                                                                                                                   |
| `organizationId`                 | varchar(191) notNull                                  |                                                                                                                                   |
| `scopeId`                        | uuid notNull references(scopes.id, onDelete: cascade) | finding-triage FK pattern; cascade required or scope delete fails                                                                 |
| `assetType`                      | pgEnum `asset_type`                                   | `subdomain`,`host`,`ip-address`,`open-port`,`http-probe`,`dns-record`,`crawled-url`,`url` — matches normalizeFindings recon types |
| `assetValue`                     | varchar(1024) notNull                                 | the normalizer's derived asset key (so it matches OpenSearch `asset_key`)                                                         |
| `firstSeenAt`/`lastSeenAt`       | timestamp withTimezone defaultNow notNull             |                                                                                                                                   |
| `firstSeenRunId`/`lastSeenRunId` | text                                                  | **text, not uuid** — runId is `sentris-run-<uuid>`                                                                                |
| `sourceComponentId`              | varchar(191) (nullable)                               | e.g. `sentris.subfinder.run`                                                                                                      |
| `metadata`                       | jsonb notNull default `{}`                            | port/protocol/status-code etc; resilient catch-all                                                                                |
| `createdAt`/`updatedAt`          | timestamp withTimezone defaultNow notNull             |                                                                                                                                   |

Indexes: `assets_org_idx (organizationId)`; `assets_scope_idx (scopeId)`; unique
`assets_org_scope_type_value_uidx (organizationId, scopeId, assetType, assetValue)` — the
dedup/upsert key; `assets_scope_lastseen_idx (scopeId, lastSeenAt)` for Assets-tab
ordering. Upsert (`onConflictDoUpdate`) bumps `lastSeenAt` + `lastSeenRunId` +
`updatedAt`, leaves `firstSeen*` untouched.

### Run linkage — existing `workflow-runs.ts`

Add nullable `scopeId` + composite index `(organizationId, scopeId, createdAt)`. The
repository `upsert()` must set `scopeId` in **both** `values` and `updateValues` (the
`if (input.x !== undefined)` guard pattern) because upsert runs twice per run and the
second call would otherwise null it.

Tenancy note: there is no automatic row-level tenancy. Every repository query ANDs
`eq(organizationId)` (and `eq(scopeId)` for scoped reads). `AssetInventoryService`
validates that the parent `scopeId` belongs to the same org before insert.

## 4. Phased Delivery

Each phase is independently shippable and independently valuable. Phase 0 ships first
because it's cheap, high-visibility, and gets the user producing the recon output the
inventory later consumes.

### Phase 0 — First-run quick wins (S, pure frontend)

- **"No setup required" badge + filter** on the Template Library, keyed off
  `requiredSecrets.length === 0` **and** absence of Docker/AI security-image node types,
  spotlighting the ~8 net-only templates.
- **Onboarding checklist** steps 2 ("Add a component") and 3 ("Run a workflow") get real
  hrefs; step 3 deep-links to a spotlighted net-only template in `UseTemplateModal`.
- **One-click demo run:** spotlight a net-only template (`kev-fresh-cve-watch-brief` —
  no target, pulls the CISA KEV/NVD feed) as the "try it" run. No new seed data; respects
  the deliberate static-template test guard.
- **Empty-state fix:** the Template Library empty state currently offers only an
  admin-only "Sync from GitHub" CTA, stranding non-admin first users. Explain/auto-trigger
  the sync instead of dead-ending.
- Touches: [TemplateLibraryPage.tsx](../../../frontend/src/pages/TemplateLibraryPage.tsx),
  [OnboardingChecklist.tsx](../../../frontend/src/components/shared/OnboardingChecklist.tsx),
  [UseTemplateModal.tsx](../../../frontend/src/features/templates/UseTemplateModal.tsx),
  [DashboardPage.tsx](../../../frontend/src/pages/DashboardPage.tsx). No backend, no schema.
- Verify: badge/filter shows exactly the net-only set; checklist links navigate; demo run
  completes with only outbound internet; empty state is actionable for a non-admin.

### Phase 1 — Scopes CRUD (M)

- New `scopes` table (+ re-export in `schema/index.ts`, `bun run migration:push`).
- New `backend/src/scopes/{scopes.module,controller,service,repository,dto}.ts` copied
  from `backend/src/agent-skills/*`; register `ScopesModule` in `app.module.ts`
  `coreModules`.
- Frontend: new `TargetsPage.tsx` + `pages/targets/*` (mirror
  [SchedulesPage.tsx](../../../frontend/src/pages/SchedulesPage.tsx) and `pages/schedules/`),
  `TargetEditorDialog.tsx` + `useTargetEditorState.ts` (mirror the schedule editor),
  `useTargetQueries.ts`, `services/api/targets.ts`, `queryKeys.ts` targets block, route in
  [routes.tsx](../../../frontend/src/routes.tsx), nav item in
  [AppLayout.tsx](../../../frontend/src/components/layout/AppLayout.tsx) `navigationItems`,
  and `prefetch-routes.ts`.
- Verify: full CRUD round-trips; org-scoped query keys embed `getOrgScope()`; unique
  `(org, name)` enforced; empty state helpful.

### Phase 2 — Run any template against a scope, prefilled (M)

- "Run against this scope" action (per-row and on scope detail header) opens the existing
  `RunWorkflowDialog` with the scope's `runtimeValues` merged over per-input defaults.
- Merge helper `mergeScopeValues(defaults, scopeValues, runtimeDefs)` at
  [useWorkflowRunner.tsx](../../../frontend/src/features/workflow-builder/hooks/useWorkflowRunner.tsx)
  `handleRun` (~lines 211–219), replacing the current
  `setPrefilledRuntimeValues(resolveRuntimeInputDefaults())`. Keyed by runtime-input `id`
  - type compatibility. No dialog changes needed — `RunWorkflowDialog` already accepts
    arbitrary `initialValues` (that's how rerun prefills).
- Share the helper with the schedule editor path
  ([RuntimeInputsSection.tsx](../../../frontend/src/components/schedules/RuntimeInputsSection.tsx))
  so scheduled runs prefill identically.
- Defense-in-depth server merge in `prepareRunPayload` where `inputs = request.inputs ?? {}`:
  `inputs = {...scopeValues, ...request.inputs}` so explicit request values still win (covers
  API/scheduled/headless runs).
- Discover fillable inputs via `GET :id/runtime-inputs`
  ([workflows.controller.ts](../../../backend/src/workflows/workflows.controller.ts)).
- Secret-typed inputs stay **out** of scope storage; the worker `entry-point.ts` remains
  the authoritative required/default enforcement, so a scope missing a required input still
  fails loudly there (acceptable).
- Verify: launching from a scope prefills matching inputs; unmatched inputs left to
  defaults; explicit dialog edits win over scope values.

### Phase 3 — Run↔scope linkage + per-scope run history (M)

- Add nullable `scopeId` to `workflow_runs` + index; thread `scopeId` into
  `CreateWorkflowRunInput` and the repository `upsert()` (both `values` and `updateValues`);
  accept `scopeId` in the run-request body; add `prepareRunPayload` + `PreparedRunPayload`
  - `startPreparedRun` plumbing; add a `countByScope` list filter.
- Frontend: `TargetDetailPage.tsx` (mirror
  [WebhookEditorPage](../../../frontend/src/pages/WebhookEditorPage.tsx) route-driven Tabs)
  with a "Run History" tab; `useTargetRuns(id)`.
- Verify: a run launched against a scope carries `scopeId` after both upsert passes; the
  scope's Run History lists its runs with resolved status + counts.

### Phase 4 — Asset inventory auto-feed (L) — the core over-time feature

- New `asset_inventory` table (FK `scopeId` → scopes, cascade; + re-export).
- New `backend/src/assets/{module,controller,service,repository,dto}.ts`.
- Hook: after `NodeIORepository.recordCompletion`
  ([node-io.repository.ts:91](../../../backend/src/node-io/node-io.repository.ts)) emit
  `EventEmitter2` `asset.nodeio.completed`. `AssetInventoryService` consumes it:
  1. recover `organizationId` + `scopeId` from the `node_io` row + `workflow_runs`
     (the COMPLETION Kafka event omits org/workflow; read them from the row);
  2. **guard null org** (node_io.organizationId is nullable) — skip if absent;
  3. **skip runs with no `scopeId`** (explicit-only feed);
  4. run `normalizeFindings`/asset-key extraction over outputs, **fetching
     `outputsStorageRef` from object storage when the payload spilled** (decision: full
     capture, not partial);
  5. upsert into `asset_inventory` on the dedup key.
- Frontend: `useTargetAssets(id)` + an "Assets" tab on the scope detail, filterable by
  type, showing first/last seen + source run.
- Verify: a recon run against a scope populates assets; re-running bumps `lastSeenAt`
  without changing `firstSeenAt`; a spilled large run (thousands of subdomains) is fully
  captured; deleting a scope cascades its assets; ingestion failure never breaks the run
  record.

### Phase 5 — (optional) Per-scope finding counts + demo polish (M)

- Per-scope finding counts via an OpenSearch `run_id` terms-aggregation over the scope's
  `runIds` (works for all runs today, no re-index) — preferred over stamping `scope_id`
  into docs (which only populates when an analytics-sink node exists). Touches
  `backend/src/analytics/findings.controller.ts` + `dto/findings-query.dto.ts`.
- Surface counts on the scope card/detail.

## 5. Decided Defaults

- **Per-scope asset duplication**, not org-global assets. Dedup key is
  `(org, scopeId, type, value)`. The same host in two scopes = two rows. Simpler, matches
  the per-scope framing.
- **Explicit-only run→inventory feed.** A run feeds a scope only if launched against it
  (`scopeId` stamped). No fuzzy matching of run inputs to scope domains — avoids false
  attribution.
- **Auto-map scope fields → runtime inputs by id + type**, with a `runtimeValues`
  override map for templates whose target input is named unexpectedly. No per-template
  mapping UI in MVP.
- **No staleness detection** in MVP (append + bump last-seen only). Deferred.
- **Spilled recon outputs are fetched during ingest** for complete inventory (decision).
- **First-run stays online** via the existing GitHub template sync (decision).
- **Org-scoping style:** use the `agent-skills`/`finding-triage` `.notNull()` style, not
  the nullable `secrets.ts` + `DEFAULT_ORGANIZATION_ID` fallback.

## 6. Risks & Mitigations

- **Ingestion coupling.** Mitigated by the `EventEmitter2` decoupling — extractor runs
  after `recordCompletion` and its failures are caught, never blocking the write path.
- **Spill fetch cost on the ingest path.** Accepted per decision; keep the fetch behind
  the extractor's try/catch and only for asset-bearing component ids so non-recon nodes
  don't trigger reads.
- **Migration style trap.** Use `bun run migration:push`; do **not** author
  `backend/drizzle/*.sql` (legacy artifact).
- **Routing/nav trap.** Router is `routes.tsx` (not `App.tsx`); nav items are declared in
  `AppLayout.tsx` (not `SidebarNav.tsx`).
- **`templateId` is not DB-backed** despite Swagger advertising it; do not assume a
  template FK exists when building run history.

## 7. Verification Strategy

Every phase follows the repo's test conventions (Bun unit tests co-located in
`__tests__/`, plus e2e where a vertical slice warrants it):

- Phases 1/3/4 backend: repository + service specs mirroring
  `backend/src/agent-skills/__tests__/*` and `finding-triage` specs; an e2e slice under
  `e2e-tests/core/` for scopes CRUD and asset ingestion (mirror
  `e2e-tests/core/schedules.test.ts`).
- Phase 2: unit test the `mergeScopeValues` helper (defaults < scope < explicit
  precedence; type compatibility; secret exclusion).
- Phase 0/frontend: component tests mirroring existing `pages/__tests__/*`.
- Asset extractor: table-driven test over sample recon outputs (subfinder/naabu/httpx/
  dnsx/katana) asserting correct `assetType`/`assetValue` and upsert semantics.
