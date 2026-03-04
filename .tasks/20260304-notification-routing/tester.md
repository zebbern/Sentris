# Agent: tester

## Purpose

Write unit tests for the backend notifications module (repositories, service, dispatcher, Slack adapter) and component tests for the frontend channel management UI.

## Skills

Load before starting: testing-patterns

## Subtasks

### Backend: Repository Tests

- [x] Create `backend/src/notifications/__tests__/notification-channel.repository.spec.ts` — test `create()`, `findById()`, `list()` (filtered by organizationId), `update()`, `delete()`, `findActiveByEventType()` (verify JSONB array containment query returns correct channels). Mock the Drizzle database instance.
- [x] Create `backend/src/notifications/__tests__/notification-delivery.repository.spec.ts` — test `create()`, `update()`, `listByChannelId()` (verify ordering and limit), `listByRunId()`. Mock the Drizzle database instance.

### Backend: Service Tests

- [x] Create `backend/src/notifications/__tests__/notifications.service.spec.ts` — test `list()` returns mapped channels, `get()` throws NotFoundException for missing channel, `create()` validates non-empty events array, `create()` validates config shape per type (Slack requires webhookUrl), `create()` masks webhookUrl in response, `update()` handles partial updates, `delete()` audit-logs the deletion, `testChannel()` calls adapter and returns result, `testChannel()` returns 501 for email/pagerduty types, `listDeliveries()` delegates to repository

### Backend: Dispatcher Tests

- [x] Create `backend/src/notifications/__tests__/notification-dispatcher.service.spec.ts` — test: handler called with run lifecycle event, looks up matching active channels via repository, creates pending delivery records, calls SlackNotificationAdapter for Slack channels, updates delivery to 'sent' on success, updates delivery to 'failed' with error message on adapter failure, handles zero matching channels (no-op), handles multiple matching channels (parallel dispatch via Promise.allSettled)

### Backend: Slack Adapter Tests

- [x] Create `backend/src/notifications/__tests__/slack.adapter.spec.ts` — test: constructs correct Block Kit payload with run details, POSTs to webhook URL, returns `{ success: true }` on 200 response, returns `{ success: false, error }` on non-2xx, returns `{ success: false, error }` on network timeout, SSRF validation rejects private IPs (10.0.0.1, 192.168.1.1, 127.0.0.1), SSRF validation rejects non-HTTPS URLs, SSRF validation rejects non-Slack domains, SSRF validation accepts valid `hooks.slack.com` URL

### Frontend: Channel Settings Component Tests

- [x] Create `frontend/src/pages/settings/__tests__/ChannelSettings.test.tsx` — test: renders channel list from mocked API data, shows empty state when no channels, "Add Channel" button opens dialog, channel row shows name/type/status/events, toggle button calls update mutation, test button calls test endpoint and shows toast, delete button shows confirmation dialog
- [x] Create `frontend/src/pages/settings/__tests__/AddChannelDialog.test.tsx` — Skipped (Radix UI Dialog + jsdom incompatibility: dispatchEvent errors during mount effects make dialog rendering impossible in unit tests). Documented for E2E coverage via Playwright instead.

## Notes

- Follow `backend/src/webhooks/__tests__/webhooks.service.spec.ts` for backend test patterns (mocking, test structure).
- Follow `frontend/src/pages/settings/__tests__/NotificationSettings.test.tsx` for frontend component test patterns.
- Use `vi.mock()` for mocking dependencies in Vitest.
- Mock HTTP calls in Slack adapter tests (use `vi.fn()` or `msw` if available).
- Frontend tests should use `@testing-library/react` with `render`, `screen`, `userEvent`.
- Ensure all tests are colocated in `__tests__/` directories alongside the source code.

## Completion Summary

<!-- Appended by orchestrator after agent completes. Do not fill manually. -->
