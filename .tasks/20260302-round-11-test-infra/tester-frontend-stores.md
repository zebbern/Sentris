# Agent: tester-frontend-stores

## Purpose

Create unit tests for three untested Zustand stores: notificationStore, workflowStore, workflowUiStore. Follow the patterns established by existing store tests (authStore, executionStore, themeStore, userPreferencesStore).

## Skills

Load before starting: testing-patterns

## Subtasks

### notificationStore (`frontend/src/store/__tests__/notificationStore.test.ts`)

- [x] Create test file with bun:test imports; reset store state in `beforeEach`
- [x] Test `push()` adds a notification with auto-generated id, timestamp, and `read: false`
- [x] Test FIFO limit: pushing more than 50 (MAX_NOTIFICATIONS) notifications trims the oldest
- [x] Test newest notifications appear first in the array (prepend order)
- [x] Test `markRead(id)` sets `read: true` on the matching notification only
- [x] Test `markAllRead()` sets `read: true` on all notifications
- [x] Test `dismiss(id)` removes the notification from the array
- [x] Test `clearAll()` resets notifications to an empty array
- [x] Test `selectUnreadCount` selector returns correct count of unread notifications

### workflowStore (`frontend/src/store/__tests__/workflowStore.test.ts`)

- [x] Create test file with bun:test imports; reset store state in `beforeEach`
- [x] Test initial state: metadata has `null` id, name "Untitled Workflow", empty description, `isDirty: false`
- [x] Test `setWorkflowId(id)` updates only `metadata.id`
- [x] Test `setWorkflowName(name)` updates only `metadata.name`
- [x] Test `setWorkflowDescription(description)` updates only `metadata.description`
- [x] Test `setMetadata(partial)` merges partial updates into metadata without overwriting unset fields
- [x] Test `markDirty()` sets `isDirty: true`
- [x] Test `markClean()` sets `isDirty: false`
- [x] Test `resetWorkflow()` returns state to initial values (null id, default name, `isDirty: false`)

### workflowUiStore (`frontend/src/store/__tests__/workflowUiStore.test.ts`)

- [x] Create test file with bun:test imports; reset store state in `beforeEach`
- [x] Test initial state has `mode: 'design'`, `libraryOpen: true`, `inspectorTab: 'events'`
- [x] Test `setMode('execution')` switches mode and closes the library panel
- [x] Test `setMode('design')` switches mode and preserves current library state
- [x] Test `setInspectorWidth(width)` clamps to min 320, max 720
- [x] Test `toggleLibrary()` toggles `libraryOpen` between true and false
- [x] Test `dockTerminal(nodeId, label)` adds a terminal tab and sets it as active
- [x] Test `dockTerminal` for an already-docked nodeId activates it without duplicating
- [x] Test `undockTerminal(nodeId)` removes the tab and moves active to the last remaining tab
- [x] Test `undockTerminal` of the last tab sets `activeDockedTerminalId: null`
- [x] Test `setTerminalPanelHeight` clamps between 150 and 70% of window height
- [x] Test `toggleTerminalPanelCollapsed()` toggles the collapsed state
- [x] Test `clearDockedTerminals()` removes all tabs and nulls the active terminal
- [x] Test `toggleHeatMap`, `toggleSmartRouting`, `toggleEdgeBundling` each toggle their respective boolean

## Notes

- Existing store tests use direct Zustand `getState()`/`setState()` calls for testing — follow that pattern.
- For stores with `persist` middleware (notificationStore, workflowUiStore), ensure localStorage is cleared or the store is reset in `beforeEach` to prevent test pollution.
- `workflowUiStore.setTerminalPanelHeight` accesses `window.innerHeight` — may need to mock `window` in the test environment.
- The `mode` field in workflowUiStore is intentionally NOT persisted; verify that after mode-related tests.

## Completion Summary

<!-- Appended by orchestrator after agent completes. Do not fill manually. -->
