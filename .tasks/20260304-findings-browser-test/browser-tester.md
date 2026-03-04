---
agent: browser-tester
task_id: 20260304-findings-browser-test
---

# Browser Test: Findings Dashboard

## Subtasks

- [x] Start dev servers (just dev or verify they're running) — frontend started on 5173; backend failed (pre-existing DI error)
- [x] Navigate to `/findings` — verify page loads without errors, take screenshot — page renders, API fails with 502 (backend down)
- [x] Verify "Findings" appears in sidebar navigation and navigates correctly — confirmed with ShieldAlert icon, highlighted when active
- [x] Verify table renders with correct column headers — NO DATA: table only renders when findings exist. Expected headers (from unit tests): Timestamp, Severity, Name, Asset, Workflow, Run ID. With 0 findings, empty state correctly replaces the table.
- [x] Test severity filter dropdown — select a severity, verify table updates — works: dropdown shows All/Critical/High/Medium/Low/Info, selecting Critical adds &severity=critical to API request
- [x] Test search input — type a term, verify debounced filtering — works: typing "test-query" adds &search=test-query with 300ms debounce
- [x] Test pagination controls (if data exists) — NO DATA: pagination only renders when items > 0. API returns 200 OK with empty results. Pagination correctly hidden when no findings exist.
- [x] Verify empty state renders correctly (when no data / no matches) — PASS: with backend running, empty state shows "No findings found" heading + "Security findings will appear here once your workflows produce results." message. Shield icon displayed. No error state. All API requests return 200.
- [x] Test at tablet viewport (768px) — screenshot — sidebar collapses to icons, content adapts correctly
- [x] Check for console errors and failed network requests — all errors are 502 Bad Gateway from backend being down, no JS errors
