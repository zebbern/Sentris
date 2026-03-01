# Agent: frontend (Dark Mode Colors + Empty State)

## Purpose

Replace ~50 hardcoded Tailwind color classes that lack `dark:` variants with semantic equivalents or dark-aware pairs, and replace one inline empty state with the shared `EmptyState` component.

## Skills

Load before starting: none

## Subtasks

### Context

- [x] Confirm `text-destructive` is the semantic class for error/danger (grep a few existing usages in `features/templates/` to verify the pattern)
- [x] Read `frontend/src/components/ui/EmptyState.tsx` to confirm its props API: `icon`, `title`, `description`, `action`, `className`

### Replacement rules

Apply these substitutions:

- Error text / required markers (`*`): `text-red-500` → `text-destructive`
- Delete/trash icons: `text-red-500` → `text-destructive`
- Error messages: `text-red-500` → `text-destructive`
- Success icons/text: `text-green-500` → `text-green-500 dark:text-green-400`
- Success text: `text-green-600` → `text-green-600 dark:text-green-400`
- Status healthy indicators: `text-green-500` → `text-green-500 dark:text-green-400`
- Status unhealthy indicators: `text-red-500` → `text-destructive`

### ValidationDock.tsx (~15 instances)

- [x] `frontend/src/components/workflow/ValidationDock.tsx` — replace all `text-red-500` on `AlertCircle` icons and error elements with `text-destructive`
- [x] Same file — replace all `text-green-500` on `CheckCircle2` icons with `text-green-500 dark:text-green-400`

### RunWorkflowDialog.tsx (~12 instances)

- [x] `frontend/src/components/workflow/RunWorkflowDialog.tsx` — replace all `text-red-500` on required markers (`*`) and error messages with `text-destructive`
- [x] Same file — replace `text-green-600` on the helper text (~line 198) with `text-green-600 dark:text-green-400`

### RuntimeInputsEditor.tsx (~4 instances)

- [x] `frontend/src/components/workflow/RuntimeInputsEditor.tsx` — replace `text-red-500` on Trash2 icon (~line 125) and required markers (~lines 132, 149, 164) with `text-destructive`
- [x] Same file — replace `text-green-600` on output port text (~line 279) with `text-green-600 dark:text-green-400`

### RuntimeInputsSection.tsx (~8 instances)

- [x] `frontend/src/components/schedules/RuntimeInputsSection.tsx` — replace all `text-red-500` on required markers and error messages with `text-destructive` (8 instances across lines 45, 72, 80, 98, 106, 125, 133, 150)

### NodeOverridesSection.tsx (2 instances)

- [x] `frontend/src/components/schedules/NodeOverridesSection.tsx` — replace `text-red-500` on Trash2 icon (~line 76) and error message (~line 86) with `text-destructive`

### Webhook files (3 instances)

- [x] `frontend/src/components/workflow/WebhookDetails.tsx` — replace `text-green-500` (~line 216) with `text-green-500 dark:text-green-400` and `text-green-600` "Copied" text (~line 217) with `text-green-600 dark:text-green-400`
- [x] `frontend/src/components/workflow/WorkflowWebhooksPanel.tsx` — replace 2× `text-green-500` (~lines 177, 277) with `text-green-500 dark:text-green-400`

### Editor files (2 instances)

- [x] `frontend/src/components/workflow/SimpleVariableListEditor.tsx` — replace `text-red-500` on Trash2 (~line 115) with `text-destructive`
- [x] `frontend/src/components/workflow/SelectionOptionsEditor.tsx` — replace `text-red-500` on Trash2 (~line 97) with `text-destructive`

### AnalyticsInputsEditor.tsx (3 instances)

- [x] `frontend/src/components/workflow/AnalyticsInputsEditor.tsx` — replace `text-red-500` on Trash2 (~line 114) and required markers (~lines 121, 138) with `text-destructive`

### McpLibraryConfig.tsx (2 instances)

- [x] `frontend/src/components/workflow/McpLibraryConfig.tsx` — replace `text-green-500` on healthy CheckCircle2 (~line 293) with `text-green-500 dark:text-green-400`, and `text-red-500` on unhealthy AlertCircle (~line 294) with `text-destructive`

### ExecutionErrorView.tsx (1 instance)

- [x] `frontend/src/components/workflow/ExecutionErrorView.tsx` — replace `text-red-500` (~line 103) with `text-destructive`

### Parameter field components (2 instances)

- [x] `frontend/src/components/workflow/parameter-field/JsonField.tsx` — replace `text-red-500` on JSON error message (~line 90) with `text-destructive`
- [x] `frontend/src/components/workflow/parameter-field/ParameterFieldWrapper.tsx` — replace `text-red-500` on required marker (~line 172) with `text-destructive`

### Node display components (7 instances)

- [x] `frontend/src/components/workflow/node/NodeHeader.tsx` — replace `text-red-500` (~line 189) with `text-destructive`
- [x] `frontend/src/components/workflow/node/NodeInputPorts.tsx` — replace `text-red-500` (~line 163) with `text-destructive`
- [x] `frontend/src/components/workflow/node/ParametersDisplay.tsx` — replace `text-red-500` (~line 83) with `text-destructive`
- [x] `frontend/src/components/workflow/node/McpServersDisplay.tsx` — replace `text-green-500` (~line 76) with `text-green-500 dark:text-green-400` and `text-red-500` (~line 78) with `text-destructive`
- [x] `frontend/src/components/workflow/node/McpGroupServersDisplay.tsx` — replace `text-green-500` (~line 67) with `text-green-500 dark:text-green-400` and `text-red-500` (~line 69) with `text-destructive`

### NotificationSettings.tsx (1 instance)

- [x] `frontend/src/pages/settings/NotificationSettings.tsx` — replace `text-green-500` on CheckCircle2 (~line 201) with `text-green-500 dark:text-green-400`

### Empty state standardization

- [x] `frontend/src/pages/mcp-library/CustomServersTable.tsx` — replace inline empty state (lines ~113-129) with `<EmptyState icon={Plug} title={searchQuery ? 'No servers match your search' : 'No custom servers configured'} action={!searchQuery ? <Button ...>Add your first custom server</Button> : undefined} />` wrapped in a `<TableRow><TableCell colSpan={8}>...</TableCell></TableRow>`

### Verify

- [x] Run `get_errors` on all modified files to confirm no TypeScript errors
- [x] Grep for remaining `text-red-500` without `dark:` in the modified files — should be zero
- [x] Grep for remaining `text-green-500` or `text-green-600` without `dark:` in the modified files — should be zero

## Notes

- `text-destructive` is the established pattern — see `UseTemplateModal.tsx`, `PublishTemplateModal.tsx`, `AnalyticsSettingsPage.tsx`, `ArtifactLibrary.tsx`, `ProviderConfigDialog.tsx` for existing usages.
- Some files already have correct dark-aware patterns (e.g., `McpDiscoveryPreview.tsx` uses `text-green-600 dark:text-green-400`). Do NOT modify files that are already correct.
- Node components (`McpServersDisplay`, `McpGroupServersDisplay`) use ternary expressions for conditional color classes — preserve the ternary structure, only change the class string values.
- `DynamicIcon.test.tsx` uses `text-red-500` in a test assertion — leave test files as-is unless the source change breaks them.
- The `EmptyState` component is at `@/components/ui/EmptyState` — import it with `import { EmptyState } from '@/components/ui/EmptyState'`.

## Completion Summary

<!-- Appended by orchestrator after agent completes. Do not fill manually. -->
