# Agent: frontend (Page Headings)

## Purpose

Add visible `<h1>` page headings to all list pages by passing the `title` prop to `PageToolbar`. This improves accessibility (h1 landmark) and page scannability.

## Skills

Load before starting: none

## Subtasks

### Context

- [x] Read `frontend/src/components/shared/PageToolbar.tsx` to confirm the `title` prop renders an `<h1>` and understand any layout implications (title row vs search row)

### Add title prop to pages using PageToolbar

- [x] `frontend/src/pages/WorkflowList.tsx` — add `title="Workflows"` to the `<PageToolbar>` call (~line 185)
- [x] `frontend/src/pages/WebhooksPage.tsx` — add `title="Webhooks"` to the `<PageToolbar>` call (~line 287)
- [x] `frontend/src/pages/SchedulesPage.tsx` — add `title="Schedules"` to the `<PageToolbar>` call (~line 377)
- [x] `frontend/src/pages/secrets-manager/SecretsTable.tsx` — add `title="Secrets"` to the `<PageToolbar>` call (~line 120)
- [x] `frontend/src/pages/api-keys-manager/ApiKeysTable.tsx` — add `title="API Keys"` to the `<PageToolbar>` call (~line 136)
- [x] `frontend/src/pages/McpLibraryPage.tsx` — add `title="MCP Library"` to the `<PageToolbar>` call (~line 323)
- [x] `frontend/src/pages/ActionCenterPage.tsx` — add `title="Action Center"` to the `<PageToolbar>` call (~line 184)
- [x] `frontend/src/pages/ArtifactLibrary.tsx` — add `title="Artifacts"` to the `<PageToolbar>` call (~line 106)
- [x] `frontend/src/pages/IntegrationsManager.tsx` — add `title="Connections"` to the `<PageToolbar>` call (~line 122)

### Handle TemplateLibraryPage (no existing PageToolbar)

- [x] `frontend/src/pages/TemplateLibraryPage.tsx` — add a `<PageToolbar title="Templates" />` or a standalone `<h1 className="text-2xl font-bold tracking-tight">Templates</h1>` at the top of the page content. Prefer `PageToolbar` for consistency if the layout allows it.

### Verify

- [x] Run `get_errors` on all modified files to confirm no TypeScript errors
- [x] Spot-check that `PageToolbar` renders actions in the title row (not the search row) when `title` is provided — reading the component source suffices

## Notes

- `PageToolbar` already has full `title` support: when `title` is provided, it renders `<h1>` + actions in a title row, then search + filters in a search row. When omitted, actions go beside the search input.
- `SecretsTable` and `ApiKeysTable` are child components of `SecretsManager` and `ApiKeysManager` respectively, but they own the `PageToolbar`. Adding `title` here is correct — no prop threading needed.
- `TemplateLibraryPage` does **not** use `PageToolbar` — it has its own search/filter UI. The agent should evaluate whether introducing `PageToolbar` is appropriate or if a standalone `<h1>` is simpler.
- No behavioral changes expected. Pure prop addition.

## Completion Summary

<!-- Appended by orchestrator after agent completes. Do not fill manually. -->
