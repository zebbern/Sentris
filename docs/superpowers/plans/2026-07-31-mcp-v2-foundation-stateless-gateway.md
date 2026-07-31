# MCP v2 Foundation and Stateless Run Gateway Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish SDK-independent MCP capability and invocation contracts, then replace the run gateway's process-local MCP sessions with one official MCP SDK v2 request-local facade that serves modern `2026-07-28` and supported legacy-stateless clients.

**Architecture:** `@sentris/shared` owns protocol-independent execution scope, grant, capability, and compact invocation-manifest contracts. The backend owns a reusable `McpFacadeService` around the official v2 `createMcpHandler`/`toNodeHandler` entry. The run route authenticates once, resolves an immutable token-bound run scope, creates a fresh server for each request, and registers tools through public JSON Schema APIs. Existing v1 outbound clients and Studio's legacy session path remain explicitly isolated until the runtime-manager and durable-agent plans replace them.

**Tech Stack:** TypeScript, Zod 4, Bun, NestJS 10, Express 5, official MCP TypeScript SDK v2, transitional MCP SDK v1 client, Redis run tool registry, Temporal client, Nginx.

## Global Constraints

- Work directly on `main`, as explicitly requested by the user. Do not create a branch or worktree and do not push until the user asks.
- Use DCO conventional commits after independently shippable tasks.
- Preserve unrelated user edits. `.cursor/hooks/state/` and `.playwright-mcp/` are intentionally ignored; `backend/.env.docker` documentation is intentionally tracked.
- Recheck official package metadata and MCP v2 documentation immediately before changing dependencies. Record the date and exact tested versions in the compatibility matrix.
- The official v2 SDK owns inbound wire behavior. Do not copy JSON-RPC methods, era negotiation, Streamable HTTP parsing, or compatibility logic into Sentris.
- Modern run-gateway requests must not depend on `Mcp-Session-Id`, affinity cookies, backend-local transports, or cached `McpServer` instances.
- Keep Studio's current session registry and sticky route in this slice. It will migrate through the same facade in the durable Studio/Tasks plan.
- Keep the v1 outbound MCP client in a visibly named compatibility adapter inside the gateway service for this slice. The worker runtime-manager plan replaces it; do not widen its ownership.
- `ToolRegistryService` remains a migration input containing ephemeral run wiring. It must not become the durable capability catalog or the only future source of capability grants/snapshots.
- Establish shared resource, resource-template, and prompt descriptors now, but do not claim runtime support until a later catalog/runtime slice actually discovers and serves them.
- A run token receives a unique immutable `capabilityGrantId` when generated. This first slice binds it to the token's run, organization, and allowed nodes for the token lifetime; append-only durable grants and snapshots are a dependent persistence task, not simulated in Redis under a misleading name.
- Remove the unused caller-controlled `x-allowed-tools` header from the run gateway. Exact tool selection is already materialized by registered nodes/tool exclusions before token generation; the gateway must not acquire a second authorization input.
- Preserve broad trusted-local capability. Do not add blanket egress, stdio, Docker, scanner, or tool restrictions in this slice.
- Use TDD for behavior changes: add a focused failing test, observe the intended failure, implement the smallest complete change, then run it green.
- Verification is proportional: focused shared/backend tests, shared/backend typechecks, backend build, `git diff --check`, one live run-gateway compatibility smoke, and a bounded request-local registration benchmark. Do not run unrelated full security or E2E suites.
- Request-local registration must stay within 10% of the recorded local list/call baseline or receive a documented exception with the measured absolute latency. If caching is needed, cache SDK-independent descriptors by run/grant/config fingerprint; never restore cached server or transport objects.

---

### Task 1: Pin the explicit MCP v1/v2 dependency and compatibility boundary

**Files:**

- Modify: `backend/package.json`
- Modify: `package.json`
- Modify: `worker/package.json`
- Modify: `docker/mcp-stdio-proxy/package.json`
- Modify: `bun.lock`
- Create: `docs/compatibility/mcp-clients.md`

**Interfaces:**

- Runtime inbound: `@modelcontextprotocol/server@^2.0.0`, `@modelcontextprotocol/node@^2.0.0`.
- Transitional runtime outbound/Studio: direct `@modelcontextprotocol/sdk@^1.30.0` dependency.
- Backend test client: `@modelcontextprotocol/client@^2.0.0` dev dependency.
- AI SDK 6 compatibility client: `@ai-sdk/mcp@^1.0.66`, the latest `1.x` line compatible with the repository's AI SDK 6 stack; do not install the AI SDK 7-oriented `2.x` line in this slice.
- Compatibility matrix owner: `docs/compatibility/mcp-clients.md`.

- [ ] **Step 1: Re-verify current official releases and runtime requirements**

  Check official package metadata and the official v2 migration/protocol-version documentation. Confirm Node `22.16.0` and Bun `1.3.10` satisfy the selected packages. Record the verification date, exact resolved versions, official URLs, supported eras, and removal condition for every temporary v1 surface in `docs/compatibility/mcp-clients.md`.

- [ ] **Step 2: Add dependencies to the package that imports them**

  Update `backend/package.json` so production imports do not depend on workspace-root hoisting:

  ```json
  {
    "dependencies": {
      "@modelcontextprotocol/node": "^2.0.0",
      "@modelcontextprotocol/sdk": "^1.30.0",
      "@modelcontextprotocol/server": "^2.0.0"
    },
    "devDependencies": {
      "@ai-sdk/mcp": "^1.0.66",
      "@modelcontextprotocol/client": "^2.0.0"
    }
  }
  ```

  Update the root and worker `@ai-sdk/mcp` declarations to `^1.0.66`. Update retained root, worker, backend, and Docker stdio-proxy v1 SDK declarations to `^1.30.0`. Run `bun install` to update `bun.lock`. Do not move the worker/Studio outbound implementation to v2 in this slice.

- [ ] **Step 3: Add a versioned supported-client matrix**

  Include these rows and acceptance gates:

  | Client                                     | Era/mode                                                   | Required acceptance                              | Removal condition                                                 |
  | ------------------------------------------ | ---------------------------------------------------------- | ------------------------------------------------ | ----------------------------------------------------------------- |
  | Official `@modelcontextprotocol/client` v2 | `versionNegotiation: { mode: 'auto' }`                     | `server/discover`, list, call, no session/cookie | Permanent canonical client                                        |
  | Existing `@ai-sdk/mcp`                     | legacy initialization through SDK v2 `legacy: 'stateless'` | list and call through same URL                   | Re-evaluate when AI SDK MCP supports modern era                   |
  | Backend outbound proxy client              | v1                                                         | discovery/call parity through explicit adapter   | Remove in runtime-manager/client-adapter plan                     |
  | Studio inbound route                       | v1 sessionful                                              | existing Studio tests remain green               | Remove when Studio uses shared facade and durable task projection |

  State that a separate legacy-session adapter is forbidden unless the AI SDK compatibility test proves stateless fallback insufficient; if introduced, it requires the two-release deletion/renewal rule from the ADR.

- [ ] **Step 4: Verify package resolution**

  ```powershell
  bun pm ls @modelcontextprotocol/server @modelcontextprotocol/node @modelcontextprotocol/client @modelcontextprotocol/sdk
  bun --cwd=backend run typecheck
  ```

  Expected: all four packages resolve from the backend workspace; pre-migration backend typecheck remains green.

- [ ] **Step 5: Commit the dependency boundary**

  ```powershell
  git add package.json backend/package.json worker/package.json docker/mcp-stdio-proxy/package.json bun.lock docs/compatibility/mcp-clients.md
  git diff --cached --check
  git commit -s -m "build: add explicit MCP v2 gateway dependencies"
  ```

---

### Task 2: Add canonical capability and compact invocation contracts

**Files:**

- Create: `packages/shared/src/mcp-capabilities.ts`
- Create: `packages/shared/src/mcp-invocation.ts`
- Create: `packages/shared/src/__tests__/mcp-capabilities.test.ts`
- Create: `packages/shared/src/__tests__/mcp-invocation.test.ts`
- Modify: `packages/shared/src/index.ts`
- Modify: `packages/component-sdk/src/tool-helpers.ts`
- Modify: `packages/component-sdk/src/types.ts`
- Modify: `packages/component-sdk/package.json`
- Modify: `packages/component-sdk/src/__tests__/tool-helpers.test.ts`

**Interfaces:**

- Produces SDK-independent `ExecutionScope`, `CapabilityGrant`, `ToolDescriptor`, resource/prompt descriptors, `McpCapabilityCatalogSnapshot`, `InvocationManifest`, and pure grant/manifest policy.
- Consumed later by gateway catalog adapters, append-only persistence, Temporal workflows, Studio, discovery, and the worker runtime manager.

- [ ] **Step 1: Write failing scope, grant, and lossless-schema tests**

  Cover all three strict scope variants, malformed UUID/date rejection, cross-kind fields, organization/subject/expiry binding, duplicate source rejection, and lossless round-trip of `$schema`, `$defs`, `$ref`, composition keywords, `_meta`, annotations, and `x-*` extensions.

  ```powershell
  bun test packages/shared/src/__tests__/mcp-capabilities.test.ts
  ```

  Expected RED: the new module does not exist.

- [ ] **Step 2: Implement strict capability contracts**

  Define:

  ```ts
  export const MCP_CAPABILITY_CONTRACT_VERSION = '1' as const;

  export const ExecutionScopeSchema = z.discriminatedUnion('kind', [
    z
      .object({
        kind: z.literal('run'),
        organizationId: z.string().min(1).nullable(),
        runId: z.string().min(1),
        capabilityGrantId: z.string().uuid(),
        invokingNodeId: z.string().min(1).optional(),
      })
      .strict(),
    z
      .object({
        kind: z.literal('studio'),
        organizationId: z.string().min(1).nullable(),
        operationId: z.string().uuid(),
        capabilityGrantId: z.string().uuid(),
        expiresAt: z.string().datetime(),
      })
      .strict(),
    z
      .object({
        kind: z.literal('discovery'),
        organizationId: z.string().min(1).nullable(),
        operationId: z.string().uuid(),
        capabilityGrantId: z.string().uuid(),
        expiresAt: z.string().datetime(),
      })
      .strict(),
  ]);

  export const CapabilityToolAccessSchema = z.discriminatedUnion('mode', [
    z.object({ mode: z.literal('all') }).strict(),
    z
      .object({
        mode: z.literal('subset'),
        names: z.array(z.string().min(1)).min(1),
      })
      .strict(),
  ]);

  export const CapabilityGrantSchema = z
    .object({
      id: z.string().uuid(),
      organizationId: z.string().min(1).nullable(),
      subject: z.discriminatedUnion('kind', [
        z.object({ kind: z.literal('run'), runId: z.string().min(1) }).strict(),
        z
          .object({
            kind: z.literal('studio'),
            operationId: z.string().uuid(),
            expiresAt: z.string().datetime(),
          })
          .strict(),
        z
          .object({
            kind: z.literal('discovery'),
            operationId: z.string().uuid(),
            expiresAt: z.string().datetime(),
          })
          .strict(),
      ]),
      sources: z.array(
        z
          .object({
            sourceId: z.string().min(1),
            toolAccess: CapabilityToolAccessSchema,
          })
          .strict(),
      ),
      createdAt: z.string().datetime(),
    })
    .strict();

  export const JsonSchemaDocumentSchema = z.record(z.string(), z.unknown());
  ```

  Use nullable organization scope deliberately because self-hosted local runs already represent the single local tenant as `null`; do not invent a fake organization row or make local execution second-class.

  Define the remaining exact descriptor shapes:

  ```ts
  export const McpIconSchema = z
    .object({
      src: z.string().min(1),
      mimeType: z.string().min(1).optional(),
      sizes: z.array(z.string().min(1)).optional(),
      theme: z.enum(['light', 'dark']).optional(),
    })
    .strict();

  export const ComponentToolSourceSchema = z
    .object({
      kind: z.literal('component'),
      sourceId: z.string().min(1),
      nodeId: z.string().min(1),
      componentId: z.string().min(1),
    })
    .strict();

  export const McpToolSourceSchema = z
    .object({
      kind: z.literal('mcp'),
      sourceId: z.string().min(1),
      serverId: z.string().min(1),
      nodeId: z.string().min(1).optional(),
      upstreamName: z.string().min(1),
    })
    .strict();

  export const ToolDescriptorSchema = z
    .object({
      canonicalName: z.string().min(1).max(128),
      displayName: z.string().min(1),
      description: z.string().optional(),
      inputSchema: JsonSchemaDocumentSchema,
      outputSchema: JsonSchemaDocumentSchema.optional(),
      source: z.discriminatedUnion('kind', [ComponentToolSourceSchema, McpToolSourceSchema]),
      title: z.string().optional(),
      icons: z.array(McpIconSchema).optional(),
      annotations: z.record(z.string(), z.unknown()).optional(),
      meta: z.record(z.string(), z.unknown()).optional(),
      effects: z.enum(['read-only', 'idempotent', 'mutating', 'unknown']),
      effectsSource: z.enum(['sentris-contract', 'operator-policy', 'mcp-annotation', 'unknown']),
      retryPolicy: z.enum(['pre-dispatch-only', 'reviewed-idempotent']),
    })
    .strict();

  const CapabilityMetadataSchema = z
    .object({
      sourceId: z.string().min(1),
      title: z.string().optional(),
      description: z.string().optional(),
      icons: z.array(McpIconSchema).optional(),
      annotations: z.record(z.string(), z.unknown()).optional(),
      meta: z.record(z.string(), z.unknown()).optional(),
    })
    .strict();

  export const ResourceDescriptorSchema = CapabilityMetadataSchema.extend({
    uri: z.string().min(1),
    name: z.string().min(1),
    mimeType: z.string().optional(),
    size: z.number().int().nonnegative().optional(),
  }).strict();

  export const ResourceTemplateDescriptorSchema = CapabilityMetadataSchema.extend({
    uriTemplate: z.string().min(1),
    name: z.string().min(1),
    mimeType: z.string().optional(),
  }).strict();

  export const PromptDescriptorSchema = CapabilityMetadataSchema.extend({
    name: z.string().min(1),
    arguments: z.array(
      z
        .object({
          name: z.string().min(1),
          description: z.string().optional(),
          required: z.boolean().optional(),
        })
        .strict(),
    ),
  }).strict();

  export const McpCapabilityCatalogSnapshotSchema = z
    .object({
      id: z.string().uuid(),
      scope: ExecutionScopeSchema,
      version: z.literal(MCP_CAPABILITY_CONTRACT_VERSION),
      configFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
      tools: z.array(ToolDescriptorSchema),
      resources: z.array(ResourceDescriptorSchema),
      resourceTemplates: z.array(ResourceTemplateDescriptorSchema),
      prompts: z.array(PromptDescriptorSchema),
      createdAt: z.string().datetime(),
    })
    .strict();
  ```

  Empty capability arrays remain valid; runtime support for resources/prompts is not claimed by this slice.

- [ ] **Step 3: Write failing pure invocation-policy tests**

  Cover deterministic sorting, component/MCP destination mapping, omission of heavy catalog fields, duplicate canonical-name rejection, source/subset authorization, grant/snapshot mismatch, and retry policy provenance.

  ```powershell
  bun test packages/shared/src/__tests__/mcp-invocation.test.ts
  ```

  Expected RED: pure policy functions do not exist.

- [ ] **Step 4: Implement the compact manifest policy**

  Export:

  ```ts
  export const InvocationManifestEntrySchema = z
    .object({
      toolName: z.string().min(1),
      sourceId: z.string().min(1),
      destination: z.enum(['component-activity', 'mcp-activity']),
      retryPolicy: z.enum(['pre-dispatch-only', 'reviewed-idempotent']),
    })
    .strict();

  export const InvocationManifestSchema = z
    .object({
      capabilitySnapshotId: z.string().uuid(),
      capabilityGrantId: z.string().uuid(),
      version: z.literal(MCP_CAPABILITY_CONTRACT_VERSION),
      entries: z.array(InvocationManifestEntrySchema),
    })
    .strict();

  export function assertCapabilityGrantApplies(scope: ExecutionScope, grant: CapabilityGrant): void;

  export function buildInvocationManifest(
    snapshot: McpCapabilityCatalogSnapshot,
    grant: CapabilityGrant,
  ): InvocationManifest;

  export function resolveInvocationManifestEntry(
    manifest: InvocationManifest,
    input: {
      scope: ExecutionScope;
      capabilitySnapshotId: string;
      toolName: string;
    },
  ): InvocationManifestEntry;
  ```

  Only `sentris-contract` and `operator-policy` may retain `reviewed-idempotent`; downgrade MCP-annotation/unknown provenance to `pre-dispatch-only`. Keep schemas, descriptions, endpoints, and credentials out of the manifest.

- [ ] **Step 5: Export and verify the contracts**

  Replace the component SDK's `Tool['inputSchema']`, `AnySchema`, and `ZodRawShapeCompat` imports with the shared `JsonSchemaDocument` plus Zod 4 `ZodType`/`ZodRawShape` types. Type `ComponentToolProvider.inputSchema` as `JsonSchemaDocument` instead of `any`, remove the now-unused v1 SDK dev dependency from `packages/component-sdk/package.json`, and keep all existing `getToolInputShape`/`getToolSchema` behavior covered by its focused tests.

  ```powershell
  bun test packages/shared/src/__tests__/mcp-capabilities.test.ts packages/shared/src/__tests__/mcp-invocation.test.ts
  bun test packages/component-sdk/src/__tests__/tool-helpers.test.ts
  bun --cwd=packages/shared run typecheck
  bun --cwd=packages/component-sdk run typecheck
  git diff --check
  ```

- [ ] **Step 6: Commit the contract foundation**

  ```powershell
  git add packages/shared/src/mcp-capabilities.ts packages/shared/src/mcp-invocation.ts packages/shared/src/__tests__/mcp-capabilities.test.ts packages/shared/src/__tests__/mcp-invocation.test.ts packages/shared/src/index.ts packages/component-sdk/src/tool-helpers.ts packages/component-sdk/src/types.ts packages/component-sdk/package.json packages/component-sdk/src/__tests__/tool-helpers.test.ts bun.lock
  git diff --cached --check
  git commit -s -m "feat: add canonical MCP capability contracts"
  ```

---

### Task 3: Bind run authentication to an immutable request scope

**Files:**

- Create: `backend/src/mcp/run-mcp-request-context.ts`
- Create: `backend/src/mcp/run-mcp-scope-resolver.service.ts`
- Create: `backend/src/mcp/__tests__/run-mcp-request-context.spec.ts`
- Create: `backend/src/mcp/__tests__/run-mcp-scope-resolver.spec.ts`
- Modify: `backend/src/mcp/mcp-auth.service.ts`
- Modify: `backend/src/mcp/mcp-auth.guard.ts`
- Modify: `backend/src/mcp/__tests__/mcp-auth.service.spec.ts`

**Interfaces:**

- Produces token-bound `RunMcpRequestContext` and shared `ExecutionScope` for the official handler factory.
- Preserves the old token Redis key/TTL format and derives a new grant ID for legacy records that predate this deployment.

- [ ] **Step 1: Write failing context and authorization tests**

  Assert:

  - new token metadata contains a UUID `capabilityGrantId` generated once and returned unchanged by every validation;
  - node IDs are normalized once (trimmed, empty removed, unique, sorted) before storage;
  - old unexpired token records without a grant ID receive a deterministic UUID derived from immutable token/run/org/node metadata, not a new value per request;
  - null organization is preserved for legitimate local runs, while a non-null run organization must match;
  - missing run, wrong organization, or malformed token context fails before server creation;
  - `x-allowed-tools` is ignored/removed as a scope input.

  ```powershell
  bun test backend/src/mcp/__tests__/mcp-auth.service.spec.ts backend/src/mcp/__tests__/run-mcp-request-context.spec.ts backend/src/mcp/__tests__/run-mcp-scope-resolver.spec.ts
  ```

- [ ] **Step 2: Implement SDK-independent run context parsing**

  ```ts
  export interface RunMcpRequestContext {
    kind: 'run';
    runId: string;
    organizationId: string | null;
    capabilityGrantId: string;
    allowedNodeIds: readonly string[];
  }

  export function parseRunMcpRequestContext(extra: unknown): RunMcpRequestContext;
  export function toRunExecutionScope(context: RunMcpRequestContext): ExecutionScope;
  ```

  Do not import SDK types in this file. Freeze/copy the normalized node list so downstream code cannot widen it.

- [ ] **Step 3: Generate and recover stable grant IDs**

  Extend `McpSessionMetadata` with `capabilityGrantId?: string`. New tokens store `uuid4()` once. For old records, derive a UUID-shaped identifier from SHA-256 over a versioned canonical JSON tuple containing token, run ID, organization ID, agent ID, and sorted node IDs; set RFC 4122 version/variant bits. Do not rewrite the Redis record during read.

  Change `McpAuthService.validateToken()` to return the v2 `AuthInfo` type from `@modelcontextprotocol/server` and include `capabilityGrantId` in `extra`.

- [ ] **Step 4: Resolve run authorization before protocol dispatch**

  `RunMcpScopeResolver.resolve(authInfo)` must parse the token context, query `WorkflowRunRepository.findByRunId`, throw `NotFoundException` for a missing run, throw `ForbiddenException` for organization mismatch, and return the frozen context. The gateway service must consume only this result, never tool arguments or request headers for tenancy/tool scope.

- [ ] **Step 5: Verify and commit the auth boundary**

  ```powershell
  bun test backend/src/mcp/__tests__/mcp-auth.service.spec.ts backend/src/mcp/__tests__/run-mcp-request-context.spec.ts backend/src/mcp/__tests__/run-mcp-scope-resolver.spec.ts
  bun --cwd=backend run typecheck
  git diff --check
  git add backend/src/mcp/run-mcp-request-context.ts backend/src/mcp/run-mcp-scope-resolver.service.ts backend/src/mcp/__tests__/run-mcp-request-context.spec.ts backend/src/mcp/__tests__/run-mcp-scope-resolver.spec.ts backend/src/mcp/mcp-auth.service.ts backend/src/mcp/mcp-auth.guard.ts backend/src/mcp/__tests__/mcp-auth.service.spec.ts
  git commit -s -m "feat: bind MCP tokens to immutable run scopes"
  ```

---

### Task 4: Introduce the reusable official-v2 facade

**Files:**

- Create: `backend/src/mcp/mcp-facade.service.ts`
- Create: `backend/src/mcp/__tests__/mcp-facade.service.spec.ts`
- Modify: `backend/src/mcp/mcp.module.ts`

**Interfaces:**

- Produces one reusable inbound wire owner for the run route now and Studio later.

- [ ] **Step 1: Write failing in-process facade protocol tests**

  Use `createMcpHandler` through a fetch-backed official v2 `StreamableHTTPClientTransport` to prove the server factory receives `era`, `authInfo`, and `requestInfo`; modern auto negotiation reaches `server/discover`; legacy-stateless list/call works; GET/DELETE return 405; malformed content type returns 415; and `close()` tears down modern in-flight exchanges.

  ```powershell
  bun test backend/src/mcp/__tests__/mcp-facade.service.spec.ts
  ```

- [ ] **Step 2: Implement the facade endpoint**

  ```ts
  export interface McpFacadeServerProvider {
    createServer(context: McpRequestContext): Promise<McpServer>;
  }

  export interface McpFacadeEndpoint {
    handle(
      req: NodeIncomingMessageLike,
      res: NodeServerResponseLike,
      parsedBody?: unknown,
    ): Promise<void>;
    close(): Promise<void>;
  }

  @Injectable()
  export class McpFacadeService implements OnModuleDestroy {
    createEndpoint(provider: McpFacadeServerProvider): McpFacadeEndpoint;
    onModuleDestroy(): Promise<void>;
  }
  ```

  Each endpoint constructs exactly one:

  ```ts
  const handler = createMcpHandler((context) => provider.createServer(context), {
    legacy: 'stateless',
    responseMode: 'auto',
    onerror,
  });
  const nodeHandler = toNodeHandler(handler, { onerror });
  ```

  `handle` passes the already parsed Express body as the third argument. The facade owns protocol setup/error logging only; no run, organization, tool, or Studio logic belongs here.

- [ ] **Step 3: Register and verify the facade**

  Add `McpFacadeService` to `McpModule.providers` and exports. Keep `SessionRegistryService`, its Redis provider, and `McpSessionsController` for Studio.

  ```powershell
  bun test backend/src/mcp/__tests__/mcp-facade.service.spec.ts
  bun --cwd=backend run typecheck
  git diff --check
  ```

- [ ] **Step 4: Commit the facade**

  ```powershell
  git add backend/src/mcp/mcp-facade.service.ts backend/src/mcp/__tests__/mcp-facade.service.spec.ts backend/src/mcp/mcp.module.ts
  git commit -s -m "feat: add shared stateless MCP facade"
  ```

---

### Task 5: Make the run server request-local and schema-correct

**Files:**

- Modify: `backend/src/mcp/mcp-gateway.service.ts`
- Modify: `backend/src/mcp/__tests__/mcp-gateway.spec.ts`
- Delete: `backend/src/mcp/__tests__/mcp-external-tools.integration.spec.ts`

**Interfaces:**

- Replaces cached `getServerForRun(...)` with `createServerForRun(context)`.
- Keeps outbound v1 discovery/call behavior behind an explicitly named compatibility boundary until the runtime-manager plan.

- [ ] **Step 1: Replace private-internal tests with failing public-protocol tests**

  Drive each server through an official handler/client rather than `_requestHandlers` or `_registeredTools`. Cover component advertisement/call, raw external JSON Schema preservation, hierarchical node filtering, tool-name filtering already materialized in the registry, deterministic duplicate-name rejection, v1 outbound call/header forwarding, and per-run cleanup.

  ```powershell
  bun test backend/src/mcp/__tests__/mcp-gateway.spec.ts
  ```

- [ ] **Step 2: Remove inbound server/session state**

  Replace:

  ```ts
  getServerForRun(
    runId: string,
    organizationId?: string | null,
    allowedTools?: string[],
    allowedNodeIds?: string[],
  ): Promise<LegacyMcpServer>
  ```

  with:

  ```ts
  createServerForRun(context: RunMcpRequestContext): Promise<McpServer>
  ```

  Remove `servers`, cross-request `registeredToolNames`, `externalToolSchemas`, cache-key builders/parsers, `patchListToolsWithExternalSchemas`, `refreshServersForRun`, `cleanupSession`, and external-client owner maps. Use a request-local `Set<string>` and fail on canonical-name collision instead of silently skipping one tool.

- [ ] **Step 3: Register schemas through public v2 APIs**

  Import `McpServer` and `fromJsonSchema` from `@modelcontextprotocol/server`. The default Node validator supports JSON Schema 2020-12; use `fromJsonSchema(document)` and register external input/output schemas without a private list-handler patch. Only add a custom validator from `@modelcontextprotocol/server/validators/ajv` if focused dialect/bounds tests prove the runtime default is insufficient; do not add `@modelcontextprotocol/core` merely for `fromJsonSchema`.

  Preserve `description`, title, icons, annotations, `_meta`, `$schema`, `$defs`, `$ref`, composition keywords, and extensions that exist in the source descriptor. Convert v1 outbound results structurally at the single handler return boundary so v1 types never leak into v2 server signatures.

- [ ] **Step 4: Isolate transitional outbound client ownership**

  Alias v1 imports (`LegacyMcpClient`, `LegacyStreamableHttpClientTransport`, `LegacyCallToolResult`). Retain a pool keyed only by `runId + endpoint`; remove inbound session/cache-key ownership. `cleanupRun(runId)` closes only that run's clients. If two request-local factories can race client creation, add a per-key pending connection promise and clear it on success/failure.

- [ ] **Step 5: Delete obsolete private-schema coverage and verify**

  Remove `mcp-external-tools.integration.spec.ts`; its behavior must now be covered through public list/call responses in `mcp-gateway.spec.ts`.

  ```powershell
  bun test backend/src/mcp/__tests__/mcp-gateway.spec.ts backend/src/mcp/__tests__/mcp-internal.integration.spec.ts
  bun --cwd=backend run typecheck
  git diff --check
  ```

- [ ] **Step 6: Commit the request-local server factory**

  ```powershell
  git add backend/src/mcp/mcp-gateway.service.ts backend/src/mcp/__tests__/mcp-gateway.spec.ts backend/src/mcp/__tests__/mcp-external-tools.integration.spec.ts
  git commit -s -m "refactor: make MCP run servers request local"
  ```

---

### Task 6: Replace the run controller and remove run-route stickiness

**Files:**

- Modify: `backend/src/mcp/mcp-gateway.controller.ts`
- Modify: `backend/src/mcp/internal-mcp.controller.ts`
- Modify: `backend/src/mcp/mcp.module.ts`
- Modify: `backend/src/mcp/__tests__/mcp-gateway.controller.spec.ts`
- Modify: `backend/src/mcp/__tests__/mcp-internal.integration.spec.ts`
- Modify: `backend/src/main.ts`
- Modify: `docker/nginx/nginx.dev.conf`
- Modify: `docker/nginx/nginx.prod.conf`

**Interfaces:**

- `/api/v1/mcp/gateway` becomes stateless/dual-era on ordinary backend routing.
- `/api/v1/studio-mcp/*` remains on the legacy sticky upstream until its migration.

- [ ] **Step 1: Write failing dual-era HTTP lifecycle tests**

  Through an ephemeral Express server, assert:

  - official v2 client with `versionNegotiation: { mode: 'auto' }` discovers, lists, and calls;
  - existing `@ai-sdk/mcp` lists and calls through the same URL via legacy-stateless fallback;
  - neither path receives `Mcp-Session-Id` or `Set-Cookie`;
  - GET and DELETE return 405 without affecting later POSTs;
  - missing/mismatched run scope is rejected before factory dispatch;
  - creating a fresh controller/facade against the same registry simulates a backend restart and modern requests still work.

  ```powershell
  bun test backend/src/mcp/__tests__/mcp-gateway.controller.spec.ts
  ```

- [ ] **Step 2: Rewrite the controller as a thin facade mount**

  Remove transport/pending maps, `randomUUID`, legacy initialize detection, session registry, affinity-cookie writes, GET/SSE lifecycle code, and DELETE session cleanup. Constructor creates one endpoint:

  ```ts
  this.endpoint = facade.createEndpoint({
    createServer: async ({ authInfo }) => {
      const context = await scopeResolver.resolve(authInfo);
      return gateway.createServerForRun(context);
    },
  });
  ```

  `handleGateway(req, res)` delegates `endpoint.handle(req, res, req.body)`. Keep `@Public()` and `McpAuthGuard`; the Node adapter forwards verified `req.auth` as `authInfo`.

- [ ] **Step 3: Remove cache refresh and close outbound pools during run cleanup**

  In `InternalMcpController`, remove `refreshServersForRun()` from both registration endpoints. In cleanup, run `toolRegistry.cleanupRun(runId)` and `mcpGatewayService.cleanupRun(runId)` and preserve the existing `{ containerIds }` response.

- [ ] **Step 4: Route only the run gateway through the ordinary backend upstream**

  In both Nginx files, change `/api/v1/mcp/` to `proxy_pass http://backend/api/v1/mcp/` while retaining no-buffering and long call timeouts. Rename comments so `backend_mcp` is explicitly the legacy Studio-only sticky upstream. Do not remove that upstream yet.

  In development Nginx and `backend/src/main.ts`, allow/expose the required modern headers:

  ```text
  MCP-Protocol-Version
  Mcp-Method
  Mcp-Name
  ```

  Preserve the existing origin allowlist/credential policy. Do not add an overly restrictive hard-coded Host allowlist that breaks custom local hostnames; deployment-configured shared Host/Origin validation belongs in a later facade-hardening task.

- [ ] **Step 5: Verify dual-era controller and internal cleanup**

  ```powershell
  bun test backend/src/mcp/__tests__/mcp-gateway.controller.spec.ts backend/src/mcp/__tests__/mcp-internal.integration.spec.ts backend/src/mcp/__tests__/mcp-auth.service.spec.ts
  bun --cwd=backend run typecheck
  bun --cwd=backend run build
  git diff --check
  ```

- [ ] **Step 6: Commit the stateless route**

  ```powershell
  git add backend/src/mcp/mcp-gateway.controller.ts backend/src/mcp/internal-mcp.controller.ts backend/src/mcp/mcp.module.ts backend/src/mcp/__tests__/mcp-gateway.controller.spec.ts backend/src/mcp/__tests__/mcp-internal.integration.spec.ts backend/src/main.ts docker/nginx/nginx.dev.conf docker/nginx/nginx.prod.conf
  git commit -s -m "feat: serve the MCP run gateway statelessly"
  ```

---

### Task 7: Document migration state and run bounded acceptance verification

**Files:**

- Modify: `AGENTS.md`
- Modify: `docs/architecture.mdx`
- Modify: `docs/architecture/adr-stateless-mcp-runtime-and-temporal-agents.md`
- Modify: `docs/compatibility/mcp-clients.md`
- Modify only if a task-owned defect is found during verification.

**Interfaces:**

- Records exactly what is canonical, transitional, and still pending after this slice.

- [ ] **Step 1: Update architecture status without overstating completion**

  Record:

  - run gateway: official v2 request-local facade, modern + legacy-stateless;
  - Studio: legacy sessionful/sticky, migration pending;
  - inbound run sessions/cookies/cache: removed;
  - outbound gateway client: explicit v1 compatibility pool, runtime-manager migration pending;
  - catalog contracts: canonical and SDK-independent;
  - durable grants/snapshots, resources/prompts runtime, invocation persistence, Workflow Updates, runtime leases, Tasks, and workflow-granular agents: pending dependent plans.

- [ ] **Step 2: Run focused automated checks**

  ```powershell
  bun test packages/shared/src/__tests__/mcp-capabilities.test.ts packages/shared/src/__tests__/mcp-invocation.test.ts
  bun test backend/src/mcp/__tests__/mcp-auth.service.spec.ts backend/src/mcp/__tests__/run-mcp-request-context.spec.ts backend/src/mcp/__tests__/run-mcp-scope-resolver.spec.ts backend/src/mcp/__tests__/mcp-facade.service.spec.ts backend/src/mcp/__tests__/mcp-gateway.spec.ts backend/src/mcp/__tests__/mcp-gateway.controller.spec.ts backend/src/mcp/__tests__/mcp-internal.integration.spec.ts backend/src/mcp/__tests__/mcp-sessions.controller.spec.ts backend/src/mcp/__tests__/session-registry.service.spec.ts
  bun --cwd=packages/shared run typecheck
  bun --cwd=backend run typecheck
  bun --cwd=backend run build
  git diff --check
  ```

- [ ] **Step 3: Check the intended local instance before live verification**

  ```powershell
  bun run instance show
  bun run dev status
  ```

  This task targets the already active instance selected by the user/workspace. Do not silently switch instances. If it is not running, start only that instance with `bun run dev`.

- [ ] **Step 4: Run one live compatibility smoke**

  Generate a real bounded run token through the existing internal flow, then use:

  - official v2 client in auto mode to discover/list/call;
  - current agent/AI SDK MCP client to list/call the same registered harmless test tool;
  - two direct requests without affinity cookie to confirm no session header/cookie dependency;
  - a backend restart between modern list and call only if the harmless tool/run fixture survives restart.

  Verify backend logs contain no transport-map/session lookup failures and the run gateway does not appear in `/api/v1/mcp/sessions`. Do not use Studio's session presence as a failure; it remains legacy by design.

- [ ] **Step 5: Record a bounded performance comparison**

  Measure at least 20 warm authenticated `tools/list` requests and 20 harmless calls before/after request-local registration where a baseline is available. Record median and p95 absolute latency in `docs/compatibility/mcp-clients.md`. If the relative regression exceeds 10%, document the absolute cost and either optimize catalog construction or add SDK-independent descriptor caching keyed by `runId + capabilityGrantId + configFingerprint`; do not cache SDK servers/transports.

- [ ] **Step 6: Commit documentation/verification evidence**

  ```powershell
  git add AGENTS.md docs/architecture.mdx docs/architecture/adr-stateless-mcp-runtime-and-temporal-agents.md docs/compatibility/mcp-clients.md
  git diff --cached --check
  git commit -s -m "docs: record stateless MCP gateway migration"
  ```

---

## Dependent plans after this slice

1. **Durable MCP grants, snapshots, and invocation persistence:** append-only Postgres grants/catalog snapshots, compact manifest persistence, keyed Workflow Updates, preflight/dispatch attempt taxonomy, and removal of signal-plus-poll component calls.
2. **Worker MCP runtime manager and canonical outbound client:** official v2 auto-negotiating client, runtime leases/fencing/owner routing, one stdio/Docker implementation, OAuth/credential references, resources/prompts discovery, and two-worker Compose acceptance.
3. **Durable Studio, Tasks, and workflow-granular agents:** migrate Studio to `McpFacade`, remove its session/task polling state, map task tools/extensions to Sentris runs, move model/tool turns into Temporal workflow granularity, and evaluate the official Temporal AI SDK integration behind `AgentRuntime`.

Each dependent plan must recheck official MCP, Temporal, and AI SDK releases immediately before implementation. Do not carry package/API assumptions from this plan forward unchanged.
