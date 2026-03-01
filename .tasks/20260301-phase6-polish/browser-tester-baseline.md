# Agent: browser-tester (baseline)

## Purpose

Screenshot all application pages to document the current UI state before Phase 6 changes begin.

## Skills

Load before starting: none

## Subtasks

- [x] Navigate to `http://localhost:5173/login` and take a screenshot of the login page
- [x] Log in and take a screenshot of the workflows dashboard (`/workflows`)
- [x] Navigate to `/templates` and screenshot the templates page
- [x] Navigate to the workflow builder and screenshot it (open any existing workflow or create a new one)
- [x] Navigate to `/webhooks` and screenshot the webhooks page
- [x] Navigate to `/schedules` and screenshot the schedules page
- [x] Navigate to `/action-center` and screenshot the Action Center page
- [x] Navigate to `/secrets` and screenshot the secrets page
- [x] Navigate to `/api-keys` and screenshot the API keys page
- [x] Navigate to `/integrations` and screenshot the integrations page
- [x] Navigate to `/mcp-library` and screenshot the MCP Library page
- [x] Navigate to `/artifacts` and screenshot the Artifact Library page
- [x] Navigate to `/settings` and screenshot the General tab
- [x] Click the Appearance tab in Settings and screenshot it
- [x] Click the Notifications tab in Settings and screenshot it
- [x] Click the Shortcuts tab in Settings and screenshot it
- [x] Click the Audit tab in Settings and screenshot it
- [x] Navigate to `/analytics-settings` and screenshot the analytics settings page
- [x] Save all screenshots to `test-screenshots/round-phase6-baseline/`

## Notes

- App runs at `http://localhost:5173`
- Login page is at `/login`
- Check `just instance show` first to confirm the correct instance
- This is Phase 1 (blocking) — Phase 2 agents wait for this to complete
- Take screenshots at a consistent viewport size (1280x800 recommended)

## Completion Summary

<!-- Appended by orchestrator after agent completes. Do not fill manually. -->
