# Agent: implementer (Findings/Vulnerability Dashboard — Phase 1)

## Purpose

Build a read-only Findings page that displays security findings from OpenSearch, with a backend endpoint and frontend table view.

## Skills

Load before starting: none

## Subtasks

### Backend — Findings Endpoint

- [x] Create `GET /api/findings` endpoint in a new controller (`backend/src/analytics/findings.controller.ts`) or extend `analytics.controller.ts` with a dedicated `GET findings` route. The endpoint must:
  - Require authentication and organization context (follow existing pattern in `analytics.controller.ts` — `@CurrentAuth()`, check `auth.isAuthenticated` and `auth.organizationId`)
  - Accept query params: `page` (default 1), `pageSize` (default 25, max 100), `severity` (optional filter), `search` (optional text search across fields)
  - Delegate to `SecurityAnalyticsService.query()` which already queries `security-findings-{orgId}-*` indices
  - Return a response shaped `{ items: Finding[], total: number, page: number, pageSize: number }` where `Finding` includes at minimum: `id`, `timestamp`, `severity`, `title/name`, `asset_key`, `workflow_name`, `workflow_id`, `run_id`, `component_id`, `node_ref`
  - Apply proper pagination (`from` / `size` mapping)
- [x] Create a Zod DTO for the findings query params and response (`backend/src/analytics/dto/findings-query.dto.ts`)
- [x] Add Swagger decorators (`@ApiTags`, `@ApiOperation`, `@ApiOkResponse`) to the new endpoint
- [x] Register the controller in `analytics.module.ts` if creating a new controller file

### Frontend — Findings Page

- [x] Create the page component at `frontend/src/pages/FindingsPage.tsx` following the existing page pattern (see `DashboardPage.tsx`, `WebhooksPage.tsx` for reference):
  - Page title via `useDocumentTitle('Findings')`
  - Full-width table layout with header row containing page title and optional export button
- [x] Create a React Query hook at `frontend/src/hooks/queries/useFindingsQueries.ts`:
  - `useFindingsQuery({ page, pageSize, severity, search })` — calls `GET /api/findings` with query params
  - Follow existing hook patterns (see `useAuditLogQueries.ts` or `useWebhookQueries.ts`)
- [x] Build the findings table using Shadcn `Table` / `TableHeader` / `TableBody` / `TableRow` / `TableCell` components (already used in `DashboardPage.tsx`):
  - Columns: Timestamp, Severity (with colored badge), Title/Name, Asset, Workflow, Run ID
  - Sortable by timestamp (default: newest first)
  - Empty state when no findings exist
- [x] Add severity filter — dropdown or segmented control with options: All, Critical, High, Medium, Low, Info
- [x] Add text search input (debounced, 300ms) that filters across title, asset, workflow name
- [x] Add pagination controls using existing pagination patterns (page number + prev/next)
- [x] Handle loading state (skeleton rows) and error state (`ErrorBanner`)

### Navigation & Routing

- [x] Add route to `frontend/src/routes.tsx`: lazy-load `FindingsPage` at `/findings`
  - Always shown (not gated on OpenSearch env var). Backend returns empty results gracefully when OpenSearch is disabled.
- [x] Add "Findings" nav item to `navigationItems` array in `frontend/src/components/layout/AppLayout.tsx` with `ShieldAlert` icon

### Tests

- [x] Write a unit test for the findings DTO validation (`backend/src/analytics/__tests__/findings-query.dto.test.ts`) — 11 tests pass
- [x] Write a frontend unit test for `FindingsPage.tsx` rendering: loading state, empty state, populated table (`frontend/src/pages/__tests__/FindingsPage.test.tsx`) — 10 tests pass

## Notes

- **Data source**: Findings are stored in OpenSearch under `security-findings-{orgId}-*` indices. The `SecurityAnalyticsService.query()` method already supports querying these indices with arbitrary OpenSearch DSL. The new endpoint is a convenience wrapper that maps REST query params to OpenSearch DSL.
- **Existing query endpoint**: `POST /api/analytics/query` already exists and takes raw OpenSearch DSL. The new `GET /api/findings` endpoint is a higher-level, paginated, filterable API specifically for the findings table — it should internally call `SecurityAnalyticsService.query()`.
- **Document shape**: Each indexed document contains enriched fields: `@timestamp`, `workflow_id`, `workflow_name`, `run_id`, `node_ref`, `component_id`, `asset_key`, plus arbitrary fields from the security tool output. Common fields to look for: `severity`, `name`/`title`, `host`/`domain`/`url`.
- The frontend uses React Router, Shadcn UI, TanStack Query, and Zustand. Follow existing patterns exactly.
- Phase 1 is read-only — no create/update/delete operations on findings.

## Completion Summary

<!-- Appended by orchestrator after agent completes. Do not fill manually. -->
