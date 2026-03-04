# Feature Specification: Platform Notification Routing

> **Created**: 2026-03-04
> **Status**: Draft
> **Owner**: planner agent

## Problem Statement

When a workflow run completes, fails, or times out, platform administrators have no way to receive external notifications (Slack, email, PagerDuty). The existing notification system is browser-only (Zustand + localStorage in `NotificationSettings.tsx`) and only reaches users who have the app open. Operations teams need proactive, channel-based alerting for run lifecycle events to enable timely incident response and workflow monitoring at scale.

## User Stories

- **US1**: As an organization admin, I want to create a Slack notification channel that sends a message when any workflow run fails, so that my team gets immediate alerts in our operations channel.
- **US2**: As an organization admin, I want to configure which run lifecycle events (completed, failed, cancelled, timed out) trigger notifications for each channel, so that I only receive relevant alerts.
- **US3**: As an organization admin, I want to view delivery history for each notification channel, so that I can diagnose delivery failures and confirm alerts were sent.
- **US4**: As an organization admin, I want to test a notification channel by sending a test message, so that I can verify the webhook URL is correct before relying on it.
- **US5**: As an organization admin, I want to enable/disable a channel without deleting it, so that I can temporarily mute notifications during maintenance windows.

## Functional Requirements

| ID   | Requirement                                                                                                               | Acceptance Criteria                                                                                                                                           | Priority                             |
| ---- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ | --- |
| FR1  | CRUD API for notification channels scoped to organization                                                                 | POST/GET/PUT/DELETE at `/api/v1/notifications/channels` returns correct status codes; channels are org-isolated                                               | P0                                   |
| FR2  | Channels support `type` field with values `slack`, `email`, `pagerduty`                                                   | `type` is validated on create; only `slack` is dispatching in v1; `email`/`pagerduty` return 501 on test                                                      | P0                                   |
| FR3  | Each channel has a `config` JSONB field holding type-specific configuration                                               | Slack: `{ webhookUrl: string }`; Email: `{ recipients: string[] }`; PagerDuty: `{ routingKey: string }`                                                       | P0                                   |
| FR4  | Each channel subscribes to a set of run lifecycle events                                                                  | `events` field is a JSON array of event type strings (`run.completed`, `run.failed`, `run.cancelled`, `run.timed_out`); at least one event required on create | P0                                   |
| FR5  | Run lifecycle events are emitted when a workflow run reaches a terminal status                                            | NestJS EventEmitter2 emits `run.status.terminal` event from `WorkflowRunService.cacheTerminalStatus` (or the code path that persists terminal status)         | P0                                   |
| FR6  | NotificationDispatcherService listens for run lifecycle events, looks up matching active channels, and dispatches to each | Fan-out: for each matching active channel with the event type in its `events` array, create a delivery record and dispatch                                    | P0                                   |
| FR7  | SlackNotificationAdapter sends a formatted message to the channel's webhook URL                                           | POST to `config.webhookUrl` with a Slack Block Kit payload containing run ID, workflow name, status, duration, and a link to the run                          | P0                                   |
| FR8  | SSRF protection on Slack webhook URLs                                                                                     | Validate URL scheme is `https`, hostname resolves to a public IP (not private/loopback), and domain matches `hooks.slack.com` or `hooks.slack-gov.com`        | P0                                   |
| FR9  | Delivery tracking: each dispatch attempt is recorded in `notification_deliveries`                                         | Record includes channelId, runId, eventType, status (pending→sent/failed), payload, errorMessage, timestamps                                                  | P0                                   |
| FR10 | Test endpoint sends a test notification to a channel                                                                      | `POST /api/v1/notifications/channels/:id/test` sends a synthetic message and returns delivery result                                                          | P1                                   |
| FR11 | Toggle channel active/inactive via PATCH                                                                                  | `PATCH /api/v1/notifications/channels/:id` with `{ status: 'active'                                                                                           | 'inactive' }` updates channel status | P1  |
| FR12 | Delivery history endpoint for a channel                                                                                   | `GET /api/v1/notifications/channels/:id/deliveries` returns paginated list of deliveries sorted by `createdAt` desc, limit 100                                | P1                                   |
| FR13 | Frontend: "Channels" tab in Settings page (admin-only)                                                                    | New tab visible only to admin users, placed after "Notifications" tab                                                                                         | P1                                   |
| FR14 | Frontend: Channel list showing name, type, status, event count, last delivery time                                        | Table/list component with type icons, status badge, and action buttons                                                                                        | P1                                   |
| FR15 | Frontend: Add channel dialog with type selector, name, config fields, event checkboxes                                    | Dialog validates required fields; Slack shows webhookUrl input; events use checkbox group                                                                     | P1                                   |
| FR16 | Frontend: Edit, delete, toggle, and test buttons per channel row                                                          | Edit opens pre-filled dialog; delete shows confirmation; toggle calls PATCH; test calls test endpoint and shows toast                                         | P1                                   |
| FR17 | Frontend: Delivery history panel per channel                                                                              | Expandable section or sheet showing recent deliveries with status badges and timestamps                                                                       | P2                                   |

## Non-Functional Requirements

| ID   | Category      | Requirement                                                                    | Target                                                                                                    |
| ---- | ------------- | ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| NFR1 | Performance   | Event emission must not block the status polling critical path                 | Event emission is fire-and-forget (async, no await on dispatch)                                           |
| NFR2 | Performance   | Notification dispatch should complete within 5 seconds per channel             | Slack webhook POST timeout: 5s                                                                            |
| NFR3 | Security      | Slack webhook URLs must pass SSRF validation before any HTTP request           | Block private IPs, loopback, link-local; allow only `hooks.slack.com` / `hooks.slack-gov.com`             |
| NFR4 | Security      | Channel config (containing webhook URLs) must not be exposed in list responses | `config.webhookUrl` is masked in GET responses (show last 8 chars only); full URL only on create response |
| NFR5 | Security      | All channel endpoints require admin role                                       | AuthGuard + admin role check on all notification channel endpoints                                        |
| NFR6 | Reliability   | Failed deliveries are recorded but do not retry automatically in v1            | Delivery attempts are best-effort; retry/dead-letter is out of scope                                      |
| NFR7 | Accessibility | Channel management UI meets WCAG 2.2 AA                                        | Keyboard navigable, proper ARIA labels, sufficient contrast                                               |
| NFR8 | Observability | All channel CRUD operations are audit-logged                                   | Use existing `AuditLogService.record()` pattern                                                           |

## Edge Cases & Error Scenarios

1. **Slack webhook URL becomes invalid**: Dispatch fails → delivery record with `status: 'failed'` and `errorMessage` containing HTTP status or network error. Channel remains active. Admin can see failure in delivery history.
2. **Channel deleted while dispatch is in flight**: Delivery record may have orphaned `channelId` with cascade delete. Accept data loss on delivery records for deleted channels (cascade delete is acceptable).
3. **Multiple channels match same event**: Fan-out dispatches in parallel via `Promise.allSettled()`. Each delivery is independent — one failure does not affect others.
4. **No channels match an event**: No-op. No delivery records created.
5. **Rapid run completions (burst)**: Event emission is non-blocking. Dispatcher processes events sequentially per event but dispatches to channels in parallel. No deduplication needed (each run completion is unique).
6. **Empty events array on create**: Validation rejects — at least one event type required.
7. **Webhook URL responds with non-2xx**: Delivery marked as `failed` with HTTP status code in error message.
8. **Network timeout on webhook POST**: 5-second timeout → delivery marked as `failed` with timeout error message.
9. **User creates channel with duplicate name**: Allowed — names are not unique constraints. Channels are identified by UUID.

## Out of Scope

- **Email notifications**: Type is accepted in schema but dispatch returns 501 "Not Implemented" in v1.
- **PagerDuty notifications**: Type is accepted in schema but dispatch returns 501 "Not Implemented" in v1.
- **Retry/dead-letter for failed deliveries**: No automatic retries in v1.
- **Per-workflow channel scoping**: v1 channels apply to all runs in the organization.
- **Rate limiting on dispatch**: No rate limiting in v1.
- **Webhook signature verification** (for outbound): Not needed for Slack incoming webhooks.
- **Real-time delivery status updates** (WebSocket/SSE): Delivery history is polled via REST.
- **Browser notification integration**: Existing `NotificationSettings.tsx` remains unchanged and complementary.

## Dependencies

- **Upstream**:
  - `WorkflowRunService.cacheTerminalStatus()` — attachment point for event emission
  - `@nestjs/event-emitter` package (EventEmitter2) — must be installed and configured in AppModule
  - `AuditLogService` — for audit logging channel CRUD
  - `AuthGuard` + admin role checking — for endpoint protection
  - `@sentris/shared` — for shared Zod schemas and types
  - `packages/backend-client` — for generated API client used by frontend
- **Downstream**:
  - Future email adapter will implement the same `NotificationAdapter` interface
  - Future PagerDuty adapter will implement the same `NotificationAdapter` interface
  - Future per-workflow channel scoping will add optional `workflowId` FK to `notification_channels`

---

**Anti-speculation guard**: This spec contains ONLY confirmed requirements. No "might need", "could eventually", or "future-proof" features beyond the stated adapter interface pattern. If it's not listed above, it's not in this spec.
