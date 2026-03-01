# Agent: refactoring-backend

## Purpose

Decompose `workflows.service.ts` (1886 LOC) and `workflows.controller.ts` (1401 LOC) into focused, domain-specific sub-services and sub-controllers without changing any external API behavior.

## Skills

Load before starting: none

## Subtasks

### Service Decomposition

- [ ] Read `backend/src/workflows/workflows.service.ts` fully and catalog all public methods by domain (CRUD, Run, Status)
- [ ] Read `backend/src/workflows/__tests__/workflows.service.spec.ts` to understand test coverage and dependencies
- [ ] Read `backend/src/workflows/workflows.module.ts` to understand current DI registrations
- [ ] Create `backend/src/workflows/workflow-crud.service.ts` — extract create, update, updateMetadata, delete, list, findById, listVersions, commit methods
- [ ] Create `backend/src/workflows/workflow-run.service.ts` — extract run, startPreparedRun, prepareRun, listRuns, getRun, getRunConfig, cancel methods
- [ ] Create `backend/src/workflows/workflow-status.service.ts` — extract status computation, buildRunSummary, getFailureDetails, and related helper methods
- [ ] Refactor `workflows.service.ts` to delegate to the three new sub-services (facade pattern) — keep it as a thin coordinator so existing consumers don't break
- [ ] Update `workflows.module.ts` to register the three new services as providers

### Controller Decomposition

- [ ] Read `backend/src/workflows/workflows.controller.ts` fully and catalog all endpoints by domain
- [ ] Create `backend/src/workflows/workflow-crud.controller.ts` — extract CRUD endpoints (create, update, delete, list, get, versions)
- [ ] Create `backend/src/workflows/workflow-run.controller.ts` — extract run, stream, terminal, node I/O endpoints
- [ ] Refactor `workflows.controller.ts` — remove extracted endpoints, keep only if any endpoints don't fit the two new controllers
- [ ] Update `workflows.module.ts` to register the new controllers
- [ ] Verify all API routes remain unchanged (same paths, same HTTP methods, same decorators)

### Verification

- [ ] Run `bun --cwd backend run test` and confirm all 17 existing unit tests pass
- [ ] Run `bun run typecheck` and confirm no type errors in the workflows module
- [ ] Run `bun run lint` and confirm no lint errors in new files

## Notes

- **Critical**: API routes must NOT change. Same paths, same HTTP methods, same request/response shapes. Only internal file organization changes.
- The existing `WorkflowsService` class should remain as a facade that delegates to sub-services, so any other modules injecting `WorkflowsService` continue to work without changes.
- Check `internal-runs.controller.ts`, `workflow-role.guard.ts`, and `workflows.bootstrap.ts` for any imports from `workflows.service.ts` that may need updating.
- The `repository/` directory and `dto/` directory should remain unchanged.
- There are 17 existing unit tests in `__tests__/workflows.service.spec.ts` — they must all pass after refactoring.

## Completion Summary

<!-- Appended by orchestrator after agent completes. Do not fill manually. -->
