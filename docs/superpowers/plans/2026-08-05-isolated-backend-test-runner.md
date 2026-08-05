# Isolated Backend Test Runner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the complete backend test command reliable by running every test file in an isolated, bounded, cleanly managed Bun process.

**Architecture:** Add one repository-level isolated-file scheduler that delegates every child to the existing bounded command lifecycle runner. Backend and Worker keep small domain-specific planners while sharing process concurrency and failure semantics; backend package and root verification commands use the backend planner by default.

**Tech Stack:** Node.js CommonJS orchestration, Bun 1.3.10 test runner, Bun tests for planner/concurrency contracts.

## Global Constraints

- Every backend test file runs in its own Bun process.
- At most three ordinary test-file processes run concurrently.
- Backend migration/schema-heavy test files run serially after ordinary files.
- A first failure stops new scheduling; already-started processes settle cleanly.
- Timeouts and signals terminate complete descendant process trees through `runCommandStep()`.
- Keep explicit changed-file pre-push execution focused and unchanged.
- Preserve user-owned `Agent Pipeline Live v4.dc.html` and unrelated working-tree edits.

---

### Task 1: Shared isolated-file scheduler

**Files:**

- Create: `scripts/lib/test-file-runner.js`
- Create: `scripts/__tests__/test-file-runner.test.ts`
- Modify: `scripts/lib/worker-test-plan.js`

**Interfaces:**

- Consumes: `runCommandStep(step, options?) => Promise<number>` from `scripts/lib/run-command-plan.js`.
- Produces: `collectTestFiles(directories: string[]) => string[]` and `runTestFilePlan(options) => Promise<number>`.
- `runTestFilePlan` accepts `{ runs, concurrency, root, createStep, runStep? }`; each run is `{ label: string, files: string[], serial: boolean }`.

- [ ] **Step 1: Write failing scheduler contract tests**

Cover deterministic recursive collection, a maximum of three active ordinary runs, no new scheduling after a failure, waiting for active runs to settle, and serial runs starting only after a successful ordinary phase. Use deferred fake `runStep` promises instead of real subprocesses so the tests assert scheduling rather than timing.

- [ ] **Step 2: Verify the new tests fail**

Run: `bun test scripts/__tests__/test-file-runner.test.ts`

Expected: FAIL because `scripts/lib/test-file-runner.js` does not exist.

- [ ] **Step 3: Implement the minimal shared scheduler**

Implement deterministic recursive collection with the existing test-file pattern. Implement a fixed-size async worker pool around:

```js
async function runTestFilePlan({ runs, concurrency = 3, root, createStep, runStep = runCommandStep })
```

Store the first non-zero status, stop workers from taking another run once it exists, await every active worker, then execute serial runs in order only when the ordinary phase succeeded. Delegate every actual process to `runStep(createStep(run), { root })`.

- [ ] **Step 4: Make Worker consume shared collection**

Remove the duplicated recursive collector from `scripts/lib/worker-test-plan.js`; retain `SERIAL_WORKER_TEST_FILES`, path normalization, and missing-serial-file validation.

- [ ] **Step 5: Run focused tests**

Run: `bun test scripts/__tests__/test-file-runner.test.ts scripts/__tests__/worker-test-plan.test.ts`

Expected: all scheduler and Worker planner tests pass.

---

### Task 2: Backend file plan and command entry point

**Files:**

- Create: `scripts/lib/backend-test-plan.js`
- Create: `scripts/test-backend.js`
- Create: `scripts/__tests__/backend-test-plan.test.ts`
- Modify: `backend/package.json`

**Interfaces:**

- Produces: `collectBackendTestFiles(backendDirectory) => string[]`.
- Produces: `createBackendTestRuns(files) => Array<{ label, files, serial }>`.
- A file is serial when it is under `scripts/migrations/__tests__/` or equals `src/database/__tests__/migration.guard.spec.ts`.

- [ ] **Step 1: Write failing backend planner tests**

Assert that discovery covers both `backend/src` and `backend/scripts`, returns normalized deterministic paths, contains the repository's current 231 files exactly once, and classifies ordinary versus migration/schema-heavy files correctly.

- [ ] **Step 2: Verify the backend planner tests fail**

Run: `bun test scripts/__tests__/backend-test-plan.test.ts`

Expected: FAIL because `backend-test-plan.js` does not exist.

- [ ] **Step 3: Implement the backend planner**

Use `collectTestFiles([path.join(backendDirectory, 'src'), path.join(backendDirectory, 'scripts')])`, normalize paths relative to the backend directory, reject duplicate paths, and return one run per file.

- [ ] **Step 4: Implement the backend command**

With no arguments, discover and run the full isolated plan at concurrency three. Each child is a bounded `bun test --force-exit <file>` command with backend cwd, a 120-second timeout, and 30-second progress. Resolve repository root from the script location. Support `--dry-run`; when explicit test arguments are supplied, preserve focused usage by delegating them to one bounded command instead of expanding the full suite.

- [ ] **Step 5: Wire the backend package command**

Change `backend/package.json` from `"test": "bun test"` to `"test": "node ../scripts/test-backend.js"`.

- [ ] **Step 6: Run focused planner and dry-run checks**

Run `bun test scripts/__tests__/backend-test-plan.test.ts`, `bun --cwd=backend run test --dry-run`, and one explicit migration guard test. Expect 231 unique planned runs and a passing focused command.

---

### Task 3: Canonicalize Worker execution and root wiring

**Files:**

- Modify: `scripts/test-worker.js`
- Modify: `scripts/lib/dev-instance-runtime.js`
- Modify: `scripts/__tests__/dev-instance-runtime.test.ts`

**Interfaces:**

- Consumes: `runTestFilePlan()` from Task 1.
- Consumes: `createWorkerTestRuns()` from the existing Worker planner.

- [ ] **Step 1: Update the root-plan expectation first**

Expect `{ command: 'bun', args: ['run', 'test'], cwd: 'backend', timeoutMs: 600_000 }`, then run the focused dev-runtime test and observe the expected failure.

- [ ] **Step 2: Wire the root test plan through the backend package runner**

Replace the raw backend command in `createRootTestPlan()` with the package command and update its comment to describe file-process isolation.

- [ ] **Step 3: Replace Worker's ad hoc pool with the shared scheduler**

Keep Worker discovery and dry-run output unchanged. Build one Bun test step per Worker run and call `runTestFilePlan({ runs, concurrency: 3, root: repositoryDirectory, createStep })`. Do not retain a second concurrency loop.

- [ ] **Step 4: Run focused integration checks**

Run the scheduler, backend planner, Worker planner, and dev-runtime tests. Then run `bun scripts/test-worker.js --dry-run` and `bun scripts/test-all.js --dry-run`. Expect passing tests and canonical dry-run commands.

---

### Task 4: Real full-suite and process-lifecycle verification

**Files:**

- Modify only if evidence from the real run identifies a runner defect in the approved scope.

**Interfaces:**

- Consumes the completed backend package runner and bounded lifecycle boundary.

- [ ] **Step 1: Run formatting and whitespace checks**

Run Prettier check for changed runner files and `git diff --check`. Expect no formatting or whitespace defects.

- [ ] **Step 2: Run the complete backend suite through its real package command**

Run: `bun --cwd=backend run test`

Expected: all 231 test files execute once without cross-file Nest/mock contamination or migration contention timeouts.

- [ ] **Step 3: Audit process cleanup**

After the suite exits, inspect running Bun command lines and confirm no `scripts/test-backend.js` or backend test-file children remain.

- [ ] **Step 4: Run the complete focused tooling regression set**

Run the command-lifecycle, scheduler, backend planner, Worker planner, dev-runtime, and pre-push tests together. Expect all lasting process, planner, and push-gate tests to pass.

- [ ] **Step 5: Inspect the final diff**

Confirm `Agent Pipeline Live v4.dc.html` remains untracked and excluded. Do not commit or push implementation work unless requested by the user.
