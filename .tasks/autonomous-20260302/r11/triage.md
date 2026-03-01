# Triage: Round 11 — Page Headings + Canvas Decomposition

## Problems

### S1 — Missing visible page headings on all list pages

`PageToolbar` supports an optional `title` prop that renders an `<h1>`, but no page passes it. All 10 list pages lack a visible heading, hurting accessibility (no h1 landmark) and scannability.

### S2 — Canvas.tsx oversized (521 lines) with code duplication

- 15 resolved schedule/webhook props computed inline (lines 152–167) — repeated on every render, clutters the component
- `ConfigPanel` is rendered twice (lines 471–487 for mobile portal, lines 501–514 for desktop inline) with identical props
- `MiniMap` `nodeColor` callback (lines 451–463) uses 4 hardcoded hex colors instead of shared constants

## EXECUTION_PLAN

### Steps

| Order          | Agent             | Task Summary                                                                                         |
| -------------- | ----------------- | ---------------------------------------------------------------------------------------------------- |
| 1 (parallel)   | frontend-headings | Add `title` prop to all `PageToolbar` usages across 10 list pages                                    |
| 2 (parallel)   | frontend-canvas   | Decompose Canvas.tsx: extract schedule context hook, deduplicate ConfigPanel, extract MiniMap colors |
| 3 (sequential) | tester            | Verify h1 headings render in page tests; verify Canvas refactor causes no regressions                |

### Detailed Context

**Step 1 — Page Headings**: Pages using `PageToolbar` without `title`:

- `WorkflowList.tsx` → "Workflows"
- `WebhooksPage.tsx` → "Webhooks"
- `SchedulesPage.tsx` → "Schedules"
- `secrets-manager/SecretsTable.tsx` → "Secrets"
- `api-keys-manager/ApiKeysTable.tsx` → "API Keys"
- `McpLibraryPage.tsx` → "MCP Library"
- `ActionCenterPage.tsx` → "Action Center"
- `ArtifactLibrary.tsx` → "Artifacts"
- `IntegrationsManager.tsx` → "Connections"

`TemplateLibraryPage.tsx` does not use `PageToolbar` — it needs a manually added `<h1>` or a `PageToolbar` introduction.

**Step 2 — Canvas Decomposition**: Extract into sibling files following the existing `canvas-*.ts` pattern (`canvas-viewport.ts`, `canvas-node-factory.ts`, etc.). Target: reduce Canvas.tsx below 400 lines.

**Step 3 — Testing**: Page tests exist for most pages. Canvas has no unit tests — tester verifies via full test suite regression check.
