# Template Validation Filter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Template Library filter for live-validation state.

**Architecture:** Keep validation filtering client-side using existing template API metadata. Derive a filtered template array in `TemplateLibraryPage`, then pass it to existing sorting/rendering.

**Tech Stack:** React, TanStack Query, Testing Library, shadcn/Radix Select wrappers.

---

### Task 1: Red Tests

**Files:**

- Modify: `frontend/src/pages/__tests__/TemplateLibraryPage.test.tsx`

- [x] Add fixtures for live-verified, stale, needs-review, and unknown templates.
- [x] Add a test that selects `Live verified` and expects only current live-verified templates.
- [x] Add a test that selects `Needs review` and expects only review templates.
- [x] Add a test that clears filters and expects hidden templates to return.
- [x] Run `bun --cwd frontend test src/pages/__tests__/TemplateLibraryPage.test.tsx` and confirm the new tests fail.

### Task 2: Implementation

**Files:**

- Modify: `frontend/src/pages/TemplateLibraryPage.tsx`
- Modify: `frontend/src/pages/template-library/TemplateFilters.tsx`

- [x] Add `selectedValidation` state and include it in `hasFilters` / `clearFilters`.
- [x] Derive `filteredTemplates` with `useMemo` from `templates` and `selectedValidation`.
- [x] Pass `filteredTemplates` to `useSortableList`.
- [x] Add the validation select to `TemplateFilters`.
- [x] Run focused Template Library tests and confirm they pass.

### Task 3: Verification

**Files:**

- All touched files.

- [x] Run `bun --cwd frontend test src/pages/__tests__/TemplateLibraryPage.test.tsx`.
- [x] Run `bun run typecheck`.
- [x] Run `bun run lint`.
- [x] Run `git diff --check -- . ':(exclude)AGENTS.md'`.
- [x] Browser-check `/templates` by selecting `Live verified` and confirming the card count remains 10 for the current ledger.
