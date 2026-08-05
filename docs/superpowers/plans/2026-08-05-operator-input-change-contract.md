# Operator Input-Change Contract Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Operator's model-facing run-input union with one canonical `set`/`unset` object and present repaired validation attempts as secondary diagnostics.

**Architecture:** The shared package owns the only input-change schema used by model tools, backend proposal validation, persisted proposal results, and reviewed launches. The backend materializes the object against the exact source run and immutable workflow version. Temporal's Activity sequence does not change; the frontend derives recovered-attempt presentation from the existing durable action ledger without mutating audit data.

**Tech Stack:** TypeScript, Zod 4, NestJS, Temporal TypeScript SDK, React, Bun test, AI SDK 6, generated OpenAPI client.

## Global Constraints

- Use one strict `{ set, unset }` object everywhere; do not retain the old discriminated model-facing array.
- `set` and `unset` are both required arrays; use `[]` when that operation is absent.
- Require one to twenty total operations, unique IDs, and no ID in both arrays.
- Proposal review and launch remain separate durable actions; proposals never launch automatically.
- Secret inputs, immutable workflow version, and source scope remain backend-enforced invariants.
- Only argument-validation failures followed by a later same-command success are visually recovered; all durable actions remain stored.
- Do not add provider-specific argument normalization or change the Temporal command sequence.
- Before implementation and live verification, target instance 0 and confirm no unrelated running `operatorTurnWorkflow` execution will be interrupted.

---

### Task 1: Canonical Shared and Backend Contract

**Files:**

- Modify: `packages/shared/src/operator.ts:730-772, 790-920, 1380-1395`
- Test: `packages/shared/src/__tests__/operator.test.ts:115-150`
- Modify: `backend/src/operator/operator-command.service.ts:123-185, 926-950, 1227-1245`
- Test: `backend/src/operator/__tests__/operator-command.service.spec.ts:313-455`
- Modify: `worker/src/temporal/activities/operator.activity.ts:840-850`

**Interfaces:**

- Produces: `OperatorRunInputChangesSchema` and `OperatorRunInputChanges` with exact shape `{ set: { inputId: string; value: unknown }[]; unset: string[] }`.
- Produces: `propose_run_input_changes` input `{ sourceRunId: string; inputChanges: OperatorRunInputChanges }`.
- Consumes: `run_workflow.inputChanges` using the same `OperatorRunInputChangesSchema`.
- Preserves: `OperatorRunInputProposalResult.changes` as the materialized display diff and `OperatorRunInputProposalResult.inputChanges` as the exact canonical launch payload.

- [ ] **Step 1: Confirm instance and drain boundary**

Run:

```powershell
bun run instance show
docker exec sentris-temporal temporal workflow list --address sentris-temporal:7233 --namespace sentris-dev-0 --query 'WorkflowType = "operatorTurnWorkflow" AND ExecutionStatus = "Running"'
```

Expected: active instance is `0`; no unrelated Operator turn is running. Allow a current UI turn to finish before continuing rather than cancelling it.

- [ ] **Step 2: Write failing shared contract tests**

Replace the old array assertion with literal set, unset, and combined examples, and prove the generated tool schema no longer contains a per-item union:

```ts
const inputChanges = {
  set: [{ inputId: 'packageSpec', value: 'minimist@1.2.9' }],
  unset: [],
};

expect(OperatorRunInputChangesSchema.parse(inputChanges)).toEqual(inputChanges);
expect(OperatorRunInputChangesSchema.parse({ set: [], unset: ['scanIntensity'] })).toEqual({
  set: [],
  unset: ['scanIntensity'],
});
expect(
  OperatorRunInputChangesSchema.parse({
    set: [{ inputId: 'packageSpec', value: 'minimist@1.2.9' }],
    unset: ['scanIntensity'],
  }),
).toEqual({
  set: [{ inputId: 'packageSpec', value: 'minimist@1.2.9' }],
  unset: ['scanIntensity'],
});

for (const invalid of [
  { set: [], unset: [] },
  {
    set: [
      { inputId: 'target', value: 'one' },
      { inputId: 'target', value: 'two' },
    ],
    unset: [],
  },
  { set: [{ inputId: 'target', value: 'one' }], unset: ['target'] },
]) {
  expect(OperatorRunInputChangesSchema.safeParse(invalid).success).toBe(false);
}

expect(
  OperatorProposeRunInputChangesInputSchema.safeParse({
    sourceRunId: 'sentris-run-source',
    changes: [{ operation: 'set', inputId: 'target', value: 'legacy' }],
  }).success,
).toBe(false);

const toolSchema = z.toJSONSchema(
  OPERATOR_COMMAND_DEFINITIONS.propose_run_input_changes.inputSchema,
);
expect(JSON.stringify(toolSchema)).not.toContain('"oneOf"');
expect(toolSchema).toMatchObject({
  properties: {
    inputChanges: {
      type: 'object',
      properties: {
        set: { type: 'array' },
        unset: { type: 'array' },
      },
      required: ['set', 'unset'],
    },
  },
});
```

Add a twenty-one-operation literal fixture and assert rejection so the total bound is exercised independently of per-array limits.

- [ ] **Step 3: Run shared tests and verify RED**

Run:

```powershell
bun --cwd=packages/shared test src/__tests__/operator.test.ts
```

Expected: FAIL because `OperatorRunInputChangesSchema` still expects an array and `propose_run_input_changes` still exposes `changes` with `oneOf` items.

- [ ] **Step 4: Write failing backend proposal and launch tests**

Change the existing end-to-end service fixture to the wished-for contract and add an unset case:

```ts
const inputChanges = {
  set: [{ inputId: 'target', value: 'new.example.com' }],
  unset: [],
};

await service.execute({
  commandName: 'propose_run_input_changes',
  arguments: { sourceRunId, inputChanges },
  auth,
  sessionId: SESSION_ID,
  turnId: TURN_ID,
  turnCreatedAt: '2026-08-02T10:00:00.000Z',
  actionId: ACTION_ID,
  actionRequestedAt: '2026-08-02T10:01:00.000Z',
});

await service.execute({
  commandName: 'run_workflow',
  arguments: {
    workflowId: WORKFLOW_ID,
    versionId: WORKFLOW_VERSION_ID,
    inputs: {},
    sourceRunId,
    inputChanges,
  },
  auth,
  sessionId: SESSION_ID,
  turnId: TURN_ID,
  turnCreatedAt: '2026-08-02T10:02:00.000Z',
  actionId: ACTION_ID,
  actionRequestedAt: '2026-08-02T10:03:00.000Z',
});
```

In the same real service test, set an optional `scanIntensity` value in source inputs and assert `{ set: [], unset: ['scanIntensity'] }` removes the explicit value, records the declared default in the proposal diff, and omits the explicit value from the launch inputs. Keep the existing secret-mutation rejection, changing its arguments to:

```ts
{
  sourceRunId,
  inputChanges: {
    set: [{ inputId: 'apiKey', value: 'replacement' }],
    unset: [],
  },
}
```

- [ ] **Step 5: Run backend tests and verify RED**

Run:

```powershell
bun --cwd=backend test src/operator/__tests__/operator-command.service.spec.ts
```

Expected: FAIL because proposal parsing still requires `changes` and materialization still iterates the legacy operation array.

- [ ] **Step 6: Implement the shared canonical schema**

Replace the discriminated input union with strict set entries and one strict changes object:

```ts
export const OperatorRunInputSetSchema = z
  .object({
    inputId: z.string().trim().min(1).max(191),
    value: z.unknown(),
  })
  .strict();

export const OperatorRunInputChangesSchema = z
  .object({
    set: z.array(OperatorRunInputSetSchema).max(20),
    unset: z.array(z.string().trim().min(1).max(191)).max(20),
  })
  .strict()
  .superRefine((inputChanges, context) => {
    const total = inputChanges.set.length + inputChanges.unset.length;
    if (total < 1 || total > 20) {
      context.addIssue({
        code: 'custom',
        path: [],
        message: 'Runtime input changes must contain between 1 and 20 operations',
      });
    }

    const seen = new Set<string>();
    for (const [index, change] of inputChanges.set.entries()) {
      if (seen.has(change.inputId)) {
        context.addIssue({
          code: 'custom',
          path: ['set', index, 'inputId'],
          message: `Duplicate runtime input change for "${change.inputId}"`,
        });
      }
      seen.add(change.inputId);
    }
    for (const [index, inputId] of inputChanges.unset.entries()) {
      if (seen.has(inputId)) {
        context.addIssue({
          code: 'custom',
          path: ['unset', index],
          message: `Duplicate runtime input change for "${inputId}"`,
        });
      }
      seen.add(inputId);
    }
  });

export type OperatorRunInputChanges = z.infer<typeof OperatorRunInputChangesSchema>;
```

Change `OperatorProposeRunInputChangesInputSchema` to `{ sourceRunId, inputChanges }`, retain the same `OperatorRunInputChangesSchema` reference in `OperatorRunWorkflowInputSchema`, and update the command description to include the literal shape `{ inputChanges: { set: [{ inputId, value }], unset: [] } }`.

- [ ] **Step 7: Implement one backend materializer**

Change `materializeRunInputChanges` to consume `inputChanges: OperatorRunInputChanges`. Apply each `set` entry with operation `set`, then each `unset` ID with operation `unset`, reusing one local `applyChange(operation, inputId, value?)` closure for definition lookup, secret rejection, before/after comparison, and diff creation. Keep final full-input validation and no-op rejection unchanged.

Update proposal execution to pass and persist `input.inputChanges`; update reviewed launch to pass `input.inputChanges` unchanged. Update the Operator system instruction to say:

```text
call propose_run_input_changes with inputChanges { set: [{ inputId, value }], unset: [] }, using [] for the unused operation
```

- [ ] **Step 8: Run focused tests and verify GREEN**

Run:

```powershell
bun --cwd=packages/shared test src/__tests__/operator.test.ts
bun --cwd=backend test src/operator/__tests__/operator-command.service.spec.ts
```

Expected: both commands exit `0`; set, unset, combined, bounds, duplicate/overlap, secret, preserved scope, and immutable-version assertions pass.

- [ ] **Step 9: Commit the canonical contract slice**

```powershell
git add packages/shared/src/operator.ts packages/shared/src/__tests__/operator.test.ts backend/src/operator/operator-command.service.ts backend/src/operator/__tests__/operator-command.service.spec.ts worker/src/temporal/activities/operator.activity.ts
git commit -s -m "feat(operator): simplify run input changes"
```

---

### Task 2: Recovered Attempt Presentation

**Files:**

- Modify: `frontend/src/features/operator/OperatorTimeline.tsx:736-780`
- Test: `frontend/src/features/operator/__tests__/OperatorTimeline.test.tsx`
- Test fixture updates: `frontend/src/features/operator/__tests__/operatorRunImprovement.test.ts`, `frontend/src/features/operator/__tests__/operatorJourneyPipeline.test.ts`
- Verify unchanged consumer: `frontend/src/features/operator/OperatorRunInputProposalCard.tsx`

**Interfaces:**

- Consumes: ordered `TimelineEvent` action segments and immutable `OperatorActionView` records.
- Produces: primary action events plus recovered argument-validation events, without modifying backend state.
- Recovered predicate: failed action, error begins `Invalid arguments for ${commandName}:`, and a later action in the same segment has the same command and status `succeeded`.

- [ ] **Step 1: Write the failing recovered-attempt UI test**

Create literal actions in one turn: `get_run` succeeds, two `propose_run_input_changes` actions fail argument validation, and a later proposal succeeds with a real `run-input-proposal` result using `{ set, unset }`.

Assert:

```ts
expect(screen.getByText('Reviewed input changes')).toBeInTheDocument();
expect(screen.getByRole('button', { name: 'Run with changes' })).toBeInTheDocument();
expect(screen.getByText('2 recovered attempts')).toBeInTheDocument();
expect(screen.queryByText(/expected object, received number/i)).not.toBeInTheDocument();

fireEvent.click(screen.getByText('2 recovered attempts'));
expect(screen.getByText(/expected object, received number/i)).toBeInTheDocument();
expect(screen.getByText(/invalid enum value/i)).toBeInTheDocument();
```

Add a separate unrecovered failed proposal without a later success and assert its error is visible immediately and no `Recovered attempts` disclosure exists.

- [ ] **Step 2: Run the frontend test and verify RED**

Run:

```powershell
bun --cwd=frontend test src/features/operator/__tests__/OperatorTimeline.test.tsx
```

Expected: FAIL because all failed actions are currently rendered in the primary action container.

- [ ] **Step 3: Implement derived recovered-attempt grouping**

Add a pure local helper above `ActionSegment`:

```ts
function partitionRecoveredArgumentFailures(events: Extract<TimelineEvent, { kind: 'action' }>[]): {
  primary: Extract<TimelineEvent, { kind: 'action' }>[];
  recovered: Extract<TimelineEvent, { kind: 'action' }>[];
} {
  const primary: Extract<TimelineEvent, { kind: 'action' }>[] = [];
  const recovered: Extract<TimelineEvent, { kind: 'action' }>[] = [];
  for (const [index, event] of events.entries()) {
    const action = event.value;
    const validationFailure =
      action.status === 'failed' &&
      action.error?.startsWith(`Invalid arguments for ${action.commandName}:`);
    const laterSuccess = events
      .slice(index + 1)
      .some(
        ({ value }) => value.commandName === action.commandName && value.status === 'succeeded',
      );
    (validationFailure && laterSuccess ? recovered : primary).push(event);
  }
  return { primary, recovered };
}
```

Render `primary` actions in the existing main container. When `recovered.length > 0`, render a closed `<details>` after the primary actions with summary copy `1 recovered attempt` or `${count} recovered attempts`; render the original `ActionEvent` rows inside it. Keep the segment's `aria-label` based on the total durable action count.

- [ ] **Step 4: Update input-change fixtures to the canonical object**

Change every frontend fixture and direct command from:

```ts
inputChanges: [{ operation: 'set', inputId: 'target', value: 'new.example.com' }];
```

to:

```ts
inputChanges: {
  set: [{ inputId: 'target', value: 'new.example.com' }],
  unset: [],
}
```

Do not add conversion logic in `OperatorRunInputProposalCard`; it forwards the same canonical result value to `run_workflow`.

- [ ] **Step 5: Run frontend tests and verify GREEN**

Run:

```powershell
bun --cwd=frontend test src/features/operator/__tests__/OperatorTimeline.test.tsx src/features/operator/__tests__/operatorRunImprovement.test.ts src/features/operator/__tests__/operatorJourneyPipeline.test.ts
```

Expected: exit `0`; recovered validation errors are hidden until expanded, unrecovered failures stay visible, and `Run with changes` sends the canonical input object.

- [ ] **Step 6: Commit the presentation slice**

```powershell
git add frontend/src/features/operator/OperatorTimeline.tsx frontend/src/features/operator/__tests__/OperatorTimeline.test.tsx frontend/src/features/operator/OperatorRunInputProposalCard.tsx frontend/src/features/operator/__tests__/operatorRunImprovement.test.ts frontend/src/features/operator/__tests__/operatorJourneyPipeline.test.ts
git commit -s -m "feat(operator): collapse recovered tool attempts"
```

---

### Task 3: Generated Contract, Architecture, and Real Journey

**Files:**

- Regenerate: `openapi.json`
- Regenerate: `packages/backend-client/src/client.ts`
- Modify: `AGENTS.md:345-355`
- Modify: `docs/architecture/adr-stateless-mcp-runtime-and-temporal-agents.md:90-105`

**Interfaces:**

- Produces: generated API/client `inputChanges` type matching `{ set, unset }`.
- Documents: canonical proposal/launch contract and recovered-attempt presentation.
- Verifies: actual Gemini set proposal, reviewed launch, and unset proposal on instance 0.

- [ ] **Step 1: Update architecture documentation**

Add one concise sentence to both architecture summaries:

```text
Run-input proposals and reviewed launches share one strict inputChanges object with required set and unset arrays; model argument-validation attempts repaired by a later same-command success remain durable but are collapsed under recovered diagnostics in the UI.
```

State that no provider-specific argument normalization or legacy model-facing schema exists.

- [ ] **Step 2: Regenerate OpenAPI and backend client**

Run:

```powershell
bun --cwd=backend run generate:openapi
bun --cwd=packages/backend-client run generate
```

Inspect `openapi.json` and `packages/backend-client/src/client.ts`. Expected generated shape:

```ts
inputChanges?: {
  set: { inputId: string; value: unknown }[];
  unset: string[];
};
```

The old `operation: 'set' | 'unset'` input array must be absent from generated run-workflow command arguments.

- [ ] **Step 3: Run affected automated verification**

Run:

```powershell
bun --cwd=packages/shared test src/__tests__/operator.test.ts
bun --cwd=backend test src/operator/__tests__/operator-command.service.spec.ts
bun --cwd=frontend test src/features/operator/__tests__/OperatorTimeline.test.tsx src/features/operator/__tests__/operatorRunImprovement.test.ts src/features/operator/__tests__/operatorJourneyPipeline.test.ts
bun --cwd=worker test src/temporal/activities/__tests__/operator.activity.test.ts src/temporal/workflows/__tests__/operator-turn-workflow.test.ts
bun run typecheck
bun run lint:shared
bun run lint:backend
bun run lint:frontend
bun run lint:worker
bun run lint:backend-client
bun run format:check
git diff --check
```

Expected: all tests, typechecks, lint commands, formatting, and diff checks exit `0`. Existing warning-only frontend lint output is acceptable only if it remains unchanged and contains no errors.

- [ ] **Step 4: Verify real Gemini set proposal without launch**

Run `bun run instance show` and `bun run dev status`; confirm instance `0` and healthy frontend/backend/worker. In the Operator UI, start from a terminal run with declared `scanIntensity`. Send:

```text
Propose changing scanIntensity to thorough for this exact run. Preserve its immutable workflow version, stored secrets, and scope. Do not launch it yet.
```

Verify the timeline records `get_run` followed by one successful `propose_run_input_changes`, renders the reviewed diff, enables `Run with changes`, and creates no new run before the click. If Gemini returns an invalid attempt, verify it is preserved only under `Recovered attempts` and the final proposal still uses `{ set, unset }`.

- [ ] **Step 5: Verify reviewed launch and unset proposal**

Click `Run with changes`, wait for the new run to be accepted, and inspect its recorded invocation. Confirm exact source workflow version and scope are preserved, stored secret placeholders are not exposed, and `scanIntensity` is `thorough`.

After that run is terminal, send:

```text
Propose unsetting scanIntensity for this exact run so the workflow default applies. Preserve its immutable workflow version, stored secrets, and scope. Do not launch it yet.
```

Verify a reviewed unset diff is rendered and no run starts. The action arguments must contain `inputChanges: { set: [], unset: ['scanIntensity'] }`.

- [ ] **Step 6: Inspect the final diff and commit**

Run:

```powershell
git status --short
git diff --stat
git diff --check
```

Confirm `Agent Pipeline Live v4.dc.html` remains untracked and unstaged. Then commit generated and documentation changes plus any fixture updates not already committed:

```powershell
git add openapi.json packages/backend-client/src/client.ts AGENTS.md docs/architecture/adr-stateless-mcp-runtime-and-temporal-agents.md
git commit -s -m "docs(operator): record canonical input changes"
```
