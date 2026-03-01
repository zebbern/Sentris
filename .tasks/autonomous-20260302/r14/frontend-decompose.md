# Agent: frontend (Decompose PublishTemplateModal & CommandPalette)

## Purpose

Decompose `PublishTemplateModal.tsx` (994 LOC) and `CommandPalette.tsx` (877 LOC) into smaller modules by extracting types, utilities, hooks, and sub-components into sibling files. Target: both parents under 300 lines. Pure structural refactoring — no behavioral changes.

## Skills

Load before starting: none

## Subtasks

### Part A: PublishTemplateModal.tsx (994 → ~250 lines)

#### Context gathering

- [x] Read `frontend/src/features/templates/PublishTemplateModal.tsx` in full to understand all types, utilities, sub-components, state, callbacks, and JSX step views
- [x] Read existing sibling files (`UseTemplateModal.tsx`, `WorkflowPreview.tsx`) to understand directory conventions

#### Extract types and constants

- [x] Create `frontend/src/features/templates/publish-template-types.ts` containing:
  - `PublishTemplateModalProps` interface
  - `WorkflowResponse`, `TemplateMetadata`, `TemplateJson` interfaces
  - `PublishStep` type and `PUBLISH_STEPS` constant
  - `TEMPLATE_CATEGORIES` array
  - `COMMON_TAGS` array
  - `DEFAULT_GITHUB_TEMPLATE_REPO` and `DEFAULT_GITHUB_BRANCH` constants

#### Extract utility functions

- [x] Create `frontend/src/features/templates/publish-template-utils.ts` containing all pure functions:
  - `sanitizeGraphForTemplate(graph)` — sanitize secrets from workflow graph
  - `extractRequiredSecrets(graph)` — extract secret requirements for documentation
  - `stripLayoutData(graph)` — remove viewport from graph
  - `generateTemplateJson(workflow, metadata)` — build the full template JSON structure
  - `generateGitHubUrl(owner, repo, branch, filename, templateName)` — build GitHub new-file URL
  - `sanitizeFilename(name)` — convert name to safe `.jsonc` filename
  - `formatJsonSize(json)` — format byte size of JSON string

#### Extract sub-components

- [x] Create `frontend/src/features/templates/StepIndicator.tsx` — extract the `StepIndicator` component (lines ~121–163). It receives `currentStep: PublishStep` and renders the step progress nav. Import `PublishStep` and `PUBLISH_STEPS` from the types file
- [x] Create `frontend/src/features/templates/JsonPreview.tsx` — extract the `JsonPreview` component (lines ~170–229). It receives `json`, `defaultOpen`, `onCopy`, `isCopied` props. Also bring `formatJsonSize` import from utils
- [x] Create `frontend/src/features/templates/ConfigureStepForm.tsx` — extract the configure form (lines ~875–990 of the JSX). Define a props interface for the form state values and their setters, plus `onSubmit`, `isLoading`, `error`, `onClose`. Include the tag input, common tags, category select, author field, and info box
- [x] Create `frontend/src/features/templates/ReviewStep.tsx` — extract the review step (lines ~812–874). Props: `name`, `description`, `category`, `author`, `tags`, `generatedTemplateJson`, `error`, `isLoading`, `onBack`, `onPublish`, `onCopyJson`, `isCopied`
- [x] Create `frontend/src/features/templates/PublishStep.tsx` — extract the publish/awaiting GitHub step (lines ~676–812). Props: `returnedFromGithub`, `hasCopiedOnSubmit`, `generatedTemplateJson`, `copiedText`, `onCopyToClipboard`, `onCheckPrStatus`, `onConfirmDone`, `onResetReturn`
- [x] Create `frontend/src/features/templates/DoneStep.tsx` — extract the done state (lines ~638–676). Props: `onCheckPrStatus`, `onClose`

#### Update parent component

- [x] Update `PublishTemplateModal.tsx` — replace all inlined code with imports from the new files. The parent should contain only: state declarations, callback handlers, and the Dialog shell that selects which step component to render based on `step` state
- [x] Verify `PublishTemplateModal.tsx` is under 300 lines after extraction (285 lines)
- [x] Run `get_errors` on `PublishTemplateModal.tsx` and all new files to confirm no TypeScript errors

---

### Part B: CommandPalette.tsx (877 → ~250 lines)

#### Context gathering

- [x] Read `frontend/src/features/command-palette/CommandPalette.tsx` in full to understand all types, utilities, hooks, state, and JSX
- [x] Read `frontend/src/features/command-palette/index.ts` and `useCommandPaletteKeyboard.ts` to understand existing barrel exports and conventions

#### Extract types and constants

- [x] Create `frontend/src/features/command-palette/command-palette-types.ts` containing:
  - `CommandCategory` type
  - `BaseCommand`, `NavigationCommand`, `ActionCommand`, `WorkflowCommand`, `ComponentCommand` interfaces
  - `Command` union type
  - `categoryLabels` record
  - `categoryOrder` array
  - `MAX_RESULTS_PER_CATEGORY` constant

#### Extract scoring utilities

- [x] Create `frontend/src/features/command-palette/command-palette-scoring.ts` containing:
  - `scoreMatch(text, term)` — score how well text matches a search term
  - `scoreCommand(cmd, terms)` — score a command against multiple search terms

#### Extract command-building hooks

- [x] Create `frontend/src/features/command-palette/useStaticCommands.ts` — a hook that returns the static navigation + action commands array. It receives or internally accesses `navigate`, `close`, `theme`, `startTransition`, and the `VITE_ENABLE_CONNECTIONS` env flag. Returns `Command[]`
- [x] Create `frontend/src/features/command-palette/useEntityCommands.ts` — a hook that returns entity-based command arrays. It takes the query data (workflows, templates, schedules, secrets, apiKeys, webhooks, allComponents) and returns an object with `workflowCommands`, `componentCommands`, `templateCommands`, `scheduleCommands`, `secretCommands`, `apiKeyCommands`, `webhookCommands`. Each is a `Command[]`
- [x] Create `frontend/src/features/command-palette/useFilteredCommands.ts` — a hook that takes `query`, `allCommands[]`, `staticCommands[]`, `workflowCommands[]`, `componentCommands[]`, `canPlaceComponents` and returns `{ filteredCommands, groupedCommands, flatCommandList }`. Uses `scoreCommand` from scoring utils

#### Extract render components

- [x] Create `frontend/src/features/command-palette/CommandItem.tsx` — extract the individual command row rendering (lines ~780–840 of JSX). Props: `command: Command`, `isSelected: boolean`, `canPlaceComponents: boolean`, `onExecute: (cmd) => void`, `onMouseEnter: () => void`. Handles icon/logo/DynamicIcon resolution and selected state styling
- [x] Create `frontend/src/features/command-palette/CommandGroup.tsx` — extract the group rendering (lines ~760–856). Props: `group` (category, label, totalCount, commands, hasMore), `startIndex: number`, `selectedIndex: number`, `canPlaceComponents: boolean`, `onExecuteCommand`, `onSelectIndex`, `onViewAll`. Renders group header + CommandItems + optional "View all" link

#### Update parent component

- [x] Update `CommandPalette.tsx` — replace all inlined code with imports from the new files. The parent should contain only: Dialog shell, search input, keyboard handling (`handleKeyDown`), `executeCommand`, scroll/focus effects, and orchestration of the extracted hooks
- [x] Verify `CommandPalette.tsx` is under 300 lines after extraction (294 lines)
- [x] Run `get_errors` on `CommandPalette.tsx` and all new files to confirm no TypeScript errors

---

### Final verification

- [x] Verify no circular imports between new and existing files in both directories
- [x] Search for imports of `PublishTemplateModal` to verify existing consumers are unaffected (the named export stays in the same file)
- [x] Search for imports of `CommandPalette` to verify existing consumers are unaffected (the barrel export via `index.ts` stays valid)
- [x] Verify `index.ts` in `command-palette/` does not need changes (it re-exports `CommandPalette` from `./CommandPalette`, which still exists)

## Notes

- **PublishTemplateModal structure**: The component has 4 wizard steps (`configure` → `review` → `publish` → `done`) rendered conditionally in the JSX. Each step is a natural extraction boundary. The parent holds ~15 state variables and ~8 callbacks that are threaded to step components via props.
- **PublishTemplateModal utilities**: 7 pure functions (lines 165–399) totaling ~160 lines — these have zero React dependencies and are straightforward to extract.
- **StepIndicator and JsonPreview**: Already standalone function components defined above the main export — extracting to separate files is mechanical (just move + add imports).
- **CommandPalette hooks**: The component has 8 `useMemo` blocks for building command arrays (~200 LOC total). Group them into 2 hooks: `useStaticCommands` (nav + actions) and `useEntityCommands` (data-driven commands).
- **CommandPalette query dependencies**: `useEntityCommands` needs access to query results from `useWorkflowsList`, `useTemplates`, `useSchedules`, `useSecrets`, `useApiKeys`, `useWebhooks`, `useComponents`. These queries should stay in the parent and pass data down, OR the hook can call the queries internally. Choose whichever keeps the parent cleaner — calling queries inside the hook is preferred since it avoids prop threading.
- **Component filtering** (lines 196–210): The `allComponents` useMemo that filters out demo/entry-point components should move into `useEntityCommands` alongside the component command builder.
- **`handleComponentSelect`**: This callback uses `setPlacement` from `usePlacementStore` and `currentWorkflowId` from `useWorkflowStore`. It should stay in the parent or move into a `useCommandExecution` hook if the parent is still too large.
- **No behavioral changes**: All visual output, keyboard interactions, step transitions, and navigation must remain identical.
- **Import grouping**: Follow the project convention — standard library, external packages, internal modules, relative imports.

## Completion Summary

<!-- Appended by orchestrator after agent completes. Do not fill manually. -->
