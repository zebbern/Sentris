# Agent: browser-tester

## Purpose

Screenshot every frontend page in both light and dark mode at desktop viewport to identify visual regressions since Round 3.

## Skills

Load before starting: none

## Subtasks

- [ ] Ensure dev environment is running (frontend on correct port for active instance)
- [ ] Screenshot the Dashboard page (`/`) in light mode
- [ ] Screenshot the Workflow List page (`/workflows`) in light mode
- [ ] Screenshot a Workflow Builder page (`/workflows/:id`) — open an existing workflow with nodes on the canvas
- [ ] Screenshot the Template Library page (`/templates`) in light mode
- [ ] Screenshot the Schedules page (`/schedules`) in light mode
- [ ] Screenshot the Webhooks page (`/webhooks`) in light mode
- [ ] Screenshot a Webhook Editor page (`/webhooks/:id` or `/webhooks/new`) in light mode
- [ ] Screenshot the Action Center page (`/action-center`) in light mode
- [ ] Screenshot the Secrets Manager page (`/secrets`) in light mode
- [ ] Screenshot the API Keys page (`/api-keys`) in light mode
- [ ] Screenshot the Integrations page (`/integrations`) in light mode
- [ ] Screenshot the Artifact Library page (`/artifacts`) in light mode
- [ ] Screenshot the MCP Library page (`/mcp-library`) in light mode
- [ ] Screenshot the Settings page (`/settings`) in light mode
- [ ] Screenshot the Analytics Settings page (`/analytics-settings`) in light mode
- [ ] Screenshot the 404 page (`/nonexistent-route`) in light mode
- [ ] Screenshot a workflow execution timeline view (`/workflows/:id/runs/:runId`) — navigate to an existing run with completed nodes
- [ ] Switch to dark mode and screenshot at least 5 representative pages (Dashboard, Workflow Builder, Templates, Action Center, Settings)
- [ ] Check the browser console on each page for JavaScript errors or warnings — note any that appear
- [ ] Inspect each screenshot for visual issues: broken layouts, overlapping elements, missing icons, clipped text, incorrect spacing, broken scrolling, invisible text on backgrounds
- [ ] Compare against the Round 3 baseline screenshots in `test-screenshots/` (files `01-workflow-builder-light.png` through `22-api-key-dialog-dark.png`) for regressions
- [ ] Save all screenshots to `test-screenshots/round26/` with descriptive filenames
- [ ] Compile a findings summary with severity ratings: S0 (broken/unusable), S1 (degraded functionality or appearance), S2 (cosmetic)

## Notes

- Use Chrome DevTools MCP or Playwright to capture screenshots
- Capture at 1920×1080 desktop viewport — mobile is not in scope for this round
- If a page requires data to render meaningfully (e.g., workflow builder needs a workflow), navigate to one that has data or note if the empty state renders correctly
- Pay special attention to pages that have changed since the R3 baseline: workflow builder canvas, template library, MCP library, action center
- If the dev environment is not running, coordinate with the user to start it before proceeding

## Completion Summary

<!-- Appended by orchestrator after agent completes. Do not fill manually. -->
