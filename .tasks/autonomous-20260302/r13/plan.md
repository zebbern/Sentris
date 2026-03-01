# Plan: Round 13 — Table aria-labels + Browser Testing

## Overview

Add `aria-label` attributes to 9 `<Table>` elements across 5 files that are currently missing them. Then verify with tests and a full visual regression pass in the browser (dark mode, page headings, empty states, form dialogs).

## Architecture Decisions

| Decision                                                                 | Alternatives                    | Rationale                                                                                                                                                    |
| ------------------------------------------------------------------------ | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Use descriptive, human-readable aria-labels matching the table's content | Use generic "data table" labels | Follows the existing pattern in SchedulesTable (`"Schedules"`), WebhooksTable (`"Webhooks"`), ApiKeysTable (`"API keys"`), SecretsTable (`"Stored secrets"`) |
| Add aria-label to skeleton/loading tables too                            | Only label data tables          | Skeleton tables share the same `<Table>` element — labeling them improves screen reader experience during loading states                                     |

## Affected Files

| Action | File Path                                                  | Change Description                                                                              |
| ------ | ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| MODIFY | `frontend/src/pages/WorkflowList.tsx`                      | Add `aria-label="Workflows"` to both `<Table>` elements (skeleton L210, main L325)              |
| MODIFY | `frontend/src/pages/integrations/IntegrationListTable.tsx` | Add `aria-label="Integration connections"` to both `<Table>` elements (skeleton L34, main L107) |
| MODIFY | `frontend/src/pages/mcp-library/ImportedGroupsSection.tsx` | Add `aria-label="MCP servers"` to both `<Table>` elements (empty state L198, data L213)         |
| MODIFY | `frontend/src/pages/ArtifactLibrary.tsx`                   | Add `aria-label="Artifacts"` to both `<Table>` elements (skeleton L129, main L192)              |
| MODIFY | `frontend/src/pages/secrets-manager/SecretsTable.tsx`      | Add `aria-label="Stored secrets"` to the skeleton `<Table>` (L56) — main table already has it   |

## Phases

| Phase | Agents             | Purpose                                                             | Depends On |
| ----- | ------------------ | ------------------------------------------------------------------- | ---------- |
| 1     | frontend-tables    | Add aria-label to all 9 tables                                      | —          |
| 2     | tester-r13         | Run test suite, add aria-label assertions                           | Phase 1    |
| 3     | browser-tester-r13 | Full visual regression — dark mode, headings, empty states, dialogs | Phase 1    |

## Dependencies

- Tester and browser-tester both depend on frontend-tables completing first.
- Tester and browser-tester can run in parallel after Phase 1.

## Risk Assessment

- **Very low risk**: All changes are adding a single HTML attribute — no behavioral changes.
- **Very low risk**: Pattern is well-established in 4 reference tables already in the codebase.
