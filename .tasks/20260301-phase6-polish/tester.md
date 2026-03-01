# Agent: tester

## Purpose

Write Playwright E2E tests for the Settings page (all 5 tabs) and the Artifact Library page.

## Skills

Load before starting: testing-patterns

## Subtasks

### Setup

- [ ] Read `e2e-tests/helpers/e2e-harness.ts` to understand the existing test harness, login flow, and page navigation helpers
- [ ] Read 1-2 existing test files in `e2e-tests/core/` to understand test patterns, structure, and naming conventions
- [ ] Verify the app is running on the expected instance (`just instance show`)

### Settings Page Tests

- [ ] Create `e2e-tests/core/settings.spec.ts`
- [ ] Write test: navigate to `/settings` and verify the General tab loads with expected content (form fields, save button)
- [ ] Write test: click the Appearance tab and verify it loads with theme/display options
- [ ] Write test: click the Notifications tab and verify it loads with notification preferences
- [ ] Write test: click the Shortcuts tab and verify it loads with keyboard shortcut listings
- [ ] Write test: click the Audit tab and verify it loads with audit log entries or empty state
- [ ] Write test: verify tab navigation works correctly (clicking each tab switches content, URL updates)

### Artifact Library Tests

- [ ] Create `e2e-tests/core/artifact-library.spec.ts`
- [ ] Write test: navigate to `/artifacts` and verify the page loads with a heading/title
- [ ] Write test: verify artifacts list renders (or empty state if no artifacts)
- [ ] Write test: verify pagination controls are present if artifacts exist
- [ ] Write test: verify artifact items display expected metadata (name, date, size/type)

### Verification

- [ ] Run the new settings tests: `bun run test:e2e -- --grep "settings"` and confirm they pass
- [ ] Run the new artifact library tests: `bun run test:e2e -- --grep "artifact"` and confirm they pass
- [ ] Confirm existing E2E tests still pass (no regressions)

## Notes

- Use the existing E2E harness from `e2e-tests/helpers/e2e-harness.ts` for login and navigation.
- Follow patterns established in existing `e2e-tests/core/` test files.
- Tests should be resilient to data variations — use `waitForSelector` / `waitForLoadState` appropriately.
- Settings page has 5 tabs: General, Appearance, Notifications, Shortcuts, Audit.
- The artifact library may be empty in test environments — handle empty states gracefully.

## Completion Summary

<!-- Appended by orchestrator after agent completes. Do not fill manually. -->
