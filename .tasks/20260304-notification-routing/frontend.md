# Agent: frontend

## Purpose

Build the channel management admin UI in the Settings page: channel list, add/edit dialog, toggle, test, delete, and delivery history — using TanStack Query hooks, Shadcn UI, and the generated backend-client.

## Skills

Load before starting: state-management-patterns, form-validation, accessibility-testing

## Subtasks

### API Service + Query Infrastructure

- [x] Create `frontend/src/services/api/notificationChannels.ts` with functions: `list()`, `get(id)`, `create(payload)`, `update(id, payload)`, `delete(id)`, `testChannel(id)`, `listDeliveries(id)` — all using the generated backend-client or `httpGet`/`httpPost`/`httpPut`/`httpDel` from `./client`
- [x] Wire `notificationChannelsApi` into `frontend/src/services/api/index.ts`: import and add to the `api` object as `notificationChannels`
- [x] Add `notificationChannels` query key factory to `frontend/src/lib/queryKeys.ts`: `all()`, `detail(id)`, `deliveries(channelId)` — following the `webhooks` key pattern with `getOrgScope()`

### TanStack Query Hooks

- [x] Create `frontend/src/hooks/queries/useNotificationChannelQueries.ts` with hooks: `useNotificationChannels()` (list, staleTime 60s), `useNotificationChannel(id)` (detail with skipToken when id undefined), `useNotificationChannelDeliveries(channelId)` (deliveries list with skipToken), `useCreateNotificationChannel()` (mutation, invalidate all), `useUpdateNotificationChannel()` (mutation, invalidate all), `useDeleteNotificationChannel()` (mutation, invalidate all), `useTestNotificationChannel()` (mutation, no invalidation needed), `useToggleNotificationChannel()` (mutation calling update with status toggle, invalidate all)

### Channel Settings Tab Component

- [x] Create `frontend/src/pages/settings/ChannelSettings.tsx` as the main tab component. Show a heading "Notification Channels", a description line, and an "Add Channel" button. Render the channel list below. Use `useNotificationChannels()` hook. Show loading skeleton, empty state ("No channels configured"), and error state.
- [x] Add the "Channels" tab definition to `frontend/src/pages/SettingsPage.tsx`: insert a new tab object `{ label: 'Channels', to: '/settings/channels', adminOnly: true }` after the "Notifications" tab. Add the corresponding `<Route path="channels" element={<ChannelSettings />} />` inside the admin-only route guard. Import `ChannelSettings`.

### Channel List

- [x] In `ChannelSettings.tsx`, render each channel as a row/card showing: name, type (with icon — e.g., Slack icon), status badge (active/inactive), subscribed events as small badges, and action buttons (edit, test, toggle, delete)
- [x] "Toggle" button calls `useToggleNotificationChannel` mutation and shows a toast on success/failure
- [x] "Test" button calls `useTestNotificationChannel` mutation and shows a toast with the result (success/failure + error message)
- [x] "Delete" button shows a confirmation dialog (`AlertDialog` from Shadcn) before calling `useDeleteNotificationChannel`

### Add/Edit Channel Dialog

- [x] Create `frontend/src/pages/settings/AddChannelDialog.tsx` as a Shadcn `Dialog` component. Props: `open`, `onOpenChange`, `channel?` (for edit mode). Contains a form with: name (text input, required), type (select: Slack, Email, PagerDuty), config fields (dynamic based on type — Slack shows webhookUrl input), events (checkbox group: Run Completed, Run Failed, Run Cancelled, Run Timed Out — at least one required)
- [x] On submit: call `useCreateNotificationChannel` (create mode) or `useUpdateNotificationChannel` (edit mode). Close dialog on success. Show toast on success/failure.
- [x] Show a note for Email/PagerDuty types: "Coming soon — only Slack is fully supported."
- [x] Validate form: name required, webhookUrl required for Slack (valid URL format), at least one event selected

### Delivery History Panel

- [x] Create `frontend/src/pages/settings/ChannelDeliveryHistory.tsx` as an expandable section or Shadcn `Sheet`. Props: `channelId`, `open`, `onOpenChange`. Show recent deliveries using `useNotificationChannelDeliveries(channelId)` hook. Each delivery shows: event type, status badge (pending/sent/failed), timestamp, error message (if failed).
- [x] Add a "History" button to each channel row in `ChannelSettings.tsx` that opens the delivery history panel for that channel

### Performance + Accessibility

- [x] Ensure `ChannelSettings` is imported via `React.lazy()` if it's a separate route, or is part of the already-lazy-loaded `SettingsPage`
- [x] Add appropriate ARIA labels to the channel list, action buttons, dialog form inputs, and delivery history
- [x] Use `useDocumentTitle('Settings · Channels')` in the `ChannelSettings` component

## Notes

- Follow `frontend/src/hooks/queries/useWebhookQueries.ts` for TanStack Query hook patterns (staleTime, skipToken, invalidation).
- Follow `frontend/src/services/api/webhooks.ts` for API service module patterns.
- Follow `frontend/src/lib/queryKeys.ts` webhook key factory pattern with `getOrgScope()`.
- The Settings page (`SettingsPage.tsx`) already has admin-only tabs (Audit). Follow the same `adminOnly: true` pattern for the Channels tab.
- All API data must use TanStack Query hooks — never `useState` + `useEffect` for fetching. See `AGENTS.md` frontend rules.
- Use Shadcn UI components: `Dialog`, `Button`, `Badge`, `Switch`, `Select`, `Input`, `Label`, `AlertDialog`, `Sheet`, `Skeleton`.
- `config.webhookUrl` will be masked in GET responses (only last 8 chars visible). The edit dialog should note this and allow entering a new URL.

## Completion Summary

<!-- Appended by orchestrator after agent completes. Do not fill manually. -->
