# Agent: doc-writer

## Purpose

Write 4 user-facing documentation guides for Webhooks, Schedules, Action Center, and MCP Library features, and register them in the docs navigation.

## Skills

Load before starting: none

## Subtasks

### Analysis

- [ ] Read `docs/guides/template-library.md` to understand the existing guide format, structure, and tone
- [ ] Read `docs/guides/secrets-management.md` as a second reference for guide style
- [ ] Read `docs/docs.json` to understand the navigation structure and where new guides should be added
- [ ] Scan the frontend pages for each feature to understand current capabilities:
  - `frontend/src/pages/` — look for Webhooks, Schedules, ActionCenter, MCP Library pages
  - `frontend/src/services/api/` — look for webhook, schedule, action-center, mcp API services

### Webhooks Guide

- [ ] Create `docs/guides/webhooks.md` covering:
  - What webhooks are and how they trigger workflows in Sentris
  - Creating a new webhook (URL generation, secret, event types)
  - Configuring webhook payloads and headers
  - Testing webhooks
  - Managing webhooks (enable/disable/delete)
  - Security considerations (signature verification, secret rotation)

### Schedules Guide

- [ ] Create `docs/guides/schedules.md` covering:
  - What scheduled workflows are
  - Creating a schedule (cron expression, timezone, workflow selection)
  - Managing schedules (pause/resume/delete)
  - Viewing schedule run history
  - Common cron patterns with examples

### Action Center Guide

- [ ] Create `docs/guides/action-center.md` covering:
  - What the Action Center is (human-in-the-loop approval queue)
  - Reviewing pending actions
  - Approving, rejecting, or dismissing actions
  - Filtering and sorting actions
  - Action detail view
  - How actions are triggered by workflows

### MCP Library Guide

- [ ] Create `docs/guides/mcp-library.md` covering:
  - What the MCP Library is (Model Context Protocol server catalog)
  - Browsing available MCP servers
  - Configuring MCP servers for use in workflows
  - MCP server categories and capabilities
  - Adding MCP servers to workflow nodes

### Navigation Update

- [ ] Update `docs/docs.json` to add the 4 new guide pages to the "Guides" group in the navigation. Add them as:
  - `"guides/webhooks"`
  - `"guides/schedules"`
  - `"guides/action-center"`
  - `"guides/mcp-library"`

### Verification

- [ ] Verify all 4 markdown files are well-formed with consistent heading structure
- [ ] Verify `docs/docs.json` is valid JSON after the navigation update
- [ ] Verify no broken internal links between the new guides and existing docs

## Notes

- Follow the exact format and tone of existing guides (`template-library.md`, `secrets-management.md`).
- Use Mintlify-compatible markdown (frontmatter with title and description).
- Include practical examples and screenshots placeholders where appropriate (`![description](/media/feature-screenshot.png)`).
- Write for end-users, not developers. Explain concepts before procedures.
- The existing `mcp-library` page reference in `docs.json` points to `"mcp-library"` at the top level — the new guide at `"guides/mcp-library"` is a user-facing guide, which is distinct from the existing technical reference.
- Current "Guides" group pages in `docs.json`: `guides/template-library`, `guides/secrets-management`, `aws-credentials`, `analytics`, `mcp-library`, `workflows/execution-status`, `workflows/mcp-library-example`.

## Completion Summary

<!-- Appended by orchestrator after agent completes. Do not fill manually. -->
