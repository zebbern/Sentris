# Agent: frontend (Table aria-labels)

## Purpose

Add `aria-label` attributes to 9 `<Table>` elements across 5 files that are currently missing them, following the established pattern in SchedulesTable, WebhooksTable, ApiKeysTable, and SecretsTable.

## Skills

Load before starting: none

## Subtasks

### Context

- [x] Confirm the existing aria-label pattern by reading one reference table (e.g., `SchedulesTable.tsx` line 104: `aria-label="Schedules"`)

### WorkflowList.tsx (2 tables)

- [x] Add `aria-label="Workflows"` to the skeleton `<Table>` at ~line 210 (`<Table className="table-fixed w-full">`)
- [x] Add `aria-label="Workflows"` to the main data `<Table>` at ~line 325 (`<Table className="table-fixed w-full">` inside `DndContext`)

### IntegrationListTable.tsx (2 tables)

- [x] Add `aria-label="Integration connections"` to the skeleton `<Table>` at ~line 34 in `ConnectionsTableSkeleton`
- [x] Add `aria-label="Integration connections"` to the main data `<Table>` at ~line 107

### ImportedGroupsSection.tsx (2 tables)

- [x] Add `aria-label="MCP servers"` to the empty-state `<Table>` at ~line 198 (the `serverCount === 0` branch)
- [x] Add `aria-label="MCP servers"` to the data `<Table>` at ~line 213

### ArtifactLibrary.tsx (2 tables)

- [x] Add `aria-label="Artifacts"` to the skeleton `<Table>` at ~line 129 (`<Table className="table-fixed w-full min-w-[600px]">`)
- [x] Add `aria-label="Artifacts"` to the main data `<Table>` at ~line 192 (`<Table className="table-fixed w-full min-w-[600px]">` inside `DndContext`)

### SecretsTable.tsx (1 table)

- [x] Add `aria-label="Stored secrets"` to the skeleton `<Table>` at ~line 56 in `TableSkeleton` (the main table at ~line 168 already has it)

## Notes

- The aria-label value should be a short, descriptive noun phrase (not a sentence).
- Reference existing labels: `"Schedules"`, `"Webhooks"`, `"API keys"`, `"Stored secrets"`.
- Skeleton and data tables for the same page should use the same aria-label value.

## Completion Summary

<!-- Appended by orchestrator after agent completes. Do not fill manually. -->
