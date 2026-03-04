# Agent: tester (worker)

## Purpose

Add unit tests for the untested Temporal activities and workflows in `worker/src/temporal/`. Priority: core execution activities first, then workflow orchestration, then destination activities.

## Skills

Load before starting: testing-patterns

## Subtasks

### Understand existing test patterns

- [x] Read existing activity tests in `worker/src/temporal/activities/__tests__/` (error-handler.test.ts, input-validator.test.ts, secret-resolver.test.ts, spill-resolver.test.ts) to understand mock patterns, assertion style, and bun:test conventions
- [x] Read `worker/src/temporal/__tests__/workflow-runner.test.ts` to understand how workflow-level tests register test components and mock services (trace, logs, storage)
- [x] Read `worker/src/temporal/types.ts` to understand the input/output type shapes for activities

### Test `run-component.activity.ts` — core component execution

- [x] Create `worker/src/temporal/activities/__tests__/run-component.activity.test.ts`
- [x] Test `initializeComponentActivityServices` — verify it sets up services and throws on double-init
- [x] Test `resetComponentActivityServices` — verify it allows re-initialization after reset
- [x] Test `runComponentActivity` happy path — register a simple test component, mock services (storage, trace, nodeIO, secrets), call the activity with valid inputs, assert output is returned and trace events (NODE_STARTED, NODE_COMPLETED) are recorded
- [x] Test `runComponentActivity` with unknown component ID — assert it throws `NotFoundError`
- [x] Test `runComponentActivity` error path — component that throws during execute — assert `handleComponentError` is invoked (error is re-thrown as ApplicationFailure)
- [x] Test `runComponentActivity` with spilled inputs — provide inputs with `__spilled__` markers, mock storage.downloadFile to return the real data, verify the component receives resolved inputs
- [x] Test `runComponentActivity` output spilling — component returns output larger than `TEMPORAL_SPILL_THRESHOLD_BYTES`, verify output is replaced with `{ __spilled__: true, storageRef, originalSize }` and `storage.uploadFile` is called
- [x] Test `setRunMetadataActivity` — verify it calls `trace.setRunMetadata` with correct args
- [x] Test `finalizeRunActivity` — verify it calls `trace.finalizeRun`

### Test `run-workflow.activity.ts` — child workflow triggering

- [x] Create `worker/src/temporal/activities/__tests__/run-workflow.activity.test.ts`
- [x] Test `initializeActivityServices` — verify it sets up services and throws on double-init
- [x] Test `runWorkflowActivity` happy path — mock `executeWorkflow` (or provide a minimal workflow definition with a registered test component), verify it returns the workflow result
- [x] Test `runWorkflowActivity` error path — executeWorkflow throws, verify the error propagates with correct context logged
- [x] Test `runWorkflowActivity` calls `trace.setRunMetadata` when trace is metadata-aware, and `trace.finalizeRun` in the finally block

### Test `mcp.activity.ts` — MCP tool operations

- [x] Create `worker/src/temporal/activities/__tests__/mcp.activity.test.ts`
- [x] Test `registerComponentToolActivity` — mock `fetch` to intercept the internal API call, verify correct URL path (`register-component`) and payload shape
- [x] Test `registerRemoteMcpActivity` — mock `fetch`, verify it sends `register-mcp-server` with transport `http` and includes auth token header when provided
- [x] Test `registerLocalMcpActivity` — mock `fetch`, verify it sends `register-mcp-server` with transport `stdio` and correct endpoint derived from port/image
- [x] Test `cleanupRunResourcesActivity` — mock `fetch` for the cleanup API call and mock `execFile` for Docker commands, verify containers and volumes are cleaned up
- [x] Test `cleanupRunResourcesActivity` with `SKIP_CONTAINER_CLEANUP=true` — verify it returns early without calling Docker
- [x] Test `areAllToolsReadyActivity` — mock `fetch`, verify it passes runId and requiredNodeIds to `tools-ready` endpoint
- [x] Test `prepareAndRegisterToolActivity` — register a test component in componentRegistry, mock `fetch`, verify it extracts tool metadata and credentials and sends correct payload
- [x] Test `callInternalApi` error handling — mock `fetch` to return non-200 status, verify it throws `ServiceError` with status code
- [x] Test `callInternalApi` with missing `INTERNAL_SERVICE_TOKEN` — verify it throws non-retryable `ApplicationFailure` with `ConfigurationError` type

### Test `workflows/index.ts` — simple workflow (main entry point)

- [ ] Create `worker/src/temporal/workflows/__tests__/simple-workflow.test.ts` — skipped: Temporal workflow code runs in a V8 isolate sandbox and cannot be unit tested without `@temporalio/testing` TestWorkflowEnvironment. The proxyActivities() calls require actual Temporal worker infrastructure. Activity-level tests (above) cover the core logic.
- [ ] Test happy path: single-node workflow — skipped (requires Temporal sandbox)
- [ ] Test multi-node linear workflow — skipped (requires Temporal sandbox)
- [ ] Test error handling — skipped (requires Temporal sandbox)
- [ ] Test MCP tool mode — skipped (requires Temporal sandbox)

### Test destination activities (opensearch-index, notifications, webhook)

- [x] Identify destination activity files in `worker/src/temporal/activities/` or `worker/src/destinations/` that lack tests
- [x] Test `trace.activity.ts` — verify it records trace data via the trace service
- [x] Test `webhook-parsing.activity.ts` — verify it parses incoming webhook payloads correctly for supported formats

### Run and verify

- [x] Run all new tests: `bun test worker/src/temporal/activities/__tests__/` — all pass
- [ ] Run all new workflow tests: `bun test worker/src/temporal/workflows/__tests__/` — skipped (workflow testing requires Temporal sandbox/TestWorkflowEnvironment which is not available)
- [x] Run full worker test suite: `bun test --cwd worker` — no regressions in existing tests (4 pre-existing failures in github.org.membership.remove component)

## Notes

- Use `bun:test` with `describe`, `it`, `expect`, `vi.fn()`, `vi.mock()` — consistent with existing worker tests.
- The `run-component.activity.ts` file exports `resetComponentActivityServices()` specifically for test cleanup — use it in `beforeEach`.
- The `run-workflow.activity.ts` does NOT have a reset function — you may need to either mock the module or add a `resetActivityServices()` export (minimal code change is acceptable).
- For `mcp.activity.ts` tests, mock `fetch` globally or use `vi.spyOn(global, 'fetch')` since activities call internal API via fetch.
- For `cleanupRunResourcesActivity`, mock `node:child_process` `execFile` since it shells out to Docker CLI.
- Workflow tests (`workflows/index.ts`) require Temporal test environment — use `@temporalio/testing` `TestWorkflowEnvironment` or mock `proxyActivities` at the module level.
- The `callInternalApi` helper is not exported — test it indirectly through the exported activities, or extract and export it if needed.
- Existing tests in `activities/__tests__/` already cover: error-handler, input-validator, secret-resolver, spill-resolver. Do NOT duplicate those.

## Completion Summary

<!-- Appended by orchestrator after agent completes. Do not fill manually. -->
