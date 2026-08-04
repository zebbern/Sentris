# Sentris Flow

Security workflow orchestration platform. Visual builder + Temporal for reliability.

To ensure security automation workflows work correctly, values such as these can be set when running the workflow locally to ensure realistic testing(not limited to these but good examples):

- Website: http://scanme.nmap.org/
- Website: https://preview.owasp-juice.shop/#/
- Any github repo
- Any npm package
- Any public API endpoint

## Stack

- `frontend/` — React + Vite
- `backend/` — NestJS API
- `worker/` — Temporal activities + components
- `packages/` — Shared code (component-sdk, backend-client)

## Development

Full setup guide: `docs/development/dev-environment.mdx`

```bash
# First time setup
just init                          # Install deps + create .env files
# OR (without just):
bun install && cp backend/.env.example backend/.env && cp worker/.env.example worker/.env && cp frontend/.env.example frontend/.env

# Start dev environment (Docker infra + PM2 apps)
just dev                           # Recommended (Linux/macOS/WSL)
# OR:
bun run dev                        # Cross-platform; respects SENTRIS_INSTANCE/.sentris-instance
# OR (manual):
docker compose -f docker/docker-compose.infra.yml -f docker/docker-compose.dev-ports.yml up -d
bun run pm2 -- startOrReload pm2.config.cjs --only sentris-frontend-0,sentris-backend-0,sentris-worker-0

# Status & logs
just dev status                    # PM2 + Docker + runtime health status
just dev logs                      # Tail app logs
bun run dev status                 # Cross-platform PM2 + Docker + runtime health status
bun run dev logs                   # Cross-platform PM2 app logs
bun run pm2 -- status              # PM2 only via repo-local binary
docker ps --filter name=sentris    # Docker only

# Stop
just dev stop                      # Stop PM2 + Docker
# OR:
bun run dev stop
# OR:
bun run dev:stop
# OR (manual):
bun run pm2 -- delete sentris-frontend-0 sentris-backend-0 sentris-worker-0 && docker compose -f docker/docker-compose.infra.yml -f docker/docker-compose.dev-ports.yml down

# Health checks
curl -sf http://localhost:3211/health        # Backend liveness
curl -sf http://localhost:3211/health/ready   # Backend readiness (Postgres/Redis/Temporal/enabled Kafka ingest)
curl -sf http://localhost:5173               # Frontend
curl -sf http://localhost                    # Nginx (auth gate)

just help                          # All commands
```

**Active instance**:

```bash
just instance show     # Print active instance number
bun run instance show  # Cross-platform fallback; initializes .sentris-instance to 0 if missing
just instance use 5    # Set active instance for this workspace
bun run instance use 5 # Cross-platform fallback
```

**Instance env files**:

```bash
just instance-init 5           # Initialize .instances/instance-5/*.env
just instance-env init 5       # Create from app/.env or app/.env.example
just instance-env update 5     # Re-apply instance-scoped vars
just instance-env copy 5 6     # Copy env setup from instance 5 -> 6
just instance-env show 6       # Show file status and computed values
```

**URLs**:

- Frontend: `http://localhost:${5173 + instance*100}`
- Backend: `http://localhost:${3211 + instance*100}`
- Temporal UI (shared): <http://localhost:8081>

Full details: `docs/MULTI-INSTANCE-DEV.mdx`

### Multi-Instance Local Dev (Important)

Local development runs as **multiple app instances** (PM2) on top of **one shared Docker infra stack**.

- Shared infra (Docker Compose project `sentris`): Postgres/Temporal/Redpanda/Redis/MinIO/Loki on fixed ports.
- Per-instance apps: `sentris-{frontend,backend,worker}-N`.
- Isolation is via per-instance DB + Temporal namespace/task queue + Kafka topic suffixing + instance-scoped Kafka consumer groups/client IDs (not per-instance infra containers).
- The workspace has an **active instance** (stored in `.sentris-instance`, gitignored). If neither `SENTRIS_INSTANCE` nor `.sentris-instance` exists, cross-platform tooling initializes `.sentris-instance` to `0` instead of silently guessing.
- Instance env files are stored at `.instances/instance-N/{backend,worker,frontend}.env` and can be managed with `just instance-env ...`.
- `bun run dev` initializes or repairs the active instance env files before PM2 starts, so PowerShell and Bash dev startup use the same instance-scoped env behavior.
- `just dev`, `bun run dev`, `just dev clean`, and `bun run dev clean` prune oversized PM2 logs for the selected instance. The default cap is 64MB per app log file; override with `SENTRIS_PM2_LOG_MAX_BYTES`.
- Backend PM2 dev watch includes `backend/src`, `backend/scripts/seed-templates`, and `packages/shared/src`; worker PM2 dev watch includes worker source plus shared runtime package sources. Keep this in sync when template validation inputs, seed catalogs, or shared execution contracts move.

**Agent rule:** before running any dev commands, ensure you’re targeting the intended instance.

- Always check: `just instance show`; if `just` is unavailable, run `bun run instance show`. Either command initializes `.sentris-instance` to `0` when no active instance has been selected.
- If the task is ambiguous (logs, curl, E2E, “run locally”, etc.), ask the user which instance to use.
- If the user says “use instance N”, prefer either:
  - `just instance use N` then run `just dev` / `bun run test:e2e`, or
  - explicit env override (`SENTRIS_INSTANCE=N just dev ...` or `SENTRIS_INSTANCE=N bun run dev`) for one-off commands.
- Local maintenance scripts that mutate or inspect local Postgres data must use the shared script runtime (`scripts/lib/local-script-runtime.ts`) instead of reading `DATABASE_URL` directly. `DATABASE_URL` is for the running app process, production Drizzle runs, and explicit app env files; local scripts should target `SENTRIS_INSTANCE` / `.sentris-instance` by default and only use script-specific overrides such as `TEMPLATE_SEED_DATABASE_URL`, `DRIZZLE_DATABASE_URL`, or the generic `SENTRIS_SCRIPT_DATABASE_URL`.
- Local scripts that start or inspect Temporal workflows must also use `getScriptTemporalTarget()` from the shared script runtime instead of reading `TEMPORAL_NAMESPACE` / `TEMPORAL_TASK_QUEUE` directly. Use script-specific `*_TEMPORAL_NAMESPACE` + `*_TEMPORAL_TASK_QUEUE` variables or `SENTRIS_SCRIPT_TEMPORAL_NAMESPACE` + `SENTRIS_SCRIPT_TEMPORAL_TASK_QUEUE` when intentionally targeting another namespace.
- Maintenance scripts must print the target database and/or Temporal target before mutating data or starting workflows.

#### Ports / URLs

- Frontend: `5173 + N*100`
- Backend: `3211 + N*100`
- Temporal UI (shared): <http://localhost:8081>

#### E2E tests

- E2E targets the backend for `SENTRIS_INSTANCE`, then legacy `E2E_INSTANCE`, then the active instance.
- `bun run test:e2e*` uses the cross-platform Node runner at `scripts/e2e-test.js`; do not reintroduce Bash-only active instance lookup in package scripts.
- When asked to run E2E, confirm the instance and ensure that instance is running: `SENTRIS_INSTANCE=N just dev start`, `SENTRIS_INSTANCE=N bun run dev`, or `just instance use N` then `just dev start`.

#### Keep docs in sync

If you change instance/infra behavior (justfile/scripts/pm2 config), update `docs/MULTI-INSTANCE-DEV.mdx` and this section accordingly in the same PR.

### After Backend Route Changes

```bash
bun --cwd=backend run generate:openapi
bun --cwd=packages/backend-client run generate
```

Backend startup and OpenAPI generation intentionally use `backend/scripts/build-app.ts`.
Do not switch them back to direct `bun src/*.ts` execution: Nest requires legacy
decorator metadata that Bun's bundler emits but its direct TypeScript runtime does not.

### Testing

```bash
bun run test           # All tests
bun run typecheck      # Type check
bun run lint           # Lint
```

The local pre-push hook checks affected TypeScript projects plus test files changed by the
pushed commits. The complete monorepo suite remains a CI and explicit `bun run test` gate; do
not restore the full serial suite to every local push.

### Database

```bash
just db-reset                              # Reset active instance database
bun run migrate                            # Apply checksum-verified migrations
bun --cwd=backend run migration:generate -- --name <name> # Generate + seal a reviewed artifact
bun --cwd=backend run db:studio            # View data
```

`backend/migrations` is authoritative. `backend/drizzle` is historical only. The
`migration:push:dev-only` command requires
`SENTRIS_ALLOW_DISPOSABLE_SCHEMA_PUSH=true`, resolves and prints the target
through the shared local-script runtime, and may be used only against an
intentionally disposable development database. It rejects production/staging
environments and direct Drizzle config/credential target overrides, and must not
be used in startup, reset, or other operational paths.

## Rules

1. TypeScript, 2-space indent
2. Conventional commits with DCO: `git commit -s -m "feat: ..."`
3. Tests alongside code in `__tests__/` folders
4. **E2E Tests**: Mandatory for significant features. Place in `e2e-tests/` folder.
5. **GitHub CLI**: Use `gh` for all GitHub operations (issues, PRs, actions, releases). Never use browser automation for GitHub tasks.

### Engineering and Product Decision Preferences

- Keep TypeScript imports at file scope unless a real runtime-loading or code-splitting
  boundary requires a dynamic import. Switches over closed unions or enums must be
  exhaustive, using a `never` check or an equivalent compile-time assertion.
- Do not land unwired scaffolding. New APIs, maps, helpers, services, or modules must
  participate in a real end-to-end control path, and documentation or release claims
  must describe behavior that is actually reachable.
- When changing concurrent or shared state, state whether ownership is global,
  per-organization, per-run, per-session, or per-channel. Keep lookup, mutation,
  cleanup, and default-key behavior symmetric, and verify isolation between owners.
- Fix the underlying ownership, lifecycle, or abstraction problem. Do not stack local
  patches, compatibility shims, duplicated state, or parallel implementations when a
  shared root-cause fix is practical.
- Prefer one canonical implementation for behavior that must stay consistent across
  the backend, worker, frontend, scripts, or deployment modes. Temporary duplication
  is acceptable only as an explicit migration boundary with an owning module or role,
  verification criteria, and a deletion condition.
- Optimize for long-term product capability, reliability, maintainability, and
  performance. Do not preserve a known weak architecture merely because replacing it
  requires a larger but well-justified change.
- Sentris must remain useful as a locally hosted open-source alternative to expensive
  platforms. Avoid architecture that unnecessarily requires managed services, heavy
  infrastructure, or enterprise-only dependencies for the normal local path.
- Security is a product constraint, not the sole objective. Evaluate controls against
  the realistic attack surface, protected value, capability cost, latency, complexity,
  and deployment trust profile. Do not remove valuable scanner, agent, MCP, Docker,
  filesystem, or network capability solely to maximize theoretical security. Prefer
  explicit trusted-local and hardened choices when their risk models differ.
- Use mature, actively maintained tools and official integrations when they solve the
  requirement well. Do not rebuild capabilities such as scanners, package intelligence,
  model-provider abstractions, or durable orchestration without a demonstrated gap.
  Keep third-party integrations behind a Sentris-owned boundary when that prevents
  vendor lock-in or contains unstable APIs.
- Add abstractions, services, dependencies, configuration, and tests in proportion to
  demonstrated product or operational value. Avoid speculative scale architecture and
  repeated broad testing that does not increase confidence in changed behavior.

### Knowledge Freshness and Research

For non-trivial implementation decisions—especially integrations, SDKs, protocols,
platforms, AI agents, orchestration, security tooling, and architectural patterns—do
not rely only on model memory or the versions already used by this repository.

1. Check current official documentation, release notes, changelogs, compatibility
   guidance, and maintained examples before choosing the design.
2. Verify whether a newer official SDK, integration, protocol revision, or simpler
   supported pattern materially changes the implementation approach.
3. Prefer primary sources and maintained upstream tools over remembered patterns,
   third-party summaries, or locally reinvented equivalents.
4. Compare the current repository versions and behavior with the latest supported
   versions. Record important compatibility constraints and migration consequences in
   the design or ADR.
5. If official sources do not resolve a material ambiguity, present the viable choices
   or ask the user rather than silently defaulting to an older remembered approach.
   Minor gaps may use a stated, evidence-based assumption.

Research should inform an implementation decision, not become open-ended work. Once
the relevant current approach and compatibility boundary are established, proceed with
focused implementation and proportional verification.

### Frontend: Read Before Writing Code

Before writing ANY frontend code that fetches data or adds a page, you MUST read these files first:

1. `frontend/docs/state.md` — Decision guide: TanStack Query vs Zustand, hook patterns, anti-patterns
2. `frontend/docs/performance.md` — Stale time tiers, bundle splitting, prefetch patterns, query key architecture
3. `frontend/src/lib/queryKeys.ts` — Existing query key factories (add new keys here, never inline)
4. Browse `frontend/src/hooks/queries/` — Follow existing hook naming conventions (`use<Domain>Queries.ts`)

### Frontend Data Fetching (Mandatory)

1. **All API data must use TanStack Query hooks** in `frontend/src/hooks/queries/`. Never use `useState` + `useEffect` to fetch backend data — this is the single most important frontend rule.
2. **Query keys** go in `frontend/src/lib/queryKeys.ts` (org-scoped, factory functions).
3. **After mutations**, invalidate the relevant query cache via `queryClient.invalidateQueries()` — do not manually update local state.
4. **Derive data** from query results using `useMemo`, not by copying into separate `useState`.
5. **Zustand stores** are for client-only UI state (canvas, timeline, auth, notifications, command palette). Never store API data in Zustand.
   - `notificationStore` — Notification history, unread count, persistent via localStorage (max 50, FIFO).
   - `commandPaletteStore` — Global search command palette open/close state.
6. **Per-route ErrorBoundary**: Every lazy-loaded route in `App.tsx` is wrapped in an `<ErrorBoundary>` so a crash in one page does not break the entire app.

See `frontend/docs/state.md` for patterns, anti-patterns, and the full decision guide.

### Frontend Performance (Mandatory)

See `frontend/docs/performance.md` for the complete reference with code examples.

1. **Every new page must use `React.lazy()`** in `App.tsx`. Add the route to `routePrefetchMap` in `src/lib/prefetch-routes.ts`.
2. **Set `staleTime: Infinity` for static/reference data** (components, templates, providers). The 30s default is wrong for them.
3. **Use `skipToken` for conditional queries** instead of `enabled: false` alone. See `useRunQueries.ts`.
4. **Granular Zustand selectors**: `useStore((s) => s.field)`, never `const store = useStore()`.
5. **No N+1 queries**: never call a query hook inside `.map()`. Use a batched endpoint (see `useMcpGroupsWithServers`).

---

## Architecture

Full details: **`docs/architecture.mdx`**

```text
Frontend ←→ Backend ←→ Temporal ←→ Worker
                                      ↓
                            Component Execution
                                      ↓
              Terminal(Redis) | Events(Kafka) | Logs(Loki)
                                      ↓
                          Frontend (SSE/WebSocket)
```

### Component Runners

- **inline** — TypeScript code (HTTP calls, transforms, file ops)
- **docker** — Containers via `execFile()` (no shell; security tools: Subfinder, DNSX, Nuclei)
- **remote** — External executors (future: K8s, ECS)

### Real-time Streaming

- Terminal: Redis Streams → SSE → xterm.js
- Events: Kafka → WebSocket
- Logs: Loki + PostgreSQL

### Health Checks

- **Backend**: `GET /health` (liveness) and `GET /health/ready` (readiness) via Terminus. Indicators: Postgres, Redis, Temporal, and all enabled Kafka ingest consumers.
- **Worker (local PM2)**: `GET :18000+N*10/health` per worker instance. The
  instance's Docker MCP proxy uses offset `+1` and runtime owner uses offset `+2`.
  Production Compose keeps fixed internal ports `9100`, `9101`, and `9301`.

### MCP Protocol Migration

MCP `2026-07-28` removes transport-level sessions from modern HTTP. The run gateway now
uses the official v2 request-local facade for modern and legacy-stateless clients. Run
gateway transport sessions, affinity cookies, cached inbound servers, and sticky routing
have been removed; its requests use the ordinary backend upstream. SDK-independent
shared capability-catalog and invocation contracts also exist.

Studio remains a v1 sessionful endpoint on sticky routing, and the outbound gateway
remains an explicit v1 run-and-endpoint-scoped compatibility pool. New runs materialize
immutable grants/catalog snapshots; the run gateway lists the persisted snapshot and
component calls use keyed Workflow Updates with durable invocation attempts. The legacy
live-catalog/signal path is only for pre-deployment Workflow histories and unexpired
tokens without `capabilitySnapshotId`; remove it after those histories are terminal or
retired and Redis has no such token (maximum token TTL: three hours).

Saved-server discovery now uses the worker-owned, Redis-lease-fenced runtime manager and
the official v2 client. Worker instances own HTTP/host-stdio/Docker transports, route one
hop to the exact owner when needed, resolve version-pinned credentials only after lease
reservation, and release discovery runtimes in Temporal cleanup. Complete immutable
catalogs preserve tools, resources, resource templates, and prompts. Acquisitions include
a caller-supplied holder ID; durable callers must derive it from stable execution identity
so retries reuse the same holder, and every operation/release must carry that holder plus
the full fence. Do not add another backend/worker MCP client or bypass this runtime
boundary.

The in-app Operator now runs each user turn as a Temporal Workflow with durable typed
actions, ask-or-auto approvals, and turn-scoped immutable MCP authority. Ordinary new histories
release the turn after launching a workflow and follow its run and Agent children through
the canonical run trace/Agent SSE pipeline; a patch-gated blocking observer exists only for
old-history replay. A terminal outbox event for an ordinary Operator-launched run starts one
idempotent durable coordinator, which waits for session availability and creates a fresh bounded
`get_run` summary turn; it does not reopen or block the launch turn. Terminal inspections include
bounded trace, finding, and artifact evidence. The frontend renders that typed evidence as a
deterministic result panel with run-scoped finding links, artifact downloads, and the existing
typed run controls rather than relying on model-generated actions. The explicit `improve_run`
journey is the deliberate exception: one turn
proposes a bounded edit, applies it through the same Ask/Auto policy, reruns the source inputs,
waits durably through retrying observations, compares recorded evidence, and summarizes the
result. Explicit run-card inspect, cancel, and retry controls are structured,
user-confirmed Operator turns. Retry creates one new run from the original stored version,
inputs, and scope with action-ID idempotency; it never mutates a completed Agent child. Its
tool, resource, and prompt calls dispatch through the same canonical runtime and durable
invocation path. Bounded multi-action requests may produce an immutable three-to-eight-step
`propose_operator_plan` preview. Run starts a separate patch-gated `execute_plan` journey by
proposal-action ID; it schedules the existing typed action boundary sequentially with stable
step identities, keeps Ask/Auto approval semantics, projects progress from the action ledger,
and supports exact-turn cancellation. The authoritative action status crosses the activity
boundary, so a failed action stops the plan before later steps run; successful new histories use
a patch-gated text-only model step to summarize durable results, then append bounded exact
workflow/run links derived from typed action results. Summarization that is unavailable or
incomplete falls back to a deterministic completion message. Revise creates a new proposal. A
later step may bind an
earlier step's string result into one top-level command argument through bounded RFC 6901 source
and target pointers; the Workflow resolves the durable activity result deterministically and the
canonical backend boundary validates the completed command input. Forward references, nested
targets, literal/bound conflicts, and turn-scoped MCP snapshots remain excluded. Do not add a
general expression language, string templating, or a second plan executor. Workflow
authoring also uses typed durable actions: component discovery is
registry-backed, new-workflow proposals use credential-safe bounded graphs, and existing-workflow
proposals use bounded operations keyed by stable node and edge IDs. The backend materializes
those operations against the exact immutable base; both paths share compile validation and a
graph diff, and apply is a separate consequential action using proposal-ID idempotency plus an
exact base-version fence. The Builder may hydrate a proposal only as an unsaved draft and restores
credential placeholders from the freshly fetched persisted graph. Turn records snapshot the
initiating actor roles so delayed authoring keeps the user's workflow authority. Provider-native
tool-call continuation metadata lives in the Temporal turn history; Postgres action rows remain
provider-neutral audit records. Run-derived update proposals carry their validated source-run
identity through apply and stage a new immutable version without changing the workflow's
`current_version_id`. The improvement journey runs that exact candidate with the source run's
stored inputs and scope; manual authoring controls may still perform these stages in separate
turns. Version-unspecified launches and optimistic edit fences use `current_version_id`, not the
numerically latest staged version. Keep this distinct from Retry, which continues to select the
original immutable version. Once both runs are terminal, the read-only `compare_runs` command verifies
same-workflow lineage and stored input/scope comparability,
then assesses terminal outcome. Optional deterministic success criteria live in the immutable
workflow graph and use the candidate version as the fixed benchmark for both runs. Supported
v1 criteria are scalar node-output assertions addressed by RFC 6901 JSON Pointer and bounded
finding-count ranges; conflicting or unavailable criterion evidence remains inconclusive and
must not be replaced with an LLM quality score. Exact trace-failure counts are the fallback
when no criteria are declared. Raw finding totals and duration remain observations only, and
mismatched inputs/scopes are always inconclusive. Comparison does not auto-promote: the
consequential `promote_workflow_version` command is the canonical Keep action and accepts only
the exact terminal candidate run/version pair while fencing on the compared source/base version
so a concurrent workflow edit cannot be overwritten. Revise starts a new improvement journey from the
candidate without changing the current-version pointer.

The generic workflow-graph `core.ai.agent` now prepares each turn in an activity and runs
the loop as a patch-gated Temporal child Workflow. Inline provider keys are sealed with
the secret-store master key before durable storage, and only a sanitized component input
plus compact state/authority refs enter the child history. Model steps and canonical MCP
operations are separate durable activities; native AI SDK continuation messages, tool
arguments, and tool results are checkpointed in organization-scoped object storage.
Top-level and For Each nodes share this execution boundary; pre-patch histories retain
the legacy single-activity loop. Provider-declared model finish errors are classified at one
worker-local boundary before either durable or legacy Agent paths can record success; Operator's
single text-only recovery remains the only caller-specific behavior. Do not add another
in-process agent loop or route these calls back through the legacy run gateway.

Remaining work is Continue-As-New, MCP Tasks, the Task 8 compatibility cleanup, the
bounded Studio migration, and complete resources/prompts behavior. See
`docs/architecture/adr-stateless-mcp-runtime-and-temporal-agents.md` and the linked
design spec. Do not expand the legacy session architecture while this migration is in
progress.

### Studio Sticky Sessions & MCP Session Registry

The following compatibility implementation is now limited to Studio, not the run
gateway:

- **Nginx** uses consistent hash on the `mcp_affinity` cookie for the sessionful Studio route.
- **Redis session registry**: keys at `mcp:sessions:{sessionId}` track active Studio sessions.
- **Admin endpoint**: `GET /api/v1/mcp/sessions` lists those compatibility sessions; run gateway traffic does not register there.

### Observability

- **Correlation IDs**: `X-Request-Id` middleware assigns a unique ID per request. The ID propagates through logging context and Temporal workflow metadata.

### Security Hardening

- **SSRF guard**: `component-sdk` exports `validateUrlForSsrf()` — blocks RFC 1918, link-local, loopback, CGN, Docker hostnames, and DNS rebinding before any outbound HTTP request.
- **exec→spawn migration**: All Docker commands in the worker use `execFile()` (no shell interpolation).

### Findings Dashboard

The `/findings` page provides a standalone view of aggregated security findings across workflow runs:

- Table with severity, source, status columns
- Detail view for individual findings
- Export (CSV / JSON)
- Severity distribution chart
- Advanced filters: date range, workflow, tool, severity, status

### Notification Routing

Notification channels route run lifecycle events (`run.completed`, `run.failed`, `run.cancelled`, `run.timed_out`) to external services.

- **EventEmitter2** dispatches `run.status.terminal` events (fire-and-forget, non-blocking via `@OnEvent('run.status.terminal', { async: true })`).
- **Dispatcher pattern**: `NotificationDispatcherService` listens for events, resolves matching channels, and delegates to type-specific adapters (`SlackNotificationAdapter`).
- **SSRF protection**: Slack webhook URLs are validated against a domain allowlist (`hooks.slack.com`, `hooks.slack-gov.com`). DNS IP validation blocks internal network targets.
- **Delivery tracking**: Every dispatch creates a record in the `notification_deliveries` table with status (`pending` → `sent` | `failed`) and error details.
- **Frontend**: Settings > Channels tab (admin-only) for CRUD, test delivery, and delivery history.

### Bidirectional Ticketing

External ticket systems (Jira) sync with finding triage state. Outbound: `finding.triage.changed` EventEmitter2 events trigger ticket creation/updates. Inbound: HMAC-verified webhooks from Jira update triage status. Circular sync prevention via `source` parameter. OAuth 2.0 tokens stored encrypted (AES-256-GCM).

### Triage Analytics & SLA Policies

The `/analytics` page provides triage performance metrics derived from `finding_triage` and `finding_triage_events` tables.

- **6 analytics endpoints** under `GET /findings/analytics/*`: posture-trend (area chart data by severity), triage-velocity (status transitions over time), MTTR (mean time to remediation by severity), SLA compliance (deadline adherence by severity), status-distribution (current triage status breakdown), top-assignees (leaderboard by resolution volume).
- **SLA policy management** (`GET/PUT /findings/sla-policies`): Configurable per-org severity→deadline mappings. Admin-only write access via `@Roles('ADMIN')`. Atomic replacement via transactional delete+insert.
- **Database**: `sla_policies` table with unique `(organization_id, severity)` constraint. Time-series indexes on `finding_triage(organization_id, created_at)` and `(organization_id, severity_override, created_at)` for aggregation query performance.
- **Frontend**: recharts charts (AreaChart, BarChart, PieChart), MTTR KPI cards, top assignees table, SLA policy settings form. WCAG 2.2 AA accessible — visually-hidden data tables, `role="img"` containers, `aria-busy` loading states, `prefers-reduced-motion` support.

## Learned User Preferences

- Prefers compact app chrome: shorter top bar, narrower sidebar, centered sidebar icons/brand, and icon-only controls with hover/aria labels (canvas overlays and App top-bar actions like Refresh / New) instead of always-visible button text.
- Component config panel should default to hiding non-editable info sections (e.g. Documentation); keep anything that changes run behavior; persist like other UI prefs; toggle copy is "Hide info sections?" / "Show info sections?".
- After frontend UI work, verify in the browser rather than relying on code review alone.
- Browser document title should be "Sentris Flow" only (no tagline).
- List-page primary controls belong in the App top bar when practical (Refresh, search, status/view toggles such as Table/Kanban or Official/Community), not only in page toolbars.
- Prefers denser list pages: less empty space above tables, filter rows on one line when they fit, and compact single-row KPI strips (e.g. MTTR cards).
- Template Library cards should stay clean: hide setup spots and extra tag chips on the grid (show those in the preview modal); Community cards should show an in-card workflow preview like Official; avoid hover translate/shift on cards.
- Prefers simple component parameters over extra modes/options; for agent/CVE research workflows, maximize chance of real findings over cost or tight timeout conservatism.
- Prefers single zip/archive download for repo fetch when equivalent to multi-request clone paths.
- Execution timeline: play at end should restart from the beginning; prefer unit-based duration display (ms/s/m/h) over padded `0:0x` clock-style text.

## Learned Workspace Facts

- App shell visual baseline: main background around `#151618`, top/sidebar chrome around translucent `#191a1f`.
- Canvas heatmap control belongs with Smart Routing overlays on the canvas (not only in the workflow top bar).
- Agent Skills are folder bundles (not only a single `SKILL.md`) and should be discoverable from `.agents/skills`, `.claude/skills`, `.github/skills`, `.codex/skills`, `.kimi/skills`, and `.opencode/skills`.
- Template Library: Official (default, Sentris-team) and Community tabs; community catalog is PR-reviewed on `zebbern/Sentris` at `community/template/` (singular), loaded from GitHub `main` raw `index.json` (override via `VITE_COMMUNITY_TEMPLATES_INDEX_URL`); prefer the real hosted catalog over local fake mirrors; Community flow is Preview + explicit Import (do not auto-run untrusted graphs), with author shoutout styling.
- Primary product use case emphasized in recent work: bug-bounty / security-research workflows aimed at reportable findings (e.g. CVE-oriented templates).
