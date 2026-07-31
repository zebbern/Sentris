# Gemini Autonomous npm Investigator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a native Gemini-powered npm security-investigation template whose Agent transcript streams during execution and whose report produces evidence-backed canonical findings.

**Architecture:** Extend the existing AgentTrace pipeline instead of adding a transport: coalesce AI SDK text deltas in the worker, persist them through the existing Kafka/backend path, and keep one stable text ID through UI conversion. Add a focused official npm template that reuses one published tarball for source context and Semgrep, gives the native AI SDK Agent optional MCP tools, saves its Markdown response, and promotes only structured entries with concrete evidence.

**Tech Stack:** TypeScript, Bun tests, AI SDK 6 `ToolLoopAgent`, NestJS Agent controller, Sentris component SDK/DSL, Temporal worker components, JSON official template seeds.

## Global Constraints

- Work directly on `main`; the user explicitly approved this workflow.
- Preserve the user-owned `backend/.env.docker`, `.cursor/`, and `.playwright-mcp/` changes.
- Use active Sentris instance `0` for all local execution and acceptance.
- Never place the supplied Gemini key in Git, `.env`, shell arguments, fixtures, logs, documentation, screenshots, or report content.
- Store the key only through the local Sentris Secrets UI and persist only the selected secret ID in the workflow.
- Use native `core.ai.agent`; OpenCode and Claude Code streaming are outside this slice.
- Do not expose model reasoning deltas. Stream final-response text and tool lifecycle events only.
- Coalesce text for perceptible live output without creating one Kafka/Postgres record per token.
- Use `gemini-3.5-flash`, `executionProfile: "deep"`, `toolAvailability: "best-effort"`, and named secret placeholder `{{SECRET:GEMINI_API_KEY}}`.
- Fetch the published npm tarball once and reuse its source bundle/volume.
- Scanner and MCP output are leads; only evidence-backed agent sidecar entries become canonical findings.
- Run focused tests/typechecks and one live browser acceptance; do not run unrelated broad security suites.
- Every commit uses Conventional Commits and DCO (`git commit -s`).

---

## File map

- `worker/src/components/ai/agent-stream-recorder.ts` — stable text stream identity, short coalescing window, ordered flush, and one terminal trace.
- `worker/src/components/ai/__tests__/agent-stream-recorder.test.ts` — recorder red/green contract.
- `backend/src/agents/agents.controller.ts` — preserve the recorder text ID when converting trace events to AI SDK UI chunks.
- `backend/src/agents/__tests__/agents.controller.spec.ts` — conversion regression contract.
- `worker/src/components/ai/ai-agent.ts` — consume `ToolLoopAgent.stream().fullStream`, project text/tool events, and preserve final component outputs.
- `worker/src/components/ai/__tests__/ai-agent.test.ts` — delayed-stream proof and existing agent behavior migrated to the stream API.
- `backend/scripts/seed-templates/gemini-autonomous-npm-investigator.json` — official workflow graph, prompts, evidence builder, report parser, artifact, and Findings sink.
- `backend/src/templates/__tests__/seed-templates.spec.ts` — catalog, graph, script, secret, and promotion-gate assertions.
- `packages/shared/src/template-validation-fingerprint.ts` — deterministic public-package live input.

---

### Task 1: Make Agent trace text ordered, bounded, and ID-stable

**Files:**

- Modify: `worker/src/components/ai/agent-stream-recorder.ts`
- Modify: `worker/src/components/ai/__tests__/agent-stream-recorder.test.ts`
- Modify: `backend/src/agents/agents.controller.ts`
- Modify: `backend/src/agents/__tests__/agents.controller.spec.ts`

**Interfaces:**

- Consumes: existing `ExecutionContext.agentTracePublisher` and `AgentTraceEvent`.
- Produces: `AgentStreamRecorder.emitTextDelta(textDelta)`, `emitToolInput`, `emitToolOutput`, `emitToolError`, `emitFinish`, and `flush`, with text-delta parts carrying the same `id` emitted by text-start/text-end.
- Produces: `convertAgentTraceToUiChunk()` text chunks whose `text-start`, `text-delta`, and `text-end` IDs match.

- [ ] **Step 1: Add failing recorder tests**

Add tests that name the production breaks:

```ts
it('preserves whitespace and flushes coalesced text before a tool event', async () => {
  const published: AgentTraceEvent[] = [];
  const recorder = new AgentStreamRecorder(contextWithPublisher(published), 'agent-run-1', {
    textFlushIntervalMs: 5,
    textFlushMaxChars: 1024,
  });

  recorder.emitTextDelta('Hello');
  recorder.emitTextDelta(' world\n');
  recorder.emitToolInput('call-1', 'lookup', { package: 'lodash' });
  await recorder.flush();

  expect(published.map((event) => event.part)).toEqual([
    { type: 'data-text-start', data: { id: 'agent-run-1:text' } },
    { type: 'text-delta', id: 'agent-run-1:text', textDelta: 'Hello world\n' },
    {
      type: 'tool-input-available',
      toolCallId: 'call-1',
      toolName: 'lookup',
      input: { package: 'lodash' },
    },
  ]);
});

it('publishes a small text buffer on the live flush interval', async () => {
  const published: AgentTraceEvent[] = [];
  const recorder = new AgentStreamRecorder(contextWithPublisher(published), 'agent-run-1', {
    textFlushIntervalMs: 5,
    textFlushMaxChars: 1024,
  });

  recorder.emitTextDelta('early');
  await Bun.sleep(15);
  await recorder.flush();

  expect(published.some((event) => event.part.type === 'text-delta')).toBe(true);
});

it('emits only one terminal part and closes the active text id', async () => {
  const published: AgentTraceEvent[] = [];
  const recorder = new AgentStreamRecorder(contextWithPublisher(published), 'agent-run-1');
  recorder.emitTextDelta('done');
  recorder.emitFinish('stop', 'done');
  recorder.emitFinish('stop', 'duplicate');
  await recorder.flush();

  expect(published.filter((event) => event.part.type === 'finish')).toHaveLength(1);
  expect(published.find((event) => event.part.type === 'data-text-end')?.part).toEqual({
    type: 'data-text-end',
    data: { id: 'agent-run-1:text' },
  });
});
```

Import the real `AgentTraceEvent` type and add a test-local `contextWithPublisher()` helper; do not add a test-only method to the production class.

- [ ] **Step 2: Run the recorder tests and verify RED**

Run:

```powershell
bun test worker/src/components/ai/__tests__/agent-stream-recorder.test.ts
```

Expected: failures because the constructor has no options, text deltas have no `id`, whitespace is dropped, and terminal calls are not guarded.

- [ ] **Step 3: Add a failing backend ID conversion test**

In `agents.controller.spec.ts`, replace the current expectation that a delta without an ID uses `AGENT_RUN_ID` only where appropriate, and add:

```ts
it('preserves one text id across start, delta, and end chunks', async () => {
  const events = [
    makeEvent({ sequence: 1, part: { type: 'data-text-start', data: { id: 'text-1' } } }),
    makeEvent({ sequence: 2, part: { type: 'text-delta', id: 'text-1', textDelta: 'hello' } }),
    makeEvent({ sequence: 3, part: { type: 'data-text-end', data: { id: 'text-1' } } }),
  ];

  expect(await getChunks(events)).toEqual([
    { type: 'text-start', id: 'text-1' },
    { type: 'text-delta', id: 'text-1', delta: 'hello' },
    { type: 'text-end', id: 'text-1' },
  ]);
});
```

Use the file's existing controller/SSE helpers rather than exporting the private converter.

- [ ] **Step 4: Run the backend test and verify RED**

Run:

```powershell
bun --cwd=backend test src/agents/__tests__/agents.controller.spec.ts
```

Expected: the text delta uses `agentRunId` because the current recorder part cannot supply a stable ID.

- [ ] **Step 5: Implement bounded recorder buffering**

Add:

```ts
export interface AgentStreamRecorderOptions {
  textFlushIntervalMs?: number;
  textFlushMaxChars?: number;
}

const DEFAULT_TEXT_FLUSH_INTERVAL_MS = 150;
const DEFAULT_TEXT_FLUSH_MAX_CHARS = 2048;
```

Extend the `text-delta` union member to:

```ts
{
  type: 'text-delta';
  id: string;
  textDelta: string;
}
```

Store `pendingText`, a timeout handle, resolved option values, and `terminalEmitted`.
`emitTextDelta()` must:

1. ignore only `textDelta.length === 0`;
2. call `ensureTextStream()` immediately;
3. append exact text, including spaces/newlines;
4. flush synchronously at the character threshold;
5. otherwise schedule one short timer.

`flushPendingText()` clears the timer and emits:

```ts
{
  type: 'text-delta',
  id: this.activeTextId!,
  textDelta,
}
```

Call `flushPendingText()` before every tool event and before text-end/finish. Guard
`emitFinish()` with `terminalEmitted`. Call `flushPendingText()` at the beginning of
`flush()` so activity cleanup cannot lose buffered text.

- [ ] **Step 6: Preserve nested data IDs in the backend converter**

For `data-text-start` and `data-text-end`, read:

```ts
const data = isRecord(payload.data) ? payload.data : {};
const textId = ensureString(payload.id) ?? ensureString(data.id) ?? baseMessageId;
```

Return `textId`. Keep `text-delta` preferring `payload.id`. Add a small local
`isRecord()` helper if the controller does not already have one.

- [ ] **Step 7: Run focused tests and commit**

Run:

```powershell
bun test worker/src/components/ai/__tests__/agent-stream-recorder.test.ts
bun --cwd=backend test src/agents/__tests__/agents.controller.spec.ts
```

Expected: both commands exit `0`.

Commit:

```powershell
git add -- worker/src/components/ai/agent-stream-recorder.ts worker/src/components/ai/__tests__/agent-stream-recorder.test.ts backend/src/agents/agents.controller.ts backend/src/agents/__tests__/agents.controller.spec.ts
git commit -s -m "feat: stream agent trace text reliably"
```

---

### Task 2: Stream native AI SDK Agent output before completion

**Files:**

- Modify: `worker/src/components/ai/ai-agent.ts`
- Modify: `worker/src/components/ai/__tests__/ai-agent.test.ts`

**Interfaces:**

- Consumes: Task 1 `AgentStreamRecorder` ordering/flush contract.
- Consumes: AI SDK `ToolLoopAgent.stream()` returning `StreamTextResult<ToolSet, never>`.
- Produces: unchanged `AiAgentOutput` (`responseText`, `conversationState`, `agentRunId`, `toolStatus`) plus incremental AgentTrace parts.

- [ ] **Step 1: Convert the test double to the stream contract**

Replace `GenerateTextResult` test typing with `StreamTextResult`/`TextStreamPart` typing.
Add:

```ts
function asyncParts(parts: TextStreamPart<ToolSet>[]): AsyncIterable<TextStreamPart<ToolSet>> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const part of parts) yield part;
    },
  };
}

type StreamToolResult = Awaited<StreamTextResult<ToolSet, never>['toolResults']>[number];

function createStreamResult(
  options: {
    parts?: TextStreamPart<ToolSet>[];
    text?: string;
    toolResults?: StreamToolResult[];
    finishReason?: FinishReason;
  } = {},
): StreamTextResult<ToolSet, never> {
  const text = options.text ?? 'Agent final answer';
  return {
    fullStream: asyncParts(
      options.parts ?? [
        { type: 'text-start', id: 'sdk-text-1' },
        { type: 'text-delta', id: 'sdk-text-1', text },
        { type: 'text-end', id: 'sdk-text-1' },
        {
          type: 'finish',
          finishReason: options.finishReason ?? 'stop',
          rawFinishReason: 'stop',
          totalUsage: createUsage(),
        },
      ],
    ),
    text: Promise.resolve(text),
    toolResults: Promise.resolve(options.toolResults ?? []),
    finishReason: Promise.resolve(options.finishReason ?? 'stop'),
  } as unknown as StreamTextResult<ToolSet, never>;
}
```

Change `MockToolLoopAgent.generate()` to `stream()` and migrate existing spies to
return `createStreamResult()`. Preserve the existing assertions for model selection,
step limits, MCP discovery, and conversation-state tool messages.

- [ ] **Step 2: Add the delayed-stream RED test**

Add a test with a real deferred async iterable:

```ts
test('publishes response text before the model stream completes', async () => {
  let releaseFinish!: () => void;
  const finishGate = new Promise<void>((resolve) => {
    releaseFinish = resolve;
  });
  const published: AgentTraceEvent[] = [];

  vi.spyOn(MockToolLoopAgent.prototype, 'stream').mockImplementation(() => {
    const fullStream = {
      async *[Symbol.asyncIterator]() {
        yield { type: 'text-start', id: 'sdk-text-1' } as const;
        yield { type: 'text-delta', id: 'sdk-text-1', text: 'Early evidence' } as const;
        await finishGate;
        yield { type: 'text-end', id: 'sdk-text-1' } as const;
        yield {
          type: 'finish',
          finishReason: 'stop',
          rawFinishReason: 'stop',
          totalUsage: createUsage(),
        } as const;
      },
    };
    return createDeferredStreamResult(fullStream, {
      text: finishGate.then(() => 'Early evidence complete'),
      toolResults: finishGate.then(() => []),
      finishReason: finishGate.then(() => 'stop'),
    });
  });

  const execution = runAgent(contextWithTracePublisher(published));
  await waitFor(() =>
    published.some(
      (event) =>
        event.part.type === 'text-delta' && event.part.textDelta.includes('Early evidence'),
    ),
  );
  expect(published.some((event) => event.part.type === 'finish')).toBe(false);

  releaseFinish();
  const result = await execution;
  expect(result.responseText).toBe('Early evidence complete');
});
```

Use a bounded polling helper (for example 500ms total with 5ms intervals), not an
unbounded sleep.

- [ ] **Step 3: Add tool projection and error RED tests**

Add one table-driven test whose stream contains literal `tool-call`, `tool-result`, and
`tool-error` parts. Assert each produces exactly one corresponding recorder part and
the tool error is truncated/stringified safely. Add a provider-error test asserting the
component rejects while the trace contains exactly one `finish` part with
`finishReason: "error"`.

- [ ] **Step 4: Run the AI-agent test and verify RED**

Run:

```powershell
bun test worker/src/components/ai/__tests__/ai-agent.test.ts
```

Expected: failure because production still calls `generate()` and publishes full text
only after it completes.

- [ ] **Step 5: Replace generation with full-stream consumption**

In `ai-agent.ts`:

- import `StreamTextResult` and `TextStreamPart`;
- remove `GenerateTextResult`, `StepResult`, and the `onStepFinish` projection;
- define `AgentStreamingResult = StreamTextResult<AgentTools, never>`;
- call `await agent.stream({ messages: messagesForModel })`;
- iterate `for await (const part of streamingResult.fullStream)`.

Project only:

```ts
switch (part.type) {
  case 'text-delta':
    agentStream.emitTextDelta(part.text);
    break;
  case 'tool-call':
    agentStream.emitToolInput(part.toolCallId, part.toolName, toRecord(part.input));
    break;
  case 'tool-result':
    agentStream.emitToolOutput(part.toolCallId, part.toolName, part.output);
    break;
  case 'tool-error':
    agentStream.emitToolError(
      part.toolCallId,
      part.toolName,
      safeStringify(part.error, LOG_TRUNCATE_LIMIT),
    );
    break;
  case 'error':
    throw part.error;
}
```

Ignore `reasoning-*`, raw, source, file, step, and SDK text-start/text-end parts. The
recorder owns the persisted text boundary and does not expose hidden reasoning.

After iteration, await:

```ts
const [responseText, toolResults, finishReason] = await Promise.all([
  streamingResult.text,
  streamingResult.toolResults,
  streamingResult.finishReason,
]);
```

Build conversation state from `toolResults` exactly as before. Do not emit
`responseText` a second time. Call `agentStream.emitFinish(finishReason, responseText)`.

Wrap the component body inside the existing lifecycle `try` with a `catch` that:

1. logs a truncated summary without credentials;
2. calls `agentStream.emitFinish('error', error message truncated to the existing log limit);
3. rethrows the original error.

The Task 1 terminal guard prevents duplicates.

- [ ] **Step 6: Run focused tests/typecheck and commit**

Run:

```powershell
bun test worker/src/components/ai/__tests__/ai-agent.test.ts worker/src/components/ai/__tests__/agent-stream-recorder.test.ts
bun --cwd=worker run typecheck
```

Expected: both commands exit `0`.

Commit:

```powershell
git add -- worker/src/components/ai/ai-agent.ts worker/src/components/ai/__tests__/ai-agent.test.ts
git commit -s -m "feat: stream native agent responses"
```

---

### Task 3: Add the official Gemini autonomous npm workflow

**Files:**

- Create: `backend/scripts/seed-templates/gemini-autonomous-npm-investigator.json`
- Modify: `backend/src/templates/__tests__/seed-templates.spec.ts`
- Modify: `packages/shared/src/template-validation-fingerprint.ts`

**Interfaces:**

- Consumes: `core.ai.agent` streaming behavior from Task 2.
- Consumes: `sentris.npm.registry.intel`, `sentris.osv.query`,
  `sentris.npm.package.source`, `sentris.semgrep.run`, `mcp.custom`,
  `core.logic.script`, `core.artifact.writer`, and `core.analytics.sink`.
- Produces: official template **Gemini Autonomous npm Investigator** with runtime
  `packageSpec`, `researchFocus`, and `authorizationNotes`; required secret
  `GEMINI_API_KEY`; Markdown artifact; canonical analytics results.

- [ ] **Step 1: Add catalog and graph RED assertions**

Add `gemini-autonomous-npm-investigator.json` to `newTemplateFiles` in sorted order and
add a focused test:

```ts
it('gemini autonomous npm investigator wires source evidence, optional MCP, and named secret mapping', () => {
  const template = readSeed('gemini-autonomous-npm-investigator.json');
  expect(template.requiredSecrets).toEqual([
    expect.objectContaining({ name: 'GEMINI_API_KEY', type: 'string' }),
  ]);

  const agent = template.graph.nodes.find((node) => node.id === 'gemini_investigator');
  expect(agent.type).toBe('core.ai.agent');
  expect(agent.data.config.inputOverrides).toMatchObject({
    chatModel: { provider: 'gemini', modelId: 'gemini-3.5-flash' },
    modelApiKey: '{{SECRET:GEMINI_API_KEY}}',
  });
  expect(agent.data.config.params).toMatchObject({
    executionProfile: 'deep',
    toolAvailability: 'best-effort',
  });

  expect(template.graph.nodes.some((node) => node.type === 'mcp.custom')).toBe(true);
  expect(template.graph.nodes.some((node) => node.type === 'sentris.npm.package.source')).toBe(
    true,
  );
  expect(template.graph.nodes.some((node) => node.type === 'sentris.semgrep.run')).toBe(true);
  expect(template.graph.nodes.some((node) => node.type === 'core.artifact.writer')).toBe(true);
  expect(template.graph.nodes.some((node) => node.type === 'core.analytics.sink')).toBe(true);
});
```

Use the file's existing seed-reading helper name rather than introducing a duplicate.

- [ ] **Step 2: Add script behavior RED assertions**

Read `normalize_package`, `build_evidence_packet`, and `parse_agent_report` from the
seed and execute them through the existing `runTemplateScript()` helper.

Assert literal behavior:

```ts
expect(
  run(normalizeCode, {
    packageSpec: '@scope/pkg@1.2.3',
    researchFocus: 'prototype pollution',
    authorizationNotes: 'authorized',
  }),
).toEqual({
  packageSpec: '@scope/pkg@1.2.3',
  packageSpecs: ['@scope/pkg@1.2.3'],
  packageName: '@scope/pkg',
  requestedVersion: '1.2.3',
  researchFocus: 'prototype pollution',
  authorizationNotes: 'authorized',
});
```

For the parser, feed a report with three sidecar entries: one concrete entry with
`evidence: ['package/index.js:L10-L20']`, one with empty evidence, and one malformed
entry. Assert only the concrete entry appears in `analyticsResults`, while
`reportText` retains the human Markdown.

For evidence building, provide no Semgrep leads and an OSV warning. Assert the prompt
contains the published-package provenance, the OSV warning, and the exact principle
that empty scanner output is not proof of safety.

- [ ] **Step 3: Run seed tests and verify RED**

Run:

```powershell
bun --cwd=backend test src/templates/__tests__/seed-templates.spec.ts
```

Expected: failure because the new seed file does not exist.

- [ ] **Step 4: Create the 15-node official graph**

Create the seed with category `cve-research`, author `sentris-team`, version `1.0.0`,
entry point `trigger_1`, and these exact node IDs/types:

1. `trigger_1` — `core.workflow.entrypoint`
2. `normalize_package` — `core.logic.script`
3. `npm_registry_intel` — `sentris.npm.registry.intel`
4. `osv_query` — `sentris.osv.query`
5. `fetch_npm_source` — `sentris.npm.package.source`
6. `semgrep_scan` — `sentris.semgrep.run`
7. `build_semgrep_success` — `core.logic.script`
8. `build_semgrep_failure` — `core.logic.script`
9. `finalize_source_evidence` — `core.logic.script`, `joinStrategy: "any"`
10. `build_evidence_packet` — `core.logic.script`
11. `custom_mcp_tools` — `mcp.custom`, `mode: "tool"`
12. `gemini_investigator` — `core.ai.agent`
13. `parse_agent_report` — `core.logic.script`
14. `artifact_report` — `core.artifact.writer`
15. `analytics_sink` — `core.analytics.sink`

The manifest uses the actual count `15`; the Semgrep fallback is worth the extra node.

Runtime inputs:

```json
[
  {
    "id": "packageSpec",
    "label": "npm package and optional version",
    "type": "text",
    "required": true,
    "description": "Published npm package to investigate, for example lodash@4.17.20."
  },
  {
    "id": "researchFocus",
    "label": "Research focus",
    "type": "text",
    "required": false,
    "defaultValue": "",
    "description": "Optional vulnerability class, code path, CVE, or research question to prioritize."
  },
  {
    "id": "authorizationNotes",
    "label": "Authorization notes",
    "type": "text",
    "required": false,
    "defaultValue": "",
    "description": "Scope and reporting context copied into the investigation report."
  }
]
```

Normalize scoped and unscoped specs using `lastIndexOf('@')` when the separator index
is greater than zero. Throw `new Error('Enter one npm package name with an optional version.')`
for empty input.

Use:

```json
{
  "npm_registry_intel": {
    "maxPackages": 1,
    "recentPublishDays": 30,
    "includeRawMetadata": false
  },
  "osv_query": {
    "ecosystem": "npm",
    "severityFloor": "low",
    "hydrateAdvisories": true,
    "maxAdvisoriesPerPackage": 30,
    "includeUnknownSeverity": true
  },
  "fetch_npm_source": {
    "emitSourceBundle": true,
    "maxFileBytes": 250000,
    "maxTotalBytes": 4000000,
    "maxArchiveBytes": 500000000
  },
  "semgrep_scan": {
    "configs": ["p/security-audit", "p/javascript", "p/typescript", "p/nodejs"],
    "timeoutSeconds": 900,
    "overrideContainerResources": true,
    "containerMemoryLimit": "4g",
    "containerCpuLimit": "2"
  },
  "custom_mcp_tools": {
    "enabledServers": [],
    "useAllEnabled": true,
    "toolExclusions": [],
    "continueOnServerError": true
  }
}
```

`build_semgrep_success` returns one `sourceEvidence` object containing the source
bundle, source status, package provenance, Semgrep findings/count, and no scanner
failure. `build_semgrep_failure` receives the error edge plus the source outputs and
returns the same shape with empty Semgrep findings and a caveat derived from the
failure's bounded message. `finalize_source_evidence` selects either object.

`build_evidence_packet` must JSON-stringify bounded values and return one `agentInput`
string containing:

- package spec/name/version and authorization/research notes;
- npm registry records/warnings;
- OSV findings/summary;
- package provenance/source status;
- at most 100 Semgrep leads;
- at most 1,500,000 source-bundle characters;
- the statement `Scanner outputs are leads only. Empty or failed scanner output does not prove absence of vulnerabilities.`

Do not send raw registry metadata or unbounded scanner output.

- [ ] **Step 5: Configure the agent and promotion contract**

Use:

```json
{
  "params": {
    "temperature": 0.2,
    "maxTokens": 32768,
    "memorySize": 8,
    "executionProfile": "deep",
    "stepLimit": 48,
    "toolAvailability": "best-effort"
  },
  "inputOverrides": {
    "chatModel": {
      "provider": "gemini",
      "modelId": "gemini-3.5-flash"
    },
    "modelApiKey": "{{SECRET:GEMINI_API_KEY}}"
  }
}
```

The system prompt requires a human Markdown report with these headings:

```text
# npm Security Investigation
## Executive Summary
## Evidence Boundary
## Confirmed Findings
## Candidate Findings
## Known Advisory Context
## False-Positive Checks
## Recommended Next Steps
```

It then requires exactly one fenced block:

````text
```sentris-findings
{"findings":[]}
```
````

Each entry may contain `title`, `severity`, `confidence`, `vulnerabilityClass`,
`affectedPackage`, `affectedVersion`, `evidence`, `impact`, `verification`, and
`remediation`. The prompt says that `evidence` must contain concrete published-source
paths/lines, scanner locations, or tool observations; uncertain entries stay in
Candidate Findings and are omitted from the sidecar.

The parser:

1. extracts the first `sentris-findings` fence;
2. parses `{ findings: [] }`, defaulting to no findings on malformed JSON;
3. keeps only object entries with non-empty `title` and at least one non-empty
   evidence string;
4. normalizes severity to `critical|high|medium|low|info|unknown`;
5. returns analytics objects with:

```ts
{
  scanner: 'gemini-autonomous-npm',
  severity,
  finding_hash: [
    packageSpec,
    affectedVersion || resolvedVersion || '',
    vulnerabilityClass || '',
    title,
    evidence[0],
  ].join(':'),
  asset_key: packageSpec,
  package: affectedPackage || packageName,
  version: affectedVersion || resolvedVersion || null,
  title,
  confidence: confidence || 'medium',
  vulnerability_class: vulnerabilityClass || null,
  evidence,
  impact: impact || null,
  verification: verification || null,
  remediation: remediation || null,
}
```

The artifact writer saves `gemini-npm-investigation-{{date}}.md` with MIME
`text/markdown`. The analytics sink uses:

```json
{
  "dataInputs": [
    {
      "id": "gemini_findings",
      "label": "Gemini evidence-backed findings",
      "sourceTag": "gemini_agent"
    }
  ],
  "assetKeyField": "auto",
  "failOnError": false
}
```

Do not set `indexSuffix`.

- [ ] **Step 6: Wire success/error/tool edges**

Required flow:

```text
trigger → normalize
normalize → registry, OSV, source, evidence metadata
source → Semgrep
source + Semgrep success → build_semgrep_success
Semgrep error + source → build_semgrep_failure
success/failure sourceEvidence → finalize_source_evidence
registry + OSV + finalized source + normalized input → build_evidence_packet
build_evidence_packet.agentInput → gemini_investigator.userInput
custom_mcp_tools.tools → gemini_investigator.tools
gemini_investigator.responseText → parse_agent_report.agentResponse
normalized/package provenance → parse_agent_report
parse_agent_report.reportText → artifact_report.content
parse_agent_report.analyticsResults → analytics_sink.gemini_findings
```

The Semgrep error edge is:

```json
{
  "id": "semgrep_scan-error-build_semgrep_failure-trigger",
  "source": "semgrep_scan",
  "target": "build_semgrep_failure",
  "kind": "error"
}
```

Use normal data edges from `fetch_npm_source` to both Semgrep branch scripts so the
failure branch retains source context.

- [ ] **Step 7: Add deterministic live input and run verification**

Add:

```ts
'Gemini Autonomous npm Investigator': {
  packageSpec: 'lodash@4.17.20',
  researchFocus:
    'Prioritize externally reachable prototype-pollution paths and distinguish known advisories from novel findings.',
  authorizationNotes: 'Live audit fixture: public npm package analysis only.',
},
```

Run:

```powershell
bun --cwd=backend test src/templates/__tests__/seed-templates.spec.ts
bun run template-library:verify
bun --cwd=backend run typecheck
```

Expected: all commands exit `0`.

Commit:

```powershell
git add -- backend/scripts/seed-templates/gemini-autonomous-npm-investigator.json backend/src/templates/__tests__/seed-templates.spec.ts packages/shared/src/template-validation-fingerprint.ts
git commit -s -m "feat: add Gemini npm investigator template"
```

---

### Task 4: Integrate, run locally, and verify through the browser

**Files:**

- No planned production file changes.
- The template live-audit ledger may change locally and is not part of the feature
  commit unless already tracked and intentionally required by repository tooling.

**Interfaces:**

- Consumes: all previous tasks.
- Produces: fresh focused test/typecheck evidence, seeded instance-0 template, one real
  Gemini run, and browser acceptance evidence.

- [ ] **Step 1: Re-read the design and inspect the combined diff**

Compare implementation against:

`docs/superpowers/specs/2026-07-31-gemini-autonomous-npm-investigator-design.md`

Run:

```powershell
git diff --check 0fa0f4f..HEAD
git status --short
```

Confirm only planned files plus the three pre-existing user changes are present.

- [ ] **Step 2: Run the focused combined verification**

Run:

```powershell
bun test worker/src/components/ai/__tests__/agent-stream-recorder.test.ts worker/src/components/ai/__tests__/ai-agent.test.ts
bun --cwd=backend test src/agents/__tests__/agents.controller.spec.ts src/templates/__tests__/seed-templates.spec.ts
bun --cwd=worker run typecheck
bun --cwd=backend run typecheck
bun run template-library:verify
```

Record exact exit codes and test counts. Fix only failures caused by this feature.

- [ ] **Step 3: Start/check instance 0**

Run:

```powershell
$env:SENTRIS_INSTANCE = '0'
bun run dev status
```

If the three PM2 applications are not online, run:

```powershell
$env:SENTRIS_INSTANCE = '0'
bun run dev
```

Then require:

```powershell
curl.exe -fsS http://127.0.0.1:5173
curl.exe -fsS http://127.0.0.1:3211/health
curl.exe -fsS http://127.0.0.1:3211/health/ready
curl.exe -fsS http://127.0.0.1:9100/health
```

- [ ] **Step 4: Dry-run and apply official seeds**

Run:

```powershell
$env:SENTRIS_INSTANCE = '0'
bun --cwd=backend scripts/seed-templates.ts --dry-run
bun --cwd=backend scripts/seed-templates.ts
```

Confirm the printed target is `sentris_instance_0` and the Gemini template is
created/updated.

- [ ] **Step 5: Store the key only through the Secrets UI**

Open `http://127.0.0.1:5173/secrets`.

Create `GEMINI_API_KEY` with the user-supplied value. Do not take a screenshot while
the value field is populated. Confirm only secret metadata appears afterward.

- [ ] **Step 6: Create and run the template**

At `http://127.0.0.1:5173/templates`:

1. select Official and search for **Gemini Autonomous npm Investigator**;
2. verify the preview shows three runtime inputs and one required secret;
3. choose **Use Template** and map `GEMINI_API_KEY` to the stored secret;
4. run with:
   - `packageSpec`: `lodash@4.17.20`
   - `researchFocus`: `Prioritize externally reachable prototype-pollution paths and distinguish known advisories from novel findings.`
   - `authorizationNotes`: `Local acceptance test against a public npm package; analysis only.`

- [ ] **Step 7: Verify live and final product behavior**

Before the agent node completes, open the run's Agent tab and confirm its prose grows
incrementally. Then confirm:

- tool events are ordered and not duplicated;
- MCP status is explicit and unavailable MCP does not fail the run;
- run status reaches `COMPLETED`;
- one readable Markdown artifact exists;
- promoted Findings, if any, include concrete evidence;
- zero promoted findings is accepted as a valid outcome;
- workflow inputs, node I/O, terminal, trace, and artifact do not display the key.

Never search for the literal key in a shell command.

- [ ] **Step 8: Run fresh final verification and commit any acceptance-only fix**

After any browser-discovered fix, rerun the exact command that covers it plus the
combined verification from Step 2. If no code changed, do not create an empty commit.

If a scoped acceptance fix was required, use `git diff --name-only` to identify the
changed files, stage only the files directly involved in that fix with `git add --`,
and commit them with:

```powershell
git commit -s -m "fix: complete Gemini investigator acceptance"
```

Do not push; the user controls when main is pushed.
