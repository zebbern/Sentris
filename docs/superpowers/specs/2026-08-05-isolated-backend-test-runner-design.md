# Isolated Backend Test Runner Design

## Problem

The backend currently runs 231 test files in one `bun test` process. Bun test files share
module caches and process-global state, and `mock.module()` overrides cannot be restored by
`mock.restore()`. In the complete backend suite, module overrides and Nest decorator/module
state contaminate unrelated files. CPU-heavy migration checks also contend with the rest of
the suite and reach Bun's default five-second per-test timeout. The same files pass when run
outside the contaminated full-suite process.

This produces dozens of misleading failures and makes the repository's full verification
gate unreliable. Adding broader timeouts or patching individual tests would hide the shared
root cause.

## Decision

Run every backend test file in its own Bun process, with at most three files running at once.
Use the same canonical isolated-file executor for the existing Worker runner so process
ownership, failure handling, timeouts, progress, and cleanup do not diverge.

Known migration/schema-heavy backend files will run serially after the ordinary bounded
parallel queue. This preserves useful parallelism without forcing CPU-heavy integrity checks
to compete for the resources assumed by their existing test limits.

Selective isolation based only on static `mock.module()` detection is rejected because the
observed corruption depends on interactions with the wider Nest suite and is not limited to
the files that contain the mock call. A fully serial suite is also rejected because file-level
process isolation provides the required state boundary without sacrificing all concurrency.

## Architecture

### Shared executor

A repository-level module will:

1. Collect test files deterministically and normalize paths to POSIX separators.
2. Convert them into ordinary and explicitly serial runs.
3. Execute ordinary runs through a fixed-size worker pool.
4. Stop scheduling new work after the first failure.
5. Wait for already-started work to settle, then run serial files only if the parallel phase
   succeeded.

Each run will delegate process creation to the existing bounded command lifecycle boundary.
That boundary owns progress reporting, per-file timeouts, signal handling, and complete child
process-tree termination on Windows and POSIX.

### Backend entry point

The backend runner will discover test files under both `backend/src` and `backend/scripts`,
matching the 231 files currently discovered by `bun test`. Each child will execute exactly one
path from the backend package directory. Migration/schema integrity files that repeatedly load
the complete checked migration catalog will be declared as serial exceptions.

The backend package `test` script and the root test plan will use this entry point. Explicit
changed-file testing in pre-push remains a focused, separate Bun process and does not need to
expand into the full file scheduler.

### Worker entry point

The Worker keeps its existing file plan and explicit serial exceptions, but delegates
execution and bounded concurrency to the shared executor. This removes the duplicate ad hoc
spawn pool while preserving current Worker behavior.

## Failure and Cleanup Semantics

- A non-zero test process marks the suite failed and prevents additional files from starting.
- Processes already running at that moment are allowed to settle normally.
- A per-file timeout or parent signal terminates that file's complete descendant tree.
- The runner exits non-zero after active work settles and never reports partial execution as a
  passing suite.
- Dry-run output remains deterministic so the planned file coverage can be inspected without
  launching tests.

## Verification

1. Keep focused tests for deterministic discovery, parallel limits, serial ordering,
   fail-fast scheduling, and lifecycle cleanup because these are concurrency/process-boundary
   guarantees that are expensive to verify manually.
2. Reproduce the previous contamination class with representative backend files and confirm
   the isolated runner prevents it.
3. Run the complete backend suite through the product-facing package command.
4. Confirm that the suite finishes without cross-file Nest/mock contamination, migration
   contention timeouts, or leftover Bun child processes.
5. Run the existing Worker runner checks to ensure the shared executor preserves its behavior.

## Success Criteria

- All 231 backend test files are included exactly once.
- No two test files share a Bun process.
- No more than three ordinary backend files run concurrently.
- Declared resource-heavy files run serially.
- Failures and timeouts cannot leave descendant processes behind.
- `bun --cwd=backend test` and the root suite use the reliable runner by default.
- The real complete backend run no longer produces the observed cross-file contamination
  failures.
