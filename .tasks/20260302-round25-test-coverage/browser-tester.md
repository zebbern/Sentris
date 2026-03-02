# Agent: browser-tester

## Purpose

Screenshot all major frontend pages to assess current visual state and flag any visual regressions.

## Skills

Load before starting: none

## Subtasks

- [ ] Ensure dev environment is running (frontend on correct port for active instance)
- [ ] Screenshot the Dashboard page (`/`)
- [ ] Screenshot the Workflow List page (`/workflows`)
- [ ] Screenshot a Workflow Builder page (open any existing workflow or create a new one)
- [ ] Screenshot the Action Center page (`/action-center`)
- [ ] Screenshot the Schedules page (`/schedules`)
- [ ] Screenshot the Webhooks page (`/webhooks`)
- [ ] Screenshot the Secrets Manager page (`/secrets`)
- [ ] Screenshot the API Keys page (`/api-keys`)
- [ ] Screenshot the Integrations page (`/integrations`)
- [ ] Screenshot the MCP Library page (`/mcp-library`)
- [ ] Screenshot the Template Library page (`/templates`)
- [ ] Screenshot the Artifact Library page (`/artifacts`)
- [ ] Screenshot the Settings page (`/settings`)
- [ ] Screenshot the Analytics Settings page (`/settings/analytics`)
- [ ] Screenshot a workflow execution timeline view (run any workflow or navigate to an existing run)
- [ ] Flag any visual issues: broken layouts, missing styles, overlapping elements, unreadable text, broken images, or console errors visible in the page
- [ ] Compile findings into a summary list with severity (S0=broken, S1=degraded, S2=cosmetic)

## Notes

- Use Chrome DevTools MCP or Playwright to capture screenshots
- Capture at desktop viewport (1920×1080) — mobile is not in scope for this round
- If a page requires data to render meaningfully (e.g., workflow builder needs a workflow), navigate to one that has data or note if the empty state renders correctly
- Save screenshots to `test-screenshots/round25/`
- If the dev environment is not running, coordinate with the user to start it before proceeding

## Completion Summary

<!-- Appended by orchestrator after agent completes. Do not fill manually. -->
