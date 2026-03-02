# Agent: tester (stores + lib)

## Purpose

Write unit tests for 3 untested Zustand stores and 5 untested lib files in the frontend.

## Skills

Load before starting: testing-patterns

## Subtasks

### Stores

- [x] Create `frontend/src/store/__tests__/commandPaletteStore.test.ts` — test `useCommandPaletteStore`: initial state has palette closed; `open()` sets isOpen to true; `close()` sets isOpen to false; `toggle()` flips state; verify granular selector pattern works
- [x] Create `frontend/src/store/__tests__/executionTimelineStore.test.ts` — test the re-exported store from `executionTimeline/` directory: verify the barrel re-export works; test `timelineEventStore` core actions (select event, clear selection); test `timelineNavigationStore` (set active node, navigate between events); test `timelinePollingStore` (start/stop polling, polling interval state)
- [x] Create `frontend/src/store/execution/__tests__/executionLifecycleStore.test.ts` — test lifecycle state transitions: initial state, start execution, complete execution, fail execution, reset state
- [x] Create `frontend/src/store/execution/__tests__/executionLogStore.test.ts` — test log store: append log entries, clear logs, filter by severity/node
- [x] Create `frontend/src/store/execution/__tests__/terminalStreamStore.test.ts` — test terminal stream store: subscribe to stream, receive chunks, clear stream data, handle multiple streams per node
- [x] Create `frontend/src/store/execution/__tests__/sseHandlers.test.ts` — test SSE event handler functions: each handler correctly updates the appropriate store when receiving SSE event data; test with valid/invalid payloads
- [x] Create `frontend/src/store/execution/__tests__/helpers.test.ts` — test helper functions exported from `execution/helpers.ts`: pure function logic, edge cases

### Lib files

- [x] Create `frontend/src/lib/__tests__/queryKeys.test.ts` — test `queryKeys` factory object: each domain key factory returns a unique, stable array; keys include org scope; parameterized keys include the parameter; no two different domains produce colliding keys
- [x] Create `frontend/src/lib/__tests__/lazyWithRetry.test.ts` — test `lazyWithRetry()`: returns a lazy component on success; retries on import failure (mock dynamic import to fail then succeed); gives up after max retries; clears retry flag from sessionStorage between tests
- [x] Create `frontend/src/lib/__tests__/prefetch-routes.test.ts` — test `prefetchIdleRoutes()`: calls dynamic imports for route modules (mock `requestIdleCallback`); test `prefetchRoute()`: triggers import for matching route; handles unknown routes gracefully
- [x] Create `frontend/src/lib/__tests__/utils.test.ts` — test `cn()`: merges class names; handles conditional classes; resolves Tailwind conflicts via `tailwind-merge`; handles empty/null/undefined inputs
- [x] Create `frontend/src/lib/__tests__/executionQueryOptions.test.ts` — test each exported query option factory (`executionStatusOptions`, `executionTraceOptions`, `executionEventsOptions`, `executionDataFlowsOptions`, `executionTerminalChunksOptions`, `executionNodeIOOptions`, `executionResultOptions`, `executionRunOptions`): returns object with correct `queryKey` and `queryFn`; keys include the `runId` parameter; terminal chunks keys include `nodeRef` and `stream`
- [x] Run `bun test frontend/src/store/__tests__/ frontend/src/store/execution/__tests__/ frontend/src/lib/__tests__/` and verify all new tests pass

## Notes

- Use `bun:test` imports (`describe`, `it`, `expect`, `mock`, `beforeEach`), NOT vitest
- Follow existing store test patterns in `frontend/src/store/__tests__/authStore.test.ts`
- `executionTimelineStore.ts` is a barrel re-export from `executionTimeline/` directory — test the actual sub-stores (`timelineEventStore`, `timelineNavigationStore`, `timelinePollingStore`)
- `execution/` subfolder has: `executionLifecycleStore`, `executionLogStore`, `terminalStreamStore`, `sseHandlers`, `helpers`, `types`, `index` — create `__tests__/` directory inside `execution/`
- For `lazyWithRetry`, mock `sessionStorage` and dynamic `import()` — the function uses sessionStorage to track retry attempts
- For `prefetch-routes`, mock the dynamic imports and `requestIdleCallback`
- For `executionQueryOptions`, verify the shape of returned objects (queryKey array, queryFn function) — don't need to execute the queryFn
- Existing lib tests are in `frontend/src/lib/__tests__/` (see `exportTableData.test.ts`, `humanizeApiError.test.ts`, `logger.test.ts`)

## Completion Summary

<!-- Appended by orchestrator after agent completes. Do not fill manually. -->
