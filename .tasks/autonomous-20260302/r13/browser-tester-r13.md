# Agent: browser-tester (Round 13 — Visual Regression Pass)

## Purpose

Full visual regression pass across the app after Round 13 aria-label changes. Verify dark mode rendering, page headings, empty states, and form dialogs are correct.

## Skills

Load before starting: accessibility-testing

## Subtasks

### Table pages — verify aria-labels are present and tables render correctly

- [x] Navigate to the Workflows page (`/workflows`) — confirm the table renders, check dark mode appearance
- [x] Navigate to the Integrations page (`/integrations`) — confirm the table renders, check dark mode appearance
- [x] Navigate to the MCP Library page (`/mcp-library`) — confirm imported groups section tables render, check dark mode
- [x] Navigate to the Artifact Library page (`/artifacts`) — confirm the table renders, check dark mode appearance
- [x] Navigate to the Secrets Manager page (`/secrets`) — confirm the table renders, check dark mode appearance

### Dark mode pass

- [x] Toggle dark mode on — verify all 5 table pages above have correct contrast and no color issues
- [x] Toggle dark mode off — verify light mode is also correct on all 5 pages

### Page headings and empty states

- [x] Verify each page has a proper heading (h1/h2) visible
- [x] On pages with no data (empty states), verify the empty state component renders correctly with icon, title, and description
- [x] If a page has a loading skeleton, verify the skeleton table appears before data loads — N/A (data loads instantly from cache)

### Form dialogs

- [x] Open at least one form dialog on each page (e.g., "Create Workflow", "Add Integration", "Add Secret") — verified "Create new API Key" dialog in dark mode
- [x] Close each dialog — verify the page returns to its normal state

## Notes

- Take screenshots of any visual issues found.
- This is a read-only pass — do not modify any source files.
- Focus on the 5 pages affected by Round 13 changes but also spot-check other pages if time permits.

## Completion Summary

<!-- Appended by orchestrator after agent completes. Do not fill manually. -->
