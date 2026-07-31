# Durable MCP Invocations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make run-scoped MCP authority and component-tool invocation state durable, then replace the new-run signal/query polling path with one keyed Temporal Workflow Update that cannot blindly redispatch an uncertain tool call.

**Architecture:** Postgres stores immutable capability grants, immutable catalog snapshots, compact invocation manifests, logical invocations, and their attempts. New Temporal runs advertise an invocation-protocol query; only those runs receive snapshot-bound tokens, while already-running workflows retain the existing token/signal path until their three-hour maximum token lifetime expires. A keyed Workflow Update schedules a retryable preflight activity and a one-attempt component dispatch activity; external MCP calls stay behind the existing explicit v1 outbound compatibility adapter until the immediately following runtime-manager plan.

**Tech Stack:** TypeScript, Zod 4, NestJS 10, Drizzle/PostgreSQL, Redis, Temporal TypeScript SDK 1.14.1, official MCP TypeScript SDK v2, Bun.

## Global Constraints

- Work directly on `main`, as explicitly requested by the user. Do not create a branch or worktree and do not push until the user asks.
- Use conventional DCO commits (`git commit -s`) after every independently shippable task. Preserve unrelated user edits.
- Do not upgrade Temporal or MCP packages in this slice. On 2026-07-31 the matched Temporal packages at `1.14.1` were verified to expose `defineUpdate`, `currentUpdateInfo`, `allHandlersFinished`, and `WorkflowHandle.executeUpdate`; the newer SDK release is not required for this behavior.
- The exact Workflow Update name is `executeToolInvocation`, the compatibility query name is `getToolInvocationProtocolVersion`, the protocol version is `1`, and the replay patch ID is `sentris-tool-invocation-update-v1`.
- Keep the shared domain contracts SDK-independent. The official MCP SDK may validate a snapshot JSON Schema in the backend adapter, but MCP transport/session types must not enter the shared contracts, database schema, or Workflow history.
- `McpRuntimeModule` is a neutral database/persistence module and exports only `McpRuntimeRepository`. Catalog, authority, invocation, auth, and gateway services remain providers of `McpModule`, which already owns `ToolRegistryService`; do not introduce an `McpModule`/`WorkflowsModule` import cycle.
- Persist no plaintext credentials, resolved headers, endpoint authorization values, or live transport/process data. Workflow history receives the bounded request, compact manifest, prepared reference, and bounded result only. A dispatch activity may receive credentials from the internal backend endpoint in memory; that response must never be returned from the activity.
- Inline invocation input is limited to 256 KiB of UTF-8 JSON and inline result output to 1 MiB. Both must be finite JSON values; `undefined`, `NaN`, `Infinity`, functions, class instances, and cycles are rejected. Artifact-backed payloads remain a later agent-history task.
- Invocation state is exactly `planned | prepared | dispatched | completed | failed | ambiguous | cancelled`. A logical invocation has a stable UUID and one or more numbered attempts; this slice creates attempt `1` only but must not prevent later reviewed-idempotent attempts.
- One immutable grant owns exactly one immutable snapshot/manifest. Any catalog/configuration change mints a new grant plus snapshot; snapshots never refresh under an existing grant ID.
- Durable invocation execution in this slice is explicitly run-scoped. Studio/discovery keep the shared authority vocabulary but do not create `mcp_invocations` rows until their later durable-operation plan.
- Dispatch activities use `maximumAttempts: 1`. Preflight and ambiguity-recording activities may use three attempts because neither calls the tool. Once an attempt is `dispatched`, an uncertain outcome becomes `ambiguous`; it is never automatically executed again.
- A backend timeout or lost response from `executeUpdate` must be returned as an error. Never fall back to the legacy signal after an Update was submitted because the Update may still execute.
- Component tools move to Workflow Updates in this slice. Snapshot-authorized external MCP tools continue through the named v1 outbound compatibility path without a second live authorization decision; canonical outbound v2 clients, worker runtime leases, stdio/Docker ownership, and external invocation dispatch are the next plan.
- Legacy tokens without a persisted `capabilitySnapshotId` retain the current live catalog plus signal/query path only for workflows that do not advertise protocol version `1`. Remove that compatibility path after one normal release has elapsed and all pre-deployment runs plus the three-hour maximum token TTL have expired.
- Preserve trusted-local capability. Do not add blanket network, Docker, stdio, scanner, or filesystem restrictions in this slice.
- Use TDD for every behavior change: add a focused failing test, run it and record the intended failure, implement the smallest complete behavior, and rerun it green.
- Verification is proportional: focused shared/backend/worker tests, affected package typechecks, backend build, migration verification, `git diff --check`, one real component-tool E2E on active instance `0`, and one duplicate-Update live probe. Do not run unrelated full security or browser suites.

---

### Task 1: Add bounded invocation and Workflow Update contracts

**Files:**

- Modify: `packages/shared/src/mcp-invocation.ts`
- Modify: `packages/shared/src/__tests__/mcp-invocation.test.ts`
- Modify: `packages/shared/src/index.ts`

**Interfaces:**

- Consumes: existing `ExecutionScope`, `InvocationManifest`, and `InvocationManifestEntry`.
- Produces: `TOOL_INVOCATION_UPDATE_NAME`, `TOOL_INVOCATION_PROTOCOL_QUERY_NAME`, `TOOL_INVOCATION_PROTOCOL_VERSION`, `ToolInvocationRequest`, `PreparedInvocationRef`, `PrepareToolInvocationOutcome`, `ComponentInvocationDispatchContext`, `ToolInvocationResult`, and their Zod schemas.

- [ ] **Step 1: Write failing bounded-request and result tests**

  Add tests that parse a run request with a nested finite JSON object, reject a 256 KiB-plus input, reject non-finite numbers/`undefined`, reject a deadline before `requestedAt`, enforce terminal result/error combinations, and parse both prepared and terminal preflight outcomes:

  ```ts
  const request = {
    invocationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    scope: RUN_SCOPE,
    capabilitySnapshotId: SNAPSHOT_ID,
    toolName: 'osv_query',
    input: { package: { ecosystem: 'npm', name: 'lodash' }, version: '4.17.20' },
    requestedAt: '2026-07-31T10:00:00.000Z',
    deadlineAt: '2026-07-31T10:05:00.000Z',
  };

  expect(ToolInvocationRequestSchema.parse(request)).toEqual(request);
  expect(() =>
    ToolInvocationRequestSchema.parse({ ...request, input: { text: 'x'.repeat(262_144) } }),
  ).toThrow('Invocation input exceeds 262144 UTF-8 bytes');
  ```

- [ ] **Step 2: Run the focused test and observe RED**

  ```powershell
  bun test packages/shared/src/__tests__/mcp-invocation.test.ts
  ```

  Expected: FAIL because the new constants and schemas are not exported.

- [ ] **Step 3: Implement the exact shared contracts**

  Add these constants and shapes to `mcp-invocation.ts`:

  ```ts
  export const TOOL_INVOCATION_UPDATE_NAME = 'executeToolInvocation' as const;
  export const TOOL_INVOCATION_PROTOCOL_QUERY_NAME = 'getToolInvocationProtocolVersion' as const;
  export const TOOL_INVOCATION_PROTOCOL_VERSION = 1 as const;
  export const MAX_INLINE_INVOCATION_INPUT_BYTES = 256 * 1024;
  export const MAX_INLINE_INVOCATION_OUTPUT_BYTES = 1024 * 1024;

  export const InvocationAttemptStatusSchema = z.enum([
    'planned',
    'prepared',
    'dispatched',
    'completed',
    'failed',
    'ambiguous',
    'cancelled',
  ]);

  export const ToolInvocationFailureClassSchema = z.enum([
    'validation',
    'authorization',
    'deadline-before-dispatch',
    'pre-dispatch',
    'remote-tool',
    'cancelled',
    'ambiguous-after-dispatch',
    'runtime-owner-loss',
  ]);
  ```

  Implement a recursive finite `JsonValueSchema` and `JsonObjectSchema`, plus one UTF-8 byte-size refinement using `TextEncoder`. Define:

  ```ts
  export const ToolInvocationRequestSchema = z
    .object({
      invocationId: z.string().uuid(),
      scope: ExecutionScopeSchema,
      capabilitySnapshotId: z.string().uuid(),
      toolName: z.string().min(1).max(128),
      input: JsonObjectSchema,
      requestedAt: z.string().datetime(),
      deadlineAt: z.string().datetime(),
    })
    .strict();

  export const PreparedInvocationRefSchema = z
    .object({
      invocationId: z.string().uuid(),
      attemptId: z.string().uuid(),
      attemptNumber: z.number().int().positive(),
      capabilitySnapshotId: z.string().uuid(),
      capabilityGrantId: z.string().uuid(),
      toolName: z.string().min(1).max(128),
      sourceId: z.string().min(1),
      destination: z.enum(['component-activity', 'mcp-activity']),
      retryPolicy: z.enum(['pre-dispatch-only', 'reviewed-idempotent']),
      preparedAt: z.string().datetime(),
    })
    .strict();

  export const ToolInvocationErrorSchema = z
    .object({
      class: ToolInvocationFailureClassSchema,
      message: z.string().min(1),
      retryable: z.boolean(),
    })
    .strict();

  export const ToolInvocationResultSchema = z
    .object({
      invocationId: z.string().uuid(),
      status: z.enum(['completed', 'failed', 'ambiguous', 'cancelled']),
      output: JsonValueSchema.optional(),
      error: ToolInvocationErrorSchema.optional(),
      completedAt: z.string().datetime(),
    })
    .strict();

  export const PrepareToolInvocationOutcomeSchema = z.discriminatedUnion('kind', [
    z
      .object({
        kind: z.literal('prepared'),
        ref: PreparedInvocationRefSchema,
        manifest: InvocationManifestSchema,
      })
      .strict(),
    z.object({ kind: z.literal('terminal'), result: ToolInvocationResultSchema }).strict(),
  ]);

  export const ComponentInvocationDispatchContextSchema = z
    .object({
      ref: PreparedInvocationRefSchema,
      run: z
        .object({
          runId: z.string().min(1),
          workflowId: z.string().uuid(),
          workflowVersionId: z.string().uuid().nullable(),
          organizationId: z.string().min(1).nullable(),
          scopeId: z.string().uuid().nullable(),
        })
        .strict(),
      component: z
        .object({
          nodeId: z.string().min(1),
          componentId: z.string().min(1),
          arguments: JsonObjectSchema,
          parameters: JsonObjectSchema,
          credentials: JsonObjectSchema.optional(),
        })
        .strict(),
    })
    .strict();
  ```

  Refine request dates, request bytes, result bytes, and these invariants: `completed` requires `output` and forbids `error`; every other terminal state requires `error` and forbids `output`. Normalize an otherwise successful `undefined` component output to JSON `null` in the worker activity before parsing the result.

- [ ] **Step 4: Run focused tests and typecheck GREEN**

  ```powershell
  bun test packages/shared/src/__tests__/mcp-invocation.test.ts
  bun --cwd=packages/shared run typecheck
  git diff --check
  ```

- [ ] **Step 5: Commit the contracts**

  ```powershell
  git add packages/shared/src/mcp-invocation.ts packages/shared/src/__tests__/mcp-invocation.test.ts packages/shared/src/index.ts
  git diff --cached --check
  git commit -s -m "feat: define durable MCP invocation contracts"
  ```

---

### Task 2: Persist immutable authority and extensible invocation attempts

**Files:**

- Create: `backend/src/database/schema/mcp-runtime.ts`
- Modify: `backend/src/database/schema/index.ts`
- Create: `backend/src/mcp-runtime/mcp-runtime.repository.ts`
- Create: `backend/src/mcp-runtime/mcp-runtime.module.ts`
- Create: `backend/src/mcp-runtime/__tests__/mcp-runtime.repository.spec.ts`
- Create: `backend/scripts/migrations/__tests__/mcp-runtime-migration.test.ts`
- Create: `backend/migrations/0010_mcp_runtime_persistence.sql`
- Create: `backend/migrations/meta/0010_snapshot.json`
- Modify: `backend/migrations/meta/_journal.json`
- Modify: `backend/migrations/manifest.json`

**Interfaces:**

- Consumes: shared grant, snapshot, manifest, request, result, and prepared-reference schemas.
- Produces: `McpRuntimeRepository.createOrReadRunAuthority`, `getAuthority`, `prepareInvocation`, `claimAttempt`, `settleAttempt`, and `markAttemptAmbiguous`.

- [ ] **Step 1: Write failing repository state-machine tests**

  Cover these exact behaviors with the existing mocked-Drizzle test style:

  - the same `authorityKey` returns the existing immutable grant/snapshot/manifest;
  - an authority collision with non-identical JSON throws instead of mutating it;
  - preparing the same invocation ID and request hash returns the same attempt;
  - reusing an invocation ID with a different hash throws;
  - invocation and current-attempt status change atomically through `prepared -> dispatched -> completed|failed`;
  - `dispatched -> ambiguous` succeeds and cannot return to `prepared`;
  - a terminal duplicate returns the stored validated result;
  - a stale/non-current attempt cannot claim or settle an invocation;
  - a later attempt number is representable at the schema level even though this slice's repository API creates only attempt `1`.

- [ ] **Step 2: Run the repository test and observe RED**

  ```powershell
  bun test backend/src/mcp-runtime/__tests__/mcp-runtime.repository.spec.ts
  ```

  Expected: FAIL because the schema/repository do not exist.

- [ ] **Step 3: Add normalized durable tables**

  Define four tables in `mcp-runtime.ts`:

  ```text
  mcp_capability_grants
    id uuid primary key
    authority_key varchar(64) unique not null
    organization_id varchar(191) null
    subject_kind varchar(32) not null
    subject_id text not null
    grant jsonb not null
    created_at timestamptz not null

  mcp_capability_snapshots
    id uuid primary key
    capability_grant_id uuid unique references grants(id) on delete restrict
    config_fingerprint varchar(64) not null
    snapshot jsonb not null
    invocation_manifest jsonb not null
    created_at timestamptz not null

  mcp_invocations
    invocation_id uuid primary key
    run_id text not null
    organization_id varchar(191) null
    capability_grant_id uuid references grants(id) on delete restrict
    capability_snapshot_id uuid references snapshots(id) on delete restrict
    tool_name varchar(128) not null
    request_hash varchar(64) not null
    request jsonb not null
    status varchar(32) not null
    current_attempt_number integer not null default 1
    result jsonb null
    created_at/updated_at/terminal_at timestamptz

  mcp_invocation_attempts
    id uuid primary key
    invocation_id uuid references invocations(invocation_id) on delete restrict
    attempt_number integer not null
    source_id text not null
    destination varchar(32) not null
    retry_policy varchar(32) not null
    status varchar(32) not null
    prepared_at/dispatched_at/completed_at timestamptz null
    unique(invocation_id, attempt_number)
  ```

  Add indexes for `(run_id, created_at)`, `(organization_id, created_at)`, `(status, updated_at)`, and attempt status. Add database checks for lowercase 64-hex hashes, allowed statuses/destinations/retry policies, and positive attempt numbers. Use `onDelete: 'restrict'`; never cascade immutable authority or audit rows from mutable MCP configuration. The one-to-one grant/snapshot unique key is intentional: changed catalog/configuration creates a new grant rather than mutating or versioning a snapshot under existing authority.

- [ ] **Step 4: Implement parsed, compare-and-set repository methods**

  Export:

  ```ts
  export interface StoredMcpAuthority {
    grant: CapabilityGrant;
    snapshot: McpCapabilityCatalogSnapshot;
    manifest: InvocationManifest;
  }

  export type ClaimAttemptOutcome =
    | { kind: 'claimed' }
    | { kind: 'terminal'; result: ToolInvocationResult }
    | { kind: 'ambiguous'; result: ToolInvocationResult };

  export class McpRuntimeRepository {
    createOrReadRunAuthority(input: {
      authorityKey: string;
      grant: CapabilityGrant;
      snapshot: McpCapabilityCatalogSnapshot;
      manifest: InvocationManifest;
    }): Promise<StoredMcpAuthority>;

    getAuthority(input: {
      capabilityGrantId: string;
      capabilitySnapshotId: string;
      runId: string;
      organizationId: string | null;
    }): Promise<StoredMcpAuthority | null>;

    prepareInvocation(input: {
      request: ToolInvocationRequest;
      requestHash: string;
      entry: InvocationManifestEntry;
      manifest: InvocationManifest;
    }): Promise<PrepareToolInvocationOutcome>;

    claimAttempt(ref: PreparedInvocationRef): Promise<ClaimAttemptOutcome>;
    settleAttempt(input: {
      ref: PreparedInvocationRef;
      result: ToolInvocationResult;
    }): Promise<ToolInvocationResult>;
    markAttemptAmbiguous(input: {
      ref: PreparedInvocationRef;
      message: string;
      completedAt: string;
    }): Promise<ToolInvocationResult>;
  }
  ```

  Use database transactions and conditional `WHERE status = ...` updates for transitions. `mcp_invocations.status` is the authoritative query projection of its `current_attempt_number`; every claim/settlement updates the logical invocation and exact current attempt atomically to the same state with one transaction timestamp. `prepared` claims both rows as `dispatched`; a second claim of that exact dispatched attempt atomically records and returns `ambiguous`; a matching terminal replay returns the stored result; missing/wrong/stale references throw. Settlement requires the ref's attempt ID/number to equal the logical invocation's current attempt and CASes from `dispatched` only. Parse every JSONB read with the shared Zod schema and verify a terminal replay equals the stored result rather than accepting a conflicting duplicate. Compare immutable authority collisions through one canonical semantic projection: omit `createdAt`, substitute grant/snapshot IDs in nested scope/manifest references with fixed sentinels, sort object keys, and preserve array order. This lets concurrent identical materializations return the winner while a real SHA-256 key collision or semantic mismatch throws. Treat nullable organization IDs with explicit `IS NULL`/equality logic rather than truthiness.

- [ ] **Step 5: Generate and seal the checked migration**

  ```powershell
  bun --cwd=backend run migration:generate -- --name mcp_runtime_persistence
  bun --cwd=backend run migration:check
  ```

  Do not hand-author SQL, snapshots, journal entries, or checksum entries. Inspect the generator-produced `0010_mcp_runtime_persistence.sql`; confirm it creates only the four tables, required checks/indexes/constraints, and no destructive statements. Add a migration artifact test that asserts the tables, one-to-one grant/snapshot key, unique attempt key, restrictive foreign keys, status/hash checks, and checked-manifest entry. Recheck the generated sequence number immediately before staging in case another migration landed concurrently.

- [ ] **Step 6: Run focused verification GREEN**

  ```powershell
  bun test backend/src/mcp-runtime/__tests__/mcp-runtime.repository.spec.ts backend/scripts/migrations/__tests__/mcp-runtime-migration.test.ts
  bun --cwd=backend run typecheck
  git diff --check
  ```

- [ ] **Step 7: Commit persistence**

  ```powershell
  git add backend/src/database/schema/mcp-runtime.ts backend/src/database/schema/index.ts backend/src/mcp-runtime backend/scripts/migrations/__tests__/mcp-runtime-migration.test.ts backend/migrations/0010_mcp_runtime_persistence.sql backend/migrations/meta/0010_snapshot.json backend/migrations/meta/_journal.json backend/migrations/manifest.json
  git diff --cached --check
  git commit -s -m "feat: persist MCP authority and invocation attempts"
  ```

---

### Task 3: Materialize one immutable catalog per new-run token scope

**Files:**

- Create: `backend/src/mcp-runtime/mcp-run-catalog.service.ts`
- Create: `backend/src/mcp-runtime/mcp-run-authority.service.ts`
- Create: `backend/src/mcp-runtime/mcp-tool-name.ts`
- Create: `backend/src/mcp/mcp-legacy-outbound-compatibility.service.ts`
- Create: `backend/src/mcp/__tests__/mcp-legacy-outbound-compatibility.service.spec.ts`
- Create: `backend/src/mcp-runtime/__tests__/mcp-run-catalog.service.spec.ts`
- Create: `backend/src/mcp-runtime/__tests__/mcp-run-authority.service.spec.ts`
- Modify: `packages/shared/src/mcp-capabilities.ts`
- Modify: `packages/shared/src/__tests__/mcp-capabilities.test.ts`
- Modify: `backend/src/mcp/mcp-auth.service.ts`
- Modify: `backend/src/mcp/mcp-gateway.service.ts`
- Modify: `backend/src/mcp/__tests__/mcp-gateway.spec.ts`
- Modify: `backend/src/mcp/run-mcp-request-context.ts`
- Modify: `backend/src/mcp/dto/mcp.dto.ts`
- Modify: `backend/src/mcp/internal-mcp.controller.ts`
- Modify: `backend/src/mcp/mcp.module.ts`
- Modify: `backend/src/mcp/__tests__/mcp-auth.service.spec.ts`
- Modify: `backend/src/mcp/__tests__/run-mcp-request-context.spec.ts`
- Modify: `backend/src/mcp/__tests__/mcp-internal.integration.spec.ts`
- Modify: `worker/src/components/ai/utils.ts`
- Modify: `worker/src/components/ai/agent-tool-access.ts`
- Modify: `worker/src/components/ai/ai-agent.ts`
- Modify: `worker/src/components/ai/claude-code-agent.ts`
- Modify: `worker/src/components/ai/opencode.ts`
- Modify: focused tests beside those worker files

**Interfaces:**

- Consumes: `ToolRegistryService` registered tools/pre-discovered server tools, `McpServersRepository` cached tools, `McpRuntimeRepository`, and `TemporalService.queryWorkflow`.
- Produces: token metadata/context with optional `capabilitySnapshotId`; durable tokens always point to a stored immutable authority.

- [ ] **Step 1: Write failing catalog and token-mode tests**

  Cover:

  - component descriptors preserve canonical name/schema and use `sourceId = nodeId`;
  - external names remain `${sanitize(source.toolName)}__${sanitize(upstream.name)}` and preserve full MCP metadata/schema;
  - hierarchical allowed node IDs are applied before snapshot creation;
  - config fingerprints are deterministic across object key order and change for endpoint, component parameters, tool schema, or encrypted-credential-version hash changes without persisting any secret/ciphertext;
  - repeated and concurrent identical token requests reuse one semantic authority despite different candidate timestamps; changed catalog/config creates a new one;
  - protocol query `1` creates a durable token with `capabilitySnapshotId`;
  - `QueryNotRegisteredError` alone creates a legacy token without a snapshot; every other Temporal error is propagated;
  - request context parsing retains optional `invokingNodeId` and snapshot ID.

- [ ] **Step 2: Run focused tests and observe RED**

  ```powershell
  bun test backend/src/mcp-runtime/__tests__/mcp-run-catalog.service.spec.ts backend/src/mcp-runtime/__tests__/mcp-run-authority.service.spec.ts backend/src/mcp/__tests__/mcp-auth.service.spec.ts
  ```

- [ ] **Step 3: Extract the one named v1 compatibility adapter**

  Move the gateway's v1 imports/client maps, connection coalescing, per-run keying, request-header resolution, live endpoint discovery, call/retry behavior, generation-safe eviction/close, conversion, and cleanup into `McpLegacyOutboundCompatibilityService`:

  ```ts
  discoverTools(
    runId: string,
    source: RegisteredTool,
  ): Promise<McpToolRegistrationDescriptor[]>;

  callTool(
    runId: string,
    source: RegisteredTool,
    upstreamName: string,
    args: Record<string, unknown>,
  ): Promise<CallToolResult>;

  cleanupRun(runId: string): Promise<void>;
  ```

  Keep all v1 SDK types private. The adapter depends only on `ToolRegistryService`. Move pooling regression tests (concurrent connect, stale/late failure eviction, per-run cleanup, headers/call forwarding) into its dedicated spec. `McpGatewayService` delegates discovery/calls, and `InternalMcpController.cleanupRun` calls the adapter directly; do not retain a gateway cleanup wrapper with no other owner.

- [ ] **Step 4: Extract canonical catalog construction**

  `McpRunCatalogService.build(input)` examines ephemeral registry bindings but returns/persists descriptors plus their configuration fingerprint only:

  ```ts
  export interface BuiltRunCatalog {
    tools: ToolDescriptor[];
    configFingerprint: string;
  }

  build(input: {
    runId: string;
    allowedNodeIds: readonly string[];
  }): Promise<BuiltRunCatalog>;
  ```

  Use Redis pre-discovered server tools first and database cached tools for registered remote servers. Use the same explicitly transitional adapter for the existing live endpoint-discovery fallback when an allowed ready local source has no cached descriptor. Snapshot the discovery result once and never refresh that snapshot. Do not return/persist endpoint, credential, client, or runtime-binding objects.

  Move tool-name normalization/collision rules into pure `mcp-tool-name.ts` and use it from catalog plus the remaining legacy gateway path. Set run snapshot `sourceId = nodeId` and always preserve `nodeId`. Make shared MCP `serverId` optional because local/ephemeral MCP sources legitimately have no saved server row; never invent a fake server ID from the node ID.

  Fingerprint a canonical object containing normalized source/node IDs, component IDs, parameters, endpoints/server IDs/container references, complete public descriptors, and `sha256(encryptedCredentials)` when present. Never include the encrypted value itself in the canonical object, logs, snapshot, or tests.

- [ ] **Step 5: Create/reuse immutable run authority**

  `McpRunAuthorityService.materialize` first computes the semantic authority tuple and `authorityKey = sha256([contractVersion, scope subject/invoker without IDs/timestamps, sorted allowed nodes, configFingerprint])`. Derive stable UUID-shaped grant and snapshot IDs from distinct SHA-256 domain prefixes plus that key, build a strict run `ExecutionScope`, grant `all` access only to sources already filtered by allowed nodes, create the snapshot/manifest, and call `createOrReadRunAuthority`. The repository's semantic comparison ignores only candidate timestamps and normalized nested ID references, so concurrent identical callers return the winner while different authority content still conflicts:

  ```ts
  materialize(input: {
    runId: string;
    organizationId: string | null;
    invokingNodeId?: string;
    allowedNodeIds: readonly string[];
  }): Promise<StoredMcpAuthority>;
  ```

- [ ] **Step 6: Bind token generation to Workflow capability**

  Add `capabilitySnapshotId?: string` and `invokingNodeId?: string` to token metadata and request context. Before token creation:

  ```ts
  try {
    const version = await temporalService.queryWorkflow<number>({
      workflowId: runId,
      queryType: TOOL_INVOCATION_PROTOCOL_QUERY_NAME,
    });
    if (version !== TOOL_INVOCATION_PROTOCOL_VERSION) {
      throw new Error(`Unsupported tool invocation protocol version: ${version}`);
    }
    authority = await runAuthority.materialize(...);
  } catch (error) {
    if (!(error instanceof QueryNotRegisteredError)) throw error;
    // Existing pre-deployment Workflow only: issue the bounded legacy token.
  }
  ```

  Replace the backend runtime import of `uuid4` from `@temporalio/workflow` with `randomUUID` from `node:crypto`. Add `invokingNodeId` to `getGatewaySessionToken`/`prepareAgentGatewayAccess`, pass `context.componentRef` from all three real agent implementations, and keep callers that omit it compatible.

  Hashing the current registry ciphertext is deliberately a conservative credential-version surrogate: unchanged registration material reuses authority; re-registering even identical plaintext mints new authority because the runtime cannot prove version identity without decrypting. The runtime-manager plan replaces this with a saved credential reference/version.

- [ ] **Step 7: Register the acyclic provider graph and run focused verification GREEN**

  `McpRuntimeModule` continues to export only `McpRuntimeRepository`. Register the compatibility adapter, catalog, authority, auth, gateway, and later invocation services as `McpModule` providers. The dependency direction is adapter → registry, catalog → registry/repository-of-saved-tools/adapter, authority → catalog/runtime repository, auth → Temporal/authority; no `forwardRef` and no import back from runtime to MCP.

  ```powershell
  bun test packages/shared/src/__tests__/mcp-capabilities.test.ts backend/src/mcp/__tests__/mcp-legacy-outbound-compatibility.service.spec.ts backend/src/mcp-runtime/__tests__/mcp-run-catalog.service.spec.ts backend/src/mcp-runtime/__tests__/mcp-run-authority.service.spec.ts backend/src/mcp/__tests__/mcp-auth.service.spec.ts backend/src/mcp/__tests__/run-mcp-request-context.spec.ts backend/src/mcp/__tests__/mcp-internal.integration.spec.ts backend/src/mcp/__tests__/mcp-gateway.spec.ts worker/src/components/ai/__tests__/agent-tool-access.test.ts worker/src/components/ai/__tests__/ai-agent.test.ts
  bun --cwd=backend run typecheck
  bun --cwd=worker run typecheck
  git diff --check
  ```

- [ ] **Step 8: Commit immutable token authority**

  ```powershell
  git add packages/shared/src/mcp-capabilities.ts packages/shared/src/__tests__/mcp-capabilities.test.ts backend/src/mcp-runtime backend/src/mcp/mcp-legacy-outbound-compatibility.service.ts backend/src/mcp/mcp-auth.service.ts backend/src/mcp/mcp-gateway.service.ts backend/src/mcp/run-mcp-request-context.ts backend/src/mcp/dto/mcp.dto.ts backend/src/mcp/internal-mcp.controller.ts backend/src/mcp/mcp.module.ts backend/src/mcp/__tests__ worker/src/components/ai
  git diff --cached --check
  git commit -s -m "feat: bind MCP tokens to immutable run catalogs"
  ```

---

### Task 4: Add retry-safe preflight and one-attempt component dispatch APIs

**Files:**

- Create: `backend/src/mcp-runtime/mcp-invocation.service.ts`
- Create: `backend/src/mcp-runtime/__tests__/mcp-invocation.service.spec.ts`
- Modify: `backend/src/mcp/mcp.module.ts`
- Modify: `backend/src/mcp/dto/mcp.dto.ts`
- Modify: `backend/src/mcp/internal-mcp.controller.ts`
- Modify: `backend/src/mcp/__tests__/mcp-internal.integration.spec.ts`

**Interfaces:**

- Consumes: durable authority/repository, `ToolRegistryService`, `WorkflowRunRepository`, component registry/schema helpers.
- Produces internal service-token routes: `POST /internal/mcp/invocations/prepare`, `/claim`, `/complete`, `/fail`, and `/ambiguous`.

- [ ] **Step 1: Write failing service tests for authorization, dedupe, and ambiguity**

  Test that preflight rejects expired requests, run/org/grant/snapshot mismatches, unauthorized tool names, invalid snapshot-schema input, and non-component destinations. Test identical prepare replay, terminal replay, dispatched replay becoming ambiguous, and a claim response that contains resolved component credentials only in the returned dispatch context.

- [ ] **Step 2: Run the service test and observe RED**

  ```powershell
  bun test backend/src/mcp-runtime/__tests__/mcp-invocation.service.spec.ts
  ```

- [ ] **Step 3: Implement preflight with no external side effect**

  `prepare(request)` must:

  1. Parse and deadline-check the request.
  2. Load the exact authority by grant/snapshot/run/org.
  3. Re-run `assertCapabilityGrantApplies` and `resolveInvocationManifestEntry`.
  4. Validate input against the snapshot tool's complete JSON Schema using the official backend `fromJsonSchema(...).safeParse(...)` adapter.
  5. Canonically hash the request and call repository `prepareInvocation`.
  6. Return the prepared ref plus compact manifest, or the stored terminal result.

  This method must not decrypt credentials, connect to MCP, call a component, or write a `dispatched` state.

- [ ] **Step 4: Implement atomic claim and terminal settlement**

  `claimComponentDispatch(ref)` performs `prepared -> dispatched` before returning this internal-only shape:

  ```ts
  const context: ComponentInvocationDispatchContext = {
    ref,
    run: {
      runId: run.runId,
      workflowId: run.workflowId,
      workflowVersionId: run.workflowVersionId,
      organizationId: run.organizationId,
      scopeId: run.scopeId,
    },
    component: {
      nodeId: source.nodeId,
      componentId: source.componentId,
      arguments: inputArgs,
      parameters: mergedParams,
      ...(credentials ? { credentials } : {}),
    },
  };
  ```

  Load the source by the manifest-bound node ID, require the same component ID/tool identity as the immutable descriptor, split exposed parameters exactly as the current gateway does, and resolve credentials only here. Build the shared `ComponentInvocationDispatchContext` from the durable run row and registered source; the worker activity alone maps that structural contract to `RunComponentActivityInput`. Do not log or persist the context, and do not return it from any Temporal activity.

  `complete`, `fail`, and `ambiguous` parse a bounded terminal result and settle with compare-and-set semantics. A duplicate settlement returns the stored result. A conflicting settlement throws.

- [ ] **Step 5: Expose internal routes with strict DTO parsing**

  Add:

  ```text
  POST internal/mcp/invocations/prepare    { request }
  POST internal/mcp/invocations/claim      { ref }
  POST internal/mcp/invocations/complete   { ref, result }
  POST internal/mcp/invocations/fail       { ref, result }
  POST internal/mcp/invocations/ambiguous  { ref, message, completedAt }
  ```

  Reuse the existing internal service-token protection. Return no stack traces, token metadata, encrypted values, or resolved context from settlement routes.

- [ ] **Step 6: Run focused backend verification GREEN**

  ```powershell
  bun test backend/src/mcp-runtime/__tests__/mcp-invocation.service.spec.ts backend/src/mcp/__tests__/mcp-internal.integration.spec.ts
  bun --cwd=backend run typecheck
  bun --cwd=backend run build
  git diff --check
  ```

- [ ] **Step 7: Commit the backend invocation boundary**

  ```powershell
  git add backend/src/mcp-runtime backend/src/mcp/dto/mcp.dto.ts backend/src/mcp/internal-mcp.controller.ts backend/src/mcp/__tests__/mcp-internal.integration.spec.ts
  git diff --cached --check
  git commit -s -m "feat: add durable MCP invocation preflight"
  ```

---

### Task 5: Execute component calls through keyed Temporal Workflow Updates

**Files:**

- Create: `worker/src/temporal/updates.ts`
- Create: `worker/src/temporal/workflows/tool-invocation-update-handler.ts`
- Create: `worker/src/temporal/workflows/__tests__/tool-invocation-update-handler.test.ts`
- Create: `worker/src/temporal/activities/mcp-invocation.activity.ts`
- Create: `worker/src/temporal/activities/__tests__/mcp-invocation.activity.test.ts`
- Modify: `worker/src/temporal/workflows/index.ts`
- Modify: `worker/src/temporal/workers/dev.worker.ts`
- Modify: workflow mock tests that enumerate `@temporalio/workflow` exports
- Modify: `backend/src/temporal/temporal.service.ts`
- Modify: `backend/src/temporal/__tests__/temporal.service.spec.ts`

**Interfaces:**

- Consumes: internal preflight/claim/settlement routes and shared invocation contracts.
- Produces: `executeToolInvocation` Update, `getToolInvocationProtocolVersion` query, `TemporalService.executeWorkflowUpdate`, and handler draining before Workflow completion.

- [ ] **Step 1: Write failing Temporal client, handler, and activity tests**

  Cover:

  - `executeWorkflowUpdate` calls `handle.executeUpdate(TOOL_INVOCATION_UPDATE_NAME, { args: [request], updateId: request.invocationId })` and propagates errors without signaling;
  - validator rejects wrong run/org, invalid request, closed acceptance, or `currentUpdateInfo().id !== invocationId`;
  - terminal preflight replay returns without dispatch;
  - prepared component work dispatches once;
  - dispatch activity failure records `ambiguous`, never retries dispatch, and returns the stored ambiguous result;
  - activities never return the claim/credential context;
  - the protocol query returns `1` only behind the new patch path;
  - Workflow completion stops accepting Updates and waits for `allHandlersFinished` before finalization.

- [ ] **Step 2: Run focused tests and observe RED**

  ```powershell
  bun test backend/src/temporal/__tests__/temporal.service.spec.ts worker/src/temporal/workflows/__tests__/tool-invocation-update-handler.test.ts worker/src/temporal/activities/__tests__/mcp-invocation.activity.test.ts
  ```

- [ ] **Step 3: Add backend keyed Update execution**

  Export:

  ```ts
  async executeWorkflowUpdate<T>(input: {
    workflowId: string;
    runId?: string;
    updateName: string;
    updateId: string;
    args: unknown;
  }): Promise<T> {
    const handle = this.workflowClient.getHandle(input.workflowId, input.runId);
    return handle.executeUpdate<T>(input.updateName, {
      args: [input.args],
      updateId: input.updateId,
    });
  }
  ```

- [ ] **Step 4: Implement preflight and one-attempt dispatch activities**

  Use `buildBackendApiUrl` plus `X-Internal-Token` and shared Zod parsing. `prepareToolInvocationActivity` calls `/prepare`. `dispatchToolInvocationActivity` calls `/claim`, maps the shared dispatch context to `RunComponentActivityInput`, invokes `runComponentActivity(...)` directly inside the same Temporal activity, normalizes JSON output (`undefined` becomes `null`), then calls `/complete` or `/fail` and returns only `ToolInvocationResult`. If the component reports a normal failure, settle `remote-tool`; if the activity process/HTTP settlement becomes uncertain, let the activity fail so the Workflow records `ambiguous` through `markToolInvocationAmbiguousActivity`.

- [ ] **Step 5: Register the Update and safe completion drain**

  In `updates.ts`:

  ```ts
  export const executeToolInvocationUpdate = defineUpdate<
    ToolInvocationResult,
    [ToolInvocationRequest]
  >(TOOL_INVOCATION_UPDATE_NAME);
  ```

  In `sentrisWorkflowRun`, evaluate `patched('sentris-tool-invocation-update-v1')` once. For the patched path:

  - register `getToolInvocationProtocolVersion` returning `1`;
  - register the Update with a synchronous validator;
  - use retryable preflight/ambiguity proxies with `maximumAttempts: 3`;
  - use a separate dispatch proxy with `maximumAttempts: 1`, `startToCloseTimeout: '10 minutes'`, and heartbeat timeout `30 seconds`;
  - before terminal finalization set `acceptingToolInvocations = false`, then `await condition(allHandlersFinished)`.

  Keep the old signal/query handler only for the unpatched compatibility path. Remove the unused `toolCallCompleted` completion signal from the new path; do not add a fallback from Update to signal.

- [ ] **Step 6: Run focused worker/backend verification GREEN**

  ```powershell
  bun test backend/src/temporal/__tests__/temporal.service.spec.ts worker/src/temporal/workflows/__tests__/tool-invocation-update-handler.test.ts worker/src/temporal/activities/__tests__/mcp-invocation.activity.test.ts worker/src/temporal/workflows/__tests__/workflow-diagnostics.test.ts
  bun --cwd=backend run typecheck
  bun --cwd=worker run typecheck
  git diff --check
  ```

- [ ] **Step 7: Commit Workflow Update execution**

  ```powershell
  git add backend/src/temporal worker/src/temporal
  git diff --cached --check
  git commit -s -m "feat: execute MCP component tools with Workflow Updates"
  ```

---

### Task 6: Cut the durable gateway path over, verify live, and document the boundary

**Files:**

- Modify: `backend/src/mcp/mcp-gateway.service.ts`
- Modify: `backend/src/mcp/__tests__/mcp-gateway.spec.ts`
- Create: `e2e-tests/pipeline/durable-component-tool-invocation.test.ts`
- Modify: `docs/architecture/adr-stateless-mcp-runtime-and-temporal-agents.md`
- Modify: `docs/compatibility/mcp-clients.md`
- Modify: `AGENTS.md`

**Interfaces:**

- Consumes: snapshot-bound request context, stored authority, `TemporalService.executeWorkflowUpdate`.
- Produces: new runs list tools from their immutable snapshot and execute component tools through one keyed Update; legacy and external boundaries remain explicit.

- [ ] **Step 1: Write failing gateway cutover tests**

  Add tests that prove:

  - a context with `capabilitySnapshotId` advertises exactly the persisted snapshot even if Redis/DB catalog contents change afterward;
  - a component call generates a UUID, submits one `executeToolInvocation` Update with the exact scope/snapshot/tool/input/deadline, returns its result, and performs no signal or query polling;
  - a rejected/timed-out Update is surfaced and never triggers `executeToolCall`;
  - an external snapshot descriptor remains callable only through its immutable source mapping and current named v1 compatibility adapter;
  - a context without a snapshot takes the old live/signal path;
  - a snapshot/grant/run/org mismatch fails before registering any tool.

- [ ] **Step 2: Run the gateway test and observe RED**

  ```powershell
  bun test backend/src/mcp/__tests__/mcp-gateway.spec.ts
  ```

- [ ] **Step 3: Register durable catalogs and call keyed Updates**

  Split gateway registration into visibly named `registerSnapshotTools` and `registerLegacyLiveTools`. For a durable context, load authority through `McpRuntimeRepository.getAuthority`, register every descriptor with the official public `fromJsonSchema` API, resolve component/external runtime bindings by immutable `sourceId`, and never rebuild/refresh the advertised descriptor.

  For component callbacks:

  ```ts
  const now = new Date();
  const request = ToolInvocationRequestSchema.parse({
    invocationId: randomUUID(),
    scope: toRunExecutionScope(context),
    capabilitySnapshotId: context.capabilitySnapshotId,
    toolName: descriptor.canonicalName,
    input: args,
    requestedAt: now.toISOString(),
    deadlineAt: new Date(now.getTime() + 5 * 60_000).toISOString(),
  });
  const result = await temporalService.executeWorkflowUpdate<ToolInvocationResult>({
    workflowId: context.runId,
    updateName: TOOL_INVOCATION_UPDATE_NAME,
    updateId: request.invocationId,
    args: request,
  });
  ```

  Convert `completed` output to the existing MCP content shape and all other terminal statuses to `isError: true` without leaking internal stack traces.

- [ ] **Step 4: Add a no-secret, real component-tool E2E**

  Create a workflow with `security.osv.query` in tool mode connected to `mock.agent`, set `callTools: true` and `maxToolCalls: 1`, query known vulnerable `lodash@4.17.20`, and assert:

  - the run completes;
  - the mock agent discovers and calls the OSV component tool;
  - the result contains at least one OSV vulnerability identifier;
  - Postgres has one immutable grant/snapshot, one logical invocation, and attempt `1` in a terminal state for that run;
  - no legacy `executeToolCall` polling is observed in focused mocks/log assertions.

- [ ] **Step 5: Update status and migration documentation**

  Record that durable run grant/catalog materialization and component invocation Updates are implemented; existing pre-deployment workflows and tokens remain a bounded legacy path; external calls still use the v1 backend pool pending the runtime-manager plan. Add the exact deletion condition and explicitly list canonical outbound runtime ownership, external invocation attempts, resources/prompts runtime behavior, Continue-As-New, MCP Tasks, and workflow-granular agent turns as remaining.

- [ ] **Step 6: Run proportional automated verification**

  Confirm the intended instance before dev commands:

  ```powershell
  bun run instance show
  bun test packages/shared/src/__tests__/mcp-invocation.test.ts backend/src/mcp-runtime/__tests__ backend/src/mcp/__tests__/mcp-gateway.spec.ts backend/src/temporal/__tests__/temporal.service.spec.ts worker/src/temporal/workflows/__tests__/tool-invocation-update-handler.test.ts worker/src/temporal/activities/__tests__/mcp-invocation.activity.test.ts
  bun --cwd=packages/shared run typecheck
  bun --cwd=backend run typecheck
  bun --cwd=worker run typecheck
  bun --cwd=backend run build
  bun --cwd=backend run migration:check
  git diff --check
  ```

- [ ] **Step 7: Start instance `0` and run bounded live acceptance**

  ```powershell
  bun run dev
  node scripts/e2e-test.js e2e-tests/pipeline/durable-component-tool-invocation.test.ts
  ```

  Then submit the same `invocationId` twice with `WorkflowHandle.executeUpdate` against a disposable live test run and verify one attempt row plus the same terminal result. Check backend and worker health. Do not launch unrelated browser/manual suites for this backend-only slice.

- [ ] **Step 8: Commit the completed vertical slice**

  ```powershell
  git add backend/src/mcp/mcp-gateway.service.ts backend/src/mcp/__tests__/mcp-gateway.spec.ts e2e-tests/pipeline/durable-component-tool-invocation.test.ts docs/architecture/adr-stateless-mcp-runtime-and-temporal-agents.md docs/compatibility/mcp-clients.md AGENTS.md
  git diff --cached --check
  git commit -s -m "feat: make MCP component invocations durable"
  ```

---

### Task 7: Review the whole slice and prepare the runtime-manager sequel

**Files:**

- Create: `docs/superpowers/plans/2026-08-01-mcp-runtime-manager.md`
- Modify only if review finds a concrete defect: files changed by Tasks 1-6

**Interfaces:**

- Consumes: the completed durable invocation slice and the accepted ADR.
- Produces: a reviewed branch state and an executable next plan for the canonical outbound v2 client plus worker-owned runtime leases.

- [ ] **Step 1: Run one broad architecture/code review over the Task 1 base through current HEAD**

  Review authority immutability, JSONB parsing, nullable tenant scope, CAS transitions, replay determinism, Update-handler draining, credential/history boundaries, no post-Update signal fallback, and compatibility deletion conditions. Fix Critical/Important findings through one reviewed fix wave; record genuinely minor deferred findings.

- [ ] **Step 2: Write the separate runtime-manager plan**

  The plan must replace, rather than wrap indefinitely:

  - the backend gateway v1 outbound client pool;
  - backend onboarding and worker discovery client duplication;
  - host stdio and Docker handwritten bridges/local maps;
  - generic worker-address routing;
  - wrong-worker cleanup;
  - resolved-secret endpoint registration;
  - tools-only discovery that drops resources, templates, and prompts.

  It must define one official-v2 `McpClientAdapter`, one worker-side `McpRuntimeManager`, direct owner address plus owner epoch/generation fencing, acquire/discover/invoke/renew/release/health, in-process owner fast path, reconciliation, full-Compose two-worker acceptance, and the 10% p50/p95 latency budget. It must not add a mandatory managed service for normal local hosting.

- [ ] **Step 3: Verify final repository state and commit the sequel plan**

  ```powershell
  git status --short
  git log --oneline --decorate -8
  git diff --check
  git add docs/superpowers/plans/2026-08-01-mcp-runtime-manager.md
  git commit -s -m "docs: plan canonical MCP runtime ownership"
  ```

  Expected: clean `main`, ahead of `origin/main`, with no push performed.
