# Plan: Round 11 — Page Headings + Canvas Decomposition

## Overview

Add visible `<h1>` page headings to all list pages via the existing `PageToolbar` `title` prop, and decompose `Canvas.tsx` (521 lines) by extracting schedule context resolution, deduplicating ConfigPanel rendering, and replacing hardcoded MiniMap colors. Steps 1 and 2 modify disjoint file sets and run in parallel; step 3 verifies both.

## Architecture Decisions

| Decision                                                       | Alternatives                 | Rationale                                                                                                   |
| -------------------------------------------------------------- | ---------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Use existing `PageToolbar` `title` prop for headings           | Add separate `<h1>` elements | `PageToolbar` already renders an h1 when title is provided — no new components needed                       |
| For TemplateLibraryPage, add `PageToolbar` with `title`        | Add raw `<h1>`               | Keeps heading pattern consistent across all pages                                                           |
| Follow `canvas-*.ts` naming for extracted Canvas hooks         | Create a `hooks/` subfolder  | 4 existing `canvas-*.ts` sibling files establish this convention                                            |
| Extract MiniMap node colors to a `NODE_STATUS_COLORS` constant | Use CSS variables            | Hex values are needed for SVG MiniMap rendering (CSS vars require `getComputedStyle` which adds complexity) |

## Affected Files

| Action | File Path                                                     | Change Description                                                    |
| ------ | ------------------------------------------------------------- | --------------------------------------------------------------------- |
| MODIFY | `frontend/src/pages/WorkflowList.tsx`                         | Add `title="Workflows"` to PageToolbar                                |
| MODIFY | `frontend/src/pages/WebhooksPage.tsx`                         | Add `title="Webhooks"` to PageToolbar                                 |
| MODIFY | `frontend/src/pages/SchedulesPage.tsx`                        | Add `title="Schedules"` to PageToolbar                                |
| MODIFY | `frontend/src/pages/secrets-manager/SecretsTable.tsx`         | Add `title="Secrets"` to PageToolbar                                  |
| MODIFY | `frontend/src/pages/api-keys-manager/ApiKeysTable.tsx`        | Add `title="API Keys"` to PageToolbar                                 |
| MODIFY | `frontend/src/pages/McpLibraryPage.tsx`                       | Add `title="MCP Library"` to PageToolbar                              |
| MODIFY | `frontend/src/pages/ActionCenterPage.tsx`                     | Add `title="Action Center"` to PageToolbar                            |
| MODIFY | `frontend/src/pages/ArtifactLibrary.tsx`                      | Add `title="Artifacts"` to PageToolbar                                |
| MODIFY | `frontend/src/pages/IntegrationsManager.tsx`                  | Add `title="Connections"` to PageToolbar                              |
| MODIFY | `frontend/src/pages/TemplateLibraryPage.tsx`                  | Add PageToolbar with `title="Templates"` or add raw `<h1>`            |
| CREATE | `frontend/src/components/workflow/canvas-schedule-context.ts` | Extract `useResolvedScheduleContext()` hook                           |
| CREATE | `frontend/src/components/workflow/canvas-config-panel.tsx`    | Extract `CanvasConfigPanel` wrapper (mobile portal vs desktop inline) |
| CREATE | `frontend/src/components/workflow/canvas-minimap-colors.ts`   | Export `NODE_STATUS_COLORS` constant + `getNodeColor` helper          |
| MODIFY | `frontend/src/components/workflow/Canvas.tsx`                 | Import extracted modules, remove inlined code                         |

## Phases

| Phase | Agents            | Purpose                                        | Depends On   |
| ----- | ----------------- | ---------------------------------------------- | ------------ |
| 1a    | frontend-headings | Add title props to all page PageToolbar usages | —            |
| 1b    | frontend-canvas   | Extract Canvas.tsx into smaller modules        | —            |
| 2     | tester            | Verify headings + Canvas regression check      | Phase 1a, 1b |

## Dependencies

- Phase 1a and 1b are independent (disjoint file sets). Can run in parallel.
- Tester depends on both phase 1a and 1b completing first.

## Risk Assessment

- **Low risk**: Page headings are additive — no existing behavior changes, just adding a prop.
- **Low risk**: Canvas decomposition is pure structural refactoring — no behavior changes.
- **TemplateLibraryPage**: Does not currently use `PageToolbar`. Agent needs to decide whether to add one or insert a standalone `<h1>`. Minor risk of layout change.
