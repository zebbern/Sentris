# Production Worker DIND Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the production worker start with correct configuration, expose
honest dependency-aware readiness, execute Docker components through isolated
DIND without worker-host bind paths, and reconcile orphaned run resources.

**Architecture:** The worker exposes process-only liveness and cached,
parallel, timeout-bounded readiness probes. DIND and the worker share a
dedicated egress-capable Docker control network, client TLS material, and a
named exchange volume containing independent run-scoped directories; all other
services remain off the Docker control plane. A bounded reconciler preserves
resources belonging to active Temporal workflows, removes old inactive
containers/volumes/exchange directories, and records failures in readiness.

**Tech Stack:** TypeScript, Bun test, Node HTTP, Docker CLI, Temporal,
PostgreSQL, MinIO, Redis, KafkaJS, Docker Compose.

## Global Constraints

- Do not run live Compose, Docker component, database, or Temporal commands in
  this workstream.
- Do not commit, branch, push, reset, rebase, or overwrite concurrent migration
  and trust-profile changes.
- Preserve scanner `bridge` networking and no-network component behavior.
- Keep readiness probes parallel, individually timeout-bounded, and cached for
  five seconds.
- Add no production dependency.
- Keep reconciliation bounded, fail closed when active-run state is unknown,
  and never report removal failures as successful cleanup.
- Preserve user-owned Phase 5 findings files.

---

### Task 1: Backend Callback URL Contract

**Files:**

- Create: `worker/src/common/backend-url.ts`
- Test: `worker/src/common/__tests__/backend-url.test.ts`
- Modify: `worker/src/temporal/activities/mcp.activity.ts`
- Modify: `worker/src/temporal/activities/run-dispatcher.activity.ts`
- Test: existing activity tests

**Interfaces:**

```ts
resolveBackendRootUrl(env?: NodeJS.ProcessEnv): string
resolveBackendApiBaseUrl(env?: NodeJS.ProcessEnv): string
buildBackendApiUrl(path: string, env?: NodeJS.ProcessEnv): string
```

- [ ] **Step 1: Write RED tests**

Cover precedence and normalization for `SENTRIS_API_BASE_URL`, `API_BASE_URL`,
and `BACKEND_URL`, including already-versioned URLs and trailing slashes. Add
activity assertions that `BACKEND_URL=http://backend:3211` produces
`http://backend:3211/api/v1/internal/...`.

Run:

```powershell
bun test worker/src/common/__tests__/backend-url.test.ts
bun test worker/src/temporal/activities/__tests__/mcp.activity.test.ts
```

Expected: the helper import is missing and the MCP activity ignores
`BACKEND_URL`.

- [ ] **Step 2: Implement and verify**

Implement one pure normalizer and use it from both internal callback
activities. Resolve URLs at call time so tests and runtime environment changes
are not hidden by module-load constants.

---

### Task 2: Worker Health Contract and Real Readiness

**Files:**

- Modify: `worker/src/health/health-server.ts`
- Create: `worker/src/health/readiness-checks.ts`
- Test: `worker/src/health/__tests__/health-server.test.ts`
- Test: `worker/src/health/__tests__/readiness-checks.test.ts`
- Modify: `worker/src/temporal/workers/service-factory.ts`
- Modify: `worker/src/temporal/workers/dev.worker.ts`

**Interfaces:**

```ts
type ReadinessCheck = () => Promise<CheckResult>;
createCachedReadinessEvaluator(checks, { timeoutMs, cacheTtlMs }): () => Promise<HealthResponse>;
createWorkerReadinessChecks(deps): Record<string, ReadinessCheck>;
startHealthServer(deps, { port? }): Promise<HealthServerHandle>;
```

- [ ] **Step 1: Write HTTP RED tests**

Use an ephemeral local port. Assert `/health` stays `200` when a readiness
dependency fails, `/health/ready` returns `503` with the failing check, parallel
probes are reused inside the TTL, timed-out probes fail readiness, and an
occupied health port rejects startup.

- [ ] **Step 2: Implement the HTTP contract**

Keep liveness synchronous and process-only. Evaluate readiness probes in
parallel, wrap each probe in a short timeout, cache the complete result for
five seconds, and reject every listen error.

- [ ] **Step 3: Write dependency RED tests**

Inject duck-typed clients and assert calls to Temporal `getSystemInfo`,
Postgres `SELECT 1`, MinIO `bucketExists`, configured Redis `PING`, Kafka
cluster metadata, backend root `/health`, and `docker info` through the Docker
CLI. Assert absent optional Redis/backend checks are explicitly
`not_configured`, while configured failures are unhealthy.

- [ ] **Step 4: Implement and integrate**

Create real probes, expose a Kafka admin readiness handle from the service
factory, mark the worker ready only after `Worker.create`, successful startup
reconciliation, and `worker.run()` initiation, and mark it unready before
shutdown.

---

### Task 3: Bounded Orphan Reconciliation

**Files:**

- Create: `worker/src/utils/orphan-reconciler.ts`
- Test: `worker/src/utils/__tests__/orphan-reconciler.test.ts`
- Modify: `worker/src/utils/isolated-volume.ts`
- Modify: `worker/src/utils/index.ts`
- Modify: `worker/src/temporal/workers/dev.worker.ts`

**Interfaces:**

```ts
reconcileOrphanedDockerResources(options): Promise<ReconciliationReport>
createTemporalRunActivityResolver(connection, namespace): ActiveRunResolver
startOrphanReconciler(options): OrphanReconcilerHandle
```

- [ ] **Step 1: Write reconciliation RED tests**

Use a fake resource client. Assert old inactive resources are removed
container-first, young and active-run resources are preserved, run-specific
volume suffixes map to their workflow ID, the per-pass limit reports
truncation, unknown Temporal state prevents removal, removal failures throw
with the partial report, and periodic passes never overlap.

- [ ] **Step 2: Implement reconciliation**

List only worker-labeled containers and managed volumes, validate identifiers,
sort deterministically by age, cap each pass, resolve active workflow state
before deletion, and throw a typed error containing every failed removal.
Scan only labeled run directories in the configured exchange root.

- [ ] **Step 3: Integrate lifecycle**

Await one startup pass before readiness, then schedule non-overlapping periodic
passes. A periodic failure updates maintenance readiness and logs the complete
report; the next successful pass clears it. Stop the scheduler during graceful
shutdown.

---

### Task 4: DIND Compose Topology and Shared Exchange

**Files:**

- Modify: `docker/docker-compose.full.yml`
- Modify: `Dockerfile`
- Modify: `packages/component-sdk/src/runner.ts`
- Test: `packages/component-sdk/src/__tests__/runner.test.ts`
- Create: `worker/src/health/__tests__/production-topology.test.ts`

**Interfaces:**

```ts
SENTRIS_DOCKER_SHARED_IO_ROOT=/sentris-docker-io
```

The runner uses a unique directory beneath that root for input/output only when
configured; local socket development keeps its existing OS temp path.

- [ ] **Step 1: Write topology and runner RED tests**

Parse Compose and assert only worker+DIND join `docker-control`, that network is
egress-capable, the Docker API is not host-published, client certificates are
mounted at `/certs/client`, the shared exchange volume reaches only
worker+DIND, required worker env names match code, and the worker healthcheck
targets `/health/ready`. Assert configured shared-I/O paths produce independent
run directories and cleanup metadata without changing component `--network`.

- [ ] **Step 2: Implement topology and exchange**

Split CA/client TLS volumes following the official DIND layout. Mount the
client volume read-only in the worker. Add the two-service control network and
shared named exchange volume, initialize permissions in DIND, and preserve
scanner egress. Use per-run directory creation so executions never serialize.

- [ ] **Step 3: Replace image healthcheck**

Expose port `9100` in the worker image and make both Dockerfile and Compose
healthchecks call `http://localhost:9100/health/ready`.

---

### Task 5: Documentation and Verification

**Files:**

- Modify: `docs/architecture/adr-supported-docker-dind-topology.md`
- Modify: `docs/goals/self-hosted-platform-readiness-evidence.md` only with
  evidence actually produced by this workstream

- [ ] **Step 1: Update the ADR**

Record the worker-host bind root cause, shared named exchange-volume design,
run-directory labels, readiness cache/timeout behavior, cleanup bounds, active
Temporal preservation, and residual privileged-DIND risk.

- [ ] **Step 2: Run focused verification**

```powershell
bun test worker/src/common/__tests__/backend-url.test.ts
bun test worker/src/health/__tests__
bun test worker/src/utils/__tests__/orphan-reconciler.test.ts
bun test worker/src/temporal/activities/__tests__/mcp.activity.test.ts
bun test packages/component-sdk/src/__tests__/runner.test.ts
bun --cwd packages/component-sdk run typecheck
bun --cwd worker run typecheck
bun --cwd worker eslint <changed worker TypeScript files>
```

Also parse the Compose YAML in the static topology test. Do not claim DIND,
scanner, callback, cancellation, performance, or production-smoke evidence
until the separately authorized live gate runs.
