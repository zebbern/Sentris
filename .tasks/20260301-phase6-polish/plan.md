# Plan: Phase 6 — Polish & Decomposition Round

## Overview

This phase focuses on code quality and completeness: decomposing oversized files in both backend and frontend, adding new security workflow templates, writing user-facing documentation for recent features, and adding E2E test coverage for Settings and Artifact Library pages. A baseline screenshot round bookends the work for regression tracking.

## Architecture Decisions

| Decision                                                             | Alternatives                                         | Rationale                                                                                                              |
| -------------------------------------------------------------------- | ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Split `workflows.service.ts` by domain (CRUD, Run, Status)           | Single file with regions; extract only Run service   | Domain split aligns with controller endpoints and keeps each service under 400 LOC. Matches NestJS DI patterns.        |
| Split `workflows.controller.ts` alongside service split (CRUD, Run)  | Keep single controller; split into 3+ controllers    | Two controllers (CRUD + Run) matches the two primary domain areas and keeps routes organized without over-fragmenting. |
| Extract `PublishTemplateModal` into `publish-template/` subdirectory | Leave in features/templates root; extract just hooks | Subdirectory mirrors existing feature-folder patterns and keeps wizard steps collocated.                               |
| Extract `ActionCenterPage` into `pages/action-center/` subdirectory  | Leave in pages root; extract only hooks              | Same rationale — collocated sub-components for a complex page.                                                         |
| New template JSONs follow existing seed-templates format             | Custom schema; YAML format                           | Consistency with 9 existing templates. JSON is already the established format.                                         |
| New docs follow existing `/guides/` Mintlify format                  | Standalone markdown; docusaurus                      | Mintlify is the established doc system; guides already exist as reference.                                             |

## Affected Files

| Action | File Path                                                                      | Change Description                                               |
| ------ | ------------------------------------------------------------------------------ | ---------------------------------------------------------------- |
| MODIFY | `backend/src/workflows/workflows.service.ts`                                   | Extract methods into sub-services, keep as facade                |
| CREATE | `backend/src/workflows/workflow-crud.service.ts`                               | CRUD operations (create, update, delete, list, findById)         |
| CREATE | `backend/src/workflows/workflow-run.service.ts`                                | Run operations (run, startPreparedRun, listRuns, getRun, cancel) |
| CREATE | `backend/src/workflows/workflow-status.service.ts`                             | Status computation, buildRunSummary                              |
| MODIFY | `backend/src/workflows/workflows.controller.ts`                                | Extract run endpoints into a separate controller                 |
| CREATE | `backend/src/workflows/workflow-crud.controller.ts`                            | CRUD endpoints                                                   |
| CREATE | `backend/src/workflows/workflow-run.controller.ts`                             | Run, stream, terminal, node I/O endpoints                        |
| MODIFY | `backend/src/workflows/workflows.module.ts`                                    | Register new services/controllers                                |
| MODIFY | `backend/src/workflows/__tests__/workflows.service.spec.ts`                    | Update imports if needed; all 17 tests must pass                 |
| MODIFY | `frontend/src/features/templates/PublishTemplateModal.tsx`                     | Replace with thin wrapper importing step components              |
| CREATE | `frontend/src/features/templates/publish-template/MetadataStep.tsx`            | Metadata step component                                          |
| CREATE | `frontend/src/features/templates/publish-template/PreviewStep.tsx`             | Preview step component                                           |
| CREATE | `frontend/src/features/templates/publish-template/GitHubStep.tsx`              | GitHub step component                                            |
| CREATE | `frontend/src/features/templates/publish-template/ReviewStep.tsx`              | Review step component                                            |
| CREATE | `frontend/src/features/templates/publish-template/usePublishTemplateWizard.ts` | Shared wizard state hook                                         |
| MODIFY | `frontend/src/pages/ActionCenterPage.tsx`                                      | Replace with thin composition of extracted components            |
| CREATE | `frontend/src/pages/action-center/ActionCenterTable.tsx`                       | Table component                                                  |
| CREATE | `frontend/src/pages/action-center/ActionDetailModal.tsx`                       | Detail modal component                                           |
| CREATE | `frontend/src/pages/action-center/useActionCenterFilters.ts`                   | Filter/sort logic hook                                           |
| CREATE | `e2e-tests/core/settings.spec.ts`                                              | E2E tests for Settings page (5 tabs)                             |
| CREATE | `e2e-tests/core/artifact-library.spec.ts`                                      | E2E tests for Artifact Library page                              |
| CREATE | `backend/scripts/seed-templates/dast-scanning.json`                            | DAST scanning template                                           |
| CREATE | `backend/scripts/seed-templates/dependency-audit.json`                         | Dependency/secret audit template                                 |
| CREATE | `backend/scripts/seed-templates/dns-monitoring.json`                           | DNS monitoring template                                          |
| CREATE | `backend/scripts/seed-templates/api-security-testing.json`                     | API security testing template                                    |
| CREATE | `docs/guides/webhooks.md`                                                      | Webhooks user guide                                              |
| CREATE | `docs/guides/schedules.md`                                                     | Schedules user guide                                             |
| CREATE | `docs/guides/action-center.md`                                                 | Action Center user guide                                         |
| CREATE | `docs/guides/mcp-library.md`                                                   | MCP Library user guide                                           |
| MODIFY | `docs/docs.json`                                                               | Add new guide pages to navigation                                |

## Phases

| Phase | Agents                                              | Purpose                                            | Depends On |
| ----- | --------------------------------------------------- | -------------------------------------------------- | ---------- |
| 1     | browser-tester (baseline)                           | Screenshot all pages for regression baseline       | —          |
| 2     | refactoring-backend, refactoring-frontend, frontend | Decompose oversized files (parallel)               | Phase 1    |
| 3     | tester, implementer, doc-writer                     | E2E tests, new templates, documentation (parallel) | Phase 2    |
| 4     | browser-tester (final)                              | Final screenshot walkthrough, regression check     | Phase 3    |

## Dependencies

- **refactoring-backend** is independent of **refactoring-frontend** and **frontend** — all Phase 2 agents work in parallel with no file overlap.
- **tester** (Phase 3) should run after Phase 2 to capture refactored pages in tests.
- **implementer** (Phase 3) has no dependency on Phase 2 — templates are new files only.
- **doc-writer** (Phase 3) should run after Phase 2 to reference refactored components if needed, though docs describe features not code.
- **browser-tester (final)** depends on all Phase 2 and 3 work being complete.

## Risk Assessment

| Risk                                                   | Impact | Mitigation                                                      |
| ------------------------------------------------------ | ------ | --------------------------------------------------------------- |
| Backend refactoring breaks 17 existing unit tests      | High   | Subtasks explicitly require running tests after each split step |
| Controller split changes API routes, breaking frontend | High   | Keep same route paths; only internal organization changes       |
| PublishTemplateModal state sharing breaks wizard flow  | Medium | Wizard hook centralizes state; test manually after extraction   |
| New templates have incorrect graph structure           | Medium | Follow exact format of existing 9 templates                     |
| Docs reference features that don't exist yet           | Low    | Features exist from prior phases; docs describe current state   |
