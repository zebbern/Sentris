# Agent: implementer (Findings Phase 2 — Frontend)

## Purpose

Add finding detail sheet, export button, severity chart, advanced filters, and supporting query hooks to the findings page.

## Skills

Load before starting: none

## Subtasks

### API service layer (`frontend/src/services/api/findings.ts`)

- [x] Add `get(id: string): Promise<FindingDetailResponse>` method to `findingsApi` — calls `GET /findings/${id}`, returns the full finding with `raw` field. Add the `FindingDetailResponse` interface (same as `FindingItem` but `raw` is required `Record<string, unknown>`)
- [x] Add `exportFindings(params: FindingsExportParams): Promise<Blob>` method — calls `GET /findings/export` with query params and returns the response as a `Blob` (use the existing `httpGet` approach but with `{ responseType: 'blob' }` or a raw `fetch` call with auth headers). Add `FindingsExportParams` interface: `{ severity?: string; search?: string; format: 'csv' | 'json'; limit?: number }`
- [x] Add `getStats(): Promise<FindingsStatsResponse>` method — calls `GET /findings/stats`. Add `FindingsStatsResponse` interface: `{ severityCounts: { severity: string; count: number }[]; total: number }`
- [x] Re-export new types from `frontend/src/services/api/index.ts` (the barrel already exports all from findings)

### Query keys (`frontend/src/lib/queryKeys.ts`)

- [x] Add `detail: (id: string) => ['findings', getOrgScope(), 'detail', id] as const` to the `findings` key factory
- [x] Add `stats: () => ['findings', getOrgScope(), 'stats'] as const` to the `findings` key factory

### Query hooks (`frontend/src/hooks/queries/useFindingsQueries.ts`)

- [x] Add `useFindingDetailQuery(id: string | null)` hook — uses `queryKeys.findings.detail(id!)` with `enabled: !!id`. Returns the full finding detail. Set `staleTime: 60_000` (findings don't change often once indexed)
- [x] Add `useFindingsStatsQuery()` hook — uses `queryKeys.findings.stats()`. Returns severity counts. Set `staleTime: 60_000`
- [x] Do NOT add an `useFindingsExport` query hook — exports are one-shot actions, not cached queries. The export function will be called directly from the ExportButton component

### FindingDetailSheet component (`frontend/src/features/findings/FindingDetailSheet.tsx`)

- [x] Create a Shadcn `Sheet` component that opens from the right side. Props: `findingId: string | null`, `isOpen: boolean`, `onClose: () => void`
- [x] When `findingId` is truthy, fetch the full finding via `useFindingDetailQuery(findingId)`
- [x] Display fields in logical sections using a description list or grid layout:
  - **Overview**: severity badge, name/title, timestamp, asset_key
  - **Source**: workflow_name, workflow_id, run_id, component_id, node_ref
  - **Raw Data**: collapsible section (default collapsed) showing `JSON.stringify(raw, null, 2)` in a `<pre>` block with monospace font
- [x] Show a loading skeleton while the detail query is pending
- [x] Show an error state if the query fails (use `ErrorBanner`)
- [x] Include a close button (`X` icon) in the sheet header

### Wire FindingDetailSheet into FindingsPage (`frontend/src/pages/FindingsPage.tsx`)

- [x] Add `selectedFindingId` state (string | null, default null)
- [x] Make table rows clickable — on row click, set `selectedFindingId` to the finding's `id`. Add `cursor-pointer hover:bg-muted/50` to clickable `TableRow` elements
- [x] Render `<FindingDetailSheet findingId={selectedFindingId} isOpen={!!selectedFindingId} onClose={() => setSelectedFindingId(null)} />` at the bottom of the page component
- [x] Lazy-load the `FindingDetailSheet` component via `React.lazy()` since it's not needed on initial render

### ExportButton component (`frontend/src/features/findings/ExportButton.tsx`)

- [x] Create a button with a Shadcn `DropdownMenu` offering two options: "Export as CSV" and "Export as JSON"
- [x] On click of either option, call `findingsApi.exportFindings()` with the current page filters (severity, search) and selected format
- [x] Pass current filters via props: `{ severity?: string; search?: string }`
- [x] Trigger browser download: create an object URL from the Blob, create a temporary `<a>` element with `download` attribute, click it, revoke the URL
- [x] Show a loading spinner on the button while export is in progress. Disable the button during export
- [x] Handle errors: show a toast notification on failure (use the existing toast/notification pattern in the codebase)

### Wire ExportButton into FindingsPage

- [x] Add `<ExportButton severity={queryParams.severity} search={queryParams.search} />` to the `PageToolbar` filters area, next to the severity select

### SeverityChart component (`frontend/src/features/findings/SeverityChart.tsx`)

- [x] Create a Recharts `BarChart` (or `ResponsiveContainer` + `BarChart`) showing severity distribution
- [x] Fetch data via `useFindingsStatsQuery()` hook
- [x] Map severity values to colors: critical → `#ef4444` (red-500), high → `#f97316` (orange-500), medium → `#eab308` (yellow-500), low → `#3b82f6` (blue-500), info → `#6b7280` (gray-500)
- [x] Show a loading skeleton while data loads
- [x] If all counts are 0 or no data, show a tasteful empty state (e.g., "No severity data available")
- [x] Wrap in `ResponsiveContainer` with `width="100%"` and a fixed `height={200}`
- [x] Add axis labels: X axis = severity name, Y axis = count

### Wire SeverityChart into FindingsPage

- [x] Add the `SeverityChart` component above the table in `FindingsPage`, inside a card or section with a heading "Severity Distribution"
- [x] Only render the chart section when there's data (don't show it if OpenSearch is disabled / returns empty)

### Advanced filters — Date range (`frontend/src/features/findings/DateRangeFilter.tsx`)

- [x] Create a date range picker using Shadcn `Popover` + `Calendar` (or `DateRangePicker` if available in the project's Shadcn setup)
- [x] Props: `value: { from?: Date; to?: Date } | undefined`, `onChange: (range) => void`
- [x] Display selected range as text in the trigger button (e.g., "Mar 1 – Mar 4" or "All time" if no range selected)
- [x] Include a "Clear" button inside the popover to reset the range

### Advanced filters — Workflow selector (`frontend/src/features/findings/WorkflowFilter.tsx`)

- [x] Create a Shadcn `Select` that lists available workflows
- [x] Fetch workflow options from the existing `queryKeys.workflows.list` / workflows API (reuse what's already in the codebase for workflow listing)
- [x] Props: `value: string | undefined`, `onChange: (workflowId: string | undefined) => void`
- [x] Include an "All workflows" option that clears the filter

### Advanced filters — Tool selector (`frontend/src/features/findings/ToolFilter.tsx`)

- [x] Create a Shadcn `Select` that lists available tools/components
- [x] Source options from distinct `component_id` values — either from the stats endpoint (if extended) or from the existing components query (`queryKeys.components.all`)
- [x] Props: `value: string | undefined`, `onChange: (componentId: string | undefined) => void`
- [x] Include an "All tools" option that clears the filter

### Wire advanced filters into FindingsPage

- [x] Add `dateRange`, `workflowId`, and `componentId` state to `FindingsPage`
- [x] Pass these as additional query params to `useFindingsQuery` (the backend `FindingsQuerySchema` will need corresponding optional fields — coordinate with backend implementer or add them as pass-through query params)
- [x] Render `DateRangeFilter`, `WorkflowFilter`, and `ToolFilter` in the `PageToolbar` filters area alongside the existing severity select
- [x] Reset page to 1 when any advanced filter changes

### Backend coordination — extended query params

- [ ] Add `workflowId?: string`, `componentId?: string`, `dateFrom?: string` (ISO), `dateTo?: string` (ISO) optional fields to `FindingsQuerySchema` in the backend DTO. Add corresponding `term` filters for `workflow_id` and `component_id`, and a `range` filter on `@timestamp` for `dateFrom`/`dateTo` in the query builder
- [ ] This can be done in the backend task or here — if done here, update the DTO file and the `buildFindingsFilter` helper

**Note**: Backend coordination subtask left unchecked — the frontend passes the params correctly but the backend DTO changes are expected from the parallel backend implementer task.

## Notes

- The `features/findings/` directory does not exist yet — create it with these new components.
- Follow the existing barrel export pattern: create an `index.ts` in `features/findings/` that re-exports all public components.
- Recharts is likely already a dependency (check `package.json`). If not, install it: `bun add recharts`.
- The `Sheet` component from Shadcn should already be available (check `frontend/src/components/ui/sheet.tsx`). If not, add it via `bunx shadcn-ui@latest add sheet`.
- The `Calendar` and `Popover` components are needed for the date range filter — verify they exist or add them.
- For the export download pattern, don't use TanStack Query — use a direct `fetch` or the api service. Exports are imperative actions, not cacheable queries.
- Keep `FindingsPage.tsx` as the orchestrator — it owns all filter state and passes it down to child components as props. Don't introduce Zustand stores for filter state; URL query params or local `useState` is appropriate.

## Completion Summary

<!-- Appended by orchestrator after agent completes. Do not fill manually. -->
