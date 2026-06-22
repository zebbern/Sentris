# Template Validation Status Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface Template Library live-validation metadata from the audit ledger in the backend API and frontend cards.

**Architecture:** Add a backend ledger reader that enriches template rows without a migration. Render the resulting optional `validation` field in the existing Template Library card metadata line.

**Tech Stack:** NestJS, Drizzle row types, Bun tests, React, TanStack Query, Testing Library.

---

### Task 1: Backend Red Test

**Files:**

- Modify: `backend/src/templates/__tests__/templates.service.spec.ts`

- [x] Add a failing test for `TemplateService.listTemplates()` that passes a fake validation service and expects the returned template to include `validation.status === 'live-verified'`, `artifactsCount`, `verifiedAt`, and `isCurrent === true`.
- [x] Run `bun --cwd backend test src/templates/__tests__/templates.service.spec.ts` and confirm the new test fails because templates are not enriched yet.

### Task 2: Backend Implementation

**Files:**

- Create: `backend/src/templates/template-validation-ledger.service.ts`
- Modify: `backend/src/templates/templates.service.ts`
- Modify: `backend/src/templates/templates.module.ts`

- [x] Implement `TemplateValidationLedgerService` with safe JSON parsing, path fallback, recommendation-to-status mapping, and missing-ledger fallback.
- [x] Inject the service into `TemplateService`.
- [x] Enrich `listTemplates()` and `getTemplateById()` responses with `validation`.
- [x] Run `bun --cwd backend test src/templates/__tests__/templates.service.spec.ts` and confirm it passes.

### Task 3: Frontend Red Test

**Files:**

- Modify: `frontend/src/pages/__tests__/TemplateLibraryPage.test.tsx`

- [x] Add a failing test that renders a validated template and expects `Live verified`.
- [x] Add a failing test that renders a stale validation and expects stale validation copy.
- [x] Run `bun --cwd frontend test src/pages/__tests__/TemplateLibraryPage.test.tsx` and confirm the tests fail before UI changes.

### Task 4: Frontend Implementation

**Files:**

- Modify: `frontend/src/types/templates.ts`
- Modify: `frontend/src/pages/template-library/TemplateCard.tsx`

- [x] Add `TemplateValidationStatus` and `TemplateValidation` types.
- [x] Render a compact validation badge with tooltip in `TemplateCard`.
- [x] Keep the metadata line responsive and avoid layout shifts.
- [x] Run `bun --cwd frontend test src/pages/__tests__/TemplateLibraryPage.test.tsx` and confirm it passes.

### Task 5: Verification

**Files:**

- All touched files.

- [x] Run focused backend service tests.
- [x] Run focused frontend Template Library tests.
- [x] Run `bun run typecheck`.
- [x] Run `bun run lint`.
- [x] Run `git diff --check -- . ':(exclude)AGENTS.md'`.
- [x] Browser-check `/templates` and confirm the validation badge appears for validated templates.
