# Triage: Phase 6 — Polish & Decomposition Round

## EXECUTION_PLAN

| Order | Agent                  | Task Summary                                                                                                                 |
| ----- | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| 1     | browser-tester         | Screenshot all pages to document current UI state                                                                            |
| 2a    | refactoring (backend)  | Decompose `workflows.service.ts` (1886 lines) + `workflows.controller.ts` (1401 lines) into focused sub-services/controllers |
| 2b    | refactoring (frontend) | Decompose `PublishTemplateModal.tsx` (994 lines) into step components + wizard hook                                          |
| 2c    | frontend               | Decompose `ActionCenterPage.tsx` (465 lines) — extract table, modal, filter hooks                                            |
| 3a    | tester                 | Write browser E2E tests for Settings page and Artifact Library page                                                          |
| 3b    | implementer            | Create 3-4 new security workflow templates                                                                                   |
| 3c    | doc-writer             | Write user-facing documentation for Webhooks, Schedules, Action Center, MCP Library                                          |
| 4     | browser-tester         | Final browser E2E walkthrough                                                                                                |

## Phases

| Phase | Steps            | Purpose                            | Dependencies |
| ----- | ---------------- | ---------------------------------- | ------------ |
| 1     | Step 1           | Baseline screenshots of current UI | —            |
| 2     | Steps 2a, 2b, 2c | Code decomposition (parallel)      | Phase 1      |
| 3     | Steps 3a, 3b, 3c | Tests, templates, docs (parallel)  | Phase 2      |
| 4     | Step 4           | Final verification                 | Phase 3      |

## Prior Context

- 5 prior phases complete (~29 commits, 100+ files)
- 80 E2E + 17 backend unit tests passing
- All prior reviews passed
- Stack: NestJS backend + React/Vite frontend + Docker infra
