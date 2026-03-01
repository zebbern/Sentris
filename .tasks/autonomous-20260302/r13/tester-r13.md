# Agent: tester (Round 13 — aria-label verification)

## Purpose

Run the existing test suite to confirm no regressions from the aria-label additions, and add assertions verifying each new aria-label is present.

## Skills

Load before starting: testing-patterns

## Subtasks

### Regression check

- [ ] Run the full frontend test suite (`bun run test` or equivalent) — confirm all existing tests pass

### aria-label assertions

- [ ] In `ArtifactLibrary.test.tsx`, add assertions that the table has `aria-label="Artifacts"` (use `screen.getByRole('table', { name: 'Artifacts' })` or equivalent)
- [ ] Add or extend a test for `WorkflowList` verifying `aria-label="Workflows"` is present on the table
- [ ] Add or extend a test for `IntegrationListTable` verifying `aria-label="Integration connections"` is present on the table
- [ ] Add or extend a test for `SecretsTable` verifying the skeleton table has `aria-label="Stored secrets"`
- [ ] Add or extend a test for `ImportedGroupsSection` verifying `aria-label="MCP servers"` is present on the table

### Final validation

- [ ] Run the full test suite again after adding new assertions — confirm all tests pass

## Notes

- Use `getByRole('table', { name: '...' })` as the preferred assertion pattern — it validates both the element role and the aria-label.
- If a test file doesn't exist yet for a component, create a minimal test file focused on the aria-label check.
- Check existing test files first: `ArtifactLibrary.test.tsx` exists, others may need to be created or extended.

## Completion Summary

<!-- Appended by orchestrator after agent completes. Do not fill manually. -->
