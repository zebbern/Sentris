# Agent: browser-tester (final)

## Purpose

Perform a final browser E2E walkthrough of all application pages after Phase 6 changes. Screenshot every key page and report any regressions compared to the baseline round.

## Skills

Load before starting: none

## Subtasks

### Full Page Walkthrough

- [ ] Navigate to `http://localhost:5173/login` and screenshot the login page
- [ ] Log in and screenshot the workflows dashboard (`/workflows`)
- [ ] Navigate to `/templates` and screenshot — verify template list loads, check for new templates
- [ ] Open the workflow builder and screenshot it
- [ ] Navigate to `/webhooks` and screenshot
- [ ] Navigate to `/schedules` and screenshot
- [ ] Navigate to `/action-center` and screenshot — verify the refactored page renders correctly
- [ ] Navigate to `/secrets` and screenshot
- [ ] Navigate to `/api-keys` and screenshot
- [ ] Navigate to `/integrations` and screenshot
- [ ] Navigate to `/mcp-library` and screenshot
- [ ] Navigate to `/artifacts` and screenshot
- [ ] Navigate to `/settings` and screenshot all 5 tabs (General, Appearance, Notifications, Shortcuts, Audit)
- [ ] Navigate to `/analytics-settings` and screenshot

### Refactored Pages Verification

- [ ] On `/action-center` — verify table loads, filters work, clicking a row opens the detail modal
- [ ] On `/templates` — open the "Publish Template" modal and step through each wizard step (Metadata, Preview, GitHub, Review). Verify all steps render.
- [ ] Verify new security templates appear in the template library (dast-scanning, dependency-audit, dns-monitoring, api-security-testing)

### Regression Check

- [ ] Compare screenshots with baseline round (`test-screenshots/round-phase6-baseline/`) and note any visual regressions
- [ ] Verify no pages show error states, blank content, or broken layouts
- [ ] Save all screenshots to `test-screenshots/round-phase6-final/`
- [ ] Write a brief regression report noting any issues found

## Notes

- App runs at `http://localhost:5173`
- Check `just instance show` first to confirm the correct instance
- This is Phase 4 (final) — runs after all Phase 2 and Phase 3 work is complete
- Compare against baseline screenshots from Phase 1 (`test-screenshots/round-phase6-baseline/`)
- Use the same viewport size as the baseline round (1280x800 recommended)
- Pay special attention to refactored pages: Action Center, Publish Template Modal
- If any regressions are found, document them clearly with before/after screenshots

## Completion Summary

<!-- Appended by orchestrator after agent completes. Do not fill manually. -->
