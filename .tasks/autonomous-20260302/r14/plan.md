# Plan: Round 14 — Decompose PublishTemplateModal & CommandPalette

## Overview

Decompose the two largest remaining frontend components — `PublishTemplateModal.tsx` (994 LOC) and `CommandPalette.tsx` (877 LOC) — into smaller, focused modules. Follow the established pattern: extract sub-components/hooks/utils into sibling files in the same directory, keep the parent as an orchestrator/shell under 300 lines. No behavioral changes.

## Architecture Decisions

| Decision                                                                                         | Alternatives              | Rationale                                                                                                                  |
| ------------------------------------------------------------------------------------------------ | ------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Extract types+constants to `*-types.ts` files                                                    | Inline in parent          | Follows codebase convention; types are reusable and reduce parent LOC significantly                                        |
| Extract pure utility functions to `*-utils.ts` files                                             | Keep inline               | Functions like `sanitizeGraphForTemplate`, `scoreMatch` are pure — no coupling to React state                              |
| Extract step views from PublishTemplateModal as components                                       | Use render functions      | Step views are self-contained JSX blocks with clear props boundaries — proper components enable independent testing        |
| Extract command builders in CommandPalette as custom hooks                                       | Keep as useMemo in parent | 8 separate useMemo blocks (~200 LOC) are the biggest contributor; grouping into 2-3 hooks dramatically reduces parent size |
| Extract `CommandItem.tsx` as a render component                                                  | Keep inline               | The command item renderer (~80 lines of JSX with icon/logo resolution) is a natural component boundary                     |
| Keep `StepIndicator` and `JsonPreview` as separate files (they are already standalone functions) | Leave in parent           | They're already standalone component functions — extracting to sibling files is mechanical                                 |

## Affected Files

### PublishTemplateModal decomposition

| Action | File Path                                                   | Change Description                                                                                                                                           |
| ------ | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| CREATE | `frontend/src/features/templates/publish-template-types.ts` | Types, interfaces, constants (TEMPLATE_CATEGORIES, COMMON_TAGS, PUBLISH_STEPS, PublishStep)                                                                  |
| CREATE | `frontend/src/features/templates/publish-template-utils.ts` | Pure utilities: sanitizeGraphForTemplate, extractRequiredSecrets, stripLayoutData, generateTemplateJson, generateGitHubUrl, sanitizeFilename, formatJsonSize |
| CREATE | `frontend/src/features/templates/StepIndicator.tsx`         | Step progress indicator component                                                                                                                            |
| CREATE | `frontend/src/features/templates/JsonPreview.tsx`           | Collapsible JSON preview component                                                                                                                           |
| CREATE | `frontend/src/features/templates/ConfigureStepForm.tsx`     | Configure step form (name, description, category, tags, author)                                                                                              |
| CREATE | `frontend/src/features/templates/ReviewStep.tsx`            | Review step content (metadata summary + JSON preview)                                                                                                        |
| CREATE | `frontend/src/features/templates/PublishStep.tsx`           | Publish/awaiting GitHub step (instructions, copy button, return detection)                                                                                   |
| CREATE | `frontend/src/features/templates/DoneStep.tsx`              | Done state (success message, PR status check)                                                                                                                |
| MODIFY | `frontend/src/features/templates/PublishTemplateModal.tsx`  | Import extracted modules, keep only state management + Dialog shell + step routing                                                                           |

### CommandPalette decomposition

| Action | File Path                                                          | Change Description                                                                       |
| ------ | ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| CREATE | `frontend/src/features/command-palette/command-palette-types.ts`   | Command types, CommandCategory, categoryLabels, categoryOrder, MAX_RESULTS_PER_CATEGORY  |
| CREATE | `frontend/src/features/command-palette/command-palette-scoring.ts` | scoreMatch and scoreCommand utility functions                                            |
| CREATE | `frontend/src/features/command-palette/useStaticCommands.ts`       | Hook returning static navigation + action commands                                       |
| CREATE | `frontend/src/features/command-palette/useEntityCommands.ts`       | Hook returning workflow, component, template, schedule, secret, apiKey, webhook commands |
| CREATE | `frontend/src/features/command-palette/useFilteredCommands.ts`     | Hook that combines all commands, filters/scores by query, groups by category             |
| CREATE | `frontend/src/features/command-palette/CommandItem.tsx`            | Individual command row rendering (icon/logo resolution, selected state)                  |
| CREATE | `frontend/src/features/command-palette/CommandGroup.tsx`           | Group rendering (header + CommandItems + "view all" link)                                |
| MODIFY | `frontend/src/features/command-palette/CommandPalette.tsx`         | Import extracted modules, keep only Dialog shell + search input + keyboard handling      |
| MODIFY | `frontend/src/features/command-palette/index.ts`                   | No change needed — existing barrel export of `CommandPalette` stays valid                |

## Phases

| Phase | Agents             | Purpose                                   | Depends On |
| ----- | ------------------ | ----------------------------------------- | ---------- |
| 1     | frontend-decompose | Decompose both components                 | —          |
| 2     | tester-verify      | Run full test suite, confirm 398/398 pass | Phase 1    |

## Dependencies

- PublishTemplateModal and CommandPalette decompositions are independent of each other (disjoint file sets).
- Tester depends on all decomposition completing first.
- `index.ts` barrel export for CommandPalette already exports `CommandPalette` — no change needed as the export stays in the same file.

## Risk Assessment

- **Low risk**: Pure structural refactoring — no behavioral changes, no public API changes.
- **Step view extraction (PublishTemplateModal)**: The configure/review/publish/done steps need props for state and callbacks. Ensure proper typing of props interfaces.
- **Hook extraction (CommandPalette)**: `useStaticCommands` depends on `navigate`, `close`, `theme`, `startTransition`. `useEntityCommands` depends on query data. Prop threading must be correct.
- **CommandItem**: Uses `ComponentCommand` type assertion for `iconUrl` — ensure the type narrowing is preserved.
- **No test files exist for either component** — regressions are caught only via the full suite (tests that render parents importing these components).
