# Plan: Platform Notification Routing

## Overview

Add a notification channel system that dispatches Slack messages (with email/PagerDuty stubs) when workflow runs reach terminal statuses. This requires two new database tables, a new NestJS module with event-driven dispatch, a frontend admin UI in the Settings page, and comprehensive tests. The system hooks into `WorkflowRunService.cacheTerminalStatus()` via NestJS EventEmitter2 to emit run lifecycle events, which a dispatcher fans out to matching channels.

## Architecture Decisions

| Decision                                              | Alternatives                                         | Rationale                                                                                                                                                                                                   |
| ----------------------------------------------------- | ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| NestJS EventEmitter2 for internal event emission      | Kafka topic, direct service call                     | Lightweight, in-process, no infra overhead. Kafka is used for node-level trace events which are high-volume; run lifecycle events are low-volume. EventEmitter2 keeps it simple with `@OnEvent` decorators. |
| Hook into `cacheTerminalStatus()` for event emission  | Poll workflow_runs table, hook into `getRunStatus()` | `cacheTerminalStatus` is the single write path when terminal status is first detected. Polling is wasteful. `getRunStatus` is a read path called by frontend and would emit duplicates.                     |
| Adapter pattern for notification types                | Single service with switch/case                      | Adapters implement a common interface, making email/PagerDuty stubs clean and future implementations isolated.                                                                                              |
| SSRF validation with domain allowlist                 | IP-only validation, no validation                    | Domain allowlist (`hooks.slack.com`, `hooks.slack-gov.com`) is most secure for Slack. IP-only misses DNS rebinding. No validation is unacceptable for server-side HTTP.                                     |
| Config masking in GET responses                       | Encrypt config at rest, no masking                   | Masking webhook URLs in list/detail responses prevents accidental exposure in logs/screenshots. Full URL returned only on create. Encryption at rest is over-engineering for v1.                            |
| Frontend: new "Channels" tab in Settings (admin-only) | New top-level page, extend NotificationSettings      | Settings tab keeps it grouped with existing notification prefs. Separate from browser notification settings to avoid confusion. Admin-only matches audit log tab pattern.                                   |

## Affected Files

| Action | File Path                                                                     | Change Description                                                                  |
| ------ | ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| CREATE | `backend/src/database/schema/notification-channels.ts`                        | Drizzle table definitions for `notification_channels` and `notification_deliveries` |
| MODIFY | `backend/src/database/schema/index.ts`                                        | Add `export * from './notification-channels'`                                       |
| CREATE | `backend/src/notifications/notifications.module.ts`                           | NestJS module declaration                                                           |
| CREATE | `backend/src/notifications/notifications.controller.ts`                       | CRUD + test + deliveries endpoints                                                  |
| CREATE | `backend/src/notifications/notifications.service.ts`                          | Channel CRUD business logic                                                         |
| CREATE | `backend/src/notifications/notification-dispatcher.service.ts`                | Event listener + fan-out dispatch                                                   |
| CREATE | `backend/src/notifications/adapters/slack.adapter.ts`                         | Slack webhook HTTP POST + SSRF validation                                           |
| CREATE | `backend/src/notifications/adapters/notification.adapter.ts`                  | Adapter interface/abstract class                                                    |
| CREATE | `backend/src/notifications/repository/notification-channel.repository.ts`     | Channel CRUD repository                                                             |
| CREATE | `backend/src/notifications/repository/notification-delivery.repository.ts`    | Delivery tracking repository                                                        |
| CREATE | `backend/src/notifications/dto/notification-channel.dto.ts`                   | Zod DTOs for request/response                                                       |
| MODIFY | `backend/src/app.module.ts`                                                   | Import NotificationsModule + EventEmitterModule.forRoot()                           |
| MODIFY | `backend/src/workflows/workflow-run.service.ts`                               | Inject EventEmitter2, emit `run.status.terminal` in `cacheTerminalStatus` call site |
| CREATE | `packages/shared/src/notifications.ts`                                        | Shared Zod schemas + types for notification channels/deliveries                     |
| MODIFY | `packages/shared/src/index.ts`                                                | Add `export * from './notifications.js'`                                            |
| CREATE | `frontend/src/services/api/notificationChannels.ts`                           | API service module for notification channels                                        |
| MODIFY | `frontend/src/services/api/index.ts`                                          | Import + wire `notificationChannelsApi`                                             |
| CREATE | `frontend/src/hooks/queries/useNotificationChannelQueries.ts`                 | TanStack Query hooks                                                                |
| MODIFY | `frontend/src/lib/queryKeys.ts`                                               | Add `notificationChannels` key factory                                              |
| CREATE | `frontend/src/pages/settings/ChannelSettings.tsx`                             | Channel management tab component                                                    |
| CREATE | `frontend/src/pages/settings/AddChannelDialog.tsx`                            | Add/Edit channel dialog                                                             |
| CREATE | `frontend/src/pages/settings/ChannelDeliveryHistory.tsx`                      | Delivery history panel                                                              |
| MODIFY | `frontend/src/pages/SettingsPage.tsx`                                         | Add "Channels" tab + route (admin-only)                                             |
| CREATE | `backend/src/notifications/__tests__/notification-channel.repository.spec.ts` | Repository unit tests                                                               |
| CREATE | `backend/src/notifications/__tests__/notifications.service.spec.ts`           | Service CRUD unit tests                                                             |
| CREATE | `backend/src/notifications/__tests__/notification-dispatcher.service.spec.ts` | Dispatcher unit tests                                                               |
| CREATE | `backend/src/notifications/__tests__/slack.adapter.spec.ts`                   | Slack adapter unit tests                                                            |
| CREATE | `frontend/src/pages/settings/__tests__/ChannelSettings.test.tsx`              | Channel settings component tests                                                    |

## Phases

| Phase | Agents                           | Purpose                                                                                                                                           | Depends On                           |
| ----- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| 1     | database                         | Create Drizzle schema for notification_channels + notification_deliveries tables                                                                  | —                                    |
| 2     | implementer                      | Build notifications module: adapters, service, dispatcher, controller, event emission wiring, shared schemas, OpenAPI + backend-client generation | Phase 1                              |
| 3     | frontend                         | Build channel management UI in Settings page with TanStack Query hooks                                                                            | Phase 2 (needs API + backend-client) |
| 4     | tester                           | Write unit + component tests for backend and frontend                                                                                             | Phase 2 + Phase 3                    |
| 5     | code-reviewer, security-reviewer | Review implementation (parallel)                                                                                                                  | Phase 4                              |
| 6     | doc-writer                       | Write feature documentation                                                                                                                       | Phase 5                              |

## Dependencies

- **Phase 1 → Phase 2**: Implementer needs schema tables to exist before building repositories/services
- **Phase 2 → Phase 3**: Frontend needs generated backend-client types and API contract
- **Phase 2 → Phase 4**: Tester needs implementation code to test against
- **Phase 3 → Phase 4**: Tester needs frontend components to write component tests
- **Phase 4 → Phase 5**: Reviewers should see test-passing code
- **Phase 5 → Phase 6**: Doc writer should document the final, reviewed implementation

## Risk Assessment

| Risk                                                     | Impact                  | Likelihood | Mitigation                                                                                                           |
| -------------------------------------------------------- | ----------------------- | ---------- | -------------------------------------------------------------------------------------------------------------------- |
| `@nestjs/event-emitter` not installed                    | Blocks event emission   | Medium     | Implementer task includes installing package and configuring in AppModule                                            |
| SSRF bypass via DNS rebinding                            | High (security)         | Low        | Domain allowlist for Slack URLs + HTTPS-only scheme validation                                                       |
| `cacheTerminalStatus` called multiple times for same run | Duplicate notifications | Low        | Dispatcher can deduplicate via DB unique constraint on (channelId, runId, eventType) or accept idempotent duplicates |
| Slack webhook rate limiting                              | Dropped notifications   | Low        | Out of scope for v1; delivery record captures the failure                                                            |
| Frontend bundle size increase                            | Performance regression  | Low        | Use React.lazy() for ChannelSettings; channel management is admin-only                                               |
