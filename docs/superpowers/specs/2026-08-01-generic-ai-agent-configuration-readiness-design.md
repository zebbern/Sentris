# Generic AI Agent Configuration and Run Readiness

## Goal

Make the generic `core.ai.agent` usable from the workflow builder without relying on
template-authored JSON. A user must be able to select a provider, model, and stored
credential, understand whether the agent and its optional MCP tools are ready, and
successfully run a real investigation.

Success means:

- the generic AI Agent exposes the same focused model editor as the existing OpenCode
  and Claude Code agents;
- the editor writes the actual model input declared by component metadata rather than
  assuming every component uses an input named `model`;
- provider, model, and credential references survive workflow serialization,
  compilation, and execution;
- the builder and template launch flow use one readiness model for provider, credential,
  and connected MCP state;
- missing required model configuration is clear before execution, while optional MCP
  degradation does not prevent a run;
- existing workflows using the legacy `modelApiKey` input continue to execute;
- focused automated tests and one real Gemini npm investigation verify the complete
  path.

This slice does not feature a specific template on `/workflows/new`, introduce a new
agent framework, or implement the product-wide Operator.

## Selected approach

### Selected: semantic LLM-provider ports and shared readiness

Add `llm-provider` as a semantic component-port editor. Agent components opt their
LLM contract input into this editor, and the frontend discovers the real port ID from
component metadata. `core.ai.agent` therefore uses `chatModel`, while OpenCode and
Claude Code continue using `model` without a component-ID-to-port map.

The existing `core.ai.llm-provider.v1` contract remains the canonical stored model
shape. It already contains provider-specific model, API-key secret reference, OAuth
secret reference, base URL, and optional provider settings. New edits store credential
references inside this contract.

A shared, pure readiness evaluator interprets that contract, graph connections,
available secret summaries, and MCP server state. The model editor, builder validation,
and template launch summary consume the same result instead of maintaining parallel
rules.

### Rejected: add the generic agent to current hardcoded maps

Adding `core.ai.agent` and `chatModel` cases to the existing frontend and worker maps
would be quicker, but it would preserve two credential shapes and require another case
for every future agent. It treats the current symptom rather than the missing semantic
port boundary.

### Rejected: template-launch readiness only

Improving `UseTemplateModal` alone would make selected templates easier to launch but
would leave a generic agent dropped onto the canvas partially unconfigurable. Template
readiness is included, but it is a consumer of the canonical agent configuration rather
than the implementation boundary.

## Component metadata contract

Extend the component SDK's closed port-editor union with `llm-provider`, including the
extracted `ComponentPortMetadata` type and the frontend component schema. The editor is
a UI semantic and does not change connection compatibility: the port continues using
the credential-bearing `core.ai.llm-provider.v1` connection contract.

Mark the model input on these existing agent components:

- `core.ai.agent` — `chatModel`;
- `core.ai.opencode` — `model`;
- `core.ai.claude-code` — `model`.

The component registry already carries port metadata through the backend component
catalog. The backend response documentation and generated OpenAPI/backend client must
include the new editor value and the existing `hidden` input metadata that the frontend
will now consume.

Activation of the editor is metadata-driven. Component-specific behavior remains
allowed inside the editor where it represents a real capability difference, such as
Claude Code subscription OAuth and effort settings; it must not decide which input ID
to read or write.

## Model and credential editing

Generalize `AgentModelConfig` to receive the editor-marked input ID and its current
connection. It reads and writes `inputOverrides[modelInputId]`, so configuration follows
the component contract rather than the literal key `model`.

Inline editing supports the providers already handled by the worker:

- Anthropic;
- OpenAI;
- Gemini;
- OpenRouter;
- Z.AI Coding Plan.

The model selector retains curated defaults and permits the exact current model ID even
when it is not in the curated list. Selecting an API key stores only
`apiKeySecretId`. Claude subscription authentication stores only
`oauthTokenSecretId`. Raw credential values are never persisted in the graph.

When the LLM port is connected from a provider node, inline controls are disabled and
the UI reports the connected source. The source node remains responsible for its own
credential validation.

Inputs owned by the semantic editor are omitted from the generic input editor. The
legacy `core.ai.agent.modelApiKey` port is marked hidden for new UI use but remains in
the component schema so existing graphs and connections continue to compile.

## Credential migration and runtime resolution

Generalize the worker's inline LLM credential resolver to inspect the component's input
metadata for `core.ai.llm-provider.v1` contracts. It resolves
`apiKeySecretId` or `oauthTokenSecretId` on every matching input using the actual port
ID, then places the resolved value only in the activity-local input object.

Runtime precedence is explicit:

1. a credential resolved from the canonical LLM-provider contract;
2. the legacy `modelApiKey` input when the canonical contract has no credential;
3. a visible configuration error when neither source is present.

This allows old workflow versions and templates to replay while ensuring a stale
legacy alias cannot override a newly selected canonical credential. The official
Gemini npm investigator seed moves its placeholder to
`chatModel.apiKeySecretId`; `modelApiKey` remains a read-compatible migration boundary.

The alias can be removed only after all of these conditions are true:

- shipped templates no longer write it;
- repository fixtures no longer depend on it;
- active persisted workflow versions using it have been migrated or reached their
  documented retention boundary.

## Shared readiness model

The readiness evaluator returns structured rows rather than UI text. Each row has a
kind, state, short label, detail, and whether it blocks creation or execution.

### Model

Ready when either:

- the LLM-provider input has a graph connection; or
- the inline configuration contains a supported provider and a non-empty model ID.

A missing or malformed inline provider/model is blocking.

### Credential

For inline configuration, readiness means the referenced secret ID exists in the
organization's loaded secret summaries. The UI says **Mapped** or **Needs mapping**;
it never claims the underlying provider credential is valid because secret summaries
do not expose or test the value.

For a connected provider input, the row says the credential comes from the connected
provider. Validation of that provider's required inputs remains on its own node.

A missing required inline credential is blocking. Secret-list loading and query errors
produce an explicit unknown/error state rather than a false ready state.

### MCP tools

Move the existing MCP Library agent-readiness types and calculation into a shared
frontend module, then reuse them from the MCP Library and template launch flow.

The graph adapter recognizes `mcp.custom` configuration, including use-all-enabled,
explicit server IDs, exclusions, and server health/tool counts. Behavior follows the
agent's actual tool policy:

- no connected MCP node: **Not configured (optional)** and non-blocking;
- `best-effort`: unavailable or unhealthy servers are visible but non-blocking;
- `required`: connected MCP selections with no usable tools are blocking;
- query failure: **Could not check MCP readiness**, blocking only for required tools.

This is a preflight description of configured state, not a substitute for the durable
run-scoped MCP snapshot and runtime checks performed during execution.

## User experience

### Agent configuration panel

The generic AI Agent shows one compact **Model & API Key** section with provider,
model, and stored-secret controls. Under it, a compact readiness summary uses text and
icons to report the model and credential state. The raw `chatModel` JSON and legacy
`modelApiKey` controls are not duplicated elsewhere in the panel.

### Builder validation

The validation dock uses the same model readiness helper. A generic agent with a
missing provider/model or credential points the user back to that node before they
press Run. This slice does not add a confirmation dialog to otherwise immediate
builder runs; readiness remains continuously visible without adding a nuisance click.

### Template Configure & Run

`UseTemplateModal` adds a compact readiness block above its action buttons:

```text
Model        Gemini · gemini-3.5-flash
Credential   GEMINI_API_KEY · Mapped
MCP tools    4 ready · optional
```

The modal parses provider/model and MCP selection from the template graph defensively,
while required credential names continue to come from `template.requiredSecrets`.
MCP queries start only while this modal is mounted, not for every card in the Template
Library.

Missing required secret mappings disable **Create & Run**. Optional MCP warnings do
not. The rows reserve stable space while queries load, include text in addition to
color, and announce state changes politely to assistive technology.

## Data flow

```text
component Zod port metadata
  → component registry
  → backend component catalog
  → frontend component schema
  → ConfigPanel discovers editor-marked input ID
  → inputOverrides[actualPortId] stores LLM provider contract
  → workflow serializer/compiler preserve arbitrary overrides
  → worker resolves nested secret reference for the contract input
  → core.ai.agent receives provider, model, and activity-local API key
```

Readiness uses existing organization-scoped TanStack Query hooks for components,
secrets, and MCP servers/tools. No new backend endpoint or Zustand API-data store is
introduced.

## Error behavior

- Unsupported or malformed stored provider data falls back to an editable normalized
  view and remains not-ready until corrected.
- A selected secret deleted after configuration is reported as **Needs mapping**.
- A secret-query failure is shown distinctly from a missing secret.
- Optional MCP discovery/health failures remain visible and non-blocking.
- Required MCP with no usable tools blocks template creation and produces a builder
  validation issue.
- Runtime authentication or quota errors still come from the provider and fail the
  agent node normally; readiness does not claim to validate credentials.
- Legacy `modelApiKey` graphs continue through the fallback path without rewriting
  saved historical versions.

## Verification

Verification is focused on changed behavior:

1. Component SDK tests prove `llm-provider` and `hidden` metadata survive port
   extraction and catalog serialization.
2. Frontend model utility and ConfigPanel tests prove `core.ai.agent` reads/writes
   `chatModel`, stores `apiKeySecretId`, respects provider connections, and hides
   semantic/legacy inputs from generic controls.
3. Shared readiness tests cover inline and connected models, mapped/deleted/query-error
   credentials, no MCP, best-effort degraded MCP, required unavailable MCP,
   use-all/explicit selections, and exclusions.
4. Template modal tests prove compact rows render, missing mappings block creation,
   and optional MCP problems do not block.
5. Worker resolver tests prove non-hardcoded LLM input IDs, API-key and OAuth resolution,
   canonical-over-legacy precedence, and organization isolation.
6. The Gemini seed-template test proves the placeholder is nested under
   `chatModel.apiKeySecretId` and the graph still compiles.
7. Run focused package tests, affected typechecks, generated OpenAPI/backend-client
   checks, and lint only for touched workspaces.
8. Check the selected local instance before starting it. In the browser, configure the
   generic agent, confirm the compact readiness states, save/reload the workflow, and
   verify the selection persists.
9. Run one real Gemini investigation against a small public npm package. Confirm the
   run completes, the Agent transcript and report are useful, MCP status matches the
   configured optional state, and no credential value appears in graph JSON, node
   output, terminal logs, or artifacts.

Broad security scans, unrelated E2E suites, and repeated full-repository test passes
are outside this slice.

## Operator sequencing

The product-wide Operator is the next independent design/implementation cycle, not an
extension of this patch. Its approved action preference has two user-selectable modes:

- **Ask for approval** (default): reads and explicit low-risk operations run directly;
  consequential workflow, integration, and ticket mutations pause on an exact action
  proposal;
- **Approve for me**: reads and supported commands execute without confirmation.

The mode changes approval policy, not command capability. Both modes will use the same
typed command registry, audit trail, organization/user-owned durable session, existing
domain services, and Temporal execution boundaries. Workflow editing will require
optimistic version checks and a reviewable diff before it is added to either mode.
