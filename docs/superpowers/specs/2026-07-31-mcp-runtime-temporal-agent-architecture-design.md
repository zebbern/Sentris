# Stateless MCP Runtime and Durable Temporal Agents

## Goal

Replace Sentris Flow's duplicated, process-local MCP ownership with one long-term
architecture that supports the MCP `2026-07-28` protocol, preserves older client
compatibility during migration, works in local PM2 and full Docker Compose deployments,
and lets AI agents use MCP tools without making Sentris the limit of their capabilities.

The target is:

```text
MCP clients and Sentris agents
              |
              v
  stateless dual-era MCP facade
              |
              v
  canonical catalog + invocation service
              |
              v
       MCP runtime manager
       |                 |
       v                 v
remote HTTP MCP   leased stdio/Docker MCP

Temporal orchestrates agent turns and runtime lifecycle.
Postgres stores durable configuration and run/catalog state.
Redis stores ephemeral routing, lease, and cache metadata.
```

Success means:

- modern MCP clients use `2026-07-28` without transport sessions, affinity cookies, or
  backend-local transport maps;
- supported legacy clients continue to list and call tools through a contained
  compatibility boundary while migration telemetry is collected;
- gateway, Studio, discovery, onboarding, MCP groups, and AI agents share one protocol
  client and one tool invocation contract;
- MCP resources, resource templates, and prompts remain discoverable through the shared
  capability boundary instead of being discarded by a tool-only proxy;
- stdio and Docker MCP servers work in PM2 and full Compose and have one identifiable
  runtime owner;
- worker or backend restarts do not lose durable run/task state or cause an already
  successful agent tool call to be repeated by retrying the whole agent loop;
- Sentris uses Temporal for durable orchestration and maintained AI/model abstractions,
  without storing sockets or child-process handles in Temporal;
- local self-hosting retains remote, stdio, Docker, scanner, filesystem, and agent
  capability under the existing trust-profile model;
- obsolete session registries, sticky routing, handwritten protocol bridges, duplicate
  discovery paths, and in-memory MCP task polling are deleted after their migration
  criteria are met.

## Why this design is required now

MCP `2026-07-28` removes the `initialize` / `initialized` handshake and
`Mcp-Session-Id` from modern core HTTP. Each request carries its protocol and capability
context, `server/discover` is the discovery entry point, and the official TypeScript SDK
v2 can serve modern and legacy stateless clients from one server factory.

Sentris currently depends on the earlier session model in two inbound controllers,
Nginx affinity, a Redis session registry, worker-local transport maps, and two
handwritten stdio-to-HTTP bridges. Extending those implementations would preserve the
wrong ownership model and make the eventual migration larger.

The current Studio MCP task path also creates an in-memory SDK task, starts an already
durable Temporal workflow, and polls that workflow from the backend. That makes the
backend a second, non-durable scheduler. The new Tasks extension is not wire-compatible
with that experimental task API, so the durable Sentris run must become the task source
of truth.

The AI agent currently executes its complete model/tool loop inside one Temporal
activity. If activity cleanup or completion reporting fails after a successful tool
call, Temporal may retry the full loop and duplicate external side effects. Agent
orchestration needs to live at workflow granularity, while model requests and tool calls
remain activities with separate timeout and retry policies.

## Verified dependency baseline

The following was checked against package metadata, official repositories, release
notes, and the repository lockfile on 2026-07-31. It must be rechecked immediately
before dependency changes rather than treated as permanently current.

| Surface                      | Repository state                                                   | Current upstream finding                                                                                      | Architectural consequence                                                                                   |
| ---------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| MCP protocol                 | SDK v1, protocol through the 2025 family                           | MCP `2026-07-28` is final                                                                                     | Session-oriented code is a migration source, not the target.                                                |
| Official MCP TypeScript SDK  | `@modelcontextprotocol/sdk` `1.27.1` resolved (`^1.26.0` declared) | Split v2 packages are `2.0.0`                                                                                 | Use v2 server/client/core/node packages as the wire owner; keep v1 only at a proven compatibility boundary. |
| Vercel MCP adapter           | `@ai-sdk/mcp` `1.0.18` resolved                                    | The `2.0.x` line still implements initialize-era MCP                                                          | Do not make it the protocol owner; convert official-client tools through a thin AI SDK adapter.             |
| AI SDK                       | `ai` `6.x`, provider packages `3.x`                                | Temporal AI integration expects AI SDK `7.x` / provider `4.x`                                                 | Treat the agent upgrade as an aligned compatibility slice, not an incidental MCP package bump.              |
| Temporal TypeScript SDK      | `1.14.1` packages                                                  | `1.21.1` publishes the official experimental AI SDK integration                                               | Reuse the provider/workflow integration behind `AgentRuntime` after replay and provider acceptance.         |
| Temporal MCP helper          | Not installed                                                      | `TemporalMCPClient` delegates to `@ai-sdk/mcp` and recreates a client in activities                           | Use Sentris's official-v2 invocation activity instead of adopting this helper unchanged.                    |
| MCP Tasks TypeScript runtime | Old experimental v1 task APIs in use                               | New Tasks extension is specified, but no separately published official TypeScript extension runtime was found | Build the durable run mapping now and recheck maintained SDK support before Phase 6.                        |

The current local Node `22.16.0` meets MCP v2 and Temporal AI SDK minimums. Container
and CI Node versions still require explicit verification during the dependency slice.

## Product and architectural principles

1. **Capability first, with explicit trust profiles.** Broad local capability remains a
   supported product feature. Hardened deployments may apply stricter policy, but the
   protocol and runtime architecture must not globally disable useful MCP transports or
   tools.
2. **One canonical behavior boundary.** Protocol negotiation, discovery, schema
   conversion, invocation policy, timeout, cancellation, and cleanup each have one
   owning implementation. Transport-specific execution remains in narrow adapters.
3. **Durable state and live resources are different.** Temporal/Postgres own durable
   lifecycle and results; a runtime process owns sockets, subprocesses, and containers.
4. **Compatibility is a migration boundary, not a permanent fork.** Legacy behavior is
   isolated, observable, and has a deletion condition.
5. **Use maintained upstreams behind stable Sentris contracts.** The official MCP SDK,
   Temporal, and Vercel AI SDK provide protocol, durability, and model abstractions.
   Sentris owns the product-facing contracts that insulate the rest of the codebase from
   their version changes.
6. **Retry only at a boundary that understands side effects.** A transport timeout does
   not prove a tool was not executed.
7. **Keep local deployment understandable.** The first target adds a runtime module and
   internal API to the existing worker deployment, not a mandatory new managed service.

## Non-goals

- Reimplementing MCP, Temporal, an LLM provider SDK, LangChain, LangGraph, Nmap, OSV, or
  other maintained upstream capabilities.
- Turning MCP into a second workflow engine or task scheduler.
- Making live sockets, subprocess objects, or Docker handles durable.
- Requiring Kubernetes, Temporal Cloud, or another managed service for local use.
- Adding every optional MCP extension before a Sentris use case needs it.
- Preserving indefinite compatibility with every historical MCP client.
- Using security hardening as a reason to remove core local product capability.

## Target component boundaries

### 1. `McpFacade`: inbound protocol adapter

`McpFacade` is the canonical and default inbound MCP wire implementation. The run
gateway and Studio provide different authentication, catalog, and tool factories, but
both use the same facade. The only permitted exception is a quarantined, time-bounded
v1 route proven necessary by compatibility tests.

For each modern request the facade:

1. authenticates the caller and resolves an immutable `ExecutionScope`;
2. creates a fresh official SDK v2 server instance;
3. registers capabilities from a versioned `McpCapabilityCatalogSnapshot` using public
   SDK schema APIs;
4. delegates calls to the scope-aware `ToolInvocationCoordinator`;
5. returns the SDK-produced response without retaining protocol transport state.

The official handler is mounted behind the existing Nest authentication,
authorization, tenant resolution, and deployment-appropriate Host/Origin policy; the
handler does not supply those controls by itself. Verified immutable caller scope is
passed through the Node adapter as MCP auth context so request-local factories and
capability handlers never re-select organization scope from tool arguments.

The server supports `server/discover`, per-request protocol metadata, standard MCP
headers, dialect-preserving JSON Schema (2020-12 when no dialect is declared),
structured results, cache hints, and multi-round-trip input results as the selected SDK
exposes them.

The v2 handler's legacy-stateless mode is the default compatibility path. A separate v1
session route is added only if conformance testing proves a supported client requires
it. If required, `McpCompatibilityAdapter` in the backend MCP module owns it. It remains
isolated from the modern facade, emits usage telemetry, and receives no new features.
It ships for at most two normal releases: migration notice ships in the first and the
remove-or-explicitly-renew decision occurs no later than the second. Renewal requires an
ADR update and explicit product approval rather than telemetry alone.

### 2. `McpCapabilityCatalogService`: canonical MCP capabilities

All MCP-producing paths publish the same SDK-independent, extensible catalog. Tools are
the first migration surface, but resources, resource templates, and prompts remain
first-class so Sentris does not permanently reduce an MCP server to tool calls.

```typescript
type ExecutionScope =
  | {
      kind: 'run';
      organizationId: string;
      runId: string;
      capabilityGrantId: string;
      invokingNodeId?: string;
    }
  | {
      kind: 'studio';
      organizationId: string;
      operationId: string;
      capabilityGrantId: string;
      expiresAt: string;
    }
  | {
      kind: 'discovery';
      organizationId: string;
      operationId: string;
      capabilityGrantId: string;
      expiresAt: string;
    };

interface ToolDescriptor {
  canonicalName: string;
  displayName: string;
  description?: string;
  inputSchema: JsonSchemaDocument;
  outputSchema?: JsonSchemaDocument;
  source: ComponentToolSource | McpToolSource;
  title?: string;
  icons?: McpIcon[];
  annotations?: Record<string, unknown>;
  meta?: Record<string, unknown>;
  effects: 'read-only' | 'idempotent' | 'mutating' | 'unknown';
  effectsSource: 'sentris-contract' | 'operator-policy' | 'mcp-annotation' | 'unknown';
  retryPolicy: 'pre-dispatch-only' | 'reviewed-idempotent';
}

interface McpCapabilityCatalogSnapshot {
  id: string;
  scope: ExecutionScope;
  version: string;
  configFingerprint: string;
  tools: ToolDescriptor[];
  resources: ResourceDescriptor[];
  resourceTemplates: ResourceTemplateDescriptor[];
  prompts: PromptDescriptor[];
  createdAt: string;
}
```

`JsonSchemaDocument` preserves the upstream `$schema` dialect rather than coercing every
schema to 2020-12. A missing dialect follows MCP's default. Public SDK
`fromJsonSchema`/AJV APIs validate and register schemas with explicit depth, size,
`$ref`, and composition bounds. Titles, icons, annotations, `_meta`, and schema
extensions such as `x-mcp-header` survive proxying.

Saved MCP configuration remains durable in Postgres. Run-scoped and bounded
operation-scoped capability snapshots are durable and versioned so an agent does not see
its tool names or schemas change halfway through a turn. Redis may cache snapshots, but
is not their only recovery source. Studio and discovery scopes always carry a unique
operation ID and expiry rather than inventing a run ID.

`capabilityGrantId` identifies an immutable authorization grant containing the allowed
server/component/source IDs and any tool subset for that caller. `invokingNodeId` is
context, not the allow-list. Capability lookup, snapshots, planning, and invocation all
require the same grant ID, preventing a caller from widening access by choosing another
node or capability version.

Three caches have different semantics and are not conflated:

1. The protocol-era `PriorDiscovery` verdict is host-managed and keyed by normalized
   endpoint/command configuration. It records the observed server identity/version and
   is re-probed on configuration change or the host's freshness horizon. It does not
   inherit `ttlMs` or `cacheScope`.
2. Cacheable MCP list/read responses honor upstream `ttlMs` and `cacheScope`. No hint
   means no reusable cache; private results are partitioned by authorization context,
   and the SDK's maximum lifetime is respected.
3. A durable capability snapshot is not a cache. It intentionally remains immutable for
   its run/operation until an explicit refresh boundary, even if the source response's
   freshness expires.

All cache keys include the exact normalized configuration fingerprint and required
caller/auth scope. Editing a server configuration invalidates the prior fingerprint
instead of silently reusing its capabilities.

Tool names are normalized and collision-checked once when the catalog is constructed.
No global mutable schema map or private SDK member access is permitted. The agent
adapter exposes tools natively and provides bounded list/read/get adapters for MCP
resources and prompts instead of silently dropping those surfaces or injecting an
unbounded resource catalog into every model turn.

MCP effect annotations are untrusted hints. They may help an operator review a policy,
but cannot by themselves authorize redispatch. Even a read-only call may be expensive
or rate limited. Only a Sentris-owned contract or explicit operator-reviewed policy may
set `reviewed-idempotent`; every other tool remains `pre-dispatch-only`.

### 3. Invocation policy, coordination, and execution activities

Every component and external MCP call crosses one invocation boundary:

```typescript
interface ToolInvocationRequest {
  invocationId: string;
  scope: ExecutionScope;
  capabilitySnapshotId: string;
  toolName: string;
  input: BoundedJsonValue | PayloadRef;
  deadlineAt: string;
}

interface InvocationManifestEntry {
  toolName: string;
  sourceId: string;
  destination: 'component-activity' | 'mcp-activity';
  retryPolicy: 'pre-dispatch-only' | 'reviewed-idempotent';
}

interface InvocationManifest {
  capabilitySnapshotId: string;
  capabilityGrantId: string;
  version: string;
  entries: InvocationManifestEntry[];
}
```

`ToolInvocationPolicy` is a pure shared planner and error taxonomy, not a god service.
It uses a compact, versioned `InvocationManifest` carried in Workflow state to verify
the immutable grant, resolve destination, and compute retry policy. Full schemas,
descriptions, and capability bodies stay outside Workflow history. Callers cannot choose
their own destination or retry safety.

A retry-safe `prepareToolInvocation` activity loads the full capability snapshot,
rechecks the grant, performs exact schema/input validation, resolves the lease and
credential references, and writes the durable prepared-attempt record. It has no
external tool side effect. The subsequent typed dispatch activity consumes that prepared
reference and is the only step allowed to call the component or MCP server.
Ingress externalizes oversized tool arguments before a Workflow Update, so the request
history carries a bounded value or payload reference rather than an unbounded object.

Execution follows one implementable call graph:

- an agent Workflow plans from the compact manifest, schedules retry-safe preflight, and
  then schedules a typed component or MCP dispatch activity;
- the backend facade submits a keyed Workflow Update for run-scoped calls and awaits its
  result; the Workflow Update handler schedules the typed activity, replacing the
  current signal-plus-poll loop;
- Studio/discovery scopes start or address a bounded operation Workflow, which schedules
  the same typed activities;
- activities execute side effects through narrow `ComponentInvoker` or `McpInvoker`
  adapters and never attempt to schedule sibling activities.

Temporal is authoritative for active orchestration. Postgres stores saved
configuration, immutable capability snapshots, invocation-attempt audit/projection
rows, results, and artifacts; it is not a second active scheduler. Each invocation ID
is unique in the durable projection and moves through planned, dispatched, completed,
failed, or ambiguous states.

The shared result taxonomy distinguishes:

- validation or authorization failure;
- failure before dispatch;
- remote tool error;
- cancellation;
- deadline before dispatch;
- ambiguous deadline after dispatch;
- runtime owner loss.

Exactly-once execution cannot be guaranteed for an external tool unless that tool
offers a usable idempotency contract. For mutating, unknown, or unreviewed tools, the
dispatch-capable Temporal activity is configured with `maximumAttempts: 1`. Retryable
acquire, validation, and preflight work occurs in separate activities or returns a
definite pre-dispatch result so the Workflow may schedule a fresh attempt. An activity
timeout or worker loss after dispatch remains ambiguous and requires user/agent policy
rather than automatic redispatch. Only an explicitly reviewed idempotent contract may
opt into automatic dispatch retries. The invocation ID is propagated where an upstream
supports idempotency or request correlation, but Sentris does not assume that every MCP
server deduplicates it.

### 4. `McpClientAdapter`: one outbound protocol client

The adapter uses the official MCP v2 client for discovery and invocation.

- Remote Streamable HTTP uses `versionNegotiation: { mode: 'auto' }`, with a bounded
  and cacheable discovery verdict.
- A managed stdio lease uses the official SDK's auto negotiation by default. The SDK
  may launch one disposable sibling probe before starting the one persistent leased
  child. Sentris caches the resulting `PriorDiscovery` verdict by normalized
  configuration, records the observed server identity/version, and permits an explicit
  modern or legacy pin for spawn-sensitive servers.
- An explicitly configured spawn-per-invocation CLI mode follows the SDK warning: it
  defaults to legacy and exposes auto/pin as configuration, avoiding an extra probe
  process and full probe timeout on every call.
- Sentris-authored modern stdio servers use the official v2 `serveStdio` entry point;
  direct `McpServer.connect(StdioServerTransport)` remains a legacy-era server path.
- HTTP+SSE is represented only by an explicit legacy transport adapter while supported;
  the canonical transport types are `streamable-http` and `stdio`.
- Abort and Temporal cancellation propagate to the actual request or transport cleanup;
  a `Promise.race` timeout without abort is not considered cancellation.
- OAuth/token handling and transport headers are centralized here.
- Tool results and JSON Schema conversion use public SDK APIs.

Modern requests are stateless on the wire, but an SDK `Client` can still hold a
negotiated era, authorization provider, response cache, and subscriptions. The default
is one client per lease/principal. Any measured pool is keyed by normalized
configuration, organization, principal/authorization context, and protocol verdict;
tokens and private cached responses never cross those partitions.

The backend owns OAuth authorization, encrypted refresh persistence, and saved secret
references. Runtime leases contain credential references and versions, not resolved
secret values. A scoped worker credential provider resolves/refreshes only what the
selected server needs and attaches it to the client without passing backend or worker
ambient credentials into the MCP server.

The AI SDK receives tools through one thin `ToolDescriptor` to AI SDK `ToolSet` adapter.
`@ai-sdk/mcp` is not the system's wire-protocol owner.

### 5. `McpRuntimeManager`: live resource owner

The runtime manager is a worker execution-plane module with an authenticated internal
API. It owns:

- host stdio child processes allowed by the active trust profile;
- Docker/DIND-backed MCP server containers;
- transport objects and persistent clients when a legacy server requires them;
- health checks and local cleanup for those resources.

Its stable contract supports acquire, discover, invoke, renew, release, and health.
Agent activities in the owning worker can use the same interface in-process; backend or
other-worker callers use the owner-addressed internal API.

Persistent resources use an application lease, not an MCP protocol session:

```typescript
interface RuntimeLease {
  leaseId: string;
  scope: ExecutionScope;
  serverId: string;
  configFingerprint: string;
  ownerId: string;
  ownerEpoch: string;
  ownerAddress: string;
  generation: number;
  protocolEra: 'modern' | 'legacy';
  capabilityFingerprint: string;
  state: 'starting' | 'ready' | 'unhealthy' | 'releasing';
  expiresAt: string;
}
```

Acquire uses `(scope kind, organizationId, runId/operationId, capabilityGrantId,
serverId, configFingerprint)` as an idempotency key; mutable expiry is excluded. It
reserves a `starting` generation before spawning and tags every child/container with
`leaseId` plus generation. A crash between spawn and readiness can briefly leave an
extra resource, so the actual guarantee is that only one fenced generation becomes
routable; owner-local tracking and reconciliation detect and reap non-routable probes,
children, and containers.

`ownerAddress` is an instance-unique address directly routable from the backend and peer
workers; it is never a generic load-balanced worker alias. A runtime publishes its
address only after its listener is ready. `ownerId` plus a random startup `ownerEpoch`
distinguishes process restarts. Every invoke, renew, release, and readiness transition
checks lease ID, owner epoch, and generation—not only acquire.

The owner renews a fenced heartbeat and self-fences when renewal is lost: after the
local safety deadline it refuses new calls, marks in-flight outcomes ambiguous, and
enters drain/cleanup. Rolling shutdown marks the owner draining before it stops
accepting leases. Redis holds routing and expiry metadata; the owner alone holds OS
resources. Saved server configuration remains in Postgres so a dead owner can be
replaced between calls when restart policy permits.

Runtime leases are correctness-critical coordination, not optional cache state. This is
an explicit exception to the graceful in-memory fallback described for non-critical
caches and idempotent locks in `adr-redis-state-externalization.md`: if Redis cannot
confirm acquisition, mutation, generation, or owner routing, Sentris fails that
operation visibly instead of guessing from a process-local map. An already routed call
may finish on its known owner.

This module initially ships inside the existing worker image/process to keep local
hosting simple. The contract forbids callers from depending on in-process details, so
operational evidence can later justify deploying it as a standalone service without
changing the catalog, invocation, or Temporal design.

### 6. Temporal agent and runtime workflows

Temporal owns durable sequencing:

```text
load saved config
  -> acquire/verify runtime leases
  -> discover and persist capability snapshot
  -> run model turn activity
  -> run zero or more selected tool activities
  -> record ordered results and continue agent loop
  -> release leases on terminal completion
```

The agent loop runs in a deterministic Workflow. The preferred implementation uses
Temporal's official AI SDK provider integration so the existing Vercel provider
abstraction is preserved while network calls execute as activities. Tool executions use
Sentris's planned component/MCP activities rather than Temporal's experimental
`TemporalMCPClient`, which currently delegates to the legacy Vercel MCP client.

The Temporal/AI SDK upgrade is isolated behind an `AgentRuntime` boundary. Before the
old agent is removed, an implementation spike must prove Workflow replay, streaming,
cancellation, bounded history, multiple tool calls, provider errors, and current
Gemini/Anthropic/OpenAI behavior. Adoption is conditional: if the experimental package
cannot meet those contracts, `AgentRuntime` uses a thin Temporal Workflow over ordinary
activities that call the maintained Vercel AI SDK providers. It does not implement
model protocols or add a second agent framework. If an upstream experimental API
changes, only the adapter changes; workflow templates and MCP contracts do not.

There is no global two-hour timeout for all workflows. Agent, scanner, interactive, and
ordinary workflows receive explicit timeout policies. Human input blocks on a Temporal
signal and does not hold an activity open. Upstream Temporal AI cancellation is not
assumed: the merge gate requires a wrapper that injects the activity cancellation signal
into provider/MCP `AbortSignal`, provides periodic heartbeats for long or idle calls,
and proves non-streaming plus idle-stream cancellation.

### 7. `AgentStateStore`: bounded Temporal history

Temporal history contains active orchestration state, compact model/tool outcomes,
stable references, and hashes—not unbounded conversations, source bundles, scanner
output, tool output, or artifact bodies. Full content is stored under organization/run
scope in Postgres or MinIO. Activities load referenced content, persist new large
content, and return bounded model-safe summaries plus references required by later
turns.

Capability snapshots are deduplicated by configuration fingerprint. Inline model/tool
content has a configurable default ceiling of 256 KiB per returned item; larger content
is externalized. The Workflow checks Temporal's continue-as-new recommendation and an
application turn/event threshold, carrying only the compact state needed to resume
under the same public Sentris run ID. The Phase 5 spike sets measured thresholds for the
deployed Temporal version and proves that long-running agents cannot approach history
or payload limits silently.

Continue-As-New never abandons a Workflow Update. Before rollover the Workflow marks
itself draining, rejects new invocation Updates with a retryable rollover response, and
waits for all accepted Update handlers to finish. The next run receives the compact
invocation manifest plus a bounded ledger of recent invocation IDs/result references.
The backend addresses the stable Workflow ID and retries the same `invocationId` after
rollover. A unique durable invocation-attempt record deduplicates across Temporal run
IDs: completed calls return their stored result, prepared calls may resume safely, and
dispatched-without-result calls remain ambiguous rather than being redispatched.

### 8. MCP Tasks as a projection of Sentris runs

Sentris does not create a second MCP task store. A durable task handle contains or maps
to the existing public Sentris run ID and Temporal workflow ID.

The product-domain operations are defined now:

- start: validate and start the Temporal workflow once;
- get: read the durable run projection or query the Workflow;
- update/input: send a typed Temporal signal;
- cancel: request cooperative Temporal cancellation, then report the Workflow's actual
  state rather than prematurely projecting `cancelled`;
- result: return the persisted run result and artifact references.

As of the verified dependency baseline, no separately published official TypeScript
extension runtime was found. Until supported official tooling is available and verified,
Studio exposes these operations as ordinary MCP tools. The future Tasks extension is a
thin protocol adapter over the same service, not a scheduler, queue, poller, or new
state store. The existing `InMemoryTaskStore`, `InMemoryTaskMessageQueue`, and backend
polling loop are deleted when this mapping is implemented.

The future wire adapter follows the new extension exactly: the original supported
request returns `resultType: 'task'`; `tasks/get` returns status and the terminal result;
`tasks/update` supplies requested input; and `tasks/cancel` requests cancellation. It
does not recreate historical `tasks/start` or `tasks/result` methods. Every get, update,
and cancel re-authorizes the mapped Sentris run, while task TTL/retention follows the
run-retention policy.

## Request and lifecycle flows

### Modern inbound tool call

1. A client sends a self-contained MCP request to the run gateway or Studio route.
2. Backend authentication resolves an immutable run, Studio, or discovery scope.
3. `McpFacade` creates a request-local SDK server and registers the referenced capability
   snapshot.
4. The SDK validates protocol and tool input.
5. `ToolInvocationCoordinator` submits the keyed run/operation command; the Workflow
   plans and schedules the typed activity with an invocation ID and deadline.
6. The component or owner runtime returns a typed result.
7. The request completes without leaving a backend transport session.

### Local stdio lifecycle

1. A Temporal activity requests a lease using saved configuration and an idempotency
   key.
2. The selected runtime owner reserves a `starting` generation, tags owned resources,
   optionally runs the SDK-owned disposable negotiation probe, and starts one persistent
   child with the approved minimal environment.
3. Readiness and discovery occur within the activity's heartbeat and timeout budget.
4. The capability snapshot records the exact configuration fingerprint and negotiated
   protocol era.
5. Calls route to the lease owner and reject stale generations.
6. The workflow renews the lease while active and releases it on completion or
   cancellation.
7. A bounded reconciler removes expired/non-routable resources after checking durable
   Temporal run state or the bounded Studio/discovery operation expiry.

### Durable agent turn

1. The Workflow loads one compact invocation manifest plus stable capability/AgentState
   references.
2. A model activity loads the bounded conversation/capabilities required for the
   provider request.
3. The model may return zero or more tool calls. The Workflow records their original
   indexes and schedules independent calls with bounded concurrency; stateful or
   conflicting calls remain sequential according to policy.
4. Full outputs are persisted, and compact results/references are ordered by the
   original model call index before the next turn.
5. Human approval/input waits through a signal; cancellation aborts active activities.
6. A failure retries only an activity whose computed policy permits it. Recorded agent
   history is not replayed as a new external call, while an unrecorded post-dispatch
   outcome remains explicitly ambiguous.

## Failure semantics

| Failure                                   | Required behavior                                                                                                                                                                                                                                                         |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Backend restart                           | Modern MCP requests continue without recovering session maps.                                                                                                                                                                                                             |
| Runtime owner exits                       | In-flight calls become ambiguous. Between calls, Temporal reacquires only when restart policy permits, then rediscovers and compares protocol/capability fingerprints; mismatch fails visibly or requires explicit refresh.                                               |
| Duplicate acquire activity                | Returns the existing routable generation or reserves a replacement after confirmed death. Brief non-routable crash-window resources are tagged, detected, and reaped.                                                                                                     |
| Owner loses lease renewal                 | The owner self-fences after its local safety deadline, refuses new calls, and marks unresolved calls ambiguous; every operation checks owner epoch and generation.                                                                                                        |
| Wrong worker receives cleanup             | Routes release to the recorded owner; expiry reconciliation remains a fallback.                                                                                                                                                                                           |
| Tool deadline/worker death after dispatch | Returns an ambiguous outcome and does not retry mutating/unknown tools automatically.                                                                                                                                                                                     |
| Workflow cancellation                     | Propagates abort, records cancellation, and releases or expires leases.                                                                                                                                                                                                   |
| Redis unavailable                         | Existing owner may finish an already-routed call; acquisition, mutation, and uncertain routing fail visibly. Durable config/run state remains recoverable from Postgres/Temporal.                                                                                         |
| Catalog changes mid-run                   | Existing snapshot remains stable; refresh creates a new version at an explicit boundary.                                                                                                                                                                                  |
| Capability grant/snapshot mismatch        | Reject before dispatch; a node or tool name never widens the immutable allowed-source grant.                                                                                                                                                                              |
| Continue-As-New during an Update          | Drain accepted handlers, reject/retry new Updates against the next run, and deduplicate the stable invocation ID across run IDs.                                                                                                                                          |
| Legacy client disconnect                  | Compatibility adapter cleans its own transport; modern traffic has no transport session to clean.                                                                                                                                                                         |
| Sentris server requires client input      | Return SDK `inputRequired` and end the request. Sentris-minted request state is integrity-protected, bounded, bound to principal/method/parameter hash/phase/expiry, and contains no secrets because signing does not encrypt it.                                         |
| External MCP server requires agent input  | Preserve the server's opaque request state byte-for-byte, persist a protected reference plus input requests, wait on a Temporal signal, then continue with a new request ID and latest-round responses. Do not perform irreversible local effects before input completes. |
| Agent cleanup fails after success         | Cleanup is independently retried/reconciled; recorded completed steps are not rerun, while unrecorded post-dispatch outcomes remain ambiguous.                                                                                                                            |
| Agent history or result grows             | Large bodies are externalized, references are hashed, and the Workflow continues as new before history/payload limits.                                                                                                                                                    |

## Security and capability policy

The existing `trusted-local` and `hardened` profiles remain the product boundary.

- `trusted-local` may enable host stdio, Docker MCP, broad public egress, and locally
  administered server configuration.
- `hardened` may restrict host stdio and require tighter tenant/admin policy while still
  supporting useful remote and isolated Docker capabilities.
- Child processes receive only explicit server configuration and selected secrets,
  never the worker's full environment, database credentials, encryption master key, or
  internal service credential.
- Remote targets and credentials remain organization-scoped. Network policy is applied
  at the adapter/runtime boundary, not duplicated throughout callers.
- The runtime internal credential authenticates the control API and is never forwarded
  to an MCP server.
- Capability controls must be tested for legitimate positive paths, not only denial
  paths.

This design intentionally does not treat a trusted single-operator local installation
as a hostile multi-tenant environment. Stronger controls remain an explicit hosting
choice rather than a reason to ship a weaker product.

## Performance and operability

- Modern inbound requests avoid sticky-session coordination and backend-local pools.
- Protocol verdicts, cacheable MCP responses, and durable capability snapshots follow
  their separate fingerprint/freshness rules rather than sharing one cache policy.
- Agent calls inside the owning worker use the runtime interface in-process; cross-owner
  calls pay one internal hop only when necessary.
- Acquisition is separate from invocation, so a reusable stdio/Docker server is not
  relaunched for every tool call.
- The runtime manager exports active leases, startup latency, calls, ambiguous outcomes,
  owner loss, reacquisition, and cleanup metrics.
- Correlation fields include execution-scope ID, organization ID, public run ID when
  present, Temporal workflow/run IDs, capability version, invocation ID, lease ID,
  owner epoch, and generation.
- Secrets and tool arguments marked sensitive remain redacted from logs and traces.
- Representative MCP list/call and agent-turn p50/p95 measurements must stay within the
  repository's normal 10% regression budget unless a measured capability/reliability
  benefit receives explicit approval.

## Migration plan

### Phase 0: architecture record

- Accept this design and its ADR.
- Record the protocol compatibility window and deletion conditions.
- Keep current runtime documentation clearly marked as legacy until implementation
  changes it.

### Phase 1: contracts and compatibility harness

- Add the official MCP SDK v2 split packages explicitly to each importing workspace.
- Keep v1 only where the measured compatibility path still needs it.
- Update any retained AI SDK 6 MCP compatibility client to the latest compatible line
  verified at implementation time; this contains legacy-path bugs and is not treated as
  modern protocol support.
- Add SDK-independent capability, immutable grant, compact invocation-manifest,
  invocation, execution-scope, lease, and client interfaces.
- Build focused conformance coverage for an official modern client, Sentris's supported
  legacy AI SDK client, cancellation, schema conversion, and protocol negotiation.
- Create a versioned supported-client matrix with exact client/package versions,
  protocol era, required features, and last verification date.
- Normalize registry transports to Streamable HTTP and stdio, with explicit legacy SSE.

### Phase 2: shared stateless facade

- Implement the request-local v2 server factory for gateway and Studio.
- Replace private SDK access and global schema maps with public schema registration.
- Mount existing authentication/authorization and Host/Origin policy before the SDK
  handler, then pass verified auth context into its request-local factory.
- Move capability selection outside the protocol handler.
- Make modern traffic independent of affinity and session registry state.

### Phase 3: runtime manager and leases

- Implement the worker module and owner-addressed internal API.
- Move host stdio and DIND MCP ownership behind the lease contract.
- Replace both handwritten JSON-RPC bridges and process-local routing maps.
- Align readiness, fenced heartbeats, self-fencing, cancellation, startup timeouts,
  draining, and reconciliation.
- Prove PM2, full Compose, two-worker direct owner routing, crash-window cleanup,
  duplicate acquire, partition/renewal loss, and conditional reacquisition behavior.

### Phase 4: canonical discovery and onboarding

- Route test, import, discovery activity, group runtime, gateway, and agent paths through
  the same client adapter.
- Separate/correctly key protocol verdict, MCP response, and durable capability snapshot
  semantics.
- Eliminate duplicate discovery during manual onboarding.
- Correct group-owned server selection and organization-scoped frontend query keys.
- Preserve resource, resource-template, and prompt discovery and expose bounded agent
  adapters for list/read/get alongside native tools.

### Phase 5: durable agent workflow

- Run the gated Temporal 1.21/AI SDK 7 integration spike. Adopt the official provider
  integration behind `AgentRuntime` only if it passes replay, payload/history,
  streaming, heartbeat, cancellation, multi-tool, and live-provider acceptance;
  otherwise use the thin ordinary-activity implementation of the same boundary.
- Move the agent loop into a Workflow and model/tool calls into separate activities.
- Preserve existing live Agent trace behavior, provider selection, execution profiles,
  tool availability modes, and output contracts.
- Add cancellation, human-input signaling, effect-aware retries, and per-workflow timeout
  policies.
- Externalize large conversation/tool content, support bounded parallel tool calls with
  deterministic ordering, and prove continue-as-new behavior.
- Drain Workflow Update handlers during rollover and deduplicate stable invocation IDs
  across Continue-As-New runs.
- Remove the whole-agent retry activity after replay and live provider acceptance pass.

### Phase 6: durable task facade

- Replace Studio's in-memory Tasks objects and poller with run/Temporal operations.
- Add the new MCP Tasks extension adapter only when official TypeScript support is
  available and passes compatibility tests; map only its actual task result/get/update/
  cancel shapes and cooperative cancellation semantics.

### Phase 7: compatibility removal

- Observe legacy route usage across the documented support window.
- Remove v1 dependencies, legacy session maps, `SessionRegistry`, affinity cookies,
  legacy SSE support, old proxies, and dead discovery implementations once supported
  clients no longer require them.
- Finalize `docs/architecture.mdx`, deployment configuration, and operator migration
  notes in the same change.

## Compatibility deletion criteria

Legacy session code may be removed when all of the following are true:

- the current official MCP client and Sentris agent path pass modern conformance;
- supported external clients can list and call Sentris tools through v2 legacy-stateless
  fallback or modern MCP;
- no supported workflow depends on the old experimental Tasks wire format;
- a release note and at least one normal release provide migration notice;
- the versioned supported-client matrix and backend MCP module owner confirm no required
  sessionful client at the mandatory remove-or-renew checkpoint, no later than the
  second normal release after enabling the adapter.

The compatibility window is not permission to add new session-oriented features.

## Verification

Verification is focused on changed behavior and architectural failure modes:

1. Run the official MCP conformance suite for the modern behavior it covers plus focused
   legacy-stateless compatibility tests.
2. Use focused maintained-SDK tests to prove list/call, schemas, structured results,
   version fallback, cache hints, cancellation, and input-required flows not guaranteed
   by the conformance suite.
3. Run one remote Streamable HTTP server, one host stdio server in `trusted-local`, and
   one DIND-backed server in full Compose.
4. Kill the backend during modern requests and confirm no session recovery is needed.
5. With two workers, prove the published owner address is instance-unique/directly
   routable and never resolves through a generic load-balanced worker alias.
6. Kill a runtime owner during startup and during a run; confirm startup-epoch/generation
   fencing, self-fencing, safe conditional reacquisition, and bounded cleanup.
7. Kill an activity worker after external dispatch but before completion is recorded;
   prove a mutating/unknown tool is not automatically dispatched a second time.
8. Force an ambiguous mutating-tool timeout and prove the call is not automatically
   dispatched a second time.
9. Replay an agent Workflow and restart workers between model and tool steps; confirm
   recorded completed steps are not rerun and unrecorded post-dispatch steps become
   ambiguous.
10. Run a long agent fixture and prove content externalization, reference recovery, and
    continue-as-new keep history and payloads bounded; concurrently submit an invocation
    Update and prove rollover neither abandons nor duplicates it.
11. Verify multiple tool calls, deterministic result order, cancellation, inbound and
    outbound input-required flows, and human input through Temporal and the browser.
12. Prove an immutable capability grant rejects an unlisted source/tool even when the
    caller supplies a valid run, node, and capability-snapshot ID.
13. Run `bun run instance show`, explicitly select the intended test instance, then
    configure an MCP server, discover capabilities, build/run an agent workflow, inspect
    the live Agent transcript, and confirm the final run/artifacts.
14. Compare MCP and agent latency/resource measurements with the accepted baseline.

Broad unrelated test suites are not repeated after every phase. Each phase runs focused
tests plus the repository typecheck/lint/build surfaces it actually changes; the full
suite and browser acceptance run at integration boundaries and before the final commit.

## Expected file and module boundaries

Names may follow existing package conventions, but responsibilities must remain:

- shared contracts under `packages/shared` or a dedicated workspace package;
- backend `McpFacade`, capability selection, `ToolInvocationCoordinator`, auth, and
  durable run/task projection;
- shared `ToolInvocationPolicy` and result/error taxonomy;
- worker typed component/MCP execution activities, `McpClientAdapter`,
  `McpRuntimeManager`, lease activities, and agent runtime;
- Temporal workflows/updates for tool commands, agent turns, and MCP runtime lifecycle;
- removal or migration of:
  - `backend/src/mcp/mcp-gateway.controller.ts` session state;
  - `backend/src/mcp/mcp-gateway.service.ts` protocol/client ownership;
  - `backend/src/studio-mcp/studio-mcp.controller.ts` session state;
  - `backend/src/studio-mcp/studio-mcp.service.ts` in-memory Tasks state;
  - `worker/src/components/core/mcp-stdio-host-proxy.ts`;
  - `docker/mcp-stdio-proxy/server.mjs`;
  - duplicated discovery and MCP client construction paths;
  - Nginx `mcp_affinity` routing and Redis MCP session registry after compatibility
    removal.

## Decisions deliberately deferred

- **Standalone runtime service:** extract only when operational evidence shows worker
  co-location is insufficient for scaling, isolation, or upgrade independence. The
  internal contract is already service-safe.
- **Required legacy session route:** add only if compatibility tests identify a supported
  client not handled by v2's legacy-stateless mode. If enabled, the backend MCP module
  owns it and a remove-or-renew decision is mandatory by the second normal release.
- **MCP Tasks TypeScript implementation:** adopt maintained official support when
  available; do not create a competing protocol library.
- **Additional agent framework:** add only if AI SDK plus Temporal cannot meet a concrete
  product requirement after the upgrade spike.

## Primary upstream references

- [MCP 2026-07-28 changelog](https://modelcontextprotocol.io/specification/2026-07-28/changelog)
- [MCP 2026-07-28 architecture](https://modelcontextprotocol.io/specification/2026-07-28/architecture)
- [MCP TypeScript SDK v2 protocol versions](https://ts.sdk.modelcontextprotocol.io/v2/protocol-versions)
- [MCP TypeScript SDK v2 migration guide](https://ts.sdk.modelcontextprotocol.io/v2/migration/upgrade-to-v2)
- [MCP TypeScript SDK caching](https://ts.sdk.modelcontextprotocol.io/v2/clients/caching)
- [MCP TypeScript SDK input required](https://ts.sdk.modelcontextprotocol.io/v2/servers/input-required)
- [MCP Tasks extension](https://modelcontextprotocol.io/extensions/tasks/overview)
- [MCP conformance suite](https://github.com/modelcontextprotocol/conformance)
- [Temporal TypeScript AI SDK integration](https://github.com/temporalio/sdk-typescript/tree/main/contrib/ai-sdk)
- [Temporal TypeScript AI SDK sample](https://github.com/temporalio/samples-typescript/tree/main/ai-sdk)
- `docs/architecture/adr-redis-state-externalization.md`
