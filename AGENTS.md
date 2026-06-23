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
curl -sf http://localhost:3211/health/ready   # Backend readiness (Postgres/Redis/Temporal)
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
bun --cwd backend run generate:openapi
bun --cwd packages/backend-client run generate
```

### Testing

```bash
bun run test           # All tests
bun run typecheck      # Type check
bun run lint           # Lint
```

### Database

```bash
just db-reset                              # Reset active instance database
bun --cwd backend run migration:push       # Push schema
bun --cwd backend run db:studio            # View data
```

## Rules

1. TypeScript, 2-space indent
2. Conventional commits with DCO: `git commit -s -m "feat: ..."`
3. Tests alongside code in `__tests__/` folders
4. **E2E Tests**: Mandatory for significant features. Place in `e2e-tests/` folder.
5. **GitHub CLI**: Use `gh` for all GitHub operations (issues, PRs, actions, releases). Never use browser automation for GitHub tasks.

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

- **Backend**: `GET /health` (liveness) and `GET /health/ready` (readiness) via Terminus. Indicators: Postgres, Redis, Temporal.
- **Worker**: `GET :9100+N*100/health` per worker instance.

### Sticky Sessions & MCP Session Registry

- **Nginx** uses consistent hash on the `mcp_affinity` cookie for MCP routes, ensuring stateful MCP connections stick to the same backend instance.
- **Redis session registry**: keys at `mcp:sessions:{sessionId}` track active MCP sessions.
- **Admin endpoint**: `GET /api/v1/mcp/sessions` lists active MCP sessions.

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
