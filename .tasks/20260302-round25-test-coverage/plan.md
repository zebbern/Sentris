# Plan: Round 25 — Frontend Test Coverage

## Overview

Add unit tests for 11 untested utils, 14 untested hooks, 3 untested stores, and 5 untested lib files in the frontend. Simultaneously screenshot all major pages for regression detection. Follow with a code quality review of key untested component directories, then fix any issues surfaced.

## Architecture Decisions

| Decision                                            | Alternatives           | Rationale                                                                   |
| --------------------------------------------------- | ---------------------- | --------------------------------------------------------------------------- |
| Use `bun:test` for all unit tests                   | Vitest, Jest           | Existing test suite uses `bun:test` consistently — follow convention        |
| Place tests in `__tests__/` co-located dirs         | Separate `test/` tree  | Matches existing pattern (e.g., `utils/__tests__/`, `hooks/__tests__/`)     |
| Use `@testing-library/react` `renderHook` for hooks | Direct hook invocation | Established pattern in existing hook tests (see `useDocumentTitle.test.ts`) |
| Split testers into 3 parallel agents by domain      | Single tester agent    | Parallelism reduces wall-clock time; domains are independent                |

## Affected Files

| Action | File Path                                                         | Change Description                                 |
| ------ | ----------------------------------------------------------------- | -------------------------------------------------- |
| CREATE | `frontend/src/utils/__tests__/artifacts.test.ts`                  | Tests for `getRemoteUploads`                       |
| CREATE | `frontend/src/utils/__tests__/auth.test.ts`                       | Tests for `normalizeRole`, `hasAdminRole`          |
| CREATE | `frontend/src/utils/__tests__/entryPointUtils.test.ts`            | Tests for entry point detection functions          |
| CREATE | `frontend/src/utils/__tests__/runtimeInputUtils.test.ts`          | Tests for `normalizeRuntimeInputs`                 |
| CREATE | `frontend/src/utils/__tests__/statusBadgeStyles.test.ts`          | Tests for status color mapping and badge classes   |
| CREATE | `frontend/src/utils/__tests__/tableHelpers.test.ts`               | Tests for `getWorkflowName`, `getStatusBadgeProps` |
| CREATE | `frontend/src/utils/__tests__/textPreview.test.ts`                | Tests for `createPreview`                          |
| CREATE | `frontend/src/utils/__tests__/timeFormat.test.ts`                 | Tests for duration/datetime/relative formatting    |
| CREATE | `frontend/src/utils/__tests__/triggerDisplay.test.ts`             | Tests for `getTriggerDisplay`                      |
| CREATE | `frontend/src/utils/__tests__/clerk-token.test.ts`                | Tests for token registration and retrieval         |
| CREATE | `frontend/src/utils/__tests__/sse-client.test.ts`                 | Tests for `FetchEventSource` class                 |
| CREATE | `frontend/src/hooks/__tests__/useBulkSelection.test.ts`           | Tests for bulk selection hook                      |
| CREATE | `frontend/src/hooks/__tests__/useCopyToClipboard.test.ts`         | Tests for clipboard hook                           |
| CREATE | `frontend/src/hooks/__tests__/useDeepCompareEffect.test.ts`       | Tests for deep comparison effect                   |
| CREATE | `frontend/src/hooks/__tests__/useIsMac.test.ts`                   | Tests for platform detection                       |
| CREATE | `frontend/src/hooks/__tests__/useIsMobile.test.ts`                | Tests for mobile detection                         |
| CREATE | `frontend/src/hooks/__tests__/useNotifications.test.ts`           | Tests for notification hook                        |
| CREATE | `frontend/src/hooks/__tests__/usePrefetchOnIdle.test.ts`          | Tests for idle prefetch hook                       |
| CREATE | `frontend/src/hooks/__tests__/useSidebarState.test.ts`            | Tests for sidebar state hook                       |
| CREATE | `frontend/src/hooks/__tests__/useWorkflowExecution.test.ts`       | Tests for workflow execution hook                  |
| CREATE | `frontend/src/hooks/__tests__/useCanvasKeyboardShortcuts.test.ts` | Tests for keyboard shortcut hook                   |
| CREATE | `frontend/src/hooks/__tests__/useCustomScrollbar.test.ts`         | Tests for scrollbar hook                           |
| CREATE | `frontend/src/hooks/__tests__/useNotificationPermission.test.ts`  | Tests for notification permission hook             |
| CREATE | `frontend/src/hooks/__tests__/useSwipeGesture.test.ts`            | Tests for swipe gesture hook                       |
| CREATE | `frontend/src/hooks/__tests__/useTimelineTerminalStream.test.ts`  | Tests for timeline terminal stream hook            |
| CREATE | `frontend/src/store/__tests__/commandPaletteStore.test.ts`        | Tests for command palette store                    |
| CREATE | `frontend/src/store/__tests__/executionTimelineStore.test.ts`     | Tests for execution timeline store                 |
| CREATE | `frontend/src/store/execution/__tests__/`                         | Tests for execution sub-stores                     |
| CREATE | `frontend/src/lib/__tests__/queryKeys.test.ts`                    | Tests for query key factories                      |
| CREATE | `frontend/src/lib/__tests__/lazyWithRetry.test.ts`                | Tests for lazy loading with retry                  |
| CREATE | `frontend/src/lib/__tests__/prefetch-routes.test.ts`              | Tests for route prefetching                        |
| CREATE | `frontend/src/lib/__tests__/utils.test.ts`                        | Tests for `cn` utility                             |
| CREATE | `frontend/src/lib/__tests__/executionQueryOptions.test.ts`        | Tests for execution query option factories         |

## Phases

| Phase | Agents                                                        | Purpose                                                  | Depends On        |
| ----- | ------------------------------------------------------------- | -------------------------------------------------------- | ----------------- |
| 1     | tester-utils, tester-hooks, tester-stores-lib, browser-tester | Write all unit tests + screenshot pages                  | —                 |
| 2     | code-reviewer                                                 | Review untested component directories for quality issues | Phase 1 (tests)   |
| 3     | error-fixer                                                   | Fix issues from reviews, screenshots, and test failures  | Phase 1 + Phase 2 |

## Dependencies

- `code-reviewer` should run after testers complete so it can also review test quality
- `error-fixer` needs outputs from all prior agents (test failures, code review findings, visual regressions)
- All 3 tester agents are fully independent and can run in parallel
- `browser-tester` is independent and can run in parallel with testers

## Risk Assessment

- **Hook tests may need complex mocking**: Hooks like `useWorkflowExecution` and `useTimelineTerminalStream` likely depend on stores and API clients. Mitigation: mock external dependencies at module level.
- **SSE client test complexity**: `FetchEventSource` involves async streaming. Mitigation: mock `fetch` responses with readable streams.
- **Store tests with sub-stores**: The `execution/` subfolder has multiple interconnected stores. Mitigation: test each sub-store in isolation, mock cross-store dependencies.
