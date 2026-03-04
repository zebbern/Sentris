# Triage: Platform Notification Routing

## EXECUTION_PLAN

### Step 1: planner (this step)

Create specification and per-agent task files.

### Step 2: database

New Drizzle schema tables:

- `notification_channels`: id, organizationId, name, type (slack|email|pagerduty), config (jsonb), status (active|inactive), events (jsonb array), createdBy, createdAt, updatedAt. Index on (organizationId, createdAt).
- `notification_deliveries`: id, channelId (FK → notification_channels.id, cascade delete), runId, eventType, status (pending|sent|failed), payload (jsonb), errorMessage, createdAt, sentAt. Index on (channelId, createdAt), (runId).

### Step 3: implementer

- Create `backend/src/notifications/` module: controller, service, repository, DTOs
- Install `@nestjs/event-emitter` and configure in AppModule
- Run lifecycle event emission: Hook into `WorkflowRunService.cacheTerminalStatus()` to emit `run.status.terminal` via EventEmitter2
- `NotificationDispatcherService`: listens for `run.status.terminal` via `@OnEvent`, fans out to matching active channels
- `SlackNotificationAdapter`: POST to webhook URL with Block Kit payload, SSRF validation
- Delivery tracking in `notification_deliveries` table
- CRUD API at `/api/v1/notifications/channels` with admin-only AuthGuard
- Test endpoint at `/api/v1/notifications/channels/:id/test`
- Delivery history endpoint at `/api/v1/notifications/channels/:id/deliveries`
- Shared Zod schemas in `packages/shared/src/notifications.ts`
- Generate OpenAPI spec + backend-client

### Step 4: frontend

- New "Channels" admin-only tab in Settings page
- Channel list component with type, status, events, last delivery
- Add channel dialog (type select, name, config fields, event checkboxes)
- Edit/delete/toggle/test actions per channel
- Delivery history panel per channel
- TanStack Query hooks in `useNotificationChannelQueries.ts`
- Query keys in `queryKeys.ts`
- API service module in `services/api/notificationChannels.ts`
- Wire into `services/api/index.ts`

### Step 5: tester

- Backend unit tests: repository CRUD, service CRUD, dispatcher fan-out, Slack adapter
- Frontend component tests: channel list, add dialog, toggle, test button

### Step 6a: code-reviewer (parallel with 6b)

- Code quality review

### Step 6b: security-reviewer (parallel with 6a)

- Security review: SSRF validation, admin access controls, config masking, input validation

### Step 7: doc-writer

- Feature documentation for notification channels

## Complexity

**High** — New DB tables, new backend module, event emission wiring, external HTTP integration with security concerns, new frontend admin UI, full test coverage.

## Agents

planner, database, implementer, frontend, tester, code-reviewer, security-reviewer, doc-writer
