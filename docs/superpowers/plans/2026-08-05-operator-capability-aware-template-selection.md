# Operator Capability-Aware Template Selection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Operator select a maintained Nuclei-backed workflow when a user explicitly asks to detect website vulnerabilities or security flaws.

**Architecture:** Extend the existing typed template catalog with graph-derived component IDs and an exact component filter. Keep template materialization and workflow execution unchanged; use the new filter in Operator guidance for vulnerability-detection requests.

**Tech Stack:** TypeScript, Zod, NestJS, Bun test, Temporal worker activities, React Operator UI

## Global Constraints

- Use the validated template graph as capability truth; do not infer capability from names or tags.
- Filter before applying `limit`.
- Keep `list_workflow_templates` and `propose_workflow_from_template` as the only template-backed Operator path.
- Do not create a generic intent taxonomy or a second workflow authoring implementation.
- Do not save or run a proposed workflow unless the existing user action and approval boundaries authorize it.

---

### Task 1: Typed catalog capability contract

**Files:**

- Modify: `packages/shared/src/operator.ts`
- Test: `packages/shared/src/__tests__/operator.test.ts`

**Interfaces:**

- Produces: `requiredComponentIds?: string[]` on `OperatorListWorkflowTemplatesInputSchema`
- Produces: `componentIds: string[]` on `OperatorWorkflowTemplateSummarySchema`

- [ ] **Step 1: Write the failing contract test**

Add a literal parse example requiring `sentris.nuclei.scan`, assert the parsed value, and assert that more than 20 required IDs is rejected. Extend the returned summary fixture with `componentIds: ['core.workflow.entrypoint', 'sentris.nuclei.scan']`.

- [ ] **Step 2: Run the contract test and confirm RED**

Run: `bun --cwd=packages/shared test src/__tests__/operator.test.ts`

Expected: failure because the strict input schema rejects `requiredComponentIds` and the summary schema rejects `componentIds`.

- [ ] **Step 3: Add the bounded schema fields**

Use `z.array(z.string().trim().min(1).max(191)).max(20).optional()` for the input and `z.array(z.string().trim().min(1).max(191)).max(100)` for the result.

- [ ] **Step 4: Run the contract test and confirm GREEN**

Run: `bun --cwd=packages/shared test src/__tests__/operator.test.ts`

Expected: all tests pass.

### Task 2: Graph-derived filtering at the catalog boundary

**Files:**

- Modify: `backend/src/templates/templates.service.ts`
- Test: `backend/src/templates/__tests__/templates.service.spec.ts`
- Modify: `backend/src/operator/__tests__/operator-command.service.spec.ts`

**Interfaces:**

- Consumes: `requiredComponentIds?: string[]`
- Produces: catalog summaries containing unique graph-derived `componentIds`

- [ ] **Step 1: Write the failing service behavior test**

Create a popular recon-only fixture and a Nuclei-backed fixture. Call:

```ts
await service.listTemplateCatalog({
  requiredComponentIds: ['sentris.nuclei.scan'],
  limit: 1,
});
```

Assert the sole result is the Nuclei-backed template and its `componentIds` are literal, unique graph component IDs.

- [ ] **Step 2: Run the service test and confirm RED**

Run: `bun --cwd=backend test src/templates/__tests__/templates.service.spec.ts`

Expected: failure because the catalog neither filters nor returns `componentIds`.

- [ ] **Step 3: Implement graph-derived filtering**

After `buildTemplateGraph`, derive:

```ts
const componentIds = [...new Set(graph.nodes.map((node) => node.type))];
```

Return no entry when any requested component ID is absent. Include `componentIds` in every remaining summary, then retain the existing final `.slice(0, limit)`.

- [ ] **Step 4: Extend the command boundary fixture**

Pass `requiredComponentIds: ['sentris.nuclei.scan']` through the existing `list_workflow_templates` command test and include graph-derived `componentIds` in its catalog result.

- [ ] **Step 5: Run backend focused tests and confirm GREEN**

Run: `bun --cwd=backend test src/templates/__tests__/templates.service.spec.ts src/operator/__tests__/operator-command.service.spec.ts`

Expected: all tests pass.

### Task 3: Operator selection guidance and real journey

**Files:**

- Modify: `worker/src/temporal/activities/operator.activity.ts`
- Modify: `docs/architecture/adr-stateless-mcp-runtime-and-temporal-agents.md`

**Interfaces:**

- Consumes: `list_workflow_templates({ requiredComponentIds: ['sentris.nuclei.scan'] })`
- Produces: a normal `propose_workflow_from_template` action using an exact returned template ID

- [ ] **Step 1: Update the bounded authoring guidance**

State that explicit web vulnerability/flaw/exposure/misconfiguration detection requires `sentris.nuclei.scan`, while discovery/recon requests do not. Names and tags alone must not be treated as capability proof.

- [ ] **Step 2: Update the architecture decision record**

Record that maintained-template selection can filter on graph-derived component IDs and that vulnerability requests require an active scanner rather than a recon-only graph.

- [ ] **Step 3: Run focused static verification**

Run the affected shared/backend tests, `bun --cwd=packages/shared run typecheck`, `bun --cwd=backend run typecheck`, and `bun --cwd=worker run typecheck`.

- [ ] **Step 4: Verify the real user path**

In the running app on instance 0, create an Operator chat with an authorized request to make—but not save or run—a website security-flaw workflow. Confirm the proposal is based on a maintained template whose graph includes `sentris.nuclei.scan`, and confirm the draft card displays the selected template provenance.

- [ ] **Step 5: Review the integrated diff**

Run `git diff --check` and inspect only the files changed for this slice. Do not stage, commit, or push without explicit user approval.
