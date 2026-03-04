# Agent: tester (E2E Workflow Execution Test)

## Purpose

Create an E2E test that validates the core product loop: create workflow → add nodes → save → trigger → monitor execution → verify completion/results.

## Skills

Load before starting: testing-patterns

## Subtasks

### Research & Design

- [x] Review existing E2E test patterns in `e2e-tests/core/` — specifically `workflows-crud.test.ts` which already has create + run + poll, and `analytics.test.ts` for any execution-related tests
- [x] Review available helpers in `e2e-tests/helpers/e2e-harness.ts`: `createWorkflowFull`, `runWorkflow`, `pollRunStatus`, `getWorkflow`, `deleteWorkflowById`, and any helpers for getting run results/outputs
- [x] Identify what the CRUD test already covers vs. what gaps remain for a full "execution loop" test (the CRUD test does run + poll, but may not verify node-level outputs or multi-node execution)

### Create E2E Test File

- [x] Create `e2e-tests/core/workflow-execution.test.ts` using existing patterns:
  - Import from `e2e-harness`: `e2eDescribe`, `e2eTest`, `checkServicesAvailable`, `createWorkflowFull`, `runWorkflow`, `pollRunStatus`, `deleteWorkflowById`, `API_BASE`, `HEADERS`
  - `beforeAll` → `checkServicesAvailable()`
  - `afterAll` → cleanup created workflows
- [x] **Test 1: Multi-node script workflow executes end-to-end**
  - Build a workflow with: entrypoint → script node (produces output) → second script node (consumes input from first)
  - Create via `createWorkflowFull()`
  - Trigger via `runWorkflow(workflowId)`
  - Poll via `pollRunStatus(runId)` — assert `status === 'COMPLETED'`
  - Fetch run details to verify node-level completion (if endpoint exists: `GET /api/workflows/runs/{runId}`)
- [x] **Test 2: HTTP Request node workflow (inline, no Docker)**
  - Build a workflow with: entrypoint → `core.http.request` node configured to call a known-good public endpoint (e.g., `https://httpbin.org/get` or the backend's own `/health` endpoint using the API_BASE)
  - Create, trigger, poll for completion
  - Assert `status === 'COMPLETED'`
  - Verify the HTTP response data is captured in node output (if accessible via run details API)
- [x] **Test 3: Workflow failure handling**
  - Build a workflow with a script node that deliberately throws an error
  - Create, trigger, poll for terminal status
  - Assert `status === 'FAILED'`
  - Verify error information is available in run details
- [x] **Test 4: Workflow with runtime inputs**
  - Build a workflow with entrypoint configured with `runtimeInputs` (e.g., a string input `target`)
  - Create workflow, trigger with `runWorkflow(workflowId, { target: 'example.com' })`
  - Poll for completion, verify the input was consumed by a downstream script node

### Verify Helpers

- [x] If run-detail endpoints (node-level outputs, execution timeline) are not yet exposed in `e2e-harness.ts`, add minimal helpers:
  - `getRunDetails(runId)` → `GET /api/workflows/runs/{runId}` (if not already `pollRunStatus`)
  - `getRunNodeOutputs(runId)` → endpoint to fetch node-level output data (only if the endpoint exists; skip if not)
  - **Decision**: Used existing `getTraceEvents(runId)` which returns node-level COMPLETED/FAILED events with `outputSummary` — no new helpers needed.
- [x] Ensure all tests use generous timeouts (120s for execution tests) since Temporal workflows may take time to schedule and complete

## Notes

- **Existing coverage gap**: `workflows-crud.test.ts` already tests create → run → poll → COMPLETED with a minimal script node. The new test should go further: multi-node data flow, HTTP component execution, failure handling, and runtime inputs.
- **Test framework**: Tests use `bun:test` with the custom `e2eDescribe`/`e2eTest` wrappers that auto-skip when `RUN_E2E !== 'true'` or backend is unreachable.
- **No Docker components**: Use inline components only (`core.logic.script`, `core.http.request`, `core.workflow.entrypoint`) to keep tests fast and avoid Docker dependency in CI.
- **Cleanup**: Follow the pattern from `workflows-crud.test.ts` — push created workflow IDs to `createdIds[]` array, delete in `afterAll`.
- **API authentication**: All requests use `x-internal-token: local-internal-token` header (see `HEADERS` in e2e-harness).
- **Run polling**: `pollRunStatus(runId, timeoutMs)` polls `GET /api/workflows/runs/{runId}/status` every 1s until a terminal status is reached.

## Completion Summary

<!-- Appended by orchestrator after agent completes. Do not fill manually. -->
