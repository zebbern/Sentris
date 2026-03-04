# Agent: tester (Findings Phase 2)

## Purpose

Write unit and integration tests for all new Findings Phase 2 backend endpoints and frontend components.

## Skills

Load before starting: testing-patterns

## Subtasks

### Backend DTO tests (`backend/src/analytics/__tests__/`)

- [x] Create `findings-detail.dto.test.ts` — test `FindingIdParamSchema` accepts valid non-empty strings, rejects empty strings. Test `FindingDetailResponseDto` validates a complete finding with required `raw` field
- [x] Create `findings-export.dto.test.ts` — test `FindingsExportQuerySchema` defaults (`format: 'json'`, `limit: 1000`), accepts `'csv'` and `'json'` formats, rejects invalid formats, enforces `limit` range (1–10000), inherits severity/search validation from parent schema
- [x] Create `findings-stats.dto.test.ts` — test `FindingsStatsResponseSchema` validates well-formed `{ severityCounts, total }`, rejects missing fields, accepts empty `severityCounts` array

### Backend controller tests (`backend/src/analytics/__tests__/findings.controller.spec.ts`)

- [x] Extend the existing `findings.controller.spec.ts` (or create if it doesn't exist) with test suites for the three new endpoints
- [x] `GET /findings/stats` tests:
  - Returns severity counts from OpenSearch aggregation buckets
  - Returns `{ severityCounts: [], total: 0 }` when OpenSearch is disabled
  - Returns 401 when unauthenticated
  - Returns 401 when no organization context
- [x] `GET /findings/export` tests:
  - Returns JSON blob with correct Content-Type and Content-Disposition headers when `format=json`
  - Returns CSV blob with correct headers when `format=csv`
  - CSV output contains expected columns: `id, timestamp, severity, name, asset_key, workflow_name, workflow_id, run_id, component_id, node_ref`
  - CSV properly escapes values containing commas and quotes
  - Applies severity and search filters to the OpenSearch query
  - Respects the `limit` parameter
  - Returns 401 when unauthenticated
  - Returns 500 when OpenSearch query fails (not empty results — exports fail visibly)
- [x] `GET /findings/:id` tests:
  - Returns full finding detail when document exists
  - Returns 404 `Finding not found` when no hits returned
  - Returns 503 when OpenSearch client is disabled
  - Returns 401 when unauthenticated
  - Includes `raw` field with complete `_source` data in the response
- [x] Mock `SecurityAnalyticsService` and `AuditLogService` following the existing test patterns in the analytics `__tests__/` directory

### Frontend query hooks tests (`frontend/src/hooks/queries/__tests__/`)

- [x] Create `useFindingsQueries.test.ts` (or extend existing) with tests for:
  - `useFindingDetailQuery` — disabled when `id` is null, enabled and fetches when `id` is provided, returns finding data on success
  - `useFindingsStatsQuery` — fetches stats on mount, returns severity counts
  - Verify correct query keys are used (match `queryKeys.findings.detail(id)` and `queryKeys.findings.stats()`)

### Frontend API service tests (`frontend/src/services/api/__tests__/`)

- [x] Create `findings.test.ts` — test that `findingsApi.get(id)` calls the correct endpoint path, `findingsApi.getStats()` calls `/findings/stats`, `findingsApi.exportFindings()` calls `/findings/export` with correct query params and returns a Blob

### Frontend component tests (`frontend/src/features/findings/__tests__/`)

- [x] `FindingDetailSheet.test.tsx` — renders sheet when `isOpen` is true, shows loading skeleton while query is pending, displays finding fields (severity, name, timestamp, asset_key, workflow info) when data is loaded, shows raw JSON toggle section, calls `onClose` when close button is clicked, does not render when `isOpen` is false
- [x] `ExportButton.test.tsx` — renders dropdown with CSV and JSON options, shows loading state during export, calls export API with correct format on option click, handles export error gracefully (shows notification)
- [x] `SeverityChart.test.tsx` — renders bar chart with severity data, shows loading skeleton while stats query is pending, shows empty state when no data, renders correct number of bars matching severity count entries
- [x] `DateRangeFilter.test.tsx` — renders trigger button showing "All time" when no range selected, opens popover on click, shows selected range in trigger text when dates are set, calls onChange with new range on date selection, clears range when Clear button is clicked
- [x] `WorkflowFilter.test.tsx` — renders select with workflow options, calls onChange with selected workflow ID, includes "All workflows" option
- [x] `ToolFilter.test.tsx` — renders select with tool/component options, calls onChange with selected component ID, includes "All tools" option

### FindingsPage integration tests

- [ ] Extend or create `FindingsPage.test.tsx` — test that clicking a table row opens the detail sheet with the correct finding ID, test that export button appears in the toolbar, test that advanced filter selects render, test that changing a filter resets the page to 1

## Notes

- Backend tests use `bun:test` (see existing pattern in `findings-query.dto.test.ts`).
- Frontend tests use Vitest + React Testing Library (verify by checking the project's test setup in `vite.config.ts` or `vitest.config.ts`).
- Mock TanStack Query hooks in component tests using `QueryClientProvider` with a test client, or mock the hooks directly.
- For Recharts component tests, don't assert pixel-level rendering — test that the chart renders without errors and that the expected data is passed.
- The `SecurityAnalyticsService` mock should return realistic aggregation responses for stats tests: `{ aggregations: { severity_counts: { buckets: [{ key: 'high', doc_count: 42 }] } } }`.
- CSV tests should verify actual CSV content (parse the output), not just status codes.

## Completion Summary

<!-- Appended by orchestrator after agent completes. Do not fill manually. -->
