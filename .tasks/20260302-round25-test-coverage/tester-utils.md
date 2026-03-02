# Agent: tester (utils)

## Purpose

Write unit tests for 11 untested utility files in `frontend/src/utils/`.

## Skills

Load before starting: testing-patterns

## Subtasks

- [x] Create `frontend/src/utils/__tests__/artifacts.test.ts` — test `getRemoteUploads()`: valid artifact with remote uploads, artifact with no remote uploads, edge case with empty/null metadata
- [x] Create `frontend/src/utils/__tests__/auth.test.ts` — test `normalizeRole()`: standard roles (ADMIN, USER), case normalization, empty/whitespace input; test `hasAdminRole()`: array containing admin, array without admin, empty array
- [x] Create `frontend/src/utils/__tests__/entryPointUtils.test.ts` — test `ENTRY_COMPONENT_ID` and `ENTRY_COMPONENT_SLUG` constant values; test `isEntryPointComponentRef()`: matching refs, non-matching refs, null/undefined; test `isEntryPointNode()`: node with entry point data, node without, null/undefined node
- [x] Create `frontend/src/utils/__tests__/runtimeInputUtils.test.ts` — test `normalizeRuntimeInputs()`: valid array input, object input, null/undefined, empty array, non-array non-object input
- [x] Create `frontend/src/utils/__tests__/statusBadgeStyles.test.ts` — test `STATUS_COLOR_MAP` covers expected statuses; test `formatStatusText()`: various status strings, empty string; test `getStatusColor()`: known statuses map to correct colors, unknown status fallback; test `getStatusBadgeClass()`: each color variant produces correct class string; test `getStatusBadgeClassFromStatus()`: end-to-end status-to-class mapping
- [x] Create `frontend/src/utils/__tests__/tableHelpers.test.ts` — test `getWorkflowName()`: matching workflow ID returns name, non-matching ID returns fallback, empty workflows array; test `getStatusBadgeProps()`: each known status returns correct variant/label, unknown status handling
- [x] Create `frontend/src/utils/__tests__/textPreview.test.ts` — test `createPreview()`: short text unchanged, long text truncated, empty/null input, special characters, multi-line input
- [x] Create `frontend/src/utils/__tests__/timeFormat.test.ts` — test `formatDuration()`: milliseconds, seconds, minutes, hours, zero; test `formatStartTime()`: valid ISO timestamp; test `formatDateTime()`: valid date, null/undefined; test `formatRelativeTime()`: recent vs old timestamps, null/undefined; test `formatTimeAgo()`: Date object and string input
- [x] Create `frontend/src/utils/__tests__/triggerDisplay.test.ts` — test `getTriggerDisplay()`: each trigger type returns correct icon/label/description, unknown trigger type fallback
- [x] Create `frontend/src/utils/__tests__/clerk-token.test.ts` — test `registerClerkTokenGetter()`: registers a getter function; test `getFreshClerkToken()`: returns token when getter registered, returns null when no getter registered. Mock async token getter.
- [x] Create `frontend/src/utils/__tests__/sse-client.test.ts` — test `FetchEventSource` class: constructor accepts URL and options, `addEventListener` registers handlers, mock `fetch` to return streaming response, verify events are dispatched to listeners, test `close()` cleans up, test error handling when fetch fails
- [x] Run `bun test frontend/src/utils/__tests__/` and verify all new tests pass

## Notes

- Use `bun:test` imports (`describe`, `it`, `expect`, `mock`, `beforeEach`), NOT vitest
- Follow existing test patterns in `frontend/src/utils/__tests__/categoryColors.test.ts`
- Place all tests in `frontend/src/utils/__tests__/`
- For `sse-client.test.ts`, mock `fetch` globally — the `FetchEventSource` class wraps the Fetch API
- For `clerk-token.test.ts`, reset module state between tests to avoid cross-test pollution
- Pure utility functions (no React) don't need `renderHook` — test directly

## Completion Summary

<!-- Appended by orchestrator after agent completes. Do not fill manually. -->
