# Agent: refactoring-frontend

## Purpose

Decompose `PublishTemplateModal.tsx` (994 LOC) into focused step components and a shared wizard state hook, placed in a `publish-template/` subdirectory.

## Skills

Load before starting: none

## Subtasks

### Analysis

- [ ] Read `frontend/src/features/templates/PublishTemplateModal.tsx` fully and identify all wizard steps, shared state, and inter-step dependencies
- [ ] Identify all imports, hooks, and utilities used by the modal to plan extraction boundaries
- [ ] Check if any other files import from `PublishTemplateModal.tsx` and note the import paths that will need updating

### Hook Extraction

- [ ] Create directory `frontend/src/features/templates/publish-template/`
- [ ] Create `frontend/src/features/templates/publish-template/usePublishTemplateWizard.ts` — extract all shared wizard state (current step, form data, validation, navigation between steps) into a custom hook
- [ ] Export clear TypeScript types for wizard state and step props from the hook file

### Step Component Extraction

- [ ] Create `frontend/src/features/templates/publish-template/MetadataStep.tsx` — extract the metadata entry step (template name, description, category, tags)
- [ ] Create `frontend/src/features/templates/publish-template/PreviewStep.tsx` — extract the workflow preview step
- [ ] Create `frontend/src/features/templates/publish-template/GitHubStep.tsx` — extract the GitHub publishing step
- [ ] Create `frontend/src/features/templates/publish-template/ReviewStep.tsx` — extract the final review/confirmation step
- [ ] Create `frontend/src/features/templates/publish-template/index.ts` — barrel export for all step components and the wizard hook

### Integration

- [ ] Refactor `PublishTemplateModal.tsx` to import from `publish-template/` subdirectory and compose the steps using the wizard hook
- [ ] Update any other files that import from the old `PublishTemplateModal.tsx` path if the export surface changed
- [ ] Verify the modal still opens, all steps render correctly, and the publish flow completes end-to-end

### Verification

- [ ] Run `bun run typecheck` and confirm no type errors
- [ ] Run `bun run lint` and confirm no lint errors in new files

## Notes

- Follow the project's frontend rules: TanStack Query for server data, Zustand only for client UI state, `useMemo` for derived data.
- Read `frontend/docs/state.md` before writing hooks to align with project patterns.
- Each step component should receive wizard state and callbacks via props from the wizard hook — avoid prop drilling through more than one level.
- Maintain all existing functionality: form validation, error handling, loading states, and success toasts.
- The `PublishTemplateModal.tsx` file should remain as the entry point (for import compatibility) but shrink significantly by composing the extracted pieces.

## Completion Summary

<!-- Appended by orchestrator after agent completes. Do not fill manually. -->
