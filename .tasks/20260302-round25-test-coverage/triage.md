# Triage: Round 25 — Frontend Test Coverage

## EXECUTION_PLAN

### Steps

| Order | Agent          | Task Summary                                                                                                                                                                                                                                                                                                                                                 |
| ----- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1a    | tester         | Write tests for 11 untested frontend utils: `artifacts`, `auth`, `entryPointUtils`, `runtimeInputUtils`, `statusBadgeStyles`, `tableHelpers`, `textPreview`, `timeFormat`, `triggerDisplay`, `clerk-token`, `sse-client`                                                                                                                                     |
| 1b    | tester         | Write tests for 14 untested frontend hooks: `useBulkSelection`, `useCopyToClipboard`, `useDeepCompareEffect`, `useIsMac`, `useIsMobile`, `useNotifications`, `usePrefetchOnIdle`, `useSidebarState`, `useWorkflowExecution`, `useCanvasKeyboardShortcuts`, `useCustomScrollbar`, `useNotificationPermission`, `useSwipeGesture`, `useTimelineTerminalStream` |
| 1c    | tester         | Write tests for 3 untested stores (`commandPaletteStore`, `executionTimelineStore`, `execution/` subfolder) + untested lib files (`queryKeys`, `lazyWithRetry`, `prefetch-routes`, `utils`, `executionQueryOptions`)                                                                                                                                         |
| 2     | browser-tester | Screenshot all major pages to assess current state. Flag visual regressions                                                                                                                                                                                                                                                                                  |
| 3     | code-reviewer  | Review untested frontend components (workflow/, timeline/, templates/, terminal/) for code quality                                                                                                                                                                                                                                                           |
| 4     | error-fixer    | Fix issues from code reviewer + browser tester + any test failures                                                                                                                                                                                                                                                                                           |

### Parallel Groups

- Group 1: Steps 1a, 1b, 1c (3 parallel testers)
- Group 2: Step 2 (browser-tester, can run parallel with Group 1)
- Group 3: Step 3 (code-reviewer, after Group 1)
- Group 4: Step 4 (error-fixer, after Groups 2+3)
