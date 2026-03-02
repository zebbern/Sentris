# Agent: code-reviewer

## Purpose

Review untested frontend component directories (`workflow/`, `timeline/`, `templates/`, `terminal/`) for code quality issues, anti-patterns, and potential bugs.

## Skills

Load before starting: none

## Subtasks

### workflow/ components (`frontend/src/components/workflow/`)

- [ ] Review `Canvas.tsx` and `WorkflowBuilderShell.tsx` — check for render performance issues (excessive re-renders, missing memoization on heavy components, inline object/function creation in JSX)
- [ ] Review `ConfigPanel.tsx` and `config-panel/` directory — check for proper form state management, prop drilling, accessibility of form fields
- [ ] Review `ConnectionLine.tsx`, `canvas-connections.ts`, `edge-routing.ts`, `edgeBundling.ts` — check for algorithmic correctness, performance with large graphs, dead code
- [ ] Review `parameter-field/` directory — check for consistent validation patterns, error handling, TypeScript type safety
- [ ] Review `node/` and `nodes/` directories — check for consistent node rendering patterns, proper event handling, accessibility
- [ ] Review `RunWorkflowDialog.tsx`, `HumanInputDialog.tsx`, `HumanInputResolutionView.tsx` — check for loading/error state handling, form validation, modal accessibility
- [ ] Review `AnalyticsInputsEditor.tsx`, `FormFieldsEditor.tsx`, `RuntimeInputsEditor.tsx`, `SelectionOptionsEditor.tsx`, `SimpleVariableListEditor.tsx` — check for consistent editor patterns, array manipulation correctness

### timeline/ components (`frontend/src/components/timeline/`)

- [ ] Review `ExecutionTimeline.tsx`, `ExecutionInspector.tsx` — check for proper data fetching patterns (TanStack Query, not useState+useEffect), stale time configuration, loading/error states
- [ ] Review `NodeIOInspector.tsx`, `ReviewInspector.tsx`, `EventInspector.tsx` — check for large data handling (pagination, virtualization), XSS in rendered content
- [ ] Review `agent-trace/` directory — check for proper trace rendering, recursive data handling
- [ ] Review `network/` directory — check for network panel data display patterns, performance with large datasets

### templates/ (`frontend/src/pages/template-library/`)

- [ ] Review `TemplateCard.tsx`, `TemplateDetailModal.tsx`, `TemplateFilters.tsx`, `PreviewSection.tsx` — check for consistent component patterns, prop types, accessibility, loading states

### terminal/ (`frontend/src/components/terminal/`)

- [ ] Review `NodeTerminalPanel.tsx`, `TerminalDockPanel.tsx`, `useXterm.ts`, `terminal-utils.ts` — check for xterm.js lifecycle management (proper disposal), memory leak potential, resize handling, accessibility

### Cross-cutting concerns

- [ ] Check for console.log/console.error statements that should use the structured logger (`src/lib/logger.ts`)
- [ ] Check for `any` type usage that should be properly typed
- [ ] Check for missing error boundaries around crash-prone components
- [ ] Compile all findings with severity: S0 (bugs/security), S1 (code quality), S2 (style/minor)

## Notes

- This is a READ-ONLY review — do not modify any source files
- Focus on actionable findings that the error-fixer agent can address
- Prioritize: security issues > bugs > performance > code quality > style
- Reference specific file paths and line numbers in findings
- Check against patterns established in AGENTS.md (TanStack Query for data, Zustand for UI state, granular selectors, etc.)

## Completion Summary

<!-- Appended by orchestrator after agent completes. Do not fill manually. -->
