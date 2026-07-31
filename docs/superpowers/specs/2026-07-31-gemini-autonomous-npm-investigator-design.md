# Gemini Autonomous npm Investigator

## Goal

Ship one polished, immediately usable autonomous security-investigation workflow that
demonstrates why Sentris Flow is valuable:

```text
npm package → public intelligence + source scan → MCP-assisted Gemini investigation
            → live agent transcript → report artifact + canonical findings
```

The first slice optimizes for useful product capability. It does not depend on the
currently unverified OpenCode container, add a new security sandbox, or broaden the
test matrix beyond the behavior changed here.

Success means:

- a user can choose the official template, map one stored Gemini secret, enter an npm
  package, and start a useful investigation;
- the published package tarball is fetched once and reused for source evidence and
  scanning;
- Gemini receives package intelligence, advisory evidence, scanner leads, source
  context, and any enabled MCP tools;
- the Agent tab grows while the model is responding instead of showing all prose only
  after completion;
- the run preserves a readable Markdown report even when no finding is promoted;
- only evidence-backed structured findings are sent to the Findings dashboard;
- one real Gemini run is manually verified through the browser before the work is
  considered complete.

## Product and scope decisions

### Selected: native Gemini agent with durable Agent trace streaming

`core.ai.agent` already supports Gemini through the AI SDK, execution profiles,
bounded autonomous tool loops, exact MCP tool selection, and best-effort tool
availability. Its AgentTrace path is already durable:

```text
worker → Kafka → backend persistence → agent chat SSE → Agent tab
```

The missing behavior is incremental model prose. The component currently calls
`ToolLoopAgent.generate()` and publishes the complete response at the end. Switching
that component to the AI SDK streaming API completes the existing architecture
without a new frontend transport.

### Deferred: Gemini through OpenCode

OpenCode would provide a capable coding-agent filesystem loop, but the checked-in
container and worker adapter currently target different generations of its CLI. The
worker also lacks Gemini's `GEMINI_API_KEY` and `google/<model>` mappings. Mocked unit
tests cannot prove that container contract works.

This path remains valuable, but it must begin with a pinned image and a real CLI smoke
test. The first Gemini workflow will not depend on it.

### Rejected for this slice: rewrite the existing full npm CVE pipeline

The current full npm pipeline has 41 nodes, multiple scanners, three Claude stages,
fallback branches, and iteration state. Replacing its agent stack in place would make
the first Gemini deliverable slower to understand and harder to accept manually.

The new workflow reuses its strongest evidence and promotion rules while presenting a
smaller workflow a new user can actually follow.

## User experience

The official template is named **Gemini Autonomous npm Investigator**.

Required runtime input:

- `packageSpec` — package name with an optional version, such as `lodash@4.17.20`

Optional runtime inputs:

- `researchFocus` — vulnerability class, suspected code path, CVE, or question to
  prioritize;
- `authorizationNotes` — scope or engagement context that should be carried into the
  report.

Required secret:

- `GEMINI_API_KEY`, selected from Sentris Secrets when the template is used.

The template uses `gemini-2.5-flash` by default so the acceptance run is inexpensive
and fast. The workflow stores a secret reference, never the key value. A user can
change the model configuration on the agent node after importing the template.

The workflow should remain useful when no MCP servers are enabled. When tools are
available, the agent can use all enabled servers by default. The run report must say
whether tools were available so users understand the evidence boundary.

## Workflow architecture

The graph stays near twelve nodes and uses existing components:

1. `core.workflow.entrypoint` collects `packageSpec`, `researchFocus`, and
   `authorizationNotes`.
2. `core.logic.script` normalizes the package input and produces package name/version
   fields plus a concise investigation brief.
3. `sentris.npm.registry.intel` resolves registry metadata and published-version
   provenance.
4. `sentris.osv.query` looks up known advisories for the resolved npm package/version.
5. `sentris.npm.package.source` downloads the selected published tarball once and
   exposes its bounded source bundle and scan volume.
6. `sentris.semgrep.run` scans the extracted published source.
7. `core.logic.script` merges registry, OSV, package provenance, source excerpts, and
   scanner results into one bounded evidence packet. It records unavailable sources
   as caveats rather than manufacturing empty success.
8. `mcp.custom` exposes enabled MCP tools with `useAllEnabled: true` and
   `continueOnServerError: true`.
9. `core.ai.agent` runs Gemini with the `deep` execution profile, a generous output
   budget, best-effort MCP availability, and an explicit investigation/promotion
   prompt.
10. `core.logic.script` separates the human report from a compact structured-findings
    sidecar. Malformed or absent structured JSON results in zero promoted findings,
    while retaining the full report.
11. `core.artifact.writer` stores the Markdown investigation report.
12. `core.analytics.sink` ingests only normalized, evidence-backed findings into the
    canonical Findings dashboard.

Registry lookup, OSV lookup, and tarball retrieval may run in parallel after input
normalization where their input contracts permit it. Semgrep begins as soon as the
tarball volume exists. The evidence merge uses the graph's `any` join semantics and
explicit fallback values so one unavailable enrichment source does not discard all
other evidence.

CodeQL, OpenGrep, and Jazzer remain available in the existing advanced pipeline. They
are not duplicated here: the focused workflow should reach autonomous investigation
quickly, while MCP tools allow a locally equipped install to extend the analysis.

## Agent contract

The template binds Gemini directly on `core.ai.agent`:

```json
{
  "chatModel": {
    "provider": "gemini",
    "modelId": "gemini-2.5-flash"
  },
  "modelApiKey": "{{SECRET:GEMINI_API_KEY}}"
}
```

The agent uses:

- `executionProfile: "deep"`;
- `toolAvailability: "best-effort"`;
- a high but bounded step limit suitable for autonomous investigation;
- a generous final-output budget;
- low temperature for reproducible evidence handling.

The system prompt makes these distinctions explicit:

- the published package tarball is primary affected-version evidence;
- registry and OSV records are intelligence, not proof of a newly discovered flaw;
- scanner output is a lead until the relevant source and data flow support it;
- repository-only behavior must not be attributed to the published package;
- unknown or unavailable evidence must be reported as a caveat;
- CVE IDs, affected versions, exploitability, and impact must never be invented;
- MCP tools may deepen or corroborate evidence, but unavailable MCP does not prevent
  analysis of the supplied packet;
- the final response contains a readable Markdown report followed by a delimited,
  compact JSON findings sidecar.

Each structured finding includes a stable title, severity, confidence, affected
package/version, vulnerability class, evidence references, impact, reproduction or
verification notes, and remediation guidance. The parser rejects entries without
concrete evidence and normalizes them into the existing analytics-results contract.

## Incremental streaming design

`core.ai.agent` changes from `ToolLoopAgent.generate()` to
`ToolLoopAgent.stream()`. It consumes `fullStream` as it is produced:

- text deltas are published to `AgentStreamRecorder`;
- tool input, output, and error events are projected into the existing trace part
  types without duplicates;
- the final result promises are awaited to preserve `responseText`, conversation
  state, tool messages, and finish reason exactly as component outputs expect.

Text deltas are coalesced inside the recorder for a short interval or small byte
threshold. This keeps the transcript perceptibly live without producing one
Kafka/Postgres row per token. Pending text is flushed before tool events, finish,
error, and activity cleanup so event order remains meaningful.

The recorder uses one text ID for text start, every delta, and text end. It emits at
most one terminal event. Exceptions produce a terminal error trace before the
component rethrows, preventing the Agent tab from polling forever.

No new websocket or frontend state store is introduced. Focused backend/frontend
changes are made only if browser acceptance exposes the known first-ingest or
workflow-completion race in the current polling transport.

## Secret handling and local acceptance

The provided Gemini key is entered once through the local Sentris Secrets flow. It is
not added to `.env` files, command arguments, template JSON, tests, fixtures,
documentation, or Git.

The official template declares:

```json
{
  "name": "GEMINI_API_KEY",
  "type": "string",
  "description": "Gemini API key stored in Sentris Secrets."
}
```

Template use replaces the named placeholder with the selected secret ID. The worker's
normal secret resolver provides the value only for execution, and existing
credential-port masking keeps it out of node inputs and outputs.

## Error behavior

- Invalid package input fails at normalization with an actionable message.
- A missing package or tarball fails before model spend.
- OSV or registry enrichment failure becomes a visible evidence caveat when the
  published source is still available.
- Semgrep failure becomes a caveat and does not erase source evidence.
- MCP discovery failure degrades to built-in model analysis because the template
  selects best-effort tools.
- Gemini authentication, quota, or provider failure fails the agent node visibly and
  emits a terminal error trace.
- Malformed findings JSON never creates dashboard findings; the Markdown report is
  still saved.
- An empty evidence-backed findings list is a valid completed investigation.

## File boundaries

Expected implementation files:

- `worker/src/components/ai/ai-agent.ts`;
- `worker/src/components/ai/agent-stream-recorder.ts`;
- focused tests beside those components;
- one new official seed under `backend/scripts/seed-templates/`;
- focused assertions in
  `backend/src/templates/__tests__/seed-templates.spec.ts`;
- deterministic live-audit input in
  `packages/shared/src/template-validation-fingerprint.ts` if required by the
  existing validator.

The existing user-owned changes in `backend/.env.docker`, `.cursor/`, and
`.playwright-mcp/` remain untouched.

## Verification

Verification is deliberately proportional to this product slice:

1. Focused recorder tests prove early delta publication, ordering, coalescing, flush,
   matching text IDs, and a single terminal event.
2. Focused AI-agent tests use a delayed fake stream to prove transcript events arrive
   before model completion while final outputs and tool messages remain intact.
3. Template seed tests compile the graph, validate named secret mapping, and assert the
   evidence/agent/artifact/findings path.
4. Run the repository's template catalog check and relevant worker/backend typechecks.
5. Seed the new template into active instance 0.
6. Store the Gemini key through Sentris Secrets, use the template, and run one small
   public-package investigation.
7. In the browser, confirm:
   - the template preview and secret mapping are understandable;
   - the run starts and the Agent transcript grows before completion;
   - MCP status is clear whether or not tools are configured;
   - the Markdown report artifact is readable;
   - any promoted Findings rows point to concrete evidence;
   - no secret value appears in workflow inputs, node outputs, terminal output, or
     artifacts.

Broader security scans, unrelated E2E suites, and OpenCode container work are outside
this slice.
