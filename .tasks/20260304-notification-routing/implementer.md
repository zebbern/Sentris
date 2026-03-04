# Agent: implementer

## Purpose

Build the complete `backend/src/notifications/` module — including adapters, repositories, service, dispatcher, controller, DTOs — wire run lifecycle event emission into `WorkflowRunService`, create shared Zod schemas, and regenerate the OpenAPI spec + backend-client.

## Skills

Load before starting: api-design-patterns, authentication-patterns

## Subtasks

### Shared Schemas (packages/shared)

- [x] Create `packages/shared/src/notifications.ts` with Zod schemas: `NotificationChannelTypeSchema` (enum: `slack`, `email`, `pagerduty`), `NotificationEventTypeSchema` (enum: `run.completed`, `run.failed`, `run.cancelled`, `run.timed_out`), `SlackChannelConfigSchema` (`{ webhookUrl: z.string().url() }`), `NotificationChannelSchema` (full response shape), `CreateNotificationChannelSchema` (create request), `UpdateNotificationChannelSchema` (update request), `NotificationDeliverySchema` (delivery response), and all corresponding TypeScript types
- [x] Add `export * from './notifications.js'` to `packages/shared/src/index.ts`

### Repositories

- [x] Create `backend/src/notifications/repository/notification-channel.repository.ts` with `@Injectable()` class injecting `DRIZZLE_TOKEN`. Methods: `create()`, `findById()`, `list()` (filtered by organizationId, ordered by createdAt desc), `update()`, `delete()`, `findActiveByEventType()` (query channels where status='active' AND events array contains the given event type, filtered by organizationId)
- [x] Create `backend/src/notifications/repository/notification-delivery.repository.ts` with `@Injectable()` class. Methods: `create()`, `update()`, `listByChannelId()` (ordered by createdAt desc, limit param), `listByRunId()`

### Adapter Interface + Slack Adapter

- [x] Create `backend/src/notifications/adapters/notification.adapter.ts` defining an abstract class or interface `NotificationAdapter` with method `send(channel: NotificationChannelRecord, payload: RunLifecycleEvent): Promise<{ success: boolean; error?: string }>`
- [x] Create `backend/src/notifications/adapters/slack.adapter.ts` as `@Injectable()` class implementing `NotificationAdapter`. Performs SSRF validation on `config.webhookUrl`: ensure HTTPS scheme, resolve hostname via DNS and reject private/loopback/link-local IPs (10.x, 172.16-31.x, 192.168.x, 127.x, 169.254.x, ::1, fc00::/7, fe80::/10), validate domain matches `hooks.slack.com` or `hooks.slack-gov.com`. POST a Slack Block Kit message with run details (run ID, workflow name, status, duration, link to run page). Use 5-second timeout. Return `{ success: true }` on 2xx or `{ success: false, error: <message> }` on failure.

### Dispatcher Service

- [x] Create `backend/src/notifications/notification-dispatcher.service.ts` as `@Injectable()` class. Inject `NotificationChannelRepository`, `NotificationDeliveryRepository`, and `SlackNotificationAdapter`. Use `@OnEvent('run.status.terminal', { async: true })` decorator on handler method. Handler: look up active channels matching the event type and organizationId. For each matching channel, create a `pending` delivery record, call the appropriate adapter, then update the delivery to `sent` or `failed`.
- [x] Dispatch to multiple channels in parallel using `Promise.allSettled()`. Log each delivery result. Do not throw on individual failures.

### Service (Channel CRUD)

- [x] Create `backend/src/notifications/notifications.service.ts` as `@Injectable()` class. Inject `NotificationChannelRepository`, `NotificationDeliveryRepository`, `SlackNotificationAdapter`, `AuditLogService`. Methods: `list(auth)`, `get(auth, id)`, `create(auth, dto)`, `update(auth, id, dto)`, `delete(auth, id)`, `testChannel(auth, id)`, `listDeliveries(auth, channelId)`
- [x] In `create()`: validate events array is non-empty, validate config shape matches type (Slack: webhookUrl required), mask `config.webhookUrl` in response (show only last 8 chars)
- [x] In `testChannel()`: send a synthetic test message via the appropriate adapter and return the result. For `email`/`pagerduty` types, return 501 Not Implemented.
- [x] Audit-log all CRUD operations using `AuditLogService.record()` with action `notification_channel.{create|update|delete}`

### DTOs

- [x] Create `backend/src/notifications/dto/notification-channel.dto.ts` with `createZodDto` classes from the shared schemas: `CreateNotificationChannelDto`, `UpdateNotificationChannelDto`, `NotificationChannelResponseDto`, `NotificationDeliveryResponseDto`

### Controller

- [x] Create `backend/src/notifications/notifications.controller.ts` at path `notifications/channels`. Use `@UseGuards(AuthGuard)`, `@ApiTags('notifications')`. Endpoints: `GET /` (list), `GET /:id` (get), `POST /` (create), `PUT /:id` (update), `DELETE /:id` (delete), `POST /:id/test` (test), `GET /:id/deliveries` (delivery history). All endpoints use `@CurrentAuth()` and call corresponding service methods. Use `ParseUUIDPipe` for id params. Use `ZodValidationPipe` for request bodies.
- [x] Add admin role check — via `@Roles('ADMIN')` decorator on the controller class (follows the pattern used by `WebhooksAdminController`)

### Module + Wiring

- [x] Create `backend/src/notifications/notifications.module.ts` importing `DatabaseModule`, `AuthModule`, `ApiKeysModule`, and exporting `NotificationsService`. Register all providers: repositories, service, dispatcher, Slack adapter.
- [x] Modify `backend/src/app.module.ts`: import `EventEmitterModule.forRoot()` from `@nestjs/event-emitter` and import `NotificationsModule`
- [x] Install `@nestjs/event-emitter` package: `bun add @nestjs/event-emitter` in backend directory

### Event Emission Wiring

- [x] Modify `backend/src/workflows/workflow-run.service.ts`: inject `EventEmitter2` from `@nestjs/event-emitter`. In the code path where `cacheTerminalStatus()` is called (around line 537-543), after the cache call, emit an event: `this.eventEmitter.emit('run.status.terminal', { runId, workflowId: run.workflowId, organizationId, status: normalizedStatus, completedAt: temporalStatus.closeTime })`. Make the emission fire-and-forget (do not await).

### OpenAPI + Client Generation

- [x] Run `bun --cwd backend run generate:openapi` to regenerate the OpenAPI spec
- [x] Run `bun --cwd packages/backend-client run generate` to regenerate the backend-client

## Notes

- Follow `backend/src/webhooks/` module structure exactly: module, controller, service, repository pattern.
- Follow `backend/src/webhooks/dto/webhook.dto.ts` for DTO patterns using `createZodDto` from `nestjs-zod`.
- Follow `backend/src/webhooks/repository/webhook.repository.ts` for repository patterns: `@Inject(DRIZZLE_TOKEN)`, Drizzle query builder.
- The `cacheTerminalStatus()` call site is at lines ~537-543 in `workflow-run.service.ts`, inside the `getRunStatus()` method, guarded by `if ((TERMINAL_STATUSES as readonly string[]).includes(normalizedStatus))`.
- The event payload should include enough data for the dispatcher to look up channels and format messages without additional DB queries.
- SSRF validation is critical — validate BEFORE any HTTP request to the webhook URL.
- The `findActiveByEventType()` repository method needs to query JSONB array containment. In Drizzle, use raw SQL or the `sql` template tag for `events @> '["run.completed"]'::jsonb`.

## Completion Summary

<!-- Appended by orchestrator after agent completes. Do not fill manually. -->
