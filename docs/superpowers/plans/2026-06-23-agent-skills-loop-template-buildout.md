# Agent Skills, For Each, and NPM CVE Pipeline Buildout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stabilize and complete the agent skills, Claude Code agent, For Each loop runtime, npm registry intel, and npm CVE pipeline template work so it can pass gates and be reviewed in the running Sentris Flow dev environment.

**Architecture:** Treat this as a multi-surface feature: backend compiles and seeds workflows, worker executes loop/runtime components, frontend exposes configuration and review UX, and scripts validate live template readiness. The first implementation phase is stabilization because `bun run typecheck` currently fails on committed/dirty work; later phases add runtime completeness, frontend wiring, and live validation.

**Tech Stack:** Bun workspaces, TypeScript, NestJS, Drizzle, React/Vite, TanStack Query, Zustand, Temporal, component-sdk, Docker runner, PM2 multi-instance dev.

---

## Operator Model

Main operator owns sequencing, integration, and review gates. Implementation workers must not overlap write sets unless explicitly assigned to a fix loop by the operator.

### Research Agents Already Dispatched

- **Hubble, Typecheck Stabilization Researcher:** mapped current typecheck failures and exact files.
- **Pauli, Backend Template Researcher:** mapped agent-skills, AI models, template seed, validation ledger, and dirty template work.
- **Herschel, Worker Runtime Researcher:** mapped For Each, Claude Code agent, npm registry intel, Docker runner, and Temporal runtime gaps.
- **Kuhn, Frontend Preview Researcher:** mapped Agent Skills page, agent model config, For Each UI gaps, and manual preview checklist.

### Implementation Roles

- **Worker A, Backend DSL Contract Owner**
  - Owns `backend/src/dsl/*`, backend workflow definition fixtures, and backend DSL tests.
- **Worker B, Worker Loop Runtime Owner**
  - Owns `worker/src/temporal/workflow-runner.ts`, `worker/src/temporal/workflows/for-each-*`, workflow runner tests, and loop runtime behavior.
- **Worker C, Security Component Owner**
  - Owns `worker/src/components/security/npm-registry-intel.ts`, its tests, and `security-docker-resources.ts`.
- **Worker D, Claude Agent and Docker Owner**
  - Owns `worker/src/components/ai/claude-code-agent.ts`, `worker/src/components/ai/agent-runner-utils.ts`, SDK runner non-zero exit handling, and related tests.
- **Worker E, Backend Template and Agent Skills Owner**
  - Owns template seed JSON, template seed tests, template validation fingerprints, agent-skills backend tests, and backend smoke scripts.
- **Worker F, Frontend UX Owner**
  - Owns frontend Agent Skills page, query hooks/API service alignment, For Each builder handles/validation, and frontend tests.
- **Reviewer S, Spec Reviewer**
  - Reviews each task against this plan only. Rejects missing or extra behavior.
- **Reviewer Q, Code Quality Reviewer**
  - Reviews after spec approval. Focuses on maintainability, test strength, boundaries, and project conventions.
- **Reviewer R, Release Gate Reviewer**
  - Performs final cross-surface review after all phases pass focused validation.

### Review Loop Per Task

1. Implementer reads the task, relevant files, and AGENTS.md.
2. Implementer writes or updates the failing test first where feasible.
3. Implementer makes the minimal implementation.
4. Implementer runs the task validation commands.
5. Reviewer S checks plan compliance.
6. Implementer fixes any spec gaps.
7. Reviewer Q checks code quality.
8. Implementer fixes any quality issues.
9. Main operator runs the phase gate and commits.

---

## Current State Snapshot

Active instance for preview: `0`

Preview URLs:

```powershell
http://localhost:5173
http://localhost:3211/health
http://localhost:3211/health/ready
http://localhost:9100/health
```

Known local dirty files at planning time:

```text
backend/src/templates/__tests__/seed-templates.spec.ts
packages/shared/src/template-validation-fingerprint.ts
worker/src/temporal/__tests__/workflow-runner.test.ts
worker/src/temporal/workflow-runner.ts
backend/scripts/seed-templates/npm-cve-hunt-pipeline.json
```

Known typecheck failure clusters:

- `WorkflowDefinition.loopBodies` required by inferred type while fixtures omit it.
- Worker test imports backend compiler, crossing `worker/tsconfig.json` root boundaries.
- `worker/src/temporal/workflow-runner.ts` puts `iterations` into `ExecutionContextMetadata`.
- `worker/src/components/ai/claude-code-agent.ts` reads `model.effort` without provider narrowing.
- `worker/src/components/security/npm-registry-intel.ts` exports inferred types where registry tests expect schema types.
- `worker/src/components/security/security-docker-resources.ts` omits inline `sentris.npm.registry.intel` from the exhaustive resource map.

---

## Phase 0: Research and Environment Baseline

**Status:** Complete for initial planning. Keep this phase repeatable at the start of each implementation day.

**Files:**

- Read: `AGENTS.md`
- Read: `README.md`
- Read: `docs/MULTI-INSTANCE-DEV.mdx`
- Read: `frontend/docs/state.md`
- Read: `frontend/docs/performance.md`
- Inspect: `package.json`
- Inspect: `git status --short --branch`

- [ ] **Step 0.1: Confirm local instance**

Run:

```powershell
bun run instance show
```

Expected:

```text
0
```

- [ ] **Step 0.2: Confirm dev stack health**

Run:

```powershell
bun run dev status
```

Expected:

```text
Frontend: OK
Backend liveness: OK
Backend readiness: OK
Worker health: OK
```

- [ ] **Step 0.3: Capture current blockers**

Run:

```powershell
bun run typecheck
```

Expected before Phase 1:

```text
Fails with the known typecheck clusters listed above.
```

Expected after Phase 1:

```text
Command exits 0.
```

**Review Gate:** Main operator confirms the health output and the current failing typecheck set before dispatching implementation workers.

---

## Phase 1: Typecheck Stabilization Gate

**Goal:** Make the current branch typecheck without changing product behavior.

**Execution Mode:** Parallel where write sets are disjoint. Worker A, Worker B, Worker C, and Worker D can run concurrently. Main operator integrates and runs `bun run typecheck`.

### Task 1A: Backend DSL Loop Type Cleanup

**Owner:** Worker A

**Files:**

- Modify: `backend/src/dsl/types.ts`
- Modify: `backend/src/dsl/loop-body.ts`
- Modify: `backend/src/dsl/__tests__/validator.spec.ts`
- Modify: `backend/src/schedules/__tests__/schedules.service.spec.ts`
- Modify: `backend/src/webhooks/__tests__/webhooks.service.spec.ts`
- Modify: `backend/src/workflows/__tests__/workflow-version.service.spec.ts`

- [ ] **Step 1A.1: Fix the nested definition type**

In `backend/src/dsl/types.ts`, keep a reusable core schema and export its inferred type:

```ts
const WorkflowDefinitionCoreSchema = z.object({
  version: z.number().int().positive().default(2),
  title: z.string(),
  description: z.string().optional(),
  entrypoint: z.object({ ref: z.string() }),
  nodes: z.record(z.string(), WorkflowNodeMetadataSchema).default({}),
  edges: z.array(WorkflowEdgeSchema).default([]),
  dependencyCounts: z.record(z.string(), z.number().int().nonnegative()).default({}),
  actions: z.array(WorkflowActionSchema),
  config: z.object({
    environment: z.string().default('default'),
    timeoutSeconds: z.number().default(0),
  }),
});

export type WorkflowDefinitionCore = z.infer<typeof WorkflowDefinitionCoreSchema>;
```

Set loop-body nested definitions to the core type:

```ts
export const LoopBodyDefinitionSchema = z.object({
  forEachRef: z.string(),
  bodyEntryRef: z.string(),
  exitRefs: z.array(z.string()),
  iterationCapture: z.object({
    sourceRef: z.string(),
    sourceHandle: z.string(),
  }),
  itemBinding: z
    .object({
      targetRef: z.string(),
      targetHandle: z.string(),
    })
    .optional(),
  definition: WorkflowDefinitionCoreSchema,
});
```

Keep the top-level definition default:

```ts
export const WorkflowDefinitionSchema = WorkflowDefinitionCoreSchema.extend({
  loopBodies: z.record(z.string(), LoopBodyDefinitionSchema).optional().default({}),
});
```

- [ ] **Step 1A.2: Use `WorkflowDefinitionCore` in loop body construction**

In `backend/src/dsl/loop-body.ts`, import `WorkflowDefinitionCore` and annotate the nested body:

```ts
import type {
  WorkflowAction,
  WorkflowDefinitionCore,
  WorkflowEdge,
  WorkflowNodeMetadata,
  LoopBodyDefinition,
} from './types';
```

Then:

```ts
const definition: WorkflowDefinitionCore = {
  version: 2,
  title: `Loop body for ${forEachId}`,
  entrypoint: { ref: bodyEntryRef },
  nodes: bodyNodes,
  edges: bodyEdges.map(
    (edge): WorkflowEdge => ({
      id: edge.id,
      sourceRef: edge.source,
      targetRef: edge.target,
      sourceHandle: edge.sourceHandle,
      targetHandle: edge.targetHandle,
      kind: 'success',
    }),
  ),
  dependencyCounts,
  actions: bodyActions,
  config: { environment: 'default', timeoutSeconds: 0 },
};
```

- [ ] **Step 1A.3: Repair hand-built fixtures**

For backend tests that directly type objects as `WorkflowDefinition`, add:

```ts
loopBodies: {},
```

This applies to:

```text
backend/src/dsl/__tests__/validator.spec.ts
backend/src/schedules/__tests__/schedules.service.spec.ts
backend/src/webhooks/__tests__/webhooks.service.spec.ts
backend/src/workflows/__tests__/workflow-version.service.spec.ts
```

- [ ] **Step 1A.4: Validate Task 1A**

Run:

```powershell
bun --cwd backend test src/dsl/__tests__/validator.spec.ts src/dsl/__tests__/loop-body.spec.ts
bun --cwd backend test src/schedules/__tests__/schedules.service.spec.ts src/webhooks/__tests__/webhooks.service.spec.ts src/workflows/__tests__/workflow-version.service.spec.ts
```

Expected:

```text
All targeted backend tests pass.
```

### Task 1B: Worker For Each Type Isolation

**Owner:** Worker B

**Files:**

- Modify: `worker/src/temporal/workflow-runner.ts`
- Modify: `worker/src/temporal/__tests__/workflow-runner.test.ts`

- [ ] **Step 1B.1: Move loop iteration facts out of metadata**

In `worker/src/temporal/workflow-runner.ts`, locate the `NODE_COMPLETED` trace for For Each. Keep `context` limited to `ExecutionContextMetadata` fields and put custom values into `data`:

```ts
options.trace?.record({
  type: 'NODE_COMPLETED',
  runId,
  nodeRef: action.ref,
  timestamp: new Date().toISOString(),
  level: 'info',
  context: {
    runId,
    componentRef: action.ref,
    streamId,
    joinStrategy,
    triggeredBy,
    failure,
  },
  data: {
    iterations: cappedItems.length,
  },
});
```

- [ ] **Step 1B.2: Remove worker test import of backend compiler**

In `worker/src/temporal/__tests__/workflow-runner.test.ts`, replace:

```ts
const { compileWorkflowGraph } = await import('../../../../backend/src/dsl/compiler');
```

with a worker-local `WorkflowDefinition` fixture that includes:

```ts
loopBodies: {
  loop: {
    forEachRef: 'loop',
    bodyEntryRef: 'body_step',
    exitRefs: ['body_step'],
    iterationCapture: {
      sourceRef: 'body_step',
      sourceHandle: 'result',
    },
    itemBinding: {
      targetRef: 'body_step',
      targetHandle: 'currentItem',
    },
    definition: {
      version: 2,
      title: 'Loop body for loop',
      entrypoint: { ref: 'body_step' },
      nodes: {
        body_step: {
          ref: 'body_step',
          mode: 'normal',
          label: 'Body',
        },
      },
      edges: [],
      dependencyCounts: { body_step: 0 },
      actions: [
        {
          ref: 'body_step',
          componentId: 'core.logic.script',
          params: {
            variables: [{ name: 'currentItem', type: 'string' }],
            returns: [{ name: 'result', type: 'json' }],
            code: "export function script(input) { return { result: { item: input.currentItem } }; }",
          },
          inputOverrides: {},
          dependsOn: [],
          inputMappings: {
            currentItem: {
              sourceRef: 'loop',
              sourceHandle: 'currentItem',
            },
          },
        },
      ],
      config: { environment: 'default', timeoutSeconds: 0 },
    },
  },
}
```

The main test definition must include only `trigger`, `loop`, and `finalize` in its top-level actions.

- [ ] **Step 1B.3: Validate Task 1B**

Run:

```powershell
bun --cwd worker test src/temporal/__tests__/workflow-runner.test.ts
```

Expected:

```text
The For Each workflow-runner test passes without importing backend files.
```

### Task 1C: NPM Registry Typing and Resource Map

**Owner:** Worker C

**Files:**

- Modify: `worker/src/components/security/npm-registry-intel.ts`
- Modify: `worker/src/components/security/__tests__/npm-registry-intel.test.ts`
- Modify: `worker/src/components/security/security-docker-resources.ts`

- [ ] **Step 1C.1: Export schema aliases**

In `worker/src/components/security/npm-registry-intel.ts`, export schema types that match `componentRegistry.get` generics:

```ts
export type NpmRegistryIntelInputSchema = typeof inputSchema;
export type NpmRegistryIntelOutputSchema = typeof outputSchema;
export type NpmRegistryIntelInput = z.infer<typeof inputSchema>;
export type NpmRegistryIntelOutput = z.infer<typeof outputSchema>;
```

- [ ] **Step 1C.2: Update test generic imports**

In `worker/src/components/security/__tests__/npm-registry-intel.test.ts`, import schema aliases and retrieve the component with schema generics:

```ts
import type {
  NpmRegistryIntelInputSchema,
  NpmRegistryIntelOutput,
  NpmRegistryIntelOutputSchema,
} from '../npm-registry-intel';

const component = componentRegistry.get<NpmRegistryIntelInputSchema, NpmRegistryIntelOutputSchema>(
  'sentris.npm.registry.intel',
);
```

When executing, type the result:

```ts
const result = (await component.execute(
  { inputs, params: {} },
  createMockContext(),
)) as NpmRegistryIntelOutput;
```

- [ ] **Step 1C.3: Add inline component to resource map**

In `worker/src/components/security/security-docker-resources.ts`, add:

```ts
'sentris.npm.registry.intel': null,
```

This component is inline and should not request Docker resources.

- [ ] **Step 1C.4: Validate Task 1C**

Run:

```powershell
bun --cwd worker test src/components/security/__tests__/npm-registry-intel.test.ts src/components/security/__tests__/security-docker-resources.test.ts
```

Expected:

```text
Both targeted worker security tests pass.
```

### Task 1D: Claude Effort Provider Narrowing

**Owner:** Worker D

**Files:**

- Modify: `worker/src/components/ai/claude-code-agent.ts`
- Modify: `worker/src/components/ai/__tests__/claude-code-agent.test.ts`
- Verify: `packages/contracts/src/__tests__/llm-provider.test.ts`

- [ ] **Step 1D.1: Add provider-narrowing helper**

In `worker/src/components/ai/claude-code-agent.ts`, add:

```ts
function getClaudeEffort(model: unknown): string | undefined {
  if (!model || typeof model !== 'object') return undefined;
  const candidate = model as { provider?: unknown; effort?: unknown };
  if (candidate.provider !== 'anthropic') return undefined;
  return typeof candidate.effort === 'string' && candidate.effort.length > 0
    ? candidate.effort
    : undefined;
}
```

- [ ] **Step 1D.2: Replace direct `model.effort` access**

Replace direct effort access with:

```ts
const effort = getClaudeEffort(model);
if (effort) {
  env.CLAUDE_CODE_EFFORT = effort;
}
```

- [ ] **Step 1D.3: Validate Task 1D**

Run:

```powershell
bun --cwd worker test src/components/ai/__tests__/claude-code-agent.test.ts
bun test packages/contracts/src/__tests__/llm-provider.test.ts
```

Expected:

```text
Claude Code agent tests and LLM provider contract tests pass.
```

### Phase 1 Gate

Run:

```powershell
bun run typecheck
```

Expected:

```text
Command exits 0.
```

**Review Gate:** Reviewer S confirms all known typecheck clusters are addressed. Reviewer Q confirms fixes do not widen types unnecessarily.

---

## Phase 2: Backend Template and Agent Skills Hardening

**Goal:** Make template seed, template validation, agent skills, and model discovery robust enough for product review.

**Execution Mode:** Worker E owns backend/template files. Worker D may assist on model auth semantics only after Worker E defines backend behavior.

### Task 2A: Finalize NPM CVE Hunt Pipeline Seed

**Owner:** Worker E

**Files:**

- Modify: `backend/scripts/seed-templates/npm-cve-hunt-pipeline.json`
- Modify: `backend/src/templates/__tests__/seed-templates.spec.ts`

- [ ] **Step 2A.1: Validate required structure in test**

In `backend/src/templates/__tests__/seed-templates.spec.ts`, add assertions for the template named `npm CVE Hunt Pipeline`:

```ts
expect(template.name).toBe('npm CVE Hunt Pipeline');
expect(template.requiredSecrets).toContain('CLAUDE_CODE_OAUTH_TOKEN');
expect(nodes.filter((node) => node.type === 'core.ai.claude-code')).toHaveLength(3);
expect(nodes.some((node) => node.type === 'core.workflow.for-each')).toBe(true);
expect(edges.some((edge) => edge.sourceHandle === 'body')).toBe(true);
expect(edges.some((edge) => edge.targetHandle === 'loopBack')).toBe(true);
expect(edges.some((edge) => edge.sourceHandle === 'results')).toBe(true);
```

- [ ] **Step 2A.2: Validate runtime input defaults**

Add explicit assertions for realistic defaults:

```ts
expect(runtimeInputs.map((input) => input.id)).toEqual(
  expect.arrayContaining(['packageSpecs', 'typosquatCandidates']),
);
```

- [ ] **Step 2A.3: Validate Task 2A**

Run:

```powershell
bun --cwd backend test src/templates/__tests__/seed-templates.spec.ts
```

Expected:

```text
Seed template tests pass and include npm CVE Hunt Pipeline loop assertions.
```

### Task 2B: Secret Mapping Coverage

**Owner:** Worker E

**Files:**

- Modify: `backend/src/templates/__tests__/templates.service.spec.ts`

- [ ] **Step 2B.1: Add secret replacement test**

Add a test that creates a template graph with three Claude Code nodes containing:

```json
"oauthTokenSecretId": "{{CLAUDE_CODE_OAUTH_TOKEN}}"
```

Call the service method that applies `secretMappings` and assert all three nodes receive:

```ts
expect(model.oauthTokenSecretId).toBe('secret_claude_code_oauth');
```

- [ ] **Step 2B.2: Validate Task 2B**

Run:

```powershell
bun --cwd backend test src/templates/__tests__/templates.service.spec.ts
```

Expected:

```text
Template service tests pass with multi-node secret replacement coverage.
```

### Task 2C: Template Fingerprint and Live Audit Classification

**Owner:** Worker E

**Files:**

- Modify: `packages/shared/src/template-validation-fingerprint.ts`
- Modify: `scripts/__tests__/template-library-live-audit-utils.test.ts`

- [ ] **Step 2C.1: Keep npm CVE live input fixture**

Confirm the shared fixture includes:

```ts
{
  name: 'npm CVE Hunt Pipeline',
  inputs: {
    packageSpecs: ['lodash@4.17.20', 'debug@2.6.8'],
    typosquatCandidates: ['lodas', 'deebug'],
  },
}
```

- [ ] **Step 2C.2: Add classification tests**

Add tests that verify the template is marked live-run capable only when `CLAUDE_CODE_OAUTH_TOKEN` is present in the audit secret map.

- [ ] **Step 2C.3: Validate Task 2C**

Run:

```powershell
bun test scripts/__tests__/template-library-live-audit-utils.test.ts
```

Expected:

```text
Template audit utility tests pass.
```

### Task 2D: Agent Skills Backend Review Coverage

**Owner:** Worker E

**Files:**

- Modify: `backend/src/agent-skills/__tests__/agent-skill-bundle.spec.ts`
- Modify: `backend/src/agent-skills/__tests__/agent-skills.service.spec.ts`

- [ ] **Step 2D.1: Add zip import coverage**

Assert zip import rejects path traversal and preserves nested skill files:

```ts
expect(result.imported[0].files['references/usage.md']).toContain('usage');
expect(() => importZipWithPath('../escape.md')).toThrow();
```

- [ ] **Step 2D.2: Add internal batch disabled-skill exclusion coverage**

Create one enabled and one disabled skill, then assert the internal batch service returns only the enabled skill.

- [ ] **Step 2D.3: Validate Task 2D**

Run:

```powershell
bun --cwd backend test src/agent-skills/__tests__/agent-skill-bundle.spec.ts src/agent-skills/__tests__/agent-skills.service.spec.ts
```

Expected:

```text
Agent skills backend tests pass.
```

### Phase 2 Gate

Run:

```powershell
bun --cwd backend run generate:openapi
bun --cwd packages/backend-client run generate
bun --cwd backend test src/templates/__tests__/seed-templates.spec.ts src/templates/__tests__/template-validation-ledger.service.spec.ts src/templates/__tests__/template-seed.service.spec.ts src/templates/__tests__/templates.service.spec.ts
bun --cwd backend test src/agent-skills/__tests__/agent-skill-bundle.spec.ts src/agent-skills/__tests__/agent-skills.service.spec.ts src/ai/__tests__/ai.service.spec.ts
```

Expected:

```text
All backend-focused tests pass and generated API/client files are updated only if routes or DTOs changed.
```

---

## Phase 3: Worker Runtime Completion

**Goal:** Make For Each, Claude Code, Docker execution, and npm registry intel reliable in both test and live workflow paths.

### Task 3A: Apply Loop Body Overrides and Retry Policy

**Owner:** Worker A with Worker B review

**Files:**

- Modify: `backend/src/workflows/workflow-run.service.ts`
- Modify: `backend/src/workflows/__tests__/workflow-run.service.spec.ts`

- [ ] **Step 3A.1: Apply node overrides recursively**

Refactor `applyNodeOverrides()` so it walks:

```ts
definition.actions;
Object.values(definition.loopBodies ?? {}).flatMap((loopBody) => loopBody.definition.actions);
```

Use a helper:

```ts
function getAllWorkflowActions(definition: WorkflowDefinition): WorkflowAction[] {
  return [
    ...definition.actions,
    ...Object.values(definition.loopBodies ?? {}).flatMap(
      (loopBody) => loopBody.definition.actions,
    ),
  ];
}
```

- [ ] **Step 3A.2: Inject retry policy recursively**

Where component retry policies are copied into compiled actions, apply the same helper so body components such as Claude Code keep `maxAttempts: 1`.

- [ ] **Step 3A.3: Validate Task 3A**

Run:

```powershell
bun --cwd backend test src/workflows/__tests__/workflow-run.service.spec.ts
```

Expected:

```text
Workflow run service tests pass, including loop-body override/retry assertions.
```

### Task 3B: De-duplicate For Each Runtime Paths

**Owner:** Worker B

**Files:**

- Modify: `worker/src/temporal/workflows/for-each-handler.ts`
- Modify: `worker/src/temporal/workflows/for-each-workflow-handler.ts`
- Modify: `worker/src/temporal/workflow-runner.ts`
- Modify: `worker/src/temporal/__tests__/workflow-runner.test.ts`

- [ ] **Step 3B.1: Share common loop execution helper**

Use `runForEachLoop()` from `for-each-handler.ts` for both Temporal workflow and inline runner paths. Keep the caller-specific action executor injected through `executeAction`.

- [ ] **Step 3B.2: Align active output ports**

Return only ports declared by the For Each component metadata:

```ts
return { activePorts: ['results', 'iterations'] };
```

If `done` is required as a routing port, add a declared output port named `done` in `worker/src/components/core/for-each.ts` and add a frontend port rendering test in Phase 4.

- [ ] **Step 3B.3: Validate Task 3B**

Run:

```powershell
bun --cwd worker test src/temporal/__tests__/workflow-runner.test.ts src/temporal/__tests__/workflow-scheduler.test.ts
```

Expected:

```text
Worker loop runner and scheduler tests pass.
```

### Task 3C: Docker Non-Zero Exit Capture

**Owner:** Worker D

**Files:**

- Modify: `packages/component-sdk/src/runner.ts`
- Modify: `packages/component-sdk/src/types.ts`
- Modify: `packages/component-sdk/src/__tests__/runner.test.ts`
- Modify: `worker/src/components/ai/claude-code-agent.ts`
- Modify: `worker/src/components/ai/__tests__/claude-code-agent.test.ts`

- [ ] **Step 3C.1: Add runner option**

Add a Docker runner option:

```ts
captureNonZeroExit?: boolean;
```

When set, Docker standard IO should resolve an object:

```ts
{
  exitCode: number;
  stdout: string;
  stderr: string;
}
```

instead of throwing immediately.

- [ ] **Step 3C.2: Use the option in Claude Code**

Set the Claude Code runner to request non-zero exit capture and convert auth failures into targeted component errors with stderr context.

- [ ] **Step 3C.3: Validate Task 3C**

Run:

```powershell
bun --cwd packages/component-sdk test src/__tests__/runner.test.ts src/__tests__/docker-runner.test.ts
bun --cwd worker test src/components/ai/__tests__/claude-code-agent.test.ts src/components/ai/__tests__/agent-runner-utils.test.ts
```

Expected:

```text
SDK runner and Claude Code tests pass.
```

### Task 3D: Claude Code Resource Profile

**Owner:** Worker D

**Files:**

- Modify: `worker/src/components/ai/claude-code-agent.ts`
- Modify: `worker/src/components/ai/__tests__/claude-code-agent.test.ts`

- [ ] **Step 3D.1: Set explicit Docker limits**

Use limits appropriate for long Claude Code runs:

```ts
memoryLimit: '2g',
cpuLimit: '2',
pidsLimit: 512,
timeoutSeconds: Math.max(params.timeoutSeconds ?? 900, 300),
```

- [ ] **Step 3D.2: Validate Task 3D**

Run:

```powershell
bun --cwd worker test src/components/ai/__tests__/claude-code-agent.test.ts
```

Expected:

```text
Tests assert explicit Docker limits for Claude Code.
```

### Phase 3 Gate

Run:

```powershell
bun --cwd worker run typecheck
bun --cwd worker test src/temporal/__tests__/workflow-runner.test.ts src/temporal/__tests__/workflow-scheduler.test.ts
bun --cwd worker test src/components/ai/__tests__/claude-code-agent.test.ts src/components/security/__tests__/npm-registry-intel.test.ts
```

Expected:

```text
Worker typecheck and focused runtime tests pass.
```

---

## Phase 4: Frontend Buildout and Preview UX

**Goal:** Make the new backend/runtime work understandable and reviewable in the UI.

### Task 4A: For Each Builder Wiring

**Owner:** Worker F

**Files:**

- Modify: `worker/src/components/core/for-each.ts`
- Modify: `frontend/src/utils/connectionValidation.ts`
- Modify: `frontend/src/utils/__tests__/connectionValidation.test.ts`
- Modify: relevant workflow node/port rendering tests if present.

- [ ] **Step 4A.1: Expose `body` and `loopBack` handles**

Update For Each component metadata so the builder can render:

```ts
output('body', z.unknown(), {
  label: 'Loop Body',
  branch: true,
});
```

and input:

```ts
input('loopBack', z.unknown().optional(), {
  label: 'Loop Back',
  required: false,
});
```

- [ ] **Step 4A.2: Allow sanctioned loop-back cycles**

In `frontend/src/utils/connectionValidation.ts`, allow a cycle only when:

```ts
targetHandle === 'loopBack';
```

and the target node type is:

```ts
core.workflow.for - each;
```

Reject all other cycles as today.

- [ ] **Step 4A.3: Validate Task 4A**

Run:

```powershell
bun --cwd frontend test src/utils/__tests__/connectionValidation.test.ts
bun --cwd worker test src/components/core/__tests__/for-each.test.ts
```

Expected:

```text
The builder allows only the For Each loop-back cycle and still rejects ordinary cycles.
```

### Task 4B: Agent Skills Data Layer Alignment

**Owner:** Worker F

**Files:**

- Modify: `frontend/src/services/api.ts` or the split API service file that owns agent skills.
- Modify: `frontend/src/hooks/queries/useAgentSkillQueries.ts`
- Modify: `frontend/src/hooks/queries/useAgentModelQueries.ts`
- Modify: frontend query hook tests.

- [ ] **Step 4B.1: Route agent skill calls through API service**

Move raw fetch calls behind `api.agentSkills.*` methods and parse returned data before query hooks receive it.

Example service shape:

```ts
agentSkills: {
  list: (enabledOnly?: boolean) => client.GET('/agent-skills', { params: { query: { enabledOnly } } }),
  discover: () => client.GET('/agent-skills/discover'),
  importDiscovered: (body) => client.POST('/agent-skills/import-discovered', { body }),
  delete: (id: string) => client.DELETE('/agent-skills/{id}', { params: { path: { id } } }),
}
```

- [ ] **Step 4B.2: Keep query keys centralized**

Continue using:

```ts
queryKeys.agentSkills.all();
queryKeys.agentSkills.discovered();
queryKeys.agentSkills.detail(id);
```

- [ ] **Step 4B.3: Validate Task 4B**

Run:

```powershell
bun --cwd frontend run typecheck
bun --cwd frontend test src/hooks/queries/__tests__/useAgentSkillQueries.test.ts
```

Expected:

```text
Frontend query hooks use the API layer and typecheck passes.
```

### Task 4C: Agent Skills Page Review Surface

**Owner:** Worker F

**Files:**

- Modify: `frontend/src/pages/AgentSkillsPage.tsx`
- Add or modify: `frontend/src/pages/__tests__/AgentSkillsPage.test.tsx`

- [ ] **Step 4C.1: Add skill detail preview**

When a library or discovered skill is selected, show:

```text
Name
Slug
Description
Source path
Enabled state
SKILL.md preview
Included file list
```

- [ ] **Step 4C.2: Add enable/disable action if API supports it**

If the update endpoint supports `enabled`, add an admin-only toggle wired through mutation invalidation. If not, show enabled state read-only and create a backend task for a later phase.

- [ ] **Step 4C.3: Validate Task 4C**

Run:

```powershell
bun --cwd frontend test src/pages/__tests__/AgentSkillsPage.test.tsx
bun --cwd frontend run lint
```

Expected:

```text
Agent Skills page tests pass and lint is clean for touched files.
```

### Phase 4 Gate

Run:

```powershell
bun --cwd frontend run typecheck
bun --cwd frontend run lint
```

Expected:

```text
Frontend typecheck and lint pass.
```

---

## Phase 5: Live Preview and Workflow Validation

**Goal:** Preview and validate the integrated experience on instance 0.

### Task 5A: Start or Confirm Dev Server

**Owner:** Main Operator

- [ ] **Step 5A.1: Confirm instance**

Run:

```powershell
bun run instance show
```

Expected:

```text
0
```

- [ ] **Step 5A.2: Start dev stack if needed**

Run:

```powershell
$env:SENTRIS_INSTANCE="0"; bun run dev
```

Expected:

```text
PM2 apps online and Docker infra running.
```

- [ ] **Step 5A.3: Confirm health**

Run:

```powershell
bun run dev status
curl.exe -sf http://localhost:5173
curl.exe -sf http://localhost:3211/health
curl.exe -sf http://localhost:3211/health/ready
curl.exe -sf http://localhost:9100/health
```

Expected:

```text
All health checks return success.
```

### Task 5B: Manual UI Review

**Owner:** Main Operator with Worker F support

- [ ] **Step 5B.1: Open Agent Skills**

Open:

```text
http://localhost:5173/agent-skills
```

Review:

```text
Top bar title
Manage sidebar item
Loading/empty/error states
Discovered skill cards
Imported/new badges
Overwrite toggle
Zip import
Import selected/all new
Delete confirmation
Admin-only visibility
```

- [ ] **Step 5B.2: Review workflow builder**

Open:

```text
http://localhost:5173/workflows
```

Create or open a test workflow and verify:

```text
Claude Code node shows model/auth config.
OpenCode node shows agent skills picker.
For Each node shows items, body, loopBack, results, iterations.
The builder allows body -> loopBack only for For Each.
```

### Task 5C: Live Template Audit

**Owner:** Worker E with Main Operator

- [ ] **Step 5C.1: Seed templates**

Run:

```powershell
bun --cwd backend scripts/seed-templates.ts --dry-run
bun --cwd backend scripts/seed-templates.ts
```

Expected:

```text
Target database is printed before mutation, and npm CVE Hunt Pipeline is upserted.
```

- [ ] **Step 5C.2: Run focused template audit**

Run with realistic secret setup:

```powershell
$env:TEMPLATE_AUDIT_NAMES="npm CVE Hunt Pipeline"; bun run template-library:audit
```

Expected:

```text
The npm CVE Hunt Pipeline either passes live validation or fails with a concrete missing-secret/runtime error.
```

### Phase 5 Gate

Run:

```powershell
bun run typecheck
bun run lint
bun run test
```

Expected:

```text
All repository gates pass before final handoff.
```

---

## Phase 6: Final Review, Docs, and Handoff

**Goal:** Make the work reviewable, documented, and ready to merge or keep on main with known risk clearly stated.

### Task 6A: Documentation Updates

**Owner:** Worker E and Worker F

**Files:**

- Modify: `docs/components/ai.mdx`
- Modify: `docs/components/security.mdx`
- Modify: `docs/guides/template-library.mdx`
- Modify: `docs/development/component-development.mdx`

- [ ] **Step 6A.1: Document Claude Code agent**

Include:

```text
Auth modes
OAuth token secret requirement
Agent skills import/use flow
Docker runtime expectations
Failure modes
```

- [ ] **Step 6A.2: Document For Each**

Include:

```text
Items input
Body edge
Loop-back edge
Results aggregation
Current limitations: sequential execution, no nested For Each until explicitly supported
```

- [ ] **Step 6A.3: Document npm registry intel**

Include:

```text
Inputs
Outputs
Risk signal meanings
Network behavior
Inline runner behavior
```

### Task 6B: Final Subagent Reviews

**Owner:** Main Operator

- [ ] **Step 6B.1: Dispatch spec reviewer**

Prompt:

```text
Review the implementation against docs/superpowers/plans/2026-06-23-agent-skills-loop-template-buildout.md.
Report only missing requirements, extra behavior, and validation gaps.
Do not modify files.
```

- [ ] **Step 6B.2: Dispatch code quality reviewer**

Prompt:

```text
Review the final diff for maintainability, type safety, test quality, frontend data-fetching conventions, backend org scoping, worker runtime safety, and Docker command safety.
Report findings with file/line references.
Do not modify files.
```

- [ ] **Step 6B.3: Resolve review findings**

Every accepted finding gets a focused fix task assigned to the owner of that subsystem.

### Task 6C: Final Git Handoff

**Owner:** Main Operator

- [ ] **Step 6C.1: Final status**

Run:

```powershell
git status --short --branch
git log -5 --oneline --decorate
```

- [ ] **Step 6C.2: Commit**

Use scoped commits after each phase. Final commit examples:

```powershell
git commit -s -m "fix: stabilize for-each workflow runtime"
git commit -s -m "feat: complete npm cve hunt template"
git commit -s -m "feat: improve agent skills review ui"
```

- [ ] **Step 6C.3: Push**

Run:

```powershell
git push origin HEAD:main
```

Expected:

```text
Push succeeds without --no-verify after Phase 5 gates pass.
```

---

## Execution Order Summary

1. Phase 1: Typecheck stabilization.
2. Phase 2: Backend template and agent-skills hardening.
3. Phase 3: Worker runtime completion.
4. Phase 4: Frontend preview UX.
5. Phase 5: Live preview and full validation.
6. Phase 6: Final reviews, docs, and handoff.

No later phase should start coding until Phase 1 passes `bun run typecheck`.

---

## Self-Review

Spec coverage:

- Subagents and roles are assigned.
- Phases include research, implementation, review, validation, and preview.
- Dev server preview is included with concrete instance and URL checks.
- Current typecheck blockers are represented as Phase 1 tasks.
- Backend, worker, frontend, docs, and release gates are represented.

Placeholder scan:

- No `TBD`, `TODO`, or undefined task owners remain.
- Each phase has exact files and validation commands.

Type consistency:

- `WorkflowDefinitionCore` is used for loop-body nested definitions.
- `WorkflowDefinition` remains the top-level parsed schema with `loopBodies`.
- For Each ports named in the plan match compiler/runtime names: `body`, `loopBack`, `results`, `iterations`.
