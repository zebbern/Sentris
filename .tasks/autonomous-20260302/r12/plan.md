# Plan: Round 12 — Dark Mode Color Consistency + Empty State Standardization

## Overview

Replace ~50 hardcoded Tailwind color classes (`text-red-500`, `text-green-500/600`) that lack `dark:` variants with semantic equivalents (`text-destructive`) or dark-aware pairs (`text-green-500 dark:text-green-400`). Also replace an inline empty state in `CustomServersTable.tsx` with the shared `EmptyState` component.

## Architecture Decisions

| Decision                                                            | Alternatives                           | Rationale                                                                                                                                                                        |
| ------------------------------------------------------------------- | -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Use `text-destructive` for error text/required markers/delete icons | `text-red-500 dark:text-red-400`       | `text-destructive` is the established semantic class already used in ~15 places across the codebase                                                                              |
| Use `text-green-500 dark:text-green-400` for success indicators     | Create a `text-success` semantic class | No existing semantic success class; adding one is out of scope. The dark pair is consistent with existing patterns (e.g., `McpDiscoveryPreview.tsx`, `NotificationSettings.tsx`) |
| Replace inline empty state with shared `EmptyState` component       | Leave as-is                            | `EmptyState` component exists at `components/ui/EmptyState.tsx` and is already used in other pages                                                                               |

## Affected Files

| Action | File Path                                                                    | Change Description                                                                                                           |
| ------ | ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| MODIFY | `frontend/src/components/workflow/ValidationDock.tsx`                        | Replace ~10 `text-red-500` → `text-destructive`, ~5 `text-green-500` → `text-green-500 dark:text-green-400`                  |
| MODIFY | `frontend/src/components/workflow/RuntimeInputsEditor.tsx`                   | Replace 3 `text-red-500` → `text-destructive`, 1 `text-green-600` → `text-green-600 dark:text-green-400`                     |
| MODIFY | `frontend/src/components/workflow/RunWorkflowDialog.tsx`                     | Replace ~12 `text-red-500` → `text-destructive`, 1 `text-green-600` → `text-green-600 dark:text-green-400`                   |
| MODIFY | `frontend/src/components/schedules/NodeOverridesSection.tsx`                 | Replace 2 `text-red-500` → `text-destructive`                                                                                |
| MODIFY | `frontend/src/components/schedules/RuntimeInputsSection.tsx`                 | Replace ~8 `text-red-500` → `text-destructive`                                                                               |
| MODIFY | `frontend/src/components/workflow/WebhookDetails.tsx`                        | Replace 1 `text-green-500` → `text-green-500 dark:text-green-400`, 1 `text-green-600` → `text-green-600 dark:text-green-400` |
| MODIFY | `frontend/src/components/workflow/WorkflowWebhooksPanel.tsx`                 | Replace 2 `text-green-500` → `text-green-500 dark:text-green-400`                                                            |
| MODIFY | `frontend/src/components/workflow/SimpleVariableListEditor.tsx`              | Replace 1 `text-red-500` → `text-destructive`                                                                                |
| MODIFY | `frontend/src/components/workflow/SelectionOptionsEditor.tsx`                | Replace 1 `text-red-500` → `text-destructive`                                                                                |
| MODIFY | `frontend/src/components/workflow/AnalyticsInputsEditor.tsx`                 | Replace 3 `text-red-500` → `text-destructive`                                                                                |
| MODIFY | `frontend/src/components/workflow/McpLibraryConfig.tsx`                      | Replace 1 `text-green-500` → `text-green-500 dark:text-green-400`, 1 `text-red-500` → `text-destructive`                     |
| MODIFY | `frontend/src/components/workflow/ExecutionErrorView.tsx`                    | Replace 1 `text-red-500` → `text-destructive`                                                                                |
| MODIFY | `frontend/src/components/workflow/parameter-field/JsonField.tsx`             | Replace 1 `text-red-500` → `text-destructive`                                                                                |
| MODIFY | `frontend/src/components/workflow/parameter-field/ParameterFieldWrapper.tsx` | Replace 1 `text-red-500` → `text-destructive`                                                                                |
| MODIFY | `frontend/src/components/workflow/node/NodeHeader.tsx`                       | Replace 1 `text-red-500` → `text-destructive`                                                                                |
| MODIFY | `frontend/src/components/workflow/node/NodeInputPorts.tsx`                   | Replace 1 `text-red-500` → `text-destructive`                                                                                |
| MODIFY | `frontend/src/components/workflow/node/ParametersDisplay.tsx`                | Replace 1 `text-red-500` → `text-destructive`                                                                                |
| MODIFY | `frontend/src/components/workflow/node/McpServersDisplay.tsx`                | Replace 1 `text-green-500` → `text-green-500 dark:text-green-400`, 1 `text-red-500` → `text-destructive`                     |
| MODIFY | `frontend/src/components/workflow/node/McpGroupServersDisplay.tsx`           | Replace 1 `text-green-500` → `text-green-500 dark:text-green-400`, 1 `text-red-500` → `text-destructive`                     |
| MODIFY | `frontend/src/pages/settings/NotificationSettings.tsx`                       | Replace 1 `text-green-500` → `text-green-500 dark:text-green-400`                                                            |
| MODIFY | `frontend/src/pages/mcp-library/CustomServersTable.tsx`                      | Replace inline empty state (lines 113-129) with shared `EmptyState` component                                                |

## Phases

| Phase | Agents          | Purpose                                            | Depends On |
| ----- | --------------- | -------------------------------------------------- | ---------- |
| 1     | frontend-colors | Replace hardcoded colors + standardize empty state | —          |
| 2     | tester          | Run test suite, verify no regressions              | Phase 1    |

## Dependencies

- Tester depends on frontend-colors completing first.

## Risk Assessment

- **Low risk**: All changes are class name replacements — no behavioral changes.
- **Low risk**: `text-destructive` is well-established in the codebase — consistent with existing patterns.
- **Low risk**: `EmptyState` component is production-tested — straightforward swap.
- **Edge case**: Node display components (`McpServersDisplay`, `McpGroupServersDisplay`) use conditional color classes in ternary expressions — agent must preserve the ternary structure.
