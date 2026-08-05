# ADR: Stateless MCP Facade, Runtime Leases, and Durable Agents

## Status

**Accepted; run-gateway, durable component invocation, and Operator-turn slices implemented, dependent work pending** — 2026-08-02

## Context

Sentris historically implemented MCP transport and lifecycle behavior in multiple
backend and worker paths. The run gateway and Studio both retained process-local
transports keyed by `Mcp-Session-Id`; Nginx used an affinity cookie; Redis mirrored
session metadata that could not recover the live transport; the worker and standalone
Docker proxy each provided a handwritten stdio-to-HTTP JSON-RPC bridge; and
discovery/client behavior was repeated across onboarding, groups, workflow activities,
gateway proxying, and AI agents.

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

### Implementation status (2026-08-01)

The inbound run-gateway foundation is implemented. Its official SDK v2 facade builds a
request-local server from authenticated run scope and serves modern plus
legacy-stateless clients. Run transport maps, pending initialization state, cached
inbound servers, session IDs, affinity cookies, Redis session registration, GET/SSE and
DELETE session lifecycle, and sticky Nginx routing have been removed from this route.

Studio has not migrated: it remains a separate v1 sessionful controller on sticky
routing and may still appear in the session registry. The run gateway now dispatches
runtime-bound saved-server operations through the canonical worker runtime manager;
the outbound v1 pool remains only behind the compatibility boundaries described below.

SDK-independent `ExecutionScope`, grant/catalog descriptor, and invocation-planning
contracts now back durable run grant/catalog materialization. Capability contract v2
adds an immutable, secret-free runtime binding for every saved source. New run tokens
carry an immutable snapshot ID, the run gateway advertises exactly that snapshot, and
component plus runtime-bound MCP tool, resource-read, and prompt-get calls execute
through invocation-ID-keyed Workflow Updates. The Workflow authorizes the compact v2
manifest; retryable preflight persists one logical invocation and attempt; dispatch
acquires the snapshotted runtime, verifies its protocol era, configuration version, and
capability fingerprint, captures the exact owner fence before the first upstream byte,
and settles or marks ambiguity against that fence. Accepted Update handlers drain before
Workflow finalization. Exact resources and templates use stable, source-qualified
`sentris-mcp://resource/...` facade identifiers so identical upstream URIs from different
servers remain independently addressable. The gateway translates those identifiers at
the boundary, rewrites returned resource links into the same namespace, and resolves
templates to the same durable resource-read operation after authoritative preflight
matching.

The no-snapshot gateway branch remains only for workflows whose histories predate the
tool-invocation protocol query and for already-issued tokens without a snapshot. Delete
that branch only after every such pre-deployment Workflow is terminal or retired and
Redis contains no unexpired `mcp:session:*` record without `capabilitySnapshotId` (the
last such token has a maximum three-hour TTL). It must not receive new behavior.

Saved-server discovery now crosses a secret-free Temporal boundary and uses the canonical
worker-owned runtime manager plus the official v2 client. It returns a complete catalog
containing tools, resources, resource templates, and prompts. An explicitly empty tool
policy is persisted distinctly from a missing policy so a resources/prompts-only saved
server can still materialize a closed catalog. Durable attempts preserve the generic
operation identity and exact runtime fence. Migration `0012` is the expand phase of a
rolling-compatible database change: `operation_kind` and `operation_target` remain
nullable only for canonical old-backend rows, while new writes populate both and database
checks reject partial identities. The nullable legacy `tool_name` projection and the
tool-shaped repository/service methods exist only to replay pre-Task-7 Workflow histories,
not as a second permanent invocation architecture. Task 8 must backfill rows written by
old binaries before enforcing the generic identity `NOT NULL` contract.

The in-app Operator now owns each user turn in a Temporal Workflow. Model steps, typed
Sentris commands, approval waits, and MCP dispatch are separate activities or durable
Workflow state rather than one retryable model/tool activity. Ordinary new turn histories
release the composer after launching a workflow and follow that run through the ordinary run
trace and Agent SSE projections; the patch-gated blocking run observer remains only for
replaying older histories. Explicit run-card inspect, cancel, and retry controls enter the same durable
turn path as user-confirmed structured commands. Retry starts one new run from the original
stored version, inputs, and scope using the Operator action identity for idempotency; it does
not mutate or reset a completed Agent child.
For bounded multi-action requests, `propose_operator_plan` persists an immutable preview of
three to eight exact typed commands. Running that proposal starts a separate patch-gated
`execute_plan` journey by proposal-action identity. Temporal schedules the existing Operator
action boundary sequentially with stable per-step tool-call IDs, so retries and worker restarts
reuse the same action rows and the normal Ask/Auto policy still decides consequential steps.
The action ledger is the progress record rendered by the browser; there is no second plan
executor or plan-state store. Stop requests cancel the exact Operator Temporal run and record
the turn as cancelled while retaining completed actions. The backend's authoritative action
status is preserved through the worker boundary: failed actions stop execution before later
steps, while user rejections remain distinct. Successful new histories use a patch-gated,
text-only model activity to summarize the existing durable action ledger, then append bounded
workflow/run links derived deterministically from exact typed results. Model failure or incomplete
output falls back to the deterministic completion message and does not turn a completed plan into
a failed turn. Revision creates a new immutable proposal. A later step may copy one
string from an earlier step's durable action result into one
top-level command argument through bounded RFC 6901 source and target pointers. Resolution is a
deterministic Workflow operation and the completed arguments still pass through the canonical
backend command schema and action boundary. Forward references, nested targets, literal/bound
conflicts, general expressions, string templating, and turn-scoped MCP snapshots remain excluded.
The selected session is projected to the browser through a versioned SSE stream of complete
Postgres-backed snapshots. TanStack Query remains the frontend cache, with periodic REST
reads only as a connection fallback; the stream is not a second event store and does not
query Temporal from the browser. Launched run cards continue to use the existing run SSE for
status and trace updates rather than multiplexing run data into the Operator stream.
The compact improvement pipeline is a frontend projection of the persisted journey marker and
action ledger; it owns no execution state, and reloads reconstruct the same stages. Embedded
workflow progress and Agent turns remain projections of the canonical run trace.
Terminal `get_run` results include separately bounded failure/recent trace evidence and run-scoped
finding summaries. For versions with a declared runtime-input contract, they also include the
effective non-secret invocation values and opaque placeholders for secret inputs. Operator can
turn that evidence into a bounded ID-based `propose_run_input_changes` action. The backend
materializes and validates the proposal against the source run's exact immutable version; a
separate user-confirmed `run_workflow` action applies only those reviewed operations while
preserving stored secrets and the source scope server-side. Different-input verification runs
remain deliberately ineligible for an apples-to-apples improvement verdict.
Ordinary run commands remain detached. An explicit `improve_run` journey
instead keeps one bounded turn durable while it diagnoses a terminal source run, proposes the
smallest valid edit, applies it through the existing Ask/Auto policy, reruns the exact stored
inputs and scope, and compares the terminal candidate. Candidate waiting uses one observation
attempt per retrying Activity attempt rather than a long in-Activity polling loop.
When an ordinary Operator-launched run becomes terminal, its transactional outbox event starts
one idempotently named follow-up coordinator. The coordinator retries durably while that Operator
session has another active turn, then creates a fresh turn through the canonical turn service. The
turn performs one bounded `get_run` inspection and a text-only result summary with product links
and suggested next actions. Terminal inspection now records separately bounded trace, finding,
and artifact evidence. The frontend projects that typed evidence into a compact result panel with
run-scoped finding navigation, direct artifact downloads, and the existing typed run controls;
older turn histories without recorded artifact evidence use the canonical terminal-run artifact
query as a compatibility fallback. The original launch turn remains closed, duplicate terminal
delivery cannot create another summary, and `improve_run` candidates are excluded because that
journey owns its comparison and completion message.
Run-derived update proposals persist the reviewed run identity only after organization and
workflow validation. Applying a valid proposal carries that lineage onto a staged immutable
version without changing the workflow's `current_version_id`. The improvement journey selects
that exact staged version and reuses the reviewed run's stored inputs and scope; the manual
cards may still perform the same stages as separate explicit turns. Ordinary launches without
an explicit version resolve through `current_version_id`, which is also the optimistic edit
fence. This does not change Retry: Retry still
replays the original version, inputs, and scope.
After that improved run becomes terminal, the journey invokes the same read-only `compare_runs`
action that remains available from run cards. The backend requires both runs to belong to the same workflow and
checks their stored inputs and scope before issuing a verdict. The deterministic assessment
uses terminal outcome first. A candidate version may declare bounded success criteria in its
immutable graph: scalar output assertions address a node output with RFC 6901 JSON Pointer,
and finding-count checks declare an allowed minimum/maximum. The candidate version is the
fixed benchmark and the backend evaluates those same criteria against both runs. Only
non-conflicting passed/failed transitions produce an improved or regressed verdict;
unavailable evidence, conflicting transitions, or input/scope mismatches remain
inconclusive. Criteria are deterministic and do not use an LLM judge. When the candidate
declares no criteria, exact recorded trace-failure counts remain the fallback. Raw finding
totals and duration remain observations because target state, network behavior, and
model-provider responses can vary between runs. The comparison is stored in the normal
Operator action ledger and does not automatically promote, roll back, or mutate a workflow
version. `Keep candidate` is a separate consequential `promote_workflow_version` action. It
requires a terminal candidate run tied to the exact staged version, then atomically moves the
workflow's current-version pointer only if it still matches the compared source/base version.
`Revise again` starts another improvement journey from the
candidate run without promoting it.
The design toolbar exposes the canonical versioned criteria editor directly. When an
improvement journey inspects a workflow without criteria, Operator may include the existing
typed `set_success_criteria` operation in its reviewed proposal only when exact component
contracts or run evidence justify the output path or finding threshold; it must not invent
either. The criteria still require the normal proposal review and Save action.
Before a new launch, `get_workflow` exposes the selected compiled version's sanitized
runtime-input descriptors so the model can map user intent to exact input IDs. The same
shared contract is enforced in `WorkflowRunService` for every launch path before persistence
or Temporal start; an Operator preflight failure is a durable failed tool result that the
model can correct within the turn rather than a doomed workflow run.
Workflow authoring uses that same typed command ledger rather than a second agent loop.
For common new-workflow requests, Operator first searches the maintained active Template
Library. The bounded catalog exposes exact runtime-input IDs and types plus unique component
IDs derived from each validated graph. Exact component requirements filter the materializable
catalog before its result limit, so a popular metadata match cannot displace a template that
actually contains the requested capability. Explicit web vulnerability, flaw, exposure, or
misconfiguration requests require `sentris.nuclei.scan`; reconnaissance-only requests do not.
The canonical TemplateService then materializes the selected graph with validated non-secret
defaults. The proposal action stores that exact credential-safe graph snapshot, so later
template updates cannot change a reviewed draft. When no suitable template exists, Operator discovers
components from the canonical registry and receives an editable graph whose inline and
component-declared credentials are opaque placeholders. Freeform creation stores one bounded
complete graph in its proposal action. Updating an existing
workflow instead stores bounded domain operations keyed by stable node and edge IDs, including
one canonical `set_success_criteria` operation for the versioned benchmark. The backend
materializes them against the exact immutable base graph. Structured node patches
merge recursively so an update to one nested value retains unrelated credential placeholders;
explicit remove operations remain top-level and full-graph proposals retain replacement
semantics. All proposal forms use
the same credential restoration, compilation, validation, and graph-diff path without
mutating a workflow. Applying either is a separate consequential action: the proposal action
ID is the workflow-mutation idempotency key, updates fence on the exact immutable base
version, and the canonical create/update transaction returns the saved version. New-history
turns that produce a compile-invalid draft make one patch-gated repair pass through this same
ledger: they durably inspect the exact failed draft, allow only component-catalog reads, and
execute at most one ID-based `revise_workflow_draft`. The pass never saves or runs a workflow;
an invalid or unavailable repair retains the normal manual revision fallback, and pre-patch
histories keep their original completion path. Durable turns snapshot the initiating actor roles
so delayed execution keeps the user's workflow
authority. The frontend can apply the materialized proposal directly or hydrate it into the
Builder as an unsaved draft; update placeholders are materialized only from the freshly
fetched persisted base graph.
Postgres stores sessions, messages, action decisions, and results; consequential actions
honor the session's ask-or-auto approval mode. Operator MCP discovery materializes an
immutable turn-scoped grant and complete capability snapshot, and tool, resource, and
prompt operations use the same invocation-ID-keyed preparation, canonical worker runtime,
fenced dispatch, reconciliation, and settlement path as run-scoped calls. Provider-native
tool-call IDs and metadata required to continue a model turn are retained in Temporal turn
history, while the provider-neutral action audit keeps a stable Sentris idempotency key.
Pre-deployment turn histories without that provider metadata are represented to the model
as bounded durable observations instead of forged native tool calls.

Two outbound compatibility boundaries remain. Contract-v1 snapshots have no runtime
bindings and continue through the existing tool-only path owned by the backend MCP
gateway and the permanent Temporal patch boundary. Remove that path only after all v1
tokens have expired and every Workflow history that can execute the old Update is
terminal or retired. Contract-v2 snapshots whose tool-only sources are still unbound
also use the explicitly named compatibility path; Task 8 owns migrating those callers
to saved-source runtime bindings, after which the gateway fallback and outbound v1 pool
can be deleted. A v2 unbound source never gains resource or prompt behavior.

The contract-v2 rollout is coordinated across backend and worker. The legacy tool protocol
query and the generic MCP-operation protocol query are distinct: the backend issues v2
authority only when the target Workflow advertises the generic protocol. A mixed history
that advertises only the legacy tool protocol receives a v1 authority and continues through
the legacy activities; a history advertising neither receives no snapshot. This supports
worker-first/backend-second deployment without routing a v1 manifest through new backend
operation endpoints. The generic workflow-graph AI Agent now uses patch-gated durable
child turns over this contract. Its setup snapshot exposes tools plus exact resources,
resource templates, and prompts as bounded model operations; every selected operation is
recorded and dispatched with its canonical typed identity through the same durable invocation
path. A true follow-up turn for a completed workflow Agent remains
available without reopening the completed graph node. Each accepted request creates an
idempotently named coordinator and a new durable Agent child linked to the public conversation
in Postgres. The worker clones the bounded conversation from organization-scoped state refs,
adds the new user message, and materializes fresh authority from the source run's immutable graph.
It does not Signal the closed child or emit another node lifecycle. The trace API projects the
linked turns as one cursor-safe conversation, while each child retains a distinct internal Agent
run identity. Only one follow-up may be queued or running per conversation. Remaining work is MCP
Tasks, the Task 8 unbound-source migration, and the separately bounded Studio v1 sessionful
migration.

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

Saved-server credential generations are derived from persisted secret dependency IDs
and current active-version metadata, independently of health timestamps and tool-cache
updates. Header and argument dependencies are indexed separately so partial edits remain
precise without decrypting unchanged configuration. Rows from before the dependency-index
migration use the organization credential-version set as a conservative compatibility
boundary until they are re-saved; remove that fallback after an upgrade audit finds no
unindexed rows.

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

The Redis lease wire record stores the canonical runtime key as an opaque JSON string
plus its hash. Lua may rewrite mutable lease metadata but never parses that identity,
because Redis cjson cannot round-trip every JavaScript-safe integer. Readers accept the
bounded v1 lease format while new writers emit v2; multi-worker rolling deployments must
use an expand/contract release or a coordinated worker restart before enabling v2 writes.

Acquire reserves a `starting` generation before spawning and tags every probe,
child/container, and live resource. A crash window may briefly leave a non-routable
duplicate resource; only one generation becomes routable, and owner-local tracking plus
reconciliation reaps the rest. The owner uses fenced heartbeats, self-fences/refuses new
calls after renewal loss, and drains before rolling shutdown.

A successful acquire returns a ready reference plus a caller-supplied holder ID. The
exact owner retains that holder before the acquisition becomes usable, validates the
holder and full fence on every operation, and drains only after the final holder releases.
Release is idempotent for the same holder and fence. Durable callers derive a stable
holder ID from their execution identity so Temporal retries reclaim and release the same
ownership instead of accumulating process-local references. A cross-worker retain with
an ambiguous response performs a bounded best-effort release using that same holder.

Docker inventory and reconciliation use the same deployment, local-instance, Temporal
namespace, and task-queue scope as Redis lease keys. A worker may therefore reap only
resources from its exact ownership domain, not another local instance or deployment that
shares the Docker daemon.

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

The `core.ai.agent` loop runs in a deterministic child Workflow on the
`sentris-durable-ai-agent-turn-v1` patch path; pre-patch histories retain the original
single component activity. Top-level nodes and For Each iterations use deterministic,
collision-free child identities. Model requests and tool calls are separate activities.
A model turn may produce zero or more tool calls; independent calls run with bounded
concurrency and results return in deterministic model-call order.
Exactly-once external effects are impossible without upstream idempotency. Mutating,
unknown, or unreviewed dispatch activities use `maximumAttempts: 1`; retryable preflight
is separate, and post-dispatch timeout/worker loss is reported as ambiguous.

Temporal's official AI SDK provider integration is evaluated behind `AgentRuntime`, not
made foundational before it passes replay, streaming, cancellation/heartbeat,
multi-tool, provider, and payload/history acceptance. Its MCP helper is not used as the
wire owner. If the experimental integration fails those gates, a thin Workflow over
ordinary activities calling maintained Vercel AI SDK providers implements the same
boundary. No additional agent framework is added without a concrete missing capability.

The graph agent prepares the root state before starting its child Workflow. Inline
provider keys are sealed with the secret-store master key, the child input is sanitized,
and immutable native AI SDK response-message checkpoints and tool results live in
organization-scoped MinIO files. This preserves provider continuation metadata (including
Gemini thought signatures) while child Workflow history carries compact references and
control state. Retry attempts use distinct model checkpoint identities so a late attempt
cannot overwrite the result Temporal accepted. The loop remains bounded to 128 model
steps and continues as new after 32 completed model/tool checkpoints, or earlier when
Temporal recommends it. The next run carries only the externalized state reference and
next step under the same child Workflow ID and public Sentris run identity. Rollover never
resets the total step budget and occurs only after a complete checkpoint. Global timeouts
are workload-specific. Human input uses Temporal signals;
model/MCP cancellation and idle-call heartbeats are acceptance requirements rather than
assumed upstream behavior.
The worker classifies the AI SDK's normalized provider-declared `error` finish reason at one
provider-neutral boundary before graph-Agent state is checkpointed. Operator may make one
text-only recovery call from bounded durable action evidence; graph Agents fail the model
step instead of recording an empty success. Opaque provider finish details are bounded
diagnostics only and never drive provider-specific control flow.

The graph-Agent child has no message handlers, so its checkpoint-boundary rollover cannot
abandon an accepted Update. Any future unbounded Workflow that accepts Updates must first
mark itself draining, reject new invocation Updates with a retryable rollover response,
and wait for accepted handlers to finish. The next run carries the compact manifest and
recent invocation-result ledger. The backend retries the same invocation ID against the
stable Workflow ID; a unique durable attempt record returns completed results, safely
resumes prepared calls, and leaves
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
- Graph-agent runs externalize native model messages and tool results and Continue-As-New
  from complete checkpoints before history/payload limits.
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
Run-gateway session state, affinity, and legacy SSE have been removed. The no-snapshot
live-catalog/signal path remains only until every Workflow history predating the durable
invocation protocol is terminal or retired and every token lacking
`capabilitySnapshotId` has expired from Redis; the token TTL is capped at three hours.
Studio session state and affinity remain until Studio uses the shared facade and durable
task projection. The backend MCP gateway owns the contract-v1 snapshot/tool-projection
boundary and removes it only after old tokens and Workflow histories are expired,
terminal, or retired. Task 8 owns migrating every contract-v2 unbound tool-only caller;
once that inventory is empty, remove its fallback together with the outbound v1 pool.
Task 8 also owns the database contract phase: backfill any legacy-null operation identities,
prove that no old backend writers remain, then enforce `operation_kind` and
`operation_target` as non-null. The legacy repository/service tool projection is removed
in the same reviewed replay migration, after the production history inventory passes. If
a new run-gateway session adapter is ever enabled, the versioned supported-client matrix
and backend MCP module owner make a mandatory remove-or-explicitly-renew decision no
later than its second normal release; renewal requires an ADR update and product approval.

## References

- `docs/architecture/research/mcp-v2-runtime-sdk-2.0.0.md`
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
