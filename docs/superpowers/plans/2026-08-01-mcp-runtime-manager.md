# Canonical MCP Runtime Manager Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Sentris's duplicated outbound MCP clients and process-local bridges with one official-v2 client adapter and one worker-owned, lease-fenced runtime manager that durably executes tools, resource reads, and prompt expansion across multiple workers.

**Architecture:** A Temporal activity may land on any worker. Its first `acquire` supplies an auth-partitioned runtime key plus a candidate owner identity/address and atomically receives the current ready runtime reference or a newly reserved owner epoch/lease generation; no pre-existing fence is required to acquire. Every later state-changing or upstream operation supplies that returned fence. The local `McpRuntimeRouter` uses an in-process fast path when the process owns the matching epoch/lease generation and otherwise makes one authenticated request to the lease's instance-unique owner address. Redis contains only ephemeral fenced lease/routing metadata. The owner alone resolves credential references, owns the official MCP client/transport and any stdio/Docker process, and renews or self-fences the lease. Postgres and the run Workflow continue to own immutable authority/catalog identity plus durable operation attempts; owner failover changes only the lease fence, not unchanged authority. Modern `2026-07-28` HTTP is request-stateless; legacy session behavior remains only inside a bounded compatibility adapter until its measured deletion condition is satisfied.

**Tech Stack:** TypeScript, Zod 4, NestJS 10, Drizzle/PostgreSQL, Redis/ioredis, Temporal TypeScript SDK 1.14.1, `@modelcontextprotocol/client` 2.0.0, `@modelcontextprotocol/node` 2.0.0, legacy `@modelcontextprotocol/sdk` 1.30.0 only at the compatibility seam, Docker/DIND, Bun.

## Global Constraints

- Work directly on `main`, as explicitly requested by the user. Do not create a branch or worktree and do not push. Use conventional DCO commits (`git commit -s`) after each independently shippable task and preserve unrelated user changes.
- Before any local dev, Compose, curl, E2E, or benchmark command, run `bun run instance show` (or `just instance show`) and record the intended `SENTRIS_INSTANCE`. Do not silently target an instance.
- Treat `.superpowers/sdd/2026-07-31-durable-mcp-invocations/mcp-v2-runtime-research.md` and `docs/architecture/adr-stateless-mcp-runtime-and-temporal-agents.md` as the compatibility boundary. Re-check the installed v2 declarations when implementation starts; do not substitute remembered APIs.
- Add `@modelcontextprotocol/client` and `@modelcontextprotocol/node` 2.0.0 as worker production dependencies before importing them. Do not rely on the backend dev dependency or a hoisted install.
- Construct the v2 client with explicit `versionNegotiation: { mode: 'auto' }`; the installed client's default is legacy. Cache `prior` negotiation verdicts only for a bounded TTL and under organization, principal/auth subject, endpoint/config fingerprint, credential reference, and credential generation. A cached legacy verdict must expire.
- Modern `2026-07-28` HTTP has independent requests: no initialize exchange, transport session, GET event stream, resume token, affinity, or sticky routing. Never project the legacy transport's `sessionId`, `resumeStream`, or reconnect behavior onto a modern runtime.
- The official SDK owns MCP negotiation, validation, HTTP/stdio framing, cancellation, progress callbacks, and response caching. Sentris owns leases, epoch/generation fencing, process/container supervision, durable attempts, cross-worker routing, and unknown-outcome classification.
- Redis and Postgres may contain credential references and credential versions, but never resolved tokens, plaintext headers, OAuth values, stdio environment secrets, tool arguments/results, or child-process environment. Resolved credentials exist only in the current owner process and are cleared on release/fence.
- Partition runtime reuse, negotiation verdicts, response caches (`cachePartition`), subscriptions, and immutable discovery by organization/principal plus credential reference and credential generation. Credential rotation produces a different runtime key/config identity; it must not mutate a live runtime in place. This credential generation is immutable configuration input and is not the ephemeral Redis lease generation.
- Use both idle timeout and `maxTotalTimeout`; progress may reset the idle deadline but never extend the total deadline indefinitely. Map Temporal cancellation to an operation-scoped `AbortSignal`. Do not close a shared modern HTTP transport to cancel one request.
- Do not configure anonymous process-local `inputRequired` callbacks. Until workflow-granular durable human/model input exists, return a typed non-retryable `input-required-unsupported` result and keep that future work behind the existing agent-turn boundary.
- MCP Tasks are explicitly out of scope. The installed TypeScript SDK 2.0.0 does not implement the current `io.modelcontextprotocol/tasks` extension. Do not recreate the draft or call the deprecated v1 `experimental.tasks`; add support only after maintained official TypeScript support, a pinned extension version, and conformance tests exist.
- A runtime operation must persist and claim an attempt before network/process dispatch. Once marked `dispatched`, owner loss, timeout, or lost response is `ambiguous` unless a provider-specific reconciliation proves the result. Automatic retry is allowed only before dispatch or under the existing reviewed-idempotent policy.
- Redis uncertainty fails closed. A worker that cannot prove lease ownership must stop accepting calls, abort what can safely be aborted, mark already-dispatched calls ambiguous through the durable repository, and reap its resources. It must not continue on a locally cached lease.
- `ownerEpoch` is a random process-incarnation UUID generated at worker boot; `leaseGeneration` is monotonically advanced under Redis CAS for a runtime key. `acquire(runtimeKey, candidateOwner)` has no fence input and returns the current or newly created `McpRuntimeRef`. Every subsequent discover/invoke/read/getPrompt/renew/release/health/state-changing request carries and validates that reference's runtime ID, owner ID, owner epoch, and lease generation.
- Publish an instance-unique direct owner URL only after the runtime is ready. Never publish `worker`, a load-balanced service name, or the old generic proxy base URL as a runtime address. The internal listener is network-private and requires the existing internal service credential.
- Preserve the in-process owner fast path. Cross-owner routing may add exactly one direct internal hop; backend or Temporal callers must not bounce through a generic worker and then a second owner lookup.
- Host stdio uses the official `StdioClientTransport`. Docker stdio uses that same transport with a bounded `docker run --rm -i` command and Sentris labels; Docker HTTP uses a labeled container plus an owner-private direct endpoint. Reconciliation remains responsible for containers left by a dead CLI/worker. Delete the handwritten stdio/Docker HTTP bridges and their process-local target maps after cutover.
- Discovery materializes every advertised family: tools, concrete resources, resource templates, and prompts. `resources/read` and `prompts/get` are runtime operations, not discovery. Cap automatic pagination at the installed client's `listMaxPages: 64` and fail a catalog that exceeds it rather than silently truncating.
- Preserve the current immutable grant/snapshot and binding-fingerprint rules. Authority/config identity is derived only from execution scope, source binding/config fingerprint, auth partition, credential reference/generation, negotiated protocol identity, and the complete capability fingerprint. Owner ID/address/epoch, lease generation/state/expiry, PID, and container identity are excluded. Owner failover increments only `leaseGeneration` and reuses unchanged authority/snapshot IDs after rediscovery confirms the same capability fingerprint. A real credential/config/protocol/capability change mints new authority; it never changes an existing snapshot.
- Keep the v1 SDK only inside `LegacyMcpClientCompatibilityAdapter`, selected by explicit negotiated/pinned legacy behavior. Very old HTTP+SSE fallback creates a fresh client and transport. Do not let compatibility session objects escape the adapter.
- No mandatory managed service may be introduced. Use the existing Redis, Postgres, Temporal, and worker processes for the normal locally hosted path.
- Use TDD for each behavior change: focused test first, observe the intended RED, implement the smallest complete behavior, rerun GREEN, then typecheck the affected package. Do not update snapshots merely to make failures disappear.
- Final acceptance requires modern stateless HTTP, legacy sessionful HTTP, host stdio, Docker/DIND, full tools/resources/templates/prompts catalogs, credential rotation/cache isolation, cancellation/timeouts/progress, owner crash/restart, unknown-outcome recovery, and a full-Compose two-worker routing/fencing scenario.
- The fixed performance gate is candidate p50 and p95 no more than 10% slower than the exact pre-change revision on the same host/instance/trust profile for representative catalog-list, warmed tool-call, resource-read, prompt-get, and existing agent-turn paths. Any exception requires measured evidence and explicit user approval; the implementer cannot waive it in the plan.

---

### Task 1: Freeze SDK-independent runtime and durable-operation contracts

**Files:**

- Modify: `packages/shared/src/mcp-capabilities.ts`
- Modify: `packages/shared/src/mcp-invocation.ts`
- Modify: `packages/shared/src/index.ts`
- Modify: `packages/shared/src/__tests__/mcp-capabilities.test.ts`
- Modify: `packages/shared/src/__tests__/mcp-invocation.test.ts`
- Modify: `worker/package.json`
- Modify: `bun.lock`

**Interfaces:**

- Produces `McpRuntimeKey`, unfenced `McpRuntimeAcquireRequest`, `McpRuntimeRef`, `McpRuntimeFence`, `McpRuntimeHealth`, `McpCatalog`, and a discriminated `McpOperation` (`tool-call | resource-read | prompt-get`) with bounded JSON request/result schemas.
- Keeps `ToolInvocationRequest` and `executeToolInvocation` as compatibility projections for already-running Workflow histories; new generic fields do not remove or reinterpret old serialized fields.

- [ ] **Step 1: Write RED contract tests**

  Test strict parsing, nullable organization scope, 64-hex hashes, epoch UUID, positive lease generation, direct owner URL, operation discriminants, resource URI/prompt arguments, and secret rejection. Prove `McpRuntimeAcquireRequest` contains a runtime key and candidate owner ID/epoch/address but cannot contain a fence; prove all post-acquire operation requests require the returned fence. Assert JSON serialization contains credential reference/version but not any resolved header/token field. Add operation result variants for completed, remote failure, cancellation, ambiguity, and input-required-unsupported.

- [ ] **Step 2: Run RED**

  ```powershell
  bun test packages/shared/src/__tests__/mcp-capabilities.test.ts packages/shared/src/__tests__/mcp-invocation.test.ts
  ```

  Expected: FAIL because the runtime and generic operation schemas do not exist.

- [ ] **Step 3: Add the contracts and worker dependency**

  Define the canonical key/fence shape without SDK types:

  ```ts
  type McpRuntimeFence = {
    runtimeId: string;
    ownerId: string;
    ownerEpoch: string;
    leaseGeneration: number;
  };

  type McpOperation =
    | { kind: 'tool-call'; name: string; arguments: JsonObject }
    | { kind: 'resource-read'; uri: string }
    | { kind: 'prompt-get'; name: string; arguments: Record<string, string> };
  ```

  `McpRuntimeKey` must include source/transport/config fingerprint, organization/principal partition hash, credential reference, and credential generation. Define `McpRuntimeAcquireRequest` as `{ runtimeKey, candidateOwner: { ownerId, ownerEpoch, ownerAddress } }`; it deliberately has no fence. `McpRuntimeRef` returns the new/current fence and adds protocol era/version, instance-unique `ownerAddress`, state (`starting | ready | draining`), lease expiry, and capability fingerprint, but no process ID, container endpoint, or secret. Keep immutable authority/config fingerprints structurally separate from `McpRuntimeFence`; the latter must never be accepted by authority/snapshot hashing helpers. Export all schemas through `packages/shared/src/index.ts`.

  Add exact `2.0.0` worker dependencies for `@modelcontextprotocol/client` and `@modelcontextprotocol/node`; retain `@modelcontextprotocol/sdk` 1.30.0 temporarily for the compatibility adapter:

  ```powershell
  bun --cwd=worker add --exact @modelcontextprotocol/client@2.0.0 @modelcontextprotocol/node@2.0.0
  ```

- [ ] **Step 4: Run GREEN and typecheck**

  ```powershell
  bun install --frozen-lockfile
  bun test packages/shared/src/__tests__/mcp-capabilities.test.ts packages/shared/src/__tests__/mcp-invocation.test.ts
  bun --cwd=packages/shared run typecheck
  bun --cwd=worker run typecheck
  ```

- [ ] **Step 5: Commit**

  ```powershell
  git add packages/shared/src/mcp-capabilities.ts packages/shared/src/mcp-invocation.ts packages/shared/src/index.ts packages/shared/src/__tests__/mcp-capabilities.test.ts packages/shared/src/__tests__/mcp-invocation.test.ts worker/package.json bun.lock
  git commit -s -m "feat: define MCP runtime ownership contracts"
  ```

---

### Task 2: Build the one official-v2 client adapter and bounded legacy seam

**Files:**

- Create: `worker/src/mcp-runtime/mcp-client-adapter.ts`
- Create: `worker/src/mcp-runtime/mcp-client-adapter.types.ts`
- Create: `worker/src/mcp-runtime/mcp-client-factory.ts`
- Create: `worker/src/mcp-runtime/legacy-mcp-client-compatibility.adapter.ts`
- Create: `worker/src/mcp-runtime/__tests__/mcp-client-adapter.spec.ts`
- Create: `worker/src/mcp-runtime/__tests__/mcp-client-conformance.spec.ts`
- Create: `worker/src/mcp-runtime/__tests__/fixtures/mcp-conformance-servers.ts`
- Modify: `worker/src/config/env.schema.ts`

**Interfaces:**

- `McpClientAdapter.connect`, `discover`, `callTool`, `readResource`, `getPrompt`, `ping`, and `close` are the only transport-facing API used by later tasks.
- Normalizes official SDK results into shared Sentris descriptors/results while retaining title, icons, annotations, `_meta` as `meta`, named content variants, resource contents, and prompt messages.

- [ ] **Step 1: Write modern/legacy conformance tests**

  Use official in-process fixtures to prove: explicit auto negotiation reaches modern `2026-07-28`; modern HTTP sends independent requests without session/resume state; legacy Streamable HTTP remains sessionful inside the compatibility adapter; stdio negotiates once and owns its child; a fresh client is used for very-old SSE fallback. Cover all four list families, `callTool` with the snapshotted `toolDefinition`, `readResource`, `getPrompt`, named result variants, and the 64-page cap.

  Also test auth-partitioned `cachePartition`, bounded `prior` expiry, credential-generation invalidation, 401 refresh bounded to one SDK retry, cancellation, idle timeout, `maxTotalTimeout`, monotonic/rate-limited progress, and typed input-required rejection.

- [ ] **Step 2: Run RED**

  ```powershell
  bun test worker/src/mcp-runtime/__tests__/mcp-client-adapter.spec.ts worker/src/mcp-runtime/__tests__/mcp-client-conformance.spec.ts
  ```

- [ ] **Step 3: Implement the adapter**

  Construct `Client` with explicit auto negotiation, `listMaxPages: 64`, private response caching with a required `cachePartition`, and no anonymous input handler. Pass `connect({ prior, signal, timeout })`, record `getProtocolEra()`, `getNegotiatedProtocolVersion()`, and `getDiscoverResult()`, then conditionally list every advertised family. Use `cacheMode: 'refresh'` for immutable snapshot materialization and the snapshotted tool definition on calls.

  `McpClientFactory` selects official `StreamableHTTPClientTransport` for HTTP and official `StdioClientTransport` for stdio. It may select `LegacyMcpClientCompatibilityAdapter` only after an explicit legacy verdict/pin; keep session/resume state private to that object. Never retry a call when the request may have reached the server.

- [ ] **Step 4: Run GREEN and typecheck**

  ```powershell
  bun test worker/src/mcp-runtime/__tests__/mcp-client-adapter.spec.ts worker/src/mcp-runtime/__tests__/mcp-client-conformance.spec.ts
  bun --cwd=worker run typecheck
  ```

- [ ] **Step 5: Commit**

  ```powershell
  git add worker/src/mcp-runtime worker/src/config/env.schema.ts
  git commit -s -m "feat: add canonical MCP v2 client adapter"
  ```

---

### Task 3: Implement Redis lease state with epoch/generation fencing

**Files:**

- Create: `worker/src/mcp-runtime/mcp-runtime-lease.repository.ts`
- Create: `worker/src/mcp-runtime/mcp-runtime-lease.scripts.ts`
- Create: `worker/src/mcp-runtime/mcp-runtime-identity.ts`
- Create: `worker/src/mcp-runtime/mcp-runtime-redis.ts`
- Create: `worker/src/mcp-runtime/__tests__/mcp-runtime-lease.repository.spec.ts`
- Modify: `worker/src/config/env.schema.ts`
- Modify: `worker/src/temporal/workers/service-factory.ts`

**Interfaces:**

- `reserve(runtimeKey, candidateOwner)` is an atomic unfenced acquisition operation that returns either the existing ready reference or a new reservation/fence. `publishReady`, `renew`, `beginDrain`, `compareAndDelete`, and every later mutation require that returned fence; `read(runtimeKey)` and `listOwned` are read-only.
- Lease state is `starting -> ready -> draining`; `leaseGeneration` only increases. `ownerEpoch` identifies one worker process incarnation, not a stable PM2/container name. Neither value participates in immutable authority/snapshot identity.

- [ ] **Step 1: Write RED lease race tests**

  With the existing Redis test fixture, race two unfenced candidate owners for the same runtime key and assert one new reservation while the loser receives the resulting current reference. Prove first acquisition succeeds without a pre-existing fence, while a stale epoch/lease generation cannot publish, renew, drain, or delete; `publishReady` alone exposes the direct address; expired owners can be replaced only with a greater lease generation; nullable-tenant keys do not collide; Redis errors fail closed. Prove failover changes the fence but leaves a separately supplied immutable authority/config fingerprint unchanged.

- [ ] **Step 2: Run RED**

  ```powershell
  bun test worker/src/mcp-runtime/__tests__/mcp-runtime-lease.repository.spec.ts
  ```

- [ ] **Step 3: Implement Lua-backed CAS transitions**

  Store one bounded JSON/hash record at `mcp:runtime:lease:{sha256(runtimeKey)}` plus an owner index. The reservation Lua script accepts only the hashed runtime key plus candidate owner identity/address: it returns a live matching reference or atomically creates a `starting` reservation with a fresh runtime ID and next lease generation. It does not compare a caller-supplied fence. Every later mutation script compares runtime ID, owner ID, epoch, and lease generation. Ready publication requires the returned fence and adds the validated instance-unique URL, protocol era/version, capability fingerprint, and normal lease expiry. Renewal cannot revive an expired or draining record. Compare-and-delete removes both lease and owner index.

  Generate `ownerEpoch` once during worker boot with `randomUUID()`. Add bounded env values for lease TTL, starting TTL, renewal interval, and owner direct URL; validate renewal interval is comfortably below lease TTL.

- [ ] **Step 4: Run GREEN**

  ```powershell
  bun test worker/src/mcp-runtime/__tests__/mcp-runtime-lease.repository.spec.ts
  bun --cwd=worker run typecheck
  ```

- [ ] **Step 5: Commit**

  ```powershell
  git add worker/src/mcp-runtime worker/src/config/env.schema.ts worker/src/temporal/workers/service-factory.ts
  git commit -s -m "feat: add fenced MCP runtime leases"
  ```

---

### Task 4: Implement the worker-owned runtime manager and resource drivers

**Files:**

- Create: `worker/src/mcp-runtime/mcp-runtime-manager.ts`
- Create: `worker/src/mcp-runtime/mcp-runtime-record.ts`
- Create: `worker/src/mcp-runtime/mcp-runtime-driver.ts`
- Create: `worker/src/mcp-runtime/mcp-runtime-reconciler.ts`
- Create: `worker/src/mcp-runtime/mcp-runtime-metrics.ts`
- Create: `worker/src/mcp-runtime/drivers/remote-http-runtime.driver.ts`
- Create: `worker/src/mcp-runtime/drivers/host-stdio-runtime.driver.ts`
- Create: `worker/src/mcp-runtime/drivers/docker-runtime.driver.ts`
- Create: `worker/src/mcp-runtime/__tests__/mcp-runtime-manager.spec.ts`
- Create: `worker/src/mcp-runtime/__tests__/mcp-runtime-reconciler.spec.ts`
- Modify: `worker/src/temporal/workers/dev.worker.ts`
- Modify: `worker/src/config/env.schema.ts`

**Interfaces:**

- `McpRuntimeManager.acquire(runtimeKey, candidateOwner)` requires no pre-existing fence and returns `McpRuntimeRef`; `discover`, `invoke`, `read`, `getPrompt`, `renew`, `release`, and state-changing `health`/`reconcile` actions require its current fence.
- The manager's in-memory map is an owner cache, never authority. Every post-acquire operation validates the live Redis fence before dispatch. Immutable authority/config identity is passed and compared separately from the ephemeral fence.

- [ ] **Step 1: Write RED lifecycle tests**

  Prove one concurrent unfenced acquire creates one routable runtime; startup failure never publishes an address; host stdio uses the official owned child; Docker resources carry runtime ID/owner epoch/lease-generation labels; credentials are resolved only after reservation on the owner and absent from lease/log/returned ref; renewal loss self-fences; release is idempotent and fenced; shutdown drains; health combines lease age, transport state, and child/container state. Kill the owner between calls, reacquire with a new owner, and assert the lease generation increases while the unchanged config/capability fingerprint and authority/snapshot identity remain stable.

  Simulate a worker crash between Docker creation and ready publication and prove reconciliation reaps the labeled orphan. Simulate owner loss after dispatch and assert the callback classifies the durable attempt ambiguous rather than retrying.

- [ ] **Step 2: Run RED**

  ```powershell
  bun test worker/src/mcp-runtime/__tests__/mcp-runtime-manager.spec.ts worker/src/mcp-runtime/__tests__/mcp-runtime-reconciler.spec.ts
  ```

- [ ] **Step 3: Implement drivers and manager**

  Remote HTTP owns a v2 adapter/transport but no process. Host stdio passes only the executable, bounded arguments, approved cwd, and an allowlisted environment to `StdioClientTransport`. Docker stdio launches a labeled `docker run --rm -i` through `StdioClientTransport`; Docker HTTP launches a labeled container on the configured DIND network and connects from the owner to its private endpoint. Do not start an HTTP bridge for stdio and do not publish container endpoints outside owner memory.

  `acquire` sends the runtime key plus local candidate owner identity/address to `reserve`; it never fabricates or requires a prior fence. If a matching ready lease exists, return it. If the candidate wins a new reservation, use its returned fence to resolve credentials, start/connect, discover, compute the complete capability fingerprint, and publish ready. Any error closes/reaps before fenced compare-and-delete. Renewal checks Redis; failure transitions the local record to draining and rejects new work. Reconciliation enumerates local child/container labels and owned leases, reaps resources with no exact live fence, and never deletes another lease generation. Redis failover is accepted only after rediscovery matches the immutable capability fingerprint; it does not mint authority merely because ownership changed.

- [ ] **Step 4: Run GREEN**

  ```powershell
  bun test worker/src/mcp-runtime/__tests__/mcp-runtime-manager.spec.ts worker/src/mcp-runtime/__tests__/mcp-runtime-reconciler.spec.ts
  bun --cwd=worker run typecheck
  ```

- [ ] **Step 5: Commit**

  ```powershell
  git add worker/src/mcp-runtime worker/src/temporal/workers/dev.worker.ts worker/src/config/env.schema.ts
  git commit -s -m "feat: own MCP runtimes in the worker"
  ```

---

### Task 5: Add one-hop direct owner routing and the in-process fast path

**Files:**

- Create: `worker/src/mcp-runtime/mcp-runtime-router.ts`
- Create: `worker/src/mcp-runtime/mcp-runtime-internal.server.ts`
- Create: `worker/src/mcp-runtime/mcp-runtime-internal.client.ts`
- Create: `worker/src/mcp-runtime/mcp-runtime-auth.ts`
- Create: `worker/src/mcp-runtime/__tests__/mcp-runtime-router.spec.ts`
- Create: `worker/src/mcp-runtime/__tests__/mcp-runtime-internal.server.spec.ts`
- Modify: `worker/src/health/health-server.ts`
- Modify: `worker/src/temporal/workers/dev.worker.ts`
- Modify: `worker/src/config/env.schema.ts`
- Modify: `pm2.config.cjs`

**Interfaces:**

- `McpRuntimeRouter.execute(ref, operation)` calls the manager directly when owner ID/epoch match; otherwise it sends one bounded authenticated request to `ref.ownerAddress`.
- Internal routes expose acquire/discover/invoke/read/getPrompt/renew/release/health only on the private runtime listener. `acquire` validates an unfenced runtime key plus candidate owner and returns a current/new reference; every other route rejects a missing, stale, or mismatched returned fence before touching a client.

- [ ] **Step 1: Write RED routing/auth tests**

  Assert initial acquisition contains no fence and can atomically return a new ready reference. Assert local post-acquire ownership performs zero HTTP calls; remote ownership performs exactly one call to the persisted direct address; the configured generic/load-balanced worker alias and non-private/invalid addresses are rejected; internal auth is mandatory; request bodies reject resolved credentials; missing/stale lease generation on post-acquire calls receives conflict/fenced status; cancellation disconnects only the target operation.

- [ ] **Step 2: Run RED**

  ```powershell
  bun test worker/src/mcp-runtime/__tests__/mcp-runtime-router.spec.ts worker/src/mcp-runtime/__tests__/mcp-runtime-internal.server.spec.ts
  ```

- [ ] **Step 3: Implement router and listener**

  Start one runtime listener per worker process. For PM2 instance `N`, use `9200 + N*100` unless explicitly overridden; advertise `http://127.0.0.1:<port>` for local PM2 and the unique Compose service URL in Compose. Reuse the existing internal service credential with constant-time validation, body limits, deadlines, request IDs, and redacted structured logging. Validate the live lease again on the owner immediately before dispatch; the caller's earlier lookup is not sufficient fencing.

- [ ] **Step 4: Run GREEN**

  ```powershell
  bun test worker/src/mcp-runtime/__tests__/mcp-runtime-router.spec.ts worker/src/mcp-runtime/__tests__/mcp-runtime-internal.server.spec.ts
  bun --cwd=worker run typecheck
  ```

- [ ] **Step 5: Commit**

  ```powershell
  git add worker/src/mcp-runtime worker/src/health/health-server.ts worker/src/temporal/workers/dev.worker.ts worker/src/config/env.schema.ts pm2.config.cjs
  git commit -s -m "feat: route MCP calls to the fenced owner"
  ```

---

### Task 6: Move onboarding and discovery to complete immutable runtime catalogs

**Files:**

- Modify: `worker/src/temporal/activities/mcp-discovery.activity.ts`
- Modify: `worker/src/temporal/workers/dev.worker.ts`
- Modify: `worker/src/temporal/workflows/mcp-discovery-workflow.ts`
- Modify: `worker/src/temporal/workflows/index.ts`
- Modify: `backend/src/mcp-runtime/mcp-run-catalog.service.ts`
- Modify: `backend/src/mcp/mcp-discovery-orchestrator.service.ts`
- Modify: `backend/src/mcp-servers/mcp-servers.service.ts`
- Modify: `packages/shared/src/mcp-capabilities.ts`
- Modify: `worker/src/temporal/activities/__tests__/mcp-discovery.activity.test.ts`
- Modify: `backend/src/mcp-runtime/__tests__/mcp-run-catalog.service.spec.ts`
- Modify: `backend/src/mcp-servers/__tests__/mcp-servers.service.spec.ts`

**Interfaces:**

- The discovery activity receives execution scope plus saved server/config/credential references, calls `McpRuntimeRouter.acquire` then `discover`, and returns a bounded normalized catalog only.
- Backend onboarding and run catalog creation no longer instantiate any MCP client. They start/wait for the bounded Temporal discovery workflow and persist the complete immutable snapshot.

- [ ] **Step 1: Write RED complete-catalog and secret-boundary tests**

  Assert tools, resources, templates, and prompts survive worker normalization and backend persistence with metadata. Verify resource contents and expanded prompts are absent from discovery. Rotate credential generation and prove a new runtime/config identity and snapshot are created. Separately fail over an unchanged runtime to a new owner epoch/lease generation and prove the existing grant, snapshot ID, config fingerprint, and capability fingerprint remain unchanged. Assert no resolved secret, endpoint authorization header, owner address, owner epoch, lease generation, PID, or container ID appears in workflow inputs/results or persisted snapshot.

- [ ] **Step 2: Run RED**

  ```powershell
  bun test worker/src/temporal/activities/__tests__/mcp-discovery.activity.test.ts backend/src/mcp-runtime/__tests__/mcp-run-catalog.service.spec.ts backend/src/mcp-servers/__tests__/mcp-servers.service.spec.ts
  ```

- [ ] **Step 3: Cut discovery callers over**

  Replace the v1 client bodies in worker discovery and backend onboarding with the runtime workflow. Make `server/discover` decide which family lists run, preserve all normalized descriptors, compute the binding/capability fingerprint from the full sorted catalog and credential/config generation, and retain immutable grant/snapshot semantics. Explicitly omit owner address/ID/epoch, lease generation/state/expiry, and process/container data from authority-key and config-fingerprint projections. Cache only by the complete auth partition; a catalog from one principal must never satisfy another.

- [ ] **Step 4: Run GREEN and regenerate route artifacts if onboarding routes change**

  ```powershell
  bun test worker/src/temporal/activities/__tests__/mcp-discovery.activity.test.ts backend/src/mcp-runtime/__tests__/mcp-run-catalog.service.spec.ts backend/src/mcp-servers/__tests__/mcp-servers.service.spec.ts
  bun --cwd=worker run typecheck
  bun --cwd=backend run typecheck
  bun --cwd=backend run generate:openapi
  bun --cwd=packages/backend-client run generate
  ```

- [ ] **Step 5: Commit**

  ```powershell
  git add packages/shared/src/mcp-capabilities.ts worker/src/temporal backend/src/mcp-runtime backend/src/mcp backend/src/mcp-servers packages/backend-client
  git commit -s -m "feat: discover complete MCP catalogs through runtimes"
  ```

---

### Task 7: Dispatch every run-scoped outbound MCP operation through durable attempts

**Files:**

- Modify: `backend/src/database/schema/mcp-runtime.ts`
- Create: `backend/migrations/0011_generalize_mcp_runtime_operations.sql`
- Modify: `backend/migrations/meta/_journal.json`
- Create/Modify: generated `backend/migrations/meta/0011_snapshot.json`
- Modify: `backend/src/database/__tests__/migration.guard.spec.ts`
- Modify: `backend/src/mcp-runtime/mcp-runtime.repository.ts`
- Modify: `backend/src/mcp-runtime/mcp-invocation.service.ts`
- Modify: `backend/src/mcp/mcp-gateway.service.ts`
- Modify: `backend/src/mcp/mcp-legacy-outbound-compatibility.service.ts`
- Modify: `worker/src/temporal/activities/mcp-invocation.activity.ts`
- Modify: `worker/src/temporal/workflows/index.ts`
- Modify: `worker/src/temporal/workflows/tool-invocation-update-handler.ts`
- Modify: `packages/shared/src/mcp-invocation.ts`
- Modify: focused tests beside every modified service/activity/workflow

**Interfaces:**

- Adds `executeMcpOperation` as a patch-gated Workflow Update for `tool-call | resource-read | prompt-get`; existing `executeToolInvocation` delegates to the tool projection so old Workflow histories continue to replay.
- Preflight creates/claims one Postgres invocation attempt; dispatch uses `McpRuntimeRouter`; settlement CAS-transitions both logical invocation and current attempt.

- [ ] **Step 1: Write RED migration, repository, Workflow, and gateway tests**

  Cover generic operation kind/target persistence, old tool-row backfill, nullable `tool_name` compatibility, exact run/org/snapshot/grant scope, duplicate Update replay, stale refs, resource/prompt authorization from the immutable snapshot, cancellation, and handler draining. Verify each attempt records the exact runtime ID, owner ID, owner epoch, and lease generation used for dispatch, separately from grant/snapshot/config identity. An owner death after `dispatched` becomes ambiguous and does not produce attempt 2; a pre-dispatch owner failure may safely reacquire between calls with a greater lease generation while retaining the unchanged snapshot.

  Gateway tests must prove external tools no longer call the backend v1 pool, `registerResource`/resource-template callbacks authorize and dispatch `resource-read`, and `registerPrompt` dispatches `prompt-get`. All three reject a changed live binding fingerprint before the Workflow Update.

- [ ] **Step 2: Run RED**

  ```powershell
  bun test backend/src/mcp-runtime/__tests__ backend/src/mcp/__tests__/mcp-gateway.spec.ts worker/src/temporal/activities/__tests__/mcp-invocation.activity.test.ts worker/src/temporal/workflows/__tests__/tool-invocation-update-handler.test.ts backend/src/database/__tests__/migration.guard.spec.ts
  ```

- [ ] **Step 3: Generalize persistence without breaking old histories**

  Migration `0011` adds `operation_kind` and `operation_target`, backfills every existing row as `tool-call` from `tool_name`, then makes the new fields non-null. It also adds nullable current-attempt fence columns (`runtime_id`, `owner_id`, `owner_epoch`, `lease_generation`) to `mcp_invocation_attempts`; they are null while prepared and written atomically by dispatch claim. Drop only the `tool_name NOT NULL` constraint; retain/populate `tool_name` for tool calls until all histories that serialize `PreparedInvocationRef.toolName` are retired. Add a kind check, bounded target validation, and positive lease-generation check in schema/service code. Generate and seal the migration using the repository command; do not hand-edit metadata after generation.

  The dispatch activity resolves no credentials itself. It first acquires by persisted runtime key plus its local candidate-owner identity, then passes the returned runtime reference and snapshotted capability definition to the dispatch-claim CAS. That CAS writes the exact fence to the current attempt and marks it `dispatched` before the first possible upstream byte. The router invokes only with the same returned fence. Settlement and ambiguity reconciliation compare the attempt-captured fence; a later owner fence cannot settle an earlier attempt. Map cancellation/deadline/remote/input-required failures and settle bounded JSON only. Progress is activity-heartbeated/rate-limited and does not flood Workflow history.

- [ ] **Step 4: Register full facade behavior**

  Build `McpServer` resources, templates, and prompts from immutable snapshot descriptors using the installed server v2 `registerResource`/`ResourceTemplate`/`registerPrompt` APIs. Resource reads and prompt gets submit the new keyed Update just like external tools. Modern requests remain stateless; do not create a run-gateway transport session or affinity record.

- [ ] **Step 5: Run GREEN, migration verification, replay, and typechecks**

  ```powershell
  bun test backend/src/mcp-runtime/__tests__ backend/src/mcp/__tests__/mcp-gateway.spec.ts worker/src/temporal/activities/__tests__/mcp-invocation.activity.test.ts worker/src/temporal/workflows/__tests__/tool-invocation-update-handler.test.ts backend/src/database/__tests__/migration.guard.spec.ts
  bun --cwd=backend run migration:check
  bun --cwd=backend run migration:smoke:fresh
  bun --cwd=backend run migration:smoke:upgrade
  bun --cwd=backend run typecheck
  bun --cwd=worker run typecheck
  ```

- [ ] **Step 6: Commit**

  ```powershell
  git add packages/shared/src/mcp-invocation.ts backend/src/database backend/src/mcp-runtime backend/src/mcp backend/migrations worker/src/temporal
  git commit -s -m "feat: durably dispatch outbound MCP operations"
  ```

---

### Task 8: Remove duplicate clients, handwritten bridges, wrong-worker cleanup, and secret registration

**Files:**

- Delete: `worker/src/components/core/mcp-stdio-host-proxy.ts`
- Delete: `worker/src/components/core/mcp-docker-proxy.ts`
- Delete: `docker/mcp-stdio-proxy/Dockerfile`
- Delete: `docker/mcp-stdio-proxy/named-servers.json`
- Delete: `docker/mcp-stdio-proxy/package.json`
- Delete: `docker/mcp-stdio-proxy/README.md`
- Delete: `docker/mcp-stdio-proxy/server.mjs`
- Delete: obsolete tests dedicated to those bridges
- Modify: `worker/src/components/core/mcp-library-utils.ts`
- Modify: `worker/src/components/core/mcp-group-runtime.ts`
- Modify: `worker/src/components/core/mcp-runtime.ts`
- Modify: `worker/src/temporal/activities/mcp.activity.ts`
- Modify: `worker/src/utils/run-resource-cleanup.ts`
- Modify: `backend/src/mcp/tool-registry.service.ts`
- Modify: `backend/src/mcp/internal-mcp.controller.ts`
- Modify: `backend/src/mcp/dto/mcp.dto.ts`
- Delete: `backend/src/mcp/mcp-legacy-outbound-compatibility.service.ts`
- Modify: `backend/src/mcp/mcp.module.ts`
- Modify: `docker/docker-compose.full.yml`
- Modify: `docker/docker-compose.yml` and dev Compose files that expose the old proxy
- Modify: `docker/mcp-aws-suite/Dockerfile`
- Modify: `docker/mcp-aws-cloudtrail/Dockerfile`
- Modify: `docker/mcp-aws-cloudwatch/Dockerfile`
- Modify: `docs/mcp-library.mdx`
- Modify: tests beside every affected component/service

**Interfaces:**

- Component libraries/groups use `McpRuntimeRouter` and runtime references; they do not create v1 clients, bridges, or local cleanup records.
- Registry records readiness/runtime reference/capability fingerprint only. It no longer accepts resolved headers, container IDs, proxy IDs, or a generic callable endpoint.

- [ ] **Step 1: Write RED ownership/cleanup/secret tests**

  Prove a component activity landing on worker B can use a runtime owned by A; B never tries to stop A's process/container; run cleanup calls fenced release and owner reconciliation; credential values never cross the registration controller; removing one execution scope releases only its lease/ref; legitimate trusted-local host stdio and Docker group paths still work.

- [ ] **Step 2: Run RED focused suites**

  ```powershell
  bun test worker/src/components/core/__tests__ worker/src/temporal/activities/__tests__/mcp.activity.test.ts worker/src/utils/__tests__/run-resource-cleanup.test.ts backend/src/mcp/__tests__/tool-registry.service.spec.ts backend/src/mcp/__tests__/mcp-internal.integration.spec.ts
  ```

- [ ] **Step 3: Replace, then delete**

  Cut each caller to the runtime router before deleting its old implementation. Remove `runningHostProxies`, Docker proxy target maps, generic `MCP_DOCKER_PROXY_PUBLIC_BASE_URL`, resolved-header registration, and cleanup payloads containing process/container IDs. Remove backend and worker direct `Client` imports except the canonical v2 adapter and bounded legacy adapter. Remove the backend v1 outbound pool entirely. Rebase the AWS MCP images on a maintained Python base and invoke their native stdio entry points directly (the suite image command remains overrideable per saved server); remove their dependency on the deleted HTTP-proxy base image and replace its HTTP health check with a process/image smoke check.

  Run a repository search and treat unexpected matches as failures:

  ```powershell
  rg -n "McpLegacyOutboundCompatibilityService|runningHostProxies|MCP_DOCKER_PROXY_PUBLIC_BASE_URL|mcp-stdio-proxy|new Client\(" backend/src worker/src docker packages
  ```

  Expected: only `McpClientAdapter`, `LegacyMcpClientCompatibilityAdapter`, deliberate tests/fixtures, and unrelated inbound server construction remain.

- [ ] **Step 4: Run GREEN and typechecks**

  ```powershell
  bun test worker/src/components/core/__tests__ worker/src/temporal/activities/__tests__/mcp.activity.test.ts worker/src/utils/__tests__/run-resource-cleanup.test.ts backend/src/mcp/__tests__
  bun --cwd=backend run typecheck
  bun --cwd=worker run typecheck
  ```

- [ ] **Step 5: Commit**

  ```powershell
  git add -A backend/src/mcp worker/src/components/core worker/src/temporal/activities/mcp.activity.ts worker/src/utils docker
  git commit -s -m "refactor: remove duplicate MCP runtime ownership"
  ```

---

### Task 9: Prove two-worker ownership, fencing, recovery, and the 10% latency budget

**Files:**

- Create: `docker/docker-compose.mcp-runtime-two-worker.yml`
- Create: `e2e-tests/fixtures/mcp-runtime-fixture.ts`
- Create: `e2e-tests/mcp-runtime-manager.e2e.test.ts`
- Create: `e2e-tests/mcp-runtime-owner-loss.e2e.test.ts`
- Create: `worker/src/temporal/activities/mcp-runtime-placement-test.activity.ts`
- Create: `worker/src/temporal/workflows/mcp-runtime-placement-test.workflow.ts`
- Create: `worker/src/temporal/activities/__tests__/mcp-runtime-placement-test.activity.test.ts`
- Modify: `worker/src/temporal/workers/dev.worker.ts`
- Modify: `worker/src/temporal/workflows/index.ts`
- Create: `scripts/mcp-runtime-benchmark.ts`
- Create: `scripts/mcp-runtime-performance-pair.ts`
- Create: `scripts/__tests__/mcp-runtime-performance-pair.test.ts`
- Modify: `scripts/lib/performance-budget.ts`
- Modify: `package.json`
- Modify: `worker/src/mcp-runtime/mcp-runtime-metrics.ts`
- Modify: `docs/MULTI-INSTANCE-DEV.mdx`

**Interfaces:**

- The Compose override runs two ordinary workers plus acceptance-only, worker-specific Temporal activity queues (`sentris-mcp-runtime-test-a` and `sentris-mcp-runtime-test-b`) with distinct stable owner IDs, random process epochs, and unique network aliases/direct addresses (`http://sentris-worker-a:9200` and `http://sentris-worker-b:9200`); neither address is a load-balanced alias. The placement workflow targets these queues explicitly and every activity result reports its observed executor owner ID/epoch.
- Benchmark artifacts use the existing schema-v2 host/instance/revision identity and fixed 10% comparison function with MCP-specific required metrics.

- [ ] **Step 1: Write RED acceptance and benchmark-runner tests**

  The placement workflow accepts an explicit activity task queue. The acquire activity reports `{ executorOwnerId, executorOwnerEpoch, runtimeRef }`; the invoke activity reports `{ executorOwnerId, executorOwnerEpoch, routedOwnerId, routedOwnerEpoch, route: 'in-process' | 'direct' }`. The two-worker test targets `sentris-mcp-runtime-test-a` to acquire and asserts executor/owner A, then targets `sentris-mcp-runtime-test-b` to execute and asserts executor B, routed owner A, and one direct hop. Exercise complete discovery, tool call, resource read, and prompt get. Block a mutating fixture call after its attempt is marked dispatched, kill A, observe ambiguity and no blind retry, and reject A's stale epoch after restart. With A unavailable and the lease expired, target B's queue for unfenced reacquisition; assert executor/owner B and a greater lease generation while grant/snapshot/config/capability identity is unchanged. Rotate credentials separately and prove cache/runtime isolation; release from an activity explicitly placed on B without wrong-worker cleanup.

  Add modern stateless HTTP, legacy sessionful HTTP, host stdio, and Docker/DIND fixtures. Add cancellation, total timeout despite progress, and unknown-outcome cases. The benchmark runner test rejects mismatched host/instance/trust profile/sample counts and fails exactly above 10%.

- [ ] **Step 2: Run RED**

  ```powershell
  bun test scripts/__tests__/mcp-runtime-performance-pair.test.ts
  bun test e2e-tests/mcp-runtime-manager.e2e.test.ts e2e-tests/mcp-runtime-owner-loss.e2e.test.ts
  ```

- [ ] **Step 3: Implement deterministic full-Compose harness**

  Extend `docker/docker-compose.full.yml` only through the new override: give the existing `worker` the unique `sentris-worker-a` network alias and add `worker-b` with `sentris-worker-b`; both use shared Redis/Postgres/Temporal/DIND and separate direct runtime listener addresses. Under an explicit E2E-only environment flag, A starts an activity-only Temporal worker polling `sentris-mcp-runtime-test-a` and B starts one polling `sentris-mcp-runtime-test-b`; production/default startup does not create these queues. The deterministic placement workflow uses its input queue in `proxyActivities({ taskQueue })`, and placement activities read the boot-generated owner identity from the real runtime manager rather than accepting an asserted ID from test input. Health waits for both listeners and both test pollers. Do not use `container_name` scaling tricks or expose the runtime listener publicly.

  `scripts/mcp-runtime-performance-pair.ts` follows the existing safe paired-checkout runner: exact clean baseline and candidate SHAs, two separate source roots, same host fingerprint/instance/trust profile, Compose cleanup, and artifacts outside both worktrees. Collect at least 50 warmups plus 500 measured serial samples for `mcp.catalog`, `mcp.tool_call`, `mcp.resource_read`, `mcp.prompt_get`, and the existing representative agent-turn path, with median and p95 metrics. Use the same deterministic fixture and payload in both revisions.

- [ ] **Step 4: Run GREEN full-Compose acceptance on the confirmed instance**

  ```powershell
  bun run instance show
  $env:SENTRIS_INSTANCE='<confirmed-N>'
  docker compose -f docker/docker-compose.full.yml -f docker/docker-compose.mcp-runtime-two-worker.yml up -d --build --wait
  bun run test:e2e:mcp-runtime
  docker compose -f docker/docker-compose.full.yml -f docker/docker-compose.mcp-runtime-two-worker.yml down
  ```

  Expected: both workers and both placement queues are healthy; observed acquire executor/owner is A; observed invoke executor is B and routed owner is A through exactly one direct hop; stale epoch/lease generation fails; killed-owner call is ambiguous exactly once; observed reacquire executor/owner is B with a higher lease generation and unchanged authority/snapshot identity; all capability families work; no resolved secret appears in Redis/Postgres/Temporal payload inspection.

- [ ] **Step 5: Run the paired performance gate**

  Use two clean source roots outside this checkout and an output directory outside both. Do not benchmark a dirty tree.

  ```powershell
  $env:SENTRIS_ALLOW_MCP_RUNTIME_PERFORMANCE_PAIR='true'
  $env:SENTRIS_INSTANCE='<confirmed-N>'
  bun scripts/mcp-runtime-performance-pair.ts --baseline-root <clean-base-root> --baseline-revision <40-char-base-sha> --candidate-root <clean-candidate-root> --candidate-revision <40-char-candidate-sha> --output-dir C:\tmp\sentris-mcp-runtime-performance
  ```

  Expected: every MCP-specific median/p95 candidate metric is `<= baseline * 1.10`. If any metric fails, optimize and rerun; stop for explicit user approval rather than documenting a self-approved exception.

- [ ] **Step 6: Commit**

  ```powershell
  git add docker/docker-compose.mcp-runtime-two-worker.yml e2e-tests scripts package.json worker/src/mcp-runtime/mcp-runtime-metrics.ts worker/src/temporal/activities/mcp-runtime-placement-test.activity.ts worker/src/temporal/activities/__tests__/mcp-runtime-placement-test.activity.test.ts worker/src/temporal/workflows/mcp-runtime-placement-test.workflow.ts worker/src/temporal/workflows/index.ts worker/src/temporal/workers/dev.worker.ts docs/MULTI-INSTANCE-DEV.mdx
  git commit -s -m "test: verify distributed MCP runtime ownership"
  ```

---

### Task 10: Close compatibility boundaries and verify the complete migration

**Files:**

- Modify: `docs/architecture/adr-stateless-mcp-runtime-and-temporal-agents.md`
- Modify: `docs/superpowers/specs/2026-07-31-mcp-runtime-temporal-agent-architecture-design.md`
- Modify: `docs/development/dev-environment.mdx`
- Modify: `backend/package.json`
- Modify: `worker/package.json`
- Modify: `bun.lock`
- Modify/Delete: remaining compatibility code proven unused by the searches below

**Interfaces:**

- Documents one canonical owner and the exact residual legacy seam/deletion condition.
- Removes a legacy package only when no supported negotiated legacy integration imports it; otherwise records its single owner, metrics, and deletion test instead of pretending it is gone.

- [ ] **Step 1: Audit imports and deletion conditions**

  ```powershell
  rg -n "@modelcontextprotocol/sdk|new Client\(|StreamableHTTPClientTransport|StdioClientTransport|sessionId|resumeStream|mcp_affinity|MCP_DOCKER_PROXY_PUBLIC_BASE_URL" backend worker packages docker docs
  rg -n "endpoint|headers|credential|secret|containerId|proxyId" backend/src/mcp worker/src/mcp-runtime worker/src/temporal/activities
  ```

  Classify every match as canonical v2 adapter, bounded legacy compatibility adapter, Studio-only inbound compatibility, immutable credential reference, fixture/test, or defect. Delete defects and obsolete dependencies. Do not remove Studio sticky compatibility in this plan; do not reintroduce it for run gateway traffic.

- [ ] **Step 2: Update architecture and operator docs**

  Document runtime key/lease state, direct-address configuration for PM2 and Compose, health/metrics, trusted-local host stdio, Docker/DIND, credential rotation, owner-loss/ambiguity behavior, and operational reconciliation. State that modern HTTP is request-stateless. Record the legacy adapter's owner and measurable deletion condition. Keep Tasks deferred until official support; keep durable input-required/workflow-granular agent turns in their sequel.

- [ ] **Step 3: Run complete proportional verification**

  ```powershell
  bun test packages/shared/src/__tests__/mcp-capabilities.test.ts packages/shared/src/__tests__/mcp-invocation.test.ts
  bun test worker/src/mcp-runtime worker/src/temporal/activities/__tests__/mcp-discovery.activity.test.ts worker/src/temporal/activities/__tests__/mcp-invocation.activity.test.ts
  bun test backend/src/mcp-runtime backend/src/mcp backend/src/mcp-servers backend/src/database/__tests__/migration.guard.spec.ts
  bun run typecheck
  bun run lint
  bun --cwd=backend run build
  bun --cwd=backend run migration:check
  bun --cwd=backend run migration:smoke:fresh
  bun --cwd=backend run migration:smoke:upgrade
  git diff --check
  git status --short
  git log --oneline --decorate -12
  ```

  Re-run Task 9's full-Compose two-worker acceptance and paired performance command against the final commit if Task 10 changed runtime code or dependencies.

- [ ] **Step 4: Self-review against the replacement list**

  Confirm, with file/search evidence, that the implementation replaced rather than wrapped indefinitely: backend gateway v1 pool; backend/worker discovery duplication; handwritten host stdio/Docker bridges and local maps; generic worker routing; wrong-worker cleanup; resolved-secret registration; and tools-only discovery. Confirm no mandatory managed service was added.

- [ ] **Step 5: Commit**

  ```powershell
  git add docs backend/package.json worker/package.json bun.lock
  git commit -s -m "docs: complete canonical MCP runtime migration"
  ```

  Expected final state: `main` is clean and ahead of `origin/main`; no branch/worktree was created and no push occurred.
