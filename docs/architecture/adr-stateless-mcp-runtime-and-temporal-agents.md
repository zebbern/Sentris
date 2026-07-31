# ADR: Stateless MCP Facade, Runtime Leases, and Durable Agents

## Status

**Accepted; implementation pending** — 2026-07-31

## Context

Sentris currently implements MCP transport and lifecycle behavior in multiple backend
and worker paths. The run gateway and Studio each retain process-local transports keyed
by `Mcp-Session-Id`; Nginx uses an affinity cookie; Redis mirrors session metadata that
cannot recover the live transport; the worker and standalone Docker proxy each provide
a handwritten stdio-to-HTTP JSON-RPC bridge; and discovery/client behavior is repeated
across onboarding, groups, workflow activities, gateway proxying, and AI agents.

This ownership works only while requests reach the exact process holding the transport.
It fails under full Compose when a backend cannot reach a worker loopback listener, and
it is not horizontally correct when a generic worker address resolves to a different
process from the one holding a subprocess or routing map.

Studio also layers an in-memory MCP task store and polling loop over Temporal, even
though the Sentris run and Temporal Workflow are already the durable task. The AI agent
runs its entire model/tool loop in one retryable activity, allowing late cleanup failure
to repeat previously successful side effects.

MCP `2026-07-28` changes the protocol assumptions: modern HTTP no longer uses
`initialize`, `initialized`, or `Mcp-Session-Id`; each request is self-contained;
`server/discover` replaces initialization; and Tasks moved to a new, incompatible
extension. The official TypeScript SDK v2 supports modern protocol requests and legacy
stateless compatibility.

The architecture must adopt the new protocol without sacrificing the local stdio,
Docker, remote-tool, agent, and scanner capabilities that make Sentris useful.

## Decision

Sentris will use a **stateless dual-era MCP facade**, a **protocol-independent capability
and invocation boundary**, **worker-owned runtime leases**, and **Temporal-owned durable
agent/task lifecycle**.

### Protocol boundary

The official MCP TypeScript SDK is the wire owner, with v2 canonical/default. Gateway
and Studio retain separate product routes and authentication but use one request-local
server factory, public schema APIs, and dialect-preserving JSON Schema. Modern requests
do not create backend transport sessions. Existing Nest authentication/authorization
and deployment-appropriate Host/Origin policy run before the SDK handler and pass
immutable caller scope into its auth context.

The v2 SDK's legacy-stateless mode is the default compatibility path. The only permitted
exception is a quarantined v1 session adapter proven necessary by the versioned
supported-client matrix. The backend MCP module owns it, it receives no new features,
and it has a mandatory remove-or-explicitly-renew decision no later than its second
normal release. Renewal requires an ADR update and product approval.

Outbound discovery and calls use one official-v2 client adapter with consistent version
negotiation, cancellation, timeout, schema, OAuth, and cleanup behavior. Remote HTTP
uses automatic modern/legacy negotiation. A managed stdio lease may use the SDK's owned,
reaped sibling probe before starting one persistent child and caches the resulting era
verdict. Spawn-per-invocation stdio defaults to legacy unless explicitly configured for
auto or pinned modern behavior.

Protocol-era verdicts, cacheable MCP list/read responses, and immutable run/operation
capability snapshots use separate freshness rules. Private responses and client pools
are partitioned by organization/principal/auth context. Modern wire statelessness does
not make an SDK client with auth, cache, or subscriptions safe to share globally.

The backend owns OAuth authorization, encrypted refresh persistence, and saved secret
references. Runtime leases carry only credential references/versions; a scoped worker
provider resolves and attaches required material without forwarding ambient backend or
worker credentials to an MCP server.

### Domain boundary

SDK-independent `ExecutionScope`, `McpCapabilityCatalogSnapshot`, tool/resource/prompt
descriptors, invocation request/plan/result, and `RuntimeLease` contracts are shared
across onboarding, gateway, Studio, MCP groups, workflow components, and AI agents.
Pre-run Studio/discovery operations use bounded operation IDs and TTLs rather than fake
run IDs. The capability catalog preserves tools, resources, resource templates, prompts,
metadata, schema dialects, and extensions.

Every execution scope carries an immutable capability-grant ID containing its allowed
server/component/source IDs and tool subset. An invoking node is context, not an
allow-list. The Workflow carries a compact, versioned routing/effect manifest bound to
that grant and the full capability-snapshot reference; schemas and descriptions remain
outside Workflow history.

`ToolInvocationPolicy` is a pure shared planner and error taxonomy. It computes
destination and retry safety; callers cannot select them. MCP effect annotations are
untrusted hints, so only Sentris-owned or operator-reviewed contracts authorize
idempotent redispatch. A retry-safe preflight activity loads the full snapshot, rechecks
the grant, validates input, resolves lease/credential references, and creates a prepared
attempt without calling the external tool. Agent Workflows then schedule typed
component/MCP dispatch activities. The backend facade submits keyed Workflow Updates for
run-scoped calls, and bounded Studio/discovery Workflows schedule the same activities.
Activities never schedule sibling activities.

Temporal is authoritative for active orchestration. Postgres owns saved configuration,
immutable capability snapshots, invocation audit/query projections, results, and
artifacts; it is not a second scheduler. Redis holds ephemeral cache and lease routing
metadata.

### Live runtime ownership

A worker-side `McpRuntimeManager` owns host stdio children, Docker/DIND MCP containers,
transport objects, and any required persistent clients. It exposes one authenticated
interface for acquire, discover, invoke, renew, release, and health.

Application leases record execution/server scope, configuration and capability
fingerprints, protocol era, process-incarnation owner/epoch, instance-unique directly
routable address, generation, health, and expiry. The address is published only after
listener readiness and is never a generic load-balanced worker alias. Every invoke,
renew, release, and readiness transition checks the lease, owner epoch, and generation.

Acquire reserves a `starting` generation before spawning and tags every probe,
child/container, and live resource. A crash window may briefly leave a non-routable
duplicate resource; only one generation becomes routable, and owner-local tracking plus
reconciliation reaps the rest. The owner uses fenced heartbeats, self-fences/refuses new
calls after renewal loss, and drains before rolling shutdown.

Runtime leases are correctness-critical coordination and do not fall back to
process-local state when Redis cannot confirm ownership. This intentionally narrows the
graceful-fallback rule in the proposed Redis externalization ADR, whose listed caches and
locks can tolerate duplicate/stale work. An already owner-routed call may finish, but
uncertain acquisition, mutation, or routing fails visibly.

Owner loss makes an in-flight call ambiguous. Reacquisition occurs only between calls
when restart policy permits, followed by protocol/capability rediscovery and fingerprint
comparison. A changed or stateful server does not resume transparently.

The manager initially ships as a separated module/internal API in the existing worker
deployment. This avoids adding a mandatory service to local installations. Its callers
depend only on the service-safe contract, allowing later extraction when measured scale
or isolation requirements justify it.

### Temporal and AI agents

Temporal owns acquire/renew/release sequencing, capability snapshot selection, active
agent state, human-input waits, cancellation, and Workflow Updates. It never owns live
MCP sockets or process handles.

The agent loop moves into a deterministic Workflow. Model requests and tool calls become
separate activities. A model turn may produce zero or more tool calls; independent calls
run with bounded concurrency and results return in deterministic model-call order.
Exactly-once external effects are impossible without upstream idempotency. Mutating,
unknown, or unreviewed dispatch activities use `maximumAttempts: 1`; retryable preflight
is separate, and post-dispatch timeout/worker loss is reported as ambiguous.

Temporal's official AI SDK provider integration is evaluated behind `AgentRuntime`, not
made foundational before it passes replay, streaming, cancellation/heartbeat,
multi-tool, provider, and payload/history acceptance. Its MCP helper is not used as the
wire owner. If the experimental integration fails those gates, a thin Workflow over
ordinary activities calling maintained Vercel AI SDK providers implements the same
boundary. No additional agent framework is added without a concrete missing capability.

Large conversations, source/scanner content, tool results, and artifacts live in
Postgres/MinIO. Workflow history carries bounded summaries, references, hashes, and
control state and continues as new before history/payload limits under the same public
run ID. Global timeouts become workload-specific. Human input uses Temporal signals;
model/MCP cancellation and idle-call heartbeats are acceptance requirements rather than
assumed upstream behavior.

Before Continue-As-New, a Workflow marks itself draining, rejects new invocation Updates
with a retryable rollover response, and waits for accepted handlers to finish. The next
run carries the compact manifest and recent invocation-result ledger. The backend retries
the same invocation ID against the stable Workflow ID; a unique durable attempt record
returns completed results, safely resumes prepared calls, and leaves
dispatched-without-result calls ambiguous instead of redispatching them.

Inbound modern input-required results end the request with integrity-protected,
principal/method/parameter/phase/expiry-bound Sentris request state that contains no
secrets. Outbound third-party request state remains opaque and is persisted byte-for-byte
behind a protected reference while the Workflow waits for input, then continues with a
new request ID and latest-round responses.

### MCP Tasks

The Sentris run and Temporal Workflow are the sole durable task. Domain start, status,
input, cooperative cancel, and result operations map directly to that state. The
in-memory SDK task store, message queue, and backend polling loop are removed.

As of 2026-07-31, no separately published official TypeScript runtime for the new Tasks
extension was found. Until maintained official support is available and verified, these
operations remain ordinary MCP tools. A future Tasks extension handler will be a thin
protocol projection, not another scheduler or database. Upstream status is rechecked
before that phase begins.

The adapter uses only the new extension shapes: an original supported request returns
`resultType: 'task'`; `tasks/get` includes the terminal result; `tasks/update` supplies
input; and `tasks/cancel` requests cancellation without prematurely declaring a terminal
state. Every operation re-authorizes the mapped run, and extension TTL/retention follows
Sentris run retention. Historical `tasks/start`/`tasks/result` methods are not recreated.

### Capability policy

The existing `trusted-local` and `hardened` profiles continue to govern host stdio,
Docker, egress, tenancy, and local administration. The architecture preserves broad
trusted-local capability. Hardened policy is applied at the shared adapter/runtime
boundaries rather than by maintaining weaker parallel implementations.

## Consequences

### Positive

- Modern MCP no longer depends on backend stickiness or recoverability of in-memory
  transport sessions.
- One set of contracts governs discovery, capabilities, schemas, calls, cancellation,
  and cleanup while narrow adapters own transport-specific execution.
- PM2, full Compose, and horizontal workers have an explicit live-resource owner.
- Temporal retries no longer need to replay the complete agent loop after one step
  fails.
- Durable task state survives backend restarts and aligns with existing run semantics.
- Local users retain powerful remote, stdio, Docker, and agent capabilities.
- MCP tools, resources, and prompts remain available through the capability boundary.
- Maintained MCP, Temporal, and AI SDK implementations replace custom protocol and
  orchestration code where they fit.

### Negative

- Migration crosses backend, worker, shared contracts, Temporal workflows, deployment
  configuration, and tests.
- MCP SDK v1 and v2 may coexist briefly at the explicit compatibility boundary.
- Runtime leases, owner routing, fencing, and reconciliation add distributed-systems
  behavior that must be observable and tested.
- Temporal's AI SDK integration is experimental and requires an isolated adapter plus a
  replay/cancellation/streaming acceptance spike.
- A legacy client that requires true transport sessions may need a time-bounded adapter.

### Neutral

- A persistent local stdio process still has application lifecycle state. The decision
  removes MCP transport sessions; it does not pretend OS resources are stateless.
- RuntimeManager is not initially a separate deployable service, but its contract is
  designed so deployment ownership can change without changing product callers.

## Failure Modes and Required Verification

- The official MCP conformance suite verifies the modern behavior it covers; focused
  maintained-SDK tests cover remaining discovery, list/call, schema, result,
  cancellation, cache, and extension behavior.
- Supported legacy clients list and call tools through the bounded compatibility path.
- Backend restart does not require modern session recovery.
- Duplicate acquire yields one routable generation; tagged non-routable crash-window
  resources are detected and reaped.
- A two-worker full-Compose test routes stdio/Docker calls to an instance-unique owner
  rather than loopback, a generic worker alias, or the wrong process-local map.
- Lease-renewal loss causes owner self-fencing, and every operation rejects stale owner
  epochs/generations.
- Worker death causes visible runtime unavailability. In-flight calls become ambiguous;
  safe between-call reacquisition rediscovers and compares protocol/capability
  fingerprints before continuing.
- A worker kill after dispatch and ambiguous mutating-tool timeout do not trigger blind
  redispatch.
- Continue-As-New drains accepted Workflow Updates and deduplicates stable invocation
  IDs across Temporal run IDs.
- A mismatched capability grant/snapshot or unlisted source fails before dispatch.
- Temporal replay and worker restart do not repeat recorded completed tools; unrecorded
  post-dispatch outcomes remain ambiguous.
- Long agent runs externalize large content and continue as new before history/payload
  limits.
- Models can issue multiple bounded-concurrent tool calls with deterministic result
  ordering.
- Human input and cancellation survive worker/backend restart.
- Trusted-local positive tests prove useful host stdio, remote MCP, Docker MCP, and
  agent flows remain available.
- Representative list/call and agent-turn latency stays within the accepted 10%
  regression budget or receives an explicitly documented exception.

## Alternatives Considered

**Patch the existing v1 controllers and lifecycle bugs**

Rejected. It would deepen dependence on a protocol session model removed by modern MCP
and leave duplicate discovery, task, proxy, and ownership implementations.

**Upgrade only the inbound facade to SDK v2**

Rejected as the final architecture. It is a useful migration phase but does not fix
worker-local stdio ownership, wrong-worker cleanup, duplicate clients, whole-agent
retries, or in-memory Tasks.

**Create a mandatory standalone MCP runtime service immediately**

Deferred. It provides a clear isolation boundary but adds another deployable, health
surface, and local-hosting burden before evidence shows the worker module cannot meet
scale or isolation requirements. The selected internal API preserves the extraction
path without requiring it now.

**Use `@ai-sdk/mcp` as the protocol client everywhere**

Rejected. Its current lines implement the older initialization/session protocol and do
not provide MCP `2026-07-28`. AI SDK tool conversion remains useful, but official MCP
SDK v2 owns the wire protocol.

**Adopt Temporal's complete MCP helper unchanged**

Rejected. The official Temporal AI SDK provider is valuable, but its experimental MCP
client currently delegates to the legacy AI SDK MCP implementation. Sentris will adopt
the provider integration only if it passes the `AgentRuntime` acceptance gate and will
always use its official-SDK invocation adapter.

**Implement the new MCP Tasks extension ourselves now**

Rejected. Sentris first fixes the durable domain mapping and waits for maintained
official TypeScript extension support, avoiding another protocol implementation.

**Add LangChain or LangGraph as another orchestration layer**

Rejected without a concrete missing capability. AI SDK already supplies model and tool
abstractions, and Temporal supplies durable orchestration. Another framework would
duplicate ownership and version surfaces.

## Migration and Removal Conditions

Implementation follows the approved design at
`docs/superpowers/specs/2026-07-31-mcp-runtime-temporal-agent-architecture-design.md`.
Legacy session state, affinity, v1 packages, and legacy SSE support are removed after
supported clients pass the modern or legacy-stateless path, old Tasks wire behavior has
no supported consumer, and migration notice has shipped. If a session adapter is ever
enabled, the versioned supported-client matrix and backend MCP module owner make a
mandatory remove-or-explicitly-renew decision no later than its second normal release;
renewal requires an ADR update and product approval.

## References

- `docs/architecture/adr-self-hosted-trust-profiles.md`
- `docs/architecture/adr-worker-capability-and-credential-boundaries.md`
- `docs/architecture/adr-supported-docker-dind-topology.md`
- `docs/architecture/adr-redis-state-externalization.md`
- `backend/src/mcp/mcp-gateway.controller.ts`
- `backend/src/mcp/mcp-gateway.service.ts`
- `backend/src/studio-mcp/studio-mcp.controller.ts`
- `backend/src/studio-mcp/studio-mcp.service.ts`
- `worker/src/components/ai/ai-agent.ts`
- `worker/src/components/core/mcp-stdio-host-proxy.ts`
- `docker/mcp-stdio-proxy/server.mjs`
- [MCP 2026-07-28 changelog](https://modelcontextprotocol.io/specification/2026-07-28/changelog)
- [MCP TypeScript SDK v2 migration](https://ts.sdk.modelcontextprotocol.io/v2/migration/upgrade-to-v2)
- [MCP TypeScript SDK protocol versions](https://ts.sdk.modelcontextprotocol.io/v2/protocol-versions)
- [MCP Tasks extension](https://modelcontextprotocol.io/extensions/tasks/overview)
- [Temporal AI SDK integration](https://github.com/temporalio/sdk-typescript/tree/main/contrib/ai-sdk)
