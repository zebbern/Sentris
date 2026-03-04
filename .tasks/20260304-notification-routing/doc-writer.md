# Agent: doc-writer

## Purpose

Write feature documentation for the Platform Notification Routing feature covering setup, configuration, usage, and troubleshooting.

## Skills

Load before starting: none

## Subtasks

- [ ] Create `docs/guides/notification-channels.mdx` documenting: feature overview (what notification channels do), supported channel types (Slack functional, Email/PagerDuty coming soon), available event types (run.completed, run.failed, run.cancelled, run.timed_out)
- [ ] Document how to create a Slack notification channel: step-by-step with screenshots/descriptions of the Settings → Channels UI, where to get a Slack webhook URL (link to Slack docs), what events to subscribe to
- [ ] Document channel management: editing, toggling active/inactive, testing, deleting channels
- [ ] Document the delivery history view: how to see past deliveries, what status values mean (pending, sent, failed), troubleshooting failed deliveries
- [ ] Document the API endpoints for programmatic channel management: `POST/GET/PUT/DELETE /api/v1/notifications/channels`, `POST /api/v1/notifications/channels/:id/test`, `GET /api/v1/notifications/channels/:id/deliveries` — with example request/response payloads
- [ ] Document security considerations: admin-only access, SSRF protection on webhook URLs, config masking in responses
- [ ] Add a reference to the new notification channels feature in `docs/user-guide.mdx` or the appropriate navigation config (`docs/docs.json`) so the page is discoverable
- [ ] Document known limitations: only Slack fully supported in v1, no automatic retries for failed deliveries, channels apply org-wide (no per-workflow filtering)

## Notes

- Follow existing documentation style in `docs/guides/` or `docs/` directory.
- Use MDX format consistent with the existing docs (Mintlify/Fumadocs or similar).
- Check `docs/docs.json` for the navigation structure and add the new page to the appropriate section.
- Reference the existing notification preferences page (`Settings → Notifications`) and clarify that browser notifications and channel notifications are complementary features.
- This is a documentation-only agent. Do NOT modify source code files outside of `docs/` and `.tasks/`.

## Completion Summary

<!-- Appended by orchestrator after agent completes. Do not fill manually. -->
