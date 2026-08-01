# Generic AI Agent Configuration and Run Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the generic AI Agent fully configurable from the workflow builder, show truthful model/credential/optional-MCP readiness before execution, preserve old workflows, and prove the path with one real Gemini npm investigation.

**Architecture:** `llm-provider` becomes semantic component-port metadata carried from the SDK through the component catalog. The frontend discovers the real input ID from metadata and stores the existing `core.ai.llm-provider.v1` contract there. One pure frontend readiness domain evaluates raw model contracts, stored-secret references, and MCP selections; thin workflow and template adapters translate their graph shapes into that domain. The worker resolves nested credential references by contract metadata rather than component IDs, while the old `modelApiKey` input remains a hidden read-only migration alias.

**Tech Stack:** TypeScript, Bun, Zod component definitions, NestJS/OpenAPI, React 19, TanStack Query 5, Temporal activities, AI SDK 6, Testing Library.

**Status (2026-08-01): Complete.** The focused acceptance passed 473 tests: 76
shared/contracts/SDK, 50 worker, 158 backend, and 189 frontend. The repository
project-reference typecheck, targeted worker/frontend lint (zero errors; three warnings),
OpenAPI generation, backend-client generation, and diff checks passed with no generated
changes. Bun's grouped backend invocation hit a `nestjs-zod` module-loader export error
before two template suites ran; both suites passed when invoked independently (140 and
17 tests), so no product failure was masked.

A consolidated final review found two provider/auth edge cases. The follow-up now rejects
Anthropic OAuth configuration in the API-key-only generic agent instead of falling back
to a legacy key, and carries provider capability metadata through the SDK, worker,
backend/OpenAPI client, canvas compatibility, readiness, and Claude Code runtime. Claude
Code accepts Anthropic while known incompatible providers are rejected; unknown custom
or legacy producers remain connectable and do not reuse stale inline configuration.
Post-review verification passed 242 focused tests (95 SDK, 41 worker, 105 frontend, and
1 backend), all five affected package typechecks, generated-output reproduction, and
targeted lint with zero errors and two pre-existing frontend warnings.

Browser acceptance passed on local instance 0 with no console errors. The generic agent
editor, reload persistence, connected-provider state, and template readiness behaved as
specified. The real `is-number` Gemini investigation completed in 1m37.4s with 16
completed nodes, zero failed nodes, two intentionally skipped branches, and one
package-specific artifact. Read-only structural database checks confirmed exactly one
stored Gemini secret-ID reference, no inline credential properties, and no unmasked
credential fields in persisted node I/O; the terminal and artifact views also contained
no credential. Optional MCP correctly degraded without blocking the run when a stale
post-restart runtime lease identity caused discovery to fail. That lease-lifecycle defect
is outside this readiness slice and is recorded as a root-cause MCP follow-up.

After the later machine restart, the frontend remained reachable but backend and worker
health endpoints were unavailable. A fresh Claude-specific browser follow-up could not
load the updated runtime catalog because restarting the local services was blocked by the
host's escalation-usage limit. The original end-to-end browser/run acceptance above
remains valid; the review-fix UI/runtime paths are covered by the post-review focused tests.

## Global Constraints

- Work directly on `main`, as requested by the user. Do not create another branch or worktree and do not push.
- Preserve unrelated user edits. Stage only files named by the active task, inspect `git diff --cached`, and use signed conventional commits (`git commit -s`).
- Use existing dependencies only. This slice needs no new endpoint, database migration, state store, AI framework, or managed service.
- Keep the product-capability focus: do not add a run confirmation dialog, broad security hardening, unrelated E2E suites, or repeated full-repository test passes.
- Store only `apiKeySecretId` or `oauthTokenSecretId` in new graph edits. Never write a raw API key into a fixture, test, plan, command line, log assertion, or committed file.
- Preserve existing persisted exact model IDs even when they are absent from the curated list. Every provider must expose an exact-model-ID text input; the curated catalog is a convenience, not an allowlist.
- Current curated models were checked on 2026-08-01 against the official [OpenAI model catalog](https://developers.openai.com/api/docs/models), [Anthropic model overview](https://platform.claude.com/docs/en/about-claude/models/overview), [Gemini model catalog](https://ai.google.dev/gemini-api/docs/models), [Z.AI model overview](https://docs.z.ai/guides/overview/overview), and [OpenRouter model guide](https://openrouter.ai/docs/guides/overview/models). The editor must use these exact recommendations:
  - OpenAI: `gpt-5.6-terra`; offer `gpt-5.6-sol`, `gpt-5.6-terra`, and `gpt-5.6-luna`.
  - Anthropic: `claude-sonnet-5`; offer `claude-opus-5`, `claude-sonnet-5`, `claude-fable-5`, and `claude-haiku-4-5`.
  - Gemini: `gemini-3.6-flash`; offer `gemini-3.6-flash`, `gemini-3.5-flash`, `gemini-3.5-flash-lite`, and `gemini-3.1-pro-preview`.
  - OpenRouter: `openrouter/auto`; arbitrary OpenRouter model IDs remain editable.
  - Z.AI Coding Plan: `glm-5.1`; offer `glm-5.1`, `glm-5`, `glm-5-turbo`, and `glm-4.7`.
- `zai-coding-plan` must default to the official Coding Plan endpoint `https://api.z.ai/api/coding/paas/v4`, while an explicit `baseUrl` remains authoritative. This fixes the currently advertised provider path instead of merely changing its label.
- Do not change worker/provider schema model fallbacks in this slice. Existing graphs that omitted an explicit model must retain their prior runtime behavior; current recommendations apply when a user creates or edits an inline agent model. Updating historical runtime fallbacks requires a separate compatibility decision.
- The canonical runtime credential precedence for `core.ai.agent` is: resolved/raw canonical `chatModel.apiKey`; legacy `modelApiKey` only when the canonical contract has no credential reference; otherwise a clear `ConfigurationError`. An unresolved canonical reference must never fall back to a stale legacy key.
- Legacy `modelApiKey` remains schema-valid and executable for saved workflows, but it is hidden from new canvas/configuration UI and no shipped template may write it.
- The three editor-enabled agent model ports are static component ports, and Task 2 tests lock that down. ConfigPanel still uses `dynamicInputs ?? component.inputs` for its existing resolved-port behavior. Workflow/template readiness may use catalog metadata for these static agent ports; if an agent later makes its LLM port dynamic, both adapters must consume resolved ports in the same change. The generic worker credential resolver continues supporting dynamic contracts because it serves components beyond these three UI editors.
- Readiness evaluates raw saved configuration, not the editor's normalized display fallback. A malformed saved provider/model must not become falsely ready because the form can display a default.
- Readiness may say **Mapped** or **Needs mapping**. It must not claim a stored provider credential is valid or verified because the secret summaries do not expose or test its value.
- An agent with no connected MCP node reports **Not configured (optional)** and remains non-blocking. `best-effort` degradation is visible and non-blocking. A `required` MCP connection with no usable enabled, non-excluded tools is blocking in readiness. Runtime snapshots and Temporal checks remain authoritative.
- API data stays in TanStack Query. Conditional secrets/MCP queries use `skipToken`; do not copy query data into `useState` or add inline query keys.
- Before any local run, execute `bun run instance show` and `bun run dev status`. Use the selected active instance; do not silently switch instances.
- Browser acceptance is required after frontend work. One real Gemini npm investigation replaces a broad E2E pass for this slice.
- The product-wide Operator chat and its approved **Ask for approval** / **Approve for me** policy are explicitly out of scope and remain the next independent design cycle.
- The initial plan commit is named `docs: plan generic agent readiness`. Use that commit as the implementation diff baseline; `origin/main` is already many commits behind this workspace.

---

### Task 1: Canonical current provider and model editor catalog

**Files:**

- Create: `packages/shared/src/ai-model-catalog.ts`
- Create: `packages/shared/src/__tests__/ai-model-catalog.test.ts`
- Modify: `packages/shared/src/index.ts`
- Modify: `packages/contracts/src/__tests__/llm-provider.test.ts`
- Modify: `worker/src/components/ai/ai-agent.ts`
- Modify: `worker/src/components/ai/__tests__/ai-agent.test.ts`
- Modify: `frontend/src/components/workflow/config-panel/agentModelOptions.ts`
- Modify: `frontend/src/components/workflow/config-panel/agentModelUtils.ts`
- Create: `frontend/src/components/workflow/config-panel/__tests__/agentModelOptions.test.ts`
- Modify: `frontend/src/components/workflow/config-panel/__tests__/agentModelUtils.test.ts`

**Interfaces:**

```ts
export const LLM_PROVIDER_IDS = [
  'anthropic',
  'openai',
  'gemini',
  'openrouter',
  'zai-coding-plan',
] as const;

export type LlmModelProvider = (typeof LLM_PROVIDER_IDS)[number];

export interface LlmModelOption {
  readonly label: string;
  readonly value: string;
}

export interface LlmProviderCatalogEntry {
  readonly label: string;
  readonly recommendedModelId: string;
  readonly models: readonly LlmModelOption[];
  readonly defaultBaseUrl?: string;
}

export const LLM_PROVIDER_CATALOG = {
  anthropic: {
    label: 'Anthropic',
    recommendedModelId: 'claude-sonnet-5',
    models: [
      { label: 'Claude Opus 5', value: 'claude-opus-5' },
      { label: 'Claude Sonnet 5', value: 'claude-sonnet-5' },
      { label: 'Claude Fable 5', value: 'claude-fable-5' },
      { label: 'Claude Haiku 4.5', value: 'claude-haiku-4-5' },
    ],
  },
  openai: {
    label: 'OpenAI',
    recommendedModelId: 'gpt-5.6-terra',
    models: [
      { label: 'GPT-5.6 Sol', value: 'gpt-5.6-sol' },
      { label: 'GPT-5.6 Terra', value: 'gpt-5.6-terra' },
      { label: 'GPT-5.6 Luna', value: 'gpt-5.6-luna' },
    ],
  },
  gemini: {
    label: 'Gemini',
    recommendedModelId: 'gemini-3.6-flash',
    models: [
      { label: 'Gemini 3.6 Flash', value: 'gemini-3.6-flash' },
      { label: 'Gemini 3.5 Flash', value: 'gemini-3.5-flash' },
      { label: 'Gemini 3.5 Flash-Lite', value: 'gemini-3.5-flash-lite' },
      { label: 'Gemini 3.1 Pro (Preview)', value: 'gemini-3.1-pro-preview' },
    ],
  },
  openrouter: {
    label: 'OpenRouter',
    recommendedModelId: 'openrouter/auto',
    models: [{ label: 'OpenRouter Auto', value: 'openrouter/auto' }],
  },
  'zai-coding-plan': {
    label: 'Z.AI Coding Plan',
    recommendedModelId: 'glm-5.1',
    defaultBaseUrl: 'https://api.z.ai/api/coding/paas/v4',
    models: [
      { label: 'GLM-5.1', value: 'glm-5.1' },
      { label: 'GLM-5', value: 'glm-5' },
      { label: 'GLM-5 Turbo', value: 'glm-5-turbo' },
      { label: 'GLM-4.7', value: 'glm-4.7' },
    ],
  },
} as const satisfies Record<LlmModelProvider, LlmProviderCatalogEntry>;

export function isLlmModelProvider(value: unknown): value is LlmModelProvider;
export function getRecommendedLlmModel(provider: LlmModelProvider): string;
```

- [x] **Step 1: Write failing catalog and integration expectations**

  Add tests that assert every provider has a non-empty label, its recommendation is present in its curated list, the exact recommendations/options in Global Constraints are exposed, and all catalog provider IDs parse through `LLMProviderSchema`. Add a dedicated frontend options test proving its arrays and provider type derive from the shared catalog. Add AI Agent tests proving `zai-coding-plan` uses the Coding Plan base URL when the graph has no explicit `baseUrl`, and an explicit URL wins. Add regression assertions that existing worker/provider schema model fallbacks remain unchanged.

- [x] **Step 2: Run the focused tests and confirm RED**

  ```powershell
  bun test packages/shared/src/__tests__/ai-model-catalog.test.ts packages/contracts/src/__tests__/llm-provider.test.ts
  bun test worker/src/components/ai/__tests__/ai-agent.test.ts
  bun --cwd=frontend run test src/components/workflow/config-panel/__tests__/agentModelOptions.test.ts src/components/workflow/config-panel/__tests__/agentModelUtils.test.ts
  ```

  Expected: missing shared catalog plus old model/default/base-URL assertions.

- [x] **Step 3: Implement and export one provider catalog**

  Populate the exact catalog from Global Constraints. Include only the Z.AI default base URL; OpenAI, Anthropic, and Gemini continue allowing their SDK defaults, and OpenRouter keeps its existing environment-aware runtime default. Export the module from `packages/shared/src/index.ts`.

  Derive `AgentModelProvider`, `AGENT_MODEL_PROVIDER_OPTIONS`, and `AGENT_MODEL_OPTIONS_BY_PROVIDER` from the shared catalog. Keep `DEFAULT_AGENT_MODEL_BY_COMPONENT` because the components genuinely choose different recommended providers, but make its model IDs come from `getRecommendedLlmModel()`:

  ```ts
  export const DEFAULT_AGENT_MODEL_BY_COMPONENT = {
    'core.ai.agent': {
      provider: 'openai',
      modelId: getRecommendedLlmModel('openai'),
    },
    'core.ai.opencode': {
      provider: 'openai',
      modelId: getRecommendedLlmModel('openai'),
    },
    'core.ai.claude-code': {
      provider: 'anthropic',
      modelId: getRecommendedLlmModel('anthropic'),
    },
  } satisfies Record<string, { provider: AgentModelProvider; modelId: string }>;
  ```

  Do not reintroduce a component-ID-to-input-ID map.

- [x] **Step 4: Wire the Z.AI endpoint without changing compatibility model fallbacks**

  Keep all existing worker model fallback constants and provider parameter defaults unchanged. Use the shared catalog only for new frontend editor recommendations and the missing Z.AI endpoint. In `ai-agent.ts`, select the fallback URL exhaustively:

  ```ts
  function getDefaultProviderBaseUrl(provider: ModelProvider): string {
    switch (provider) {
      case 'openai':
        return OPENAI_BASE_URL;
      case 'anthropic':
        return ANTHROPIC_BASE_URL;
      case 'gemini':
        return GEMINI_BASE_URL;
      case 'openrouter':
        return OPENROUTER_BASE_URL;
      case 'zai-coding-plan':
        return process.env.ZAI_BASE_URL ?? LLM_PROVIDER_CATALOG[provider].defaultBaseUrl!;
      default:
        return assertNever(provider);
    }
  }

  function assertNever(value: never): never {
    throw new Error(`Unsupported LLM provider: ${String(value)}`);
  }
  ```

  Keep closed-provider switches exhaustive. Do not modify persisted workflows or the model selected when an older graph omitted `modelId`; only explicit new editor choices use the current recommendations.

- [x] **Step 5: Run focused tests and typechecks**

  ```powershell
  bun test packages/shared/src/__tests__/ai-model-catalog.test.ts packages/contracts/src/__tests__/llm-provider.test.ts
  bun test worker/src/components/ai/__tests__/ai-agent.test.ts
  bun --cwd=frontend run test src/components/workflow/config-panel/__tests__/agentModelOptions.test.ts src/components/workflow/config-panel/__tests__/agentModelUtils.test.ts
  bun --cwd=packages/shared run typecheck
  bun --cwd=packages/contracts run typecheck
  bun --cwd=worker run typecheck
  bun --cwd=frontend run typecheck
  ```

  Expected: zero failures and no old default duplicated in the touched runtime/catalog files.

- [x] **Step 6: Commit Task 1**

  ```powershell
  git add packages/shared/src/ai-model-catalog.ts packages/shared/src/__tests__/ai-model-catalog.test.ts packages/shared/src/index.ts packages/contracts/src/__tests__/llm-provider.test.ts worker/src/components/ai/ai-agent.ts worker/src/components/ai/__tests__/ai-agent.test.ts frontend/src/components/workflow/config-panel/agentModelOptions.ts frontend/src/components/workflow/config-panel/agentModelUtils.ts frontend/src/components/workflow/config-panel/__tests__/agentModelOptions.test.ts frontend/src/components/workflow/config-panel/__tests__/agentModelUtils.test.ts
  git diff --cached --check
  git commit -s -m "feat(ai): centralize current model catalog"
  ```

---

### Task 2: Carry semantic LLM editor and hidden metadata end to end

**Files:**

- Modify: `packages/component-sdk/src/port-meta.ts`
- Modify: `packages/component-sdk/src/types.ts`
- Modify: `packages/component-sdk/src/zod-ports.ts`
- Modify: `packages/component-sdk/src/__tests__/zod-ports.test.ts`
- Modify: `worker/src/components/ai/ai-agent.ts`
- Modify: `worker/src/components/ai/opencode.ts`
- Modify: `worker/src/components/ai/claude-code-agent.ts`
- Create: `worker/src/components/ai/__tests__/agent-model-port-metadata.test.ts`
- Modify: `backend/src/components/components.controller.ts`
- Create: `backend/src/components/__tests__/agent-component-metadata.spec.ts`
- Modify: `frontend/src/schemas/component.ts`
- Create: `frontend/src/schemas/__tests__/component.test.ts`
- Regenerate: `openapi.json`
- Regenerate: `packages/backend-client/src/client.ts`

**Metadata rules:**

- `core.ai.agent.chatModel`, `core.ai.opencode.model`, and `core.ai.claude-code.model` have `editor: 'llm-provider'` and retain the `core.ai.llm-provider.v1` credential contract.
- `core.ai.agent.modelApiKey` remains optional secret-typed and gains `hidden: true`; its description names it as a legacy compatibility input.
- `llm-provider` affects frontend editing only. Explicit connection contracts continue taking precedence over editor-derived primitive types.

- [x] **Step 1: Write failing metadata tests**

  Add:

  - SDK coverage that an `llm-provider` editor and `hidden: true` survive `extractPorts()` without changing a declared contract;
  - registry coverage for the exact three component input IDs above and the hidden legacy input;
  - backend controller coverage that list/get payloads contain `editor` and `hidden` unchanged;
  - frontend schema coverage named `parses llm-provider and hidden input metadata`.

- [x] **Step 2: Run the tests and confirm RED**

  ```powershell
  bun test packages/component-sdk/src/__tests__/zod-ports.test.ts worker/src/components/ai/__tests__/agent-model-port-metadata.test.ts backend/src/components/__tests__/agent-component-metadata.spec.ts
  bun --cwd=frontend run test src/schemas/__tests__/component.test.ts
  ```

  Expected: the new editor is rejected or absent, the legacy input is not hidden, and the frontend schema strips/rejects the metadata.

- [x] **Step 3: Extend the closed editor union and component descriptors**

  Add `'llm-provider'` to `PortMeta.editor`, `ComponentPortMetadata.editor`, and the frontend `PortEditorTypes`; add `hidden: z.boolean().optional()` to `InputPortSchema`.

  Keep `editorToConnectionType()` exhaustive:

  ```ts
  case 'llm-provider':
  case undefined:
    return undefined;
  default:
    return assertNever(editor);
  ```

  Then add the metadata rules above to the three agent descriptors. Remove API-key examples from descriptions and direct users toward stored credentials/provider connections.

- [x] **Step 4: Document and generate the catalog contract**

  Add `llm-provider` to both component input editor enums in `ComponentsController` Swagger schemas and add:

  ```ts
  hidden: { type: 'boolean', nullable: true },
  ```

  Generate from the real application build path:

  ```powershell
  bun --cwd=backend run generate:openapi
  bun --cwd=packages/backend-client run generate
  ```

  Inspect `openapi.json` and the generated client to confirm both `"llm-provider"` and `hidden?: boolean | null` are present. Do not hand-edit generated output.

- [x] **Step 5: Run focused verification**

  ```powershell
  bun test packages/component-sdk/src/__tests__/zod-ports.test.ts packages/component-sdk/src/__tests__/registry.test.ts worker/src/components/ai/__tests__/agent-model-port-metadata.test.ts backend/src/components/__tests__/agent-component-metadata.spec.ts
  bun --cwd=frontend run test src/schemas/__tests__/component.test.ts
  bun --cwd=packages/component-sdk run typecheck
  bun --cwd=worker run typecheck
  bun --cwd=backend run typecheck
  bun --cwd=packages/backend-client run typecheck
  bun --cwd=frontend run typecheck
  ```

- [x] **Step 6: Commit Task 2**

  ```powershell
  git add packages/component-sdk/src/port-meta.ts packages/component-sdk/src/types.ts packages/component-sdk/src/zod-ports.ts packages/component-sdk/src/__tests__/zod-ports.test.ts worker/src/components/ai/ai-agent.ts worker/src/components/ai/opencode.ts worker/src/components/ai/claude-code-agent.ts worker/src/components/ai/__tests__/agent-model-port-metadata.test.ts backend/src/components/components.controller.ts backend/src/components/__tests__/agent-component-metadata.spec.ts frontend/src/schemas/component.ts frontend/src/schemas/__tests__/component.test.ts openapi.json packages/backend-client/src/client.ts
  git diff --cached --check
  git commit -s -m "feat(ai): expose semantic model port metadata"
  ```

---

### Task 3: Resolve canonical credentials by contract and retire template writes to the legacy alias

**Files:**

- Modify: `worker/src/temporal/activities/secret-resolver.ts`
- Modify: `worker/src/temporal/activities/run-component.activity.ts`
- Modify: `worker/src/temporal/activities/__tests__/secret-resolver.test.ts`
- Modify: `worker/src/components/ai/ai-agent.ts`
- Modify: `worker/src/components/ai/__tests__/ai-agent.test.ts`
- Modify: `backend/scripts/seed-templates/gemini-autonomous-npm-investigator.json`
- Modify: `backend/src/templates/__tests__/seed-templates.spec.ts`

**Resolver interface:**

```ts
export async function resolveLlmProviderModelOverrides(
  inputs: Record<string, unknown>,
  options: {
    secrets: ISecretsService | undefined;
    component: ComponentDefinition;
    resolvedParams: Record<string, unknown>;
    organizationId?: string | null;
  },
): Promise<void>;
```

- [x] **Step 1: Write failing metadata-driven resolver tests**

  Add tests named for these behaviors:

  - resolves a canonical API-key reference on a nonstandard LLM input ID;
  - resolves every input whose connection contract is `core.ai.llm-provider.v1`;
  - ignores an object named `model` when its port has no LLM contract;
  - preserves an already activity-local `apiKey`;
  - resolves Anthropic `oauthTokenSecretId` in subscription mode;
  - does not inject `apiKey` in subscription mode;
  - scopes every lookup through `forOrganization(organizationId)`;
  - uses resolved dynamic ports when `resolvePorts()` supplies them.

- [x] **Step 2: Write failing canonical-versus-legacy agent tests**

  Cover:

  - canonical `chatModel.apiKey` wins when legacy `modelApiKey` also exists;
  - legacy is accepted only when the canonical contract has no key or key reference;
  - an unresolved canonical `apiKeySecretId` throws instead of falling back;
  - neither source produces a clear configuration error that names the model provider and stored-secret action.

  Update the Gemini seed assertion to require:

  ```ts
  chatModel: {
    provider: 'gemini',
    modelId: 'gemini-3.5-flash',
    apiKeySecretId: '{{SECRET:GEMINI_API_KEY}}',
  }
  ```

  and assert `modelApiKey` is absent.

- [x] **Step 3: Run focused tests and confirm RED**

  ```powershell
  bun test worker/src/temporal/activities/__tests__/secret-resolver.test.ts worker/src/components/ai/__tests__/ai-agent.test.ts backend/src/templates/__tests__/seed-templates.spec.ts
  ```

  Expected: the resolver still depends on component IDs and `inputs.model`, legacy wins in the agent, and the seed still writes the old placeholder location.

- [x] **Step 4: Implement contract-driven resolution**

  Resolve static or dynamic input ports, select only ports with:

  ```ts
  port.connectionType.kind === 'contract' && port.connectionType.name === llmProviderContractName;
  ```

  For every match, inspect `inputs[port.id]`, resolve the appropriate secret ID through the organization-scoped service, and replace only that activity-local input with a shallow copy containing `apiKey` or `oauthToken`. Keep secret reference IDs in the copy for diagnostics and never mutate saved workflow data.

  Update `run-component.activity.ts` to pass `component`, `resolvedParams`, and `organizationId`.

- [x] **Step 5: Implement explicit agent credential precedence**

  Add one helper in `ai-agent.ts`:

  ```ts
  function selectAgentApiKey(
    provider: ModelProvider,
    chatModel: LlmProviderConfig,
    legacyModelApiKey?: string,
  ): string {
    const canonical = chatModel.apiKey?.trim();
    if (canonical) return canonical;

    if (chatModel.apiKeySecretId?.trim()) {
      throw new ConfigurationError(
        `The stored credential selected for "${provider}" could not be resolved. Reselect it in Model & API Key.`,
        { configKey: 'apiKeySecretId', details: { provider } },
      );
    }

    const legacy = legacyModelApiKey?.trim();
    if (legacy) return legacy;

    throw new ConfigurationError(
      `No stored credential is configured for "${provider}". Select one in Model & API Key or connect a provider node.`,
      { configKey: 'apiKey', details: { provider } },
    );
  }
  ```

  Keep this helper specific to `core.ai.agent`: `core.ai.generate-text.modelApiKey` is explicitly documented as an override and is not the same migration alias.

- [x] **Step 6: Move the official seed placeholder into the contract**

  Add `apiKeySecretId` under `chatModel` and delete the seed's `modelApiKey`. Do not change its provider, `gemini-3.5-flash` acceptance model, investigation prompt, or best-effort MCP policy in this task.

- [x] **Step 7: Run focused tests, compile check, and typecheck**

  ```powershell
  bun test worker/src/temporal/activities/__tests__/secret-resolver.test.ts worker/src/components/ai/__tests__/ai-agent.test.ts backend/src/templates/__tests__/seed-templates.spec.ts backend/src/templates/__tests__/templates.service.spec.ts
  bun --cwd=worker run typecheck
  bun --cwd=backend run typecheck
  ```

  Expected: zero failures; the template graph still validates and nested placeholder replacement remains covered.

- [x] **Step 8: Commit Task 3**

  ```powershell
  git add worker/src/temporal/activities/secret-resolver.ts worker/src/temporal/activities/run-component.activity.ts worker/src/temporal/activities/__tests__/secret-resolver.test.ts worker/src/components/ai/ai-agent.ts worker/src/components/ai/__tests__/ai-agent.test.ts backend/scripts/seed-templates/gemini-autonomous-npm-investigator.json backend/src/templates/__tests__/seed-templates.spec.ts
  git diff --cached --check
  git commit -s -m "fix(ai): resolve canonical agent credentials"
  ```

---

### Task 4: One pure frontend readiness domain and conditional catalog queries

**Files:**

- Create: `frontend/src/features/agent-readiness/readiness.ts`
- Create: `frontend/src/features/agent-readiness/__tests__/readiness.test.ts`
- Create: `frontend/src/lib/mcpReadiness.ts`
- Create: `frontend/src/lib/__tests__/mcpReadiness.test.ts`
- Modify: `frontend/src/pages/mcp-library/utils.ts`
- Modify: `frontend/src/pages/mcp-library/types.ts`
- Modify: `frontend/src/pages/mcp-library/useMcpLibraryData.ts`
- Modify: `frontend/src/pages/mcp-library/CustomServersTable.tsx`
- Modify: `frontend/src/pages/mcp-library/ImportedGroupsSection.tsx`
- Delete: `frontend/src/pages/mcp-library/__tests__/readiness.test.ts`
- Modify: `frontend/src/hooks/queries/useMcpServerQueries.ts`
- Modify: `frontend/src/hooks/queries/useSecretQueries.ts`
- Modify: `frontend/src/hooks/queries/__tests__/useMcpServerQueries.test.tsx`
- Modify: `frontend/src/hooks/queries/__tests__/useSecretQueries.test.tsx`

**Readiness interfaces:**

```ts
export type AgentReadinessKind = 'model' | 'credential' | 'mcp-tools';
export type AgentReadinessState =
  'ready' | 'loading' | 'not-configured' | 'needs-mapping' | 'degraded' | 'error';

export interface AgentReadinessRow {
  kind: AgentReadinessKind;
  state: AgentReadinessState;
  label: string;
  detail: string;
  blocksCreation: boolean;
  blocksExecution: boolean;
}

export interface CatalogState<T> {
  items: readonly T[];
  isLoading: boolean;
  error: unknown | null;
}

export type LlmAuthMode = 'api_key' | 'subscription_oauth';

export interface McpSelection {
  useAllEnabled: boolean;
  serverIds: readonly string[];
  toolExclusions: readonly string[];
}

export function isLlmProviderInput(input: InputPort): boolean;
export function findLlmProviderInput(inputs: readonly InputPort[]): InputPort | undefined;
export function evaluateLlmModelReadiness(input: {
  value: unknown;
  connectedSource?: string;
  supportedAuthModes?: readonly LlmAuthMode[];
}): AgentReadinessRow;
export function evaluateLlmCredentialReadiness(input: {
  value: unknown;
  connectedSource?: string;
  supportedAuthModes?: readonly LlmAuthMode[];
  secrets: CatalogState<Pick<SecretSummary, 'id' | 'name'>>;
}): AgentReadinessRow;
export function evaluateLlmProviderReadiness(input: {
  value: unknown;
  connectedSource?: string;
  supportedAuthModes?: readonly LlmAuthMode[];
  secrets: CatalogState<Pick<SecretSummary, 'id' | 'name'>>;
}): AgentReadinessRow[];
export function evaluateCredentialMappingReadiness(input: {
  requiredNames: readonly string[];
  mappings: Readonly<Record<string, string>>;
  secrets: CatalogState<Pick<SecretSummary, 'id' | 'name'>>;
}): AgentReadinessRow;
export function evaluateMcpToolsReadiness(input: {
  connected: boolean;
  policy: 'required' | 'best-effort';
  selection?: McpSelection;
  servers: CatalogState<McpServerResponse>;
  tools: CatalogState<McpToolResponse>;
}): AgentReadinessRow;
```

Use this exact blocking matrix:

| Row condition                            | State                 | `blocksCreation` | `blocksExecution` |
| ---------------------------------------- | --------------------- | ---------------: | ----------------: |
| Valid or connected model                 | `ready`               |            false |             false |
| Missing/malformed provider or model      | `not-configured`      |             true |              true |
| Auth mode unsupported by this component  | `error`               |             true |              true |
| Existing referenced secret               | `ready`               |            false |             false |
| Missing/deleted/no referenced secret     | `needs-mapping`       |             true |              true |
| Secret catalog loading                   | `loading`             |             true |             false |
| Secret catalog query error               | `error`               |             true |             false |
| Historical inline raw key                | `degraded`            |            false |             false |
| No MCP connection                        | `not-configured`      |            false |             false |
| Best-effort MCP in any unavailable state | `degraded` or `error` |            false |             false |
| Required MCP with usable tools           | `ready`               |            false |             false |
| Required MCP loading                     | `loading`             |             true |             false |
| Required MCP query error                 | `error`               |             true |              true |
| Required MCP with no usable tools        | `not-configured`      |             true |              true |

`blocksExecution` drives builder validation messages, not an actual Run-button gate. `blocksCreation` drives template launch state.

- [x] **Step 1: Move the existing per-server MCP calculation with tests unchanged**

  Move the pure `getMcpAgentReadiness()` implementation and its types from the MCP page into `frontend/src/lib/mcpReadiness.ts`. Move its five existing tests to `frontend/src/lib/__tests__/mcpReadiness.test.ts`; update page imports and re-export compatibility types from `pages/mcp-library/types.ts` only where that prevents noisy call-site churn. Delete the old calculator so there is one implementation.

- [x] **Step 2: Write failing agent-readiness tests**

  Add exact cases:

  - `marks a supported inline provider and model ready`;
  - `keeps malformed stored provider or model blocked after display normalization`;
  - `marks an existing API-key secret reference as Mapped`;
  - `marks a deleted secret reference as Needs mapping`;
  - `reports secret loading and query errors without claiming Mapped`;
  - `uses the connected provider for both model and credential readiness`;
  - `blocks subscription OAuth when the component supports API keys only`;
  - `accepts subscription OAuth only when the component declares that capability`;
  - `reports a legacy inline key as degraded but executable`;
  - `summarizes required template credential mappings by existing secret ID`;
  - `keeps no connected MCP node optional and non-blocking`;
  - `keeps degraded best-effort MCP selections non-blocking`;
  - `blocks required MCP when selected servers expose no usable tools`;
  - `honors use-all-enabled, explicit selections, disabled servers, and tool exclusions`;
  - `blocks an MCP query failure only for required tools`.

- [x] **Step 3: Write failing conditional-query tests**

  Assert `useSecrets({ enabled: false })`, `useMcpServers({ enabled: false })`, and `useMcpAllTools({ enabled: false })` use `skipToken` and make no request; enabled/default calls retain the current organization-scoped query keys, sorting, and stale times.

- [x] **Step 4: Run focused tests and confirm RED**

  ```powershell
  bun --cwd=frontend run test src/lib/__tests__/mcpReadiness.test.ts src/features/agent-readiness/__tests__/readiness.test.ts src/hooks/queries/__tests__/useMcpServerQueries.test.tsx src/hooks/queries/__tests__/useSecretQueries.test.tsx
  ```

  Expected: missing domain module and current `enabled`-only/missing MCP query options.

- [x] **Step 5: Implement pure readiness decisions**

  Keep `readiness.ts` free of React and TanStack imports. Parse raw records defensively. `evaluateLlmProviderReadiness()` is only composition: it returns `evaluateLlmModelReadiness()` plus `evaluateLlmCredentialReadiness()` so template and builder adapters cannot fork the rules. Use `isLlmModelProvider()` plus a non-empty `modelId`; never require that model ID to appear in the catalog. Default `supportedAuthModes` to `['api_key']`; only `core.ai.claude-code` callers pass `['api_key', 'subscription_oauth']`. An unsupported stored mode is blocking even when its referenced secret exists. For credential state:

  - a connected source makes both model and credential rows ready;
  - `subscription_oauth` checks `oauthTokenSecretId`, otherwise check `apiKeySecretId`;
  - a referenced ID is **Mapped** only when it exists in the loaded catalog by ID;
  - loading and error remain distinct, never ready;
  - a historical raw `apiKey` without a reference is `degraded`, says it should be moved to a stored secret, and remains executable;
  - no credential at all is blocking.

  MCP selection mirrors `worker/src/components/core/mcp-library-utils.ts`: choose enabled servers by use-all or explicit ID, drop disabled/excluded tools using `${serverId}:${toolName}`, call the shared per-server readiness function, and apply required versus best-effort blocking only once in this domain.

- [x] **Step 6: Add skipToken-based query gating**

  Keep backward-compatible signatures:

  ```ts
  export function useSecrets(options?: { enabled?: boolean });
  export function useMcpServers(options?: { enabled?: boolean });
  export function useMcpAllTools(options?: { enabled?: boolean });
  ```

  Use `queryFn: options?.enabled === false ? skipToken : () => api.secrets.list()` for secrets and the corresponding existing `apiRequest()` closure for each MCP hook; do not add `enabled: false` as the only gate.

- [x] **Step 7: Run focused tests and typecheck**

  ```powershell
  bun --cwd=frontend run test src/lib/__tests__/mcpReadiness.test.ts src/features/agent-readiness/__tests__/readiness.test.ts src/hooks/queries/__tests__/useMcpServerQueries.test.tsx src/hooks/queries/__tests__/useSecretQueries.test.tsx
  bun --cwd=frontend run typecheck
  bun --cwd=frontend x eslint src/features/agent-readiness/readiness.ts src/features/agent-readiness/__tests__/readiness.test.ts src/lib/mcpReadiness.ts src/lib/__tests__/mcpReadiness.test.ts src/hooks/queries/useMcpServerQueries.ts src/hooks/queries/useSecretQueries.ts
  ```

- [x] **Step 8: Commit Task 4**

  ```powershell
  git add frontend/src/features/agent-readiness/readiness.ts frontend/src/features/agent-readiness/__tests__/readiness.test.ts frontend/src/lib/mcpReadiness.ts frontend/src/lib/__tests__/mcpReadiness.test.ts frontend/src/pages/mcp-library/utils.ts frontend/src/pages/mcp-library/types.ts frontend/src/pages/mcp-library/useMcpLibraryData.ts frontend/src/pages/mcp-library/CustomServersTable.tsx frontend/src/pages/mcp-library/ImportedGroupsSection.tsx frontend/src/pages/mcp-library/__tests__/readiness.test.ts frontend/src/hooks/queries/useMcpServerQueries.ts frontend/src/hooks/queries/useSecretQueries.ts frontend/src/hooks/queries/__tests__/useMcpServerQueries.test.tsx frontend/src/hooks/queries/__tests__/useSecretQueries.test.tsx
  git diff --cached --check
  git commit -s -m "feat(frontend): share agent readiness decisions"
  ```

---

### Task 5: Route and edit agent model contracts by semantic port metadata

**Files:**

- Create: `frontend/src/features/agent-readiness/ReadinessSummary.tsx`
- Modify: `frontend/src/components/workflow/ConfigPanel.tsx`
- Modify: `frontend/src/components/workflow/config-panel/AgentModelConfig.tsx`
- Modify: `frontend/src/components/workflow/config-panel/agentModelUtils.ts`
- Modify: `frontend/src/components/workflow/config-panel/ConfigPanelInputs.tsx`
- Modify: `frontend/src/components/workflow/node/hooks/useNodeValidation.ts`
- Modify: `frontend/src/components/workflow/node/NodeInputPorts.tsx`
- Modify: `frontend/src/utils/portUtils.ts`
- Modify: `frontend/src/components/workflow/__tests__/ConfigPanel.test.tsx`
- Modify: `frontend/src/components/workflow/config-panel/__tests__/agentModelUtils.test.ts`
- Modify: `frontend/src/components/workflow/node/__tests__/NodeInputPorts.test.tsx`
- Modify: `frontend/src/utils/__tests__/portUtils.test.ts`

**Editor interface:**

```ts
export interface AgentModelConfigProps {
  componentId: string;
  inputId: string;
  value: unknown;
  connectedSource?: string;
  onChange: (inputId: string, value: AgentModelConfigValue) => void;
}
```

- [x] **Step 1: Write failing metadata-routing and hiding tests**

  Add:

  - `uses the editor-marked chatModel input for core.ai.agent`;
  - `keeps the editor-marked model input for OpenCode without a component port map`;
  - `omits llm-provider and hidden legacy inputs from generic controls`;
  - `disables inline controls when chatModel is connected`;
  - `treats llm-provider as a manually configurable contract input`;
  - `does not render a hidden legacy input handle`.

  Assert a generic edit writes `config.inputOverrides.chatModel.apiKeySecretId`, never `inputOverrides.model` or a raw `apiKey`.

- [x] **Step 2: Write failing editor behavior tests**

  Extend `agentModelUtils.test.ts` and ConfigPanel tests to cover:

  - generic Agent default from Task 1;
  - provider, curated model, and stored-secret edits;
  - exact custom model preservation for every provider, including a value absent from the catalog;
  - Claude Code API-key and subscription OAuth modes;
  - saving an edited historical raw-key model drops `apiKey`;
  - a deleted referenced secret renders **Needs mapping**, while an existing ID renders **Mapped**;
  - connected-provider copy uses the actual source label.

- [x] **Step 3: Run tests and confirm RED**

  ```powershell
  bun --cwd=frontend run test src/components/workflow/__tests__/ConfigPanel.test.tsx src/components/workflow/config-panel/__tests__/agentModelUtils.test.ts src/components/workflow/node/__tests__/NodeInputPorts.test.tsx src/utils/__tests__/portUtils.test.ts
  ```

  Expected: the panel still reads/writes literal `model`, the generic agent has no editor, and hidden/semantic ports still appear in generic UI.

- [x] **Step 4: Make ConfigPanel metadata-driven**

  Set `componentInputs = dynamicInputs ?? component.inputs ?? []`, then call `findLlmProviderInput(componentInputs)`. Find its incoming edge using `target === selectedNode.id && targetHandle === llmInput.id`; resolve the source node label; then render `AgentModelConfig` only when the semantic port exists:

  ```tsx
  {
    llmInput ? (
      <AgentModelConfig
        componentId={component.id}
        inputId={llmInput.id}
        value={inputOverrides[llmInput.id]}
        connectedSource={connectedSource}
        onChange={handleInputOverrideChange}
      />
    ) : null;
  }
  ```

  Delete `AGENT_MODEL_COMPONENT_IDS` and `supportsInlineAgentModelConfig()`. Component-specific Claude behavior may remain; activation and port IDs may not depend on component IDs.

- [x] **Step 5: Implement complete provider/model/credential editing**

  Normalize only for form display. Always show the curated selector plus a compact exact-model-ID input for all providers, merging the current exact value into the selector display. On provider change, select that provider's canonical default. Store only reference fields:

  ```ts
  return {
    provider: normalized.provider,
    modelId: normalized.modelId,
    ...(normalized.apiKeySecretId ? { apiKeySecretId: normalized.apiKeySecretId } : {}),
  };
  ```

  Preserve Claude `oauthTokenSecretId`, `authMode`, and non-default effort. Never emit `apiKey` from `buildAgentModelOverride()`.

  Query secrets with `useSecrets()` and feed the full `data/isLoading/error` state plus the raw `value` to `evaluateLlmProviderReadiness()`. Pass both auth modes only when `componentId === 'core.ai.claude-code'`; generic AI Agent and OpenCode pass API-key-only capability. Render the returned rows through a compact `ReadinessSummary` with visible text and icons, not color alone.

- [x] **Step 6: Hide semantic and migration-only inputs consistently**

  `ConfigPanelInputs` filters `input.hidden || input.editor === 'llm-provider'` once and iterates only `visibleInputs`. `NodeInputPorts` omits hidden ports. `inputSupportsManualValue()` recognizes `llm-provider`; `manualValueProvidedForInput()` checks `input.editor === 'llm-provider'` rather than `input.id === 'model'`.

  Do not delete saved mappings or edges for hidden ports; this is presentation only.

- [x] **Step 7: Run focused tests, typecheck, and lint**

  ```powershell
  bun --cwd=frontend run test src/components/workflow/__tests__/ConfigPanel.test.tsx src/components/workflow/config-panel/__tests__/agentModelUtils.test.ts src/components/workflow/node/__tests__/NodeInputPorts.test.tsx src/utils/__tests__/portUtils.test.ts src/features/agent-readiness/__tests__/readiness.test.ts
  bun --cwd=frontend run typecheck
  bun --cwd=frontend x eslint src/features/agent-readiness/ReadinessSummary.tsx src/components/workflow/ConfigPanel.tsx src/components/workflow/config-panel/AgentModelConfig.tsx src/components/workflow/config-panel/agentModelUtils.ts src/components/workflow/config-panel/ConfigPanelInputs.tsx src/components/workflow/node/hooks/useNodeValidation.ts src/components/workflow/node/NodeInputPorts.tsx src/utils/portUtils.ts
  ```

- [x] **Step 8: Commit Task 5**

  ```powershell
  git add frontend/src/features/agent-readiness/ReadinessSummary.tsx frontend/src/components/workflow/ConfigPanel.tsx frontend/src/components/workflow/config-panel/AgentModelConfig.tsx frontend/src/components/workflow/config-panel/agentModelUtils.ts frontend/src/components/workflow/config-panel/ConfigPanelInputs.tsx frontend/src/components/workflow/node/hooks/useNodeValidation.ts frontend/src/components/workflow/node/NodeInputPorts.tsx frontend/src/utils/portUtils.ts frontend/src/components/workflow/__tests__/ConfigPanel.test.tsx frontend/src/components/workflow/config-panel/__tests__/agentModelUtils.test.ts frontend/src/components/workflow/node/__tests__/NodeInputPorts.test.tsx frontend/src/utils/__tests__/portUtils.test.ts
  git diff --cached --check
  git commit -s -m "feat(frontend): edit agent models by port metadata"
  ```

---

### Task 6: Adapt workflow graphs into shared readiness and surface blocking issues

**Files:**

- Create: `frontend/src/features/agent-readiness/workflowAdapter.ts`
- Create: `frontend/src/features/agent-readiness/__tests__/workflowAdapter.test.ts`
- Modify: `frontend/src/components/workflow/ValidationDock.tsx`
- Modify: `frontend/src/components/workflow/__tests__/ValidationDock.test.tsx`

**Adapter interface:**

```ts
export function evaluateWorkflowAgentNodeReadiness(input: {
  node: Node<FrontendNodeData>;
  component: ComponentMetadata;
  nodes: readonly Node<FrontendNodeData>[];
  edges: readonly Edge[];
  getComponent: (ref: string | undefined) => ComponentMetadata | null;
  secrets: CatalogState<SecretSummary>;
  mcpServers: CatalogState<McpServerResponse>;
  mcpTools: CatalogState<McpToolResponse>;
}): AgentReadinessRow[];
```

- [x] **Step 1: Write failing workflow-adapter tests**

  Prove the adapter:

  - finds the actual `llm-provider` input ID and raw override;
  - resolves a connected provider source label;
  - recognizes incoming tool edges only on the agent's `tools` handle;
  - parses `mcp.custom` `enabledServers`, `useAllEnabled`, and `toolExclusions` defensively;
  - reads `toolAvailability`, defaulting to `required`;
  - declares subscription OAuth support only for `core.ai.claude-code` and leaves generic AI Agent/OpenCode API-key-only;
  - delegates blocking decisions to the readiness domain rather than reimplementing them.

- [x] **Step 2: Write failing ValidationDock integration tests**

  Add:

  - `links a missing generic-agent model issue to the agent node`;
  - `shows Needs mapping for a deleted agent credential`;
  - `does not flag optional degraded MCP tools`;
  - `flags required MCP with no usable tools`.

  Clicking either model or credential issue must still call `onNodeClick(agentId)`.

- [x] **Step 3: Run focused tests and confirm RED**

  ```powershell
  bun --cwd=frontend run test src/features/agent-readiness/__tests__/workflowAdapter.test.ts src/components/workflow/__tests__/ValidationDock.test.tsx
  ```

- [x] **Step 4: Implement a graph-only adapter**

  The adapter may locate nodes/edges and parse configuration, but every ready/loading/degraded/error and blocking decision must call Task 4 functions. It must not contain a provider allowlist, secret lookup rule, health-state switch, or component-ID-to-model-port map.

- [x] **Step 5: Add readiness issues without adding a run-confirmation nuisance**

  Keep ordinary `getNodeValidationWarnings()` output. Append only rows where `blocksExecution` is true:

  ```ts
  const readinessIssues = evaluateWorkflowAgentNodeReadiness({
    node: node as Node<FrontendNodeData>,
    component,
    nodes: nodes as Node<FrontendNodeData>[],
    edges,
    getComponent,
    secrets: secretCatalogState,
    mcpServers: mcpServerCatalogState,
    mcpTools: mcpToolCatalogState,
  })
    .filter((row) => row.blocksExecution)
    .map((row) => ({
      nodeId: node.id,
      nodeLabel,
      message: `${row.label}: ${row.detail}`,
    }));
  ```

  Keep full query objects instead of destructuring errors/loading into empty arrays. Enable MCP queries only while design mode contains a relevant connected `mcp.custom` node. Do not add a modal or change the existing Run action.

- [x] **Step 6: Run focused verification**

  ```powershell
  bun --cwd=frontend run test src/features/agent-readiness/__tests__/workflowAdapter.test.ts src/components/workflow/__tests__/ValidationDock.test.tsx src/features/agent-readiness/__tests__/readiness.test.ts src/utils/__tests__/nodeValidationWarnings.test.ts
  bun --cwd=frontend run typecheck
  bun --cwd=frontend x eslint src/features/agent-readiness/workflowAdapter.ts src/components/workflow/ValidationDock.tsx
  ```

- [x] **Step 7: Commit Task 6**

  ```powershell
  git add frontend/src/features/agent-readiness/workflowAdapter.ts frontend/src/features/agent-readiness/__tests__/workflowAdapter.test.ts frontend/src/components/workflow/ValidationDock.tsx frontend/src/components/workflow/__tests__/ValidationDock.test.tsx
  git diff --cached --check
  git commit -s -m "feat(frontend): surface agent run readiness"
  ```

---

### Task 7: Parse template launch requirements without parallel readiness rules

**Files:**

- Create: `frontend/src/features/templates/template-launch-readiness.ts`
- Create: `frontend/src/features/templates/__tests__/template-launch-readiness.test.ts`

**Template adapter interfaces:**

```ts
export interface TemplateModelRequirement {
  componentId: string;
  inputId: string;
  provider: string;
  modelId: string;
  rawValue: Record<string, unknown>;
  nodeCount: number;
  supportedAuthModes: readonly LlmAuthMode[];
}

export interface TemplateMcpRequirement {
  mcpNodeId: string;
  agentNodeId: string;
  policy: 'required' | 'best-effort';
  selection: McpSelection;
}

export interface TemplateLaunchRequirements {
  models: TemplateModelRequirement[];
  mcp: TemplateMcpRequirement[];
}

export function parseTemplateLaunchRequirements(
  graph: Record<string, unknown> | undefined,
  resolveComponent: (ref: string) => ComponentMetadata | null,
): TemplateLaunchRequirements;

export function evaluateTemplateLaunchReadiness(input: {
  requirements: TemplateLaunchRequirements;
  requiredSecretNames: readonly string[];
  secretMappings: Readonly<Record<string, string>>;
  secrets: CatalogState<SecretSummary>;
  mcpServers: CatalogState<McpServerResponse>;
  mcpTools: CatalogState<McpToolResponse>;
  componentCatalog: { isLoading: boolean; error: unknown | null };
}): AgentReadinessRow[];
```

- [x] **Step 1: Write failing defensive parser tests**

  Add exact cases:

  - `returns empty requirements for missing and malformed graphs`;
  - `extracts different editor-marked input IDs and deduplicates identical provider-model pairs`;
  - `ignores provider-shaped overrides on ports without the llm-provider editor`;
  - `preserves an exact model id absent from the curated catalog`;
  - `extracts use-all, explicit server, exclusion, and target-agent policy settings`;
  - `ignores an unconnected mcp.custom node`;
  - `creates one MCP requirement per connected target agent`;
  - `selects every enabled server for useAllEnabled and ignores disabled servers`;
  - `selects only explicitly configured enabled server IDs`;
  - `excludes disabled and template-excluded tools from readiness counts`;
  - `keeps the current Gemini template best-effort MCP state non-blocking`.

  Include a fixture matching the actual seed shape: Gemini `gemini-3.5-flash`, nested `apiKeySecretId`, `mcp.custom` use-all/exclusions, an edge to the agent's `tools` handle, and `toolAvailability: 'best-effort'`.

- [x] **Step 2: Run tests and confirm RED**

  ```powershell
  bun --cwd=frontend run test src/features/templates/__tests__/template-launch-readiness.test.ts
  ```

- [x] **Step 3: Implement defensive graph parsing**

  Accept only records/arrays after runtime checks. Resolve each node's component from `data.componentId`, then `type`, then `data.componentSlug`. Call `findLlmProviderInput(component.inputs)` and read only `data.config.inputOverrides[llmInput.id]`; never probe literal `chatModel` or `model` keys. Keep only a string provider and non-empty model ID, deduplicate by `${provider}\u0000${modelId}`, and increment `nodeCount`. Record API-key-only auth capability except for `core.ai.claude-code`, which records both modes.

  For MCP, follow graph edges where the source node is `mcp.custom` and `targetHandle === 'tools'`. Parse the source selection and the target agent's `data.config.params.toolAvailability`; default that policy to `required`. Do not infer a credential name from provider. `template.requiredSecrets` remains the only credential-requirement source.

- [x] **Step 4: Adapt to the Task 4 domain**

  `evaluateTemplateLaunchReadiness()` may aggregate duplicate model display rows, but must call `evaluateLlmModelReadiness()` with each requirement's auth capability, `evaluateCredentialMappingReadiness()`, and `evaluateMcpToolsReadiness()` for state and blocking. It never evaluates a template graph placeholder as a secret ID: `template.requiredSecrets` plus the user's mapping own the credential row. If the component catalog is loading or failed, return an explicit model `loading`/`error` row instead of treating an empty parse result as ready. Builder/editor consumers continue using the composed `evaluateLlmProviderReadiness()` function.

- [x] **Step 5: Run focused verification**

  ```powershell
  bun --cwd=frontend run test src/features/templates/__tests__/template-launch-readiness.test.ts src/features/agent-readiness/__tests__/readiness.test.ts
  bun --cwd=frontend run typecheck
  bun --cwd=frontend x eslint src/features/templates/template-launch-readiness.ts src/features/templates/__tests__/template-launch-readiness.test.ts
  ```

- [x] **Step 6: Commit Task 7**

  ```powershell
  git add frontend/src/features/templates/template-launch-readiness.ts frontend/src/features/templates/__tests__/template-launch-readiness.test.ts
  git diff --cached --check
  git commit -s -m "feat(templates): derive launch readiness"
  ```

---

### Task 8: Show compact readiness in Configure & Run

**Files:**

- Modify: `frontend/src/features/templates/UseTemplateModal.tsx`
- Modify: `frontend/src/features/templates/__tests__/UseTemplateModal.test.tsx`

- [x] **Step 1: Extend query mocks and write failing modal tests**

  Add mutable component/secret/server/tool query results and these tests:

  - `shows the configured provider and model before creation`;
  - `deduplicates identical model configurations and shows the agent count`;
  - `shows required credentials as needing mapping and disables creation`;
  - `shows required credentials as mapped and enables creation after selection`;
  - `shows optional MCP with no enabled servers without blocking creation`;
  - `shows ready and attention MCP server counts from current server and tool data`;
  - `shows MCP status unavailable without blocking a best-effort template`;
  - `does not query or render MCP readiness for templates without an MCP connection`;
  - `shows model readiness unavailable when component metadata cannot load`;
  - `announces readiness changes through a polite live region`.

  Change the existing defensive unmapped-secret submit test to submit the form directly because the normal button will now be disabled.

- [x] **Step 2: Run the modal test and confirm RED**

  ```powershell
  bun --cwd=frontend run test src/features/templates/__tests__/UseTemplateModal.test.tsx
  ```

- [x] **Step 3: Derive all remote data through TanStack Query**

  Read the static component catalog with `useComponents()` and parse `template.graph` once with `useMemo`, resolving a node ref through `byId` and then `slugIndex`. Use:

  ```ts
  const componentsQuery = useComponents();
  const requirements = useMemo(() => {
    const index = componentsQuery.data;
    if (!index) return { models: [], mcp: [] };
    return parseTemplateLaunchRequirements(template.graph, (ref) => {
      const direct = index.byId[ref];
      if (direct) return direct;
      const id = index.slugIndex[ref];
      return id ? (index.byId[id] ?? null) : null;
    });
  }, [componentsQuery.data, template.graph]);
  const needsMcp = open && requirements.mcp.length > 0;
  const secretsQuery = useSecrets({ enabled: open && requiredSecrets.length > 0 });
  const serversQuery = useMcpServers({ enabled: needsMcp });
  const toolsQuery = useMcpAllTools({ enabled: needsMcp });
  ```

  Keep only workflow-name and secret-selection form state in `useState`. Derive `hasUnmappedSecrets` and readiness rows with `useMemo`; do not copy any query result.

- [x] **Step 4: Render one compact shared readiness block**

  Place **Run readiness** above the footer and reuse `ReadinessSummary`. Model rows render `${provider label} · ${modelId}` and `(N agents)` only when `nodeCount > 1`. Credential copy is `Not required`, `N/M mapped`, or `Needs mapping`. MCP copy explicitly includes `(optional)` for best-effort.

  Loading/error/empty MCP values must be textual (`Checking…`, `Status unavailable`, `No enabled servers`) and include a `/mcp-library` management link. Add a separate `aria-live="polite" aria-atomic="true"` summary. Do not call provider/model APIs and do not say a credential is valid.

- [x] **Step 5: Align button state with readiness**

  Disable **Create & Run** for mutation, required-secret loading/error/no-catalog, or `hasUnmappedSecrets`. Preserve the defensive submit validation. Never disable creation for a best-effort MCP row, including query failure or zero servers.

- [x] **Step 6: Run focused modal verification**

  ```powershell
  bun --cwd=frontend run test src/features/templates/__tests__/UseTemplateModal.test.tsx src/features/templates/__tests__/template-launch-readiness.test.ts src/features/agent-readiness/__tests__/readiness.test.ts
  bun --cwd=frontend run typecheck
  bun --cwd=frontend x eslint src/features/templates/UseTemplateModal.tsx src/features/templates/__tests__/UseTemplateModal.test.tsx
  ```

- [x] **Step 7: Commit Task 8**

  ```powershell
  git add frontend/src/features/templates/UseTemplateModal.tsx frontend/src/features/templates/__tests__/UseTemplateModal.test.tsx
  git diff --cached --check
  git commit -s -m "feat(templates): show run readiness"
  ```

---

### Task 9: Focused cross-workspace, browser, and real-run acceptance

**Required skill for browser steps:** `browser:control-in-app-browser`.

**Files:**

- Modify only if acceptance finds a task-owned defect: the owning task's files/tests above
- Update checklist/status after completion: `docs/superpowers/plans/2026-08-01-generic-ai-agent-configuration-readiness.md`

- [x] **Step 1: Run each focused automated suite once**

  ```powershell
  bun test packages/shared/src/__tests__/ai-model-catalog.test.ts packages/contracts/src/__tests__/llm-provider.test.ts packages/component-sdk/src/__tests__/zod-ports.test.ts packages/component-sdk/src/__tests__/registry.test.ts
  bun test worker/src/components/ai/__tests__/agent-model-port-metadata.test.ts worker/src/temporal/activities/__tests__/secret-resolver.test.ts worker/src/components/ai/__tests__/ai-agent.test.ts
  bun test backend/src/components/__tests__/agent-component-metadata.spec.ts backend/src/templates/__tests__/seed-templates.spec.ts backend/src/templates/__tests__/templates.service.spec.ts
  bun --cwd=frontend run test src/schemas/__tests__/component.test.ts src/lib/__tests__/mcpReadiness.test.ts src/features/agent-readiness/__tests__/readiness.test.ts src/features/agent-readiness/__tests__/workflowAdapter.test.ts src/components/workflow/config-panel/__tests__/agentModelOptions.test.ts src/components/workflow/config-panel/__tests__/agentModelUtils.test.ts src/utils/__tests__/portUtils.test.ts src/components/workflow/node/__tests__/NodeInputPorts.test.tsx src/components/workflow/__tests__/ConfigPanel.test.tsx src/components/workflow/__tests__/ValidationDock.test.tsx src/features/templates/__tests__/template-launch-readiness.test.ts src/features/templates/__tests__/UseTemplateModal.test.tsx src/hooks/queries/__tests__/useMcpServerQueries.test.tsx src/hooks/queries/__tests__/useSecretQueries.test.tsx
  ```

  Do not follow this with the full repository test suite unless a focused failure demonstrates a cross-cutting regression.

- [x] **Step 2: Run affected typechecks, targeted lint, and generated-output checks**

  ```powershell
  bun --cwd=packages/shared run typecheck
  bun --cwd=packages/contracts run typecheck
  bun --cwd=packages/component-sdk run typecheck
  bun --cwd=worker run typecheck
  bun --cwd=backend run typecheck
  bun --cwd=packages/backend-client run typecheck
  bun --cwd=frontend run typecheck
  bun --cwd=worker x eslint src/components/ai/ai-agent.ts src/components/ai/openai-provider.ts src/components/ai/anthropic-provider.ts src/components/ai/gemini-provider.ts src/components/ai/openrouter-provider.ts src/components/ai/opencode.ts src/components/ai/claude-code-agent.ts src/temporal/activities/secret-resolver.ts src/temporal/activities/run-component.activity.ts
  bun --cwd=frontend x eslint src/features/agent-readiness src/features/templates/template-launch-readiness.ts src/features/templates/UseTemplateModal.tsx src/components/workflow/ConfigPanel.tsx src/components/workflow/config-panel src/components/workflow/ValidationDock.tsx src/components/workflow/node/NodeInputPorts.tsx src/components/workflow/node/hooks/useNodeValidation.ts src/hooks/queries/useMcpServerQueries.ts src/hooks/queries/useSecretQueries.ts src/lib/mcpReadiness.ts src/utils/portUtils.ts
  bun --cwd=backend run generate:openapi
  bun --cwd=packages/backend-client run generate
  git diff --check
  ```

  Expected: generation produces no new diff after the committed Task 2 output.

- [x] **Step 3: Check and start the selected local instance**

  ```powershell
  bun run instance show
  bun run dev status
  ```

  If the selected instance is stopped, start that same instance with `bun run dev`. Wait for backend readiness, worker health, and frontend response; do not switch instance numbers.

- [x] **Step 4: Browser-verify the generic agent editor**

  In `/workflows/new`, create a workflow with an Entry Point and generic AI Agent. Verify:

  - the agent shows one **Model & API Key** section rather than raw `chatModel` JSON plus `modelApiKey`;
  - provider, curated model, exact model ID, and stored-secret controls are editable;
  - an exact non-catalog model remains visible after another field changes;
  - **Needs mapping** changes to **Mapped** only after selecting an existing secret;
  - connecting a provider node to `chatModel` disables inline controls and names the source;
  - save/reload preserves the actual `inputOverrides.chatModel` value;
  - browser console shows no new errors.

- [x] **Step 5: Browser-verify template launch readiness**

  Open the official **Gemini Autonomous npm Investigator** Configure & Run modal. Verify:

  - `Gemini · gemini-3.5-flash` appears before creation;
  - `GEMINI_API_KEY` is **Needs mapping** until a stored secret is selected;
  - optional MCP state reflects the current enabled server/tool catalog;
  - optional MCP loading/error/no-server state never disables **Create & Run**;
  - the button becomes enabled after required mapping.

- [x] **Step 6: Run one real Gemini npm investigation**

  Use the stored Gemini credential already authorized for this project and a small public package such as `is-number`. Launch the official template once. Wait for its terminal state and inspect the run page:

  - workflow and AI Agent nodes complete;
  - the transcript/report contains a package-specific investigation rather than placeholder output;
  - tool status accurately reports configured or degraded optional MCP state;
  - the saved graph contains a secret ID reference, not a credential value;
  - node output, terminal view, and artifacts do not display the credential.

  If the provider returns an authentication/quota/service error, record the exact external error and do not mask it with retries or substitute fake output. Fix only a Sentris-owned defect and rerun the smallest failed step.

- [x] **Step 7: Review the final diff and close the plan**

  ```powershell
  $taskStartSha = git log -1 --format=%H --grep="^docs: plan generic agent readiness$"
  if ([string]::IsNullOrWhiteSpace($taskStartSha)) {
    throw 'Could not locate the generic agent readiness plan commit.'
  }
  git status --short --branch
  git diff "$taskStartSha...HEAD" --stat
  git diff --stat
  git diff --cached --stat
  git log --oneline --decorate -12
  ```

  Confirm there are no unrelated staged files, raw secrets, `TODO`/temporary shims, duplicate readiness calculators, component-ID-to-model-port maps, or unintended generated changes. Mark completed checkboxes and add a short status line with exact verification counts/results.

  If acceptance required a final task-owned fix, add a signed conventional commit describing that fix. Otherwise commit only the completed plan status:

  ```powershell
  git add docs/superpowers/plans/2026-08-01-generic-ai-agent-configuration-readiness.md
  git diff --cached --check
  git commit -s -m "docs: complete generic agent readiness plan"
  ```
