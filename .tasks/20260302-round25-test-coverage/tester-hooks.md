# Agent: tester (hooks)

## Purpose

Write unit tests for 14 untested React hooks in `frontend/src/hooks/`.

## Skills

Load before starting: testing-patterns

## Subtasks

- [x] Create `frontend/src/hooks/__tests__/useBulkSelection.test.ts` — 10 tests: empty selection, toggleId add/remove, toggleAll select/deselect/partial, clearSelection, isIndeterminate, stale pruning, empty items
- [x] Create `frontend/src/hooks/__tests__/useCopyToClipboard.test.ts` — 5 tests: returns copy/copiedText/isCopied, clipboard write, isCopied true, failure handling, 2s reset
- [x] Create `frontend/src/hooks/__tests__/useDeepCompareEffect.test.ts` — 6 tests: mount, skip on same value, re-run on nested change, cleanup, arrays, primitives
- [x] Create `frontend/src/hooks/__tests__/useIsMac.test.ts` — 6 tests: Mac platform, case-insensitive, Windows, Linux, userAgent fallback, userAgentData
- [x] Create `frontend/src/hooks/__tests__/useIsMobile.test.ts` — 6 tests: desktop false, mobile true, 768px default, custom breakpoint, media query change, cleanup
- [x] Create `frontend/src/hooks/__tests__/useNotifications.test.ts` — 6 tests: subscribe on mount, unsubscribe on unmount, no initial notify, toast on completed, toast on failed, dedup
- [x] Create `frontend/src/hooks/__tests__/usePrefetchOnIdle.test.ts` — 6 tests: requestIdleCallback, prefetch queries, setTimeout fallback, no auth skip, cancel on unmount, offline skip
- [x] Create `frontend/src/hooks/__tests__/useSidebarState.test.ts` — 10 tests: desktop open, collapsed preference, mobile closed, tablet closed, toggle, persist, backdrop click, closeMobile, mouseEnter, mouseLeave
- [x] Create `frontend/src/hooks/__tests__/useWorkflowExecution.test.ts` — 7 tests: idle status, matching workflow, different workflow, explicit workflowId, action functions, empty nodeStates, runStatus fallback
- [x] Create `frontend/src/hooks/__tests__/useCanvasKeyboardShortcuts.test.ts` — 8 tests: register listener, remove on unmount, Escape deselect, Delete removes nodes, non-design mode skip, input element skip, Backspace deletion, entry point protection
- [x] Create `frontend/src/hooks/__tests__/useCustomScrollbar.test.ts` — 5 tests: ref return, null ref, contentDependency change, unmount cleanup, ref consistency
- [x] Create `frontend/src/hooks/__tests__/useNotificationPermission.test.ts` — 8 tests: granted/denied/default/unsupported status, requestPermission success/unsupported/error, visibilitychange re-sync
- [x] Create `frontend/src/hooks/__tests__/useSwipeGesture.test.ts` — 7 tests: right swipe open, left swipe close, below threshold ignore, edge zone ignore, disabled no-op, unmount cleanup, default params
- [x] Create `frontend/src/hooks/__tests__/useTimelineTerminalStream.test.ts` — 7 tests: base stream results, timelineSync false, timelineSync option, live chunks, hasData false, unmount cleanup, replay mode
- [x] Run `bun test frontend/src/hooks/__tests__/` — 129 pass, 0 fail across 19 files

## Notes

- Use `bun:test` imports (`describe`, `it`, `expect`, `mock`, `beforeEach`, `afterEach`), NOT vitest
- Use `renderHook` from `@testing-library/react` — follow pattern in `frontend/src/hooks/__tests__/useDocumentTitle.test.ts`
- Call `cleanup()` in `afterEach` to prevent memory leaks
- For hooks that depend on Zustand stores, mock the store module (e.g., `mock.module('../store/notificationStore', ...)`)
- For hooks that depend on browser APIs (`navigator`, `Notification`, `matchMedia`, `requestIdleCallback`), mock them on `globalThis` or `window`
- For keyboard/touch event hooks, use `fireEvent` or `dispatchEvent` on the target element
- Hooks file: `frontend/src/hooks/useXxx.ts` → Test file: `frontend/src/hooks/__tests__/useXxx.test.ts`

## Completion Summary

<!-- Appended by orchestrator after agent completes. Do not fill manually. -->
