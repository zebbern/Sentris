# Local Usability — Phase 2: Run Against a Saved Scope (Prefill) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox syntax.

**Goal:** Let a user prefill a workflow's runtime inputs from a saved Target (scope) — pick a target in the Run dialog and its domains/repos/IP-ranges auto-fill the matching inputs.

**Architecture:** Frontend-only. A pure `mergeScopeValues(defaults, scope, runtimeDefs)` helper derives prefill values from a scope's `domains`/`repos`/`ipRanges` (matched to runtime-input ids by a documented vocabulary + type), overlaid with any explicit `scope.runtimeValues`, over the input defaults. A "Prefill from target" `Select` is added to `RunWorkflowDialog`; selecting a target applies the merge to the current inputs using the dialog's existing re-seed mechanism (`setInputs` + `formSeed` bump). No backend change (server-side scope threading is Phase 3).

**Tech Stack:** React + TanStack Query + shadcn/ui, `bun:test`.

## Global Constraints

- Frontend-only; no backend/schema changes. Server-side `scopeId` threading is deferred to Phase 3.
- The Run dialog already accepts `initialValues` and re-seeds uncontrolled fields via a `formSeed` key — reuse that exact mechanism; do not restructure the dialog's field rendering.
- Merge precedence (lowest→highest): input `defaultValue` < scope-derived (domains/repos/ipRanges auto-map) < explicit `scope.runtimeValues[id]`. A later manual edit in the dialog still wins (it's applied after selection).
- Type handling: an `array`-typed matched input gets the whole bucket array; a `text`/`string`-typed matched input gets the **first** bucket element. `'string'` normalizes to `'text'`.
- Only fill inputs whose id is in the documented ID sets — never guess-fill unrelated inputs. Unknown target inputs (e.g. `packageSpecs`, `cveId`) are intentionally left to their defaults/manual entry in this phase.
- No `any` in production. Commit after each task.

## File Structure

- Create `frontend/src/components/workflow/scopeInputMapping.ts` — `DOMAIN_INPUT_IDS`/`REPO_INPUT_IDS`/`IP_INPUT_IDS`, `mergeScopeValues`.
- Create `frontend/src/components/workflow/__tests__/scopeInputMapping.test.ts`.
- Modify `frontend/src/components/workflow/RunWorkflowDialog.tsx` — add the "Prefill from target" selector.
- Modify (or add) `frontend/src/components/workflow/__tests__/RunWorkflowDialog.test.tsx` — cover the selector prefills.

---

### Task 1: `mergeScopeValues` helper + tests

**Files:** Create `frontend/src/components/workflow/scopeInputMapping.ts`, `frontend/src/components/workflow/__tests__/scopeInputMapping.test.ts`.

**Interfaces produced:**

- `DOMAIN_INPUT_IDS`, `REPO_INPUT_IDS`, `IP_INPUT_IDS: ReadonlySet<string>`
- `mergeScopeValues(defaults: Record<string,unknown>, scope: ScopeLike, runtimeDefs: RuntimeInputDefLike[]): Record<string,unknown>` where `ScopeLike = Pick<Scope,'domains'|'repos'|'ipRanges'|'runtimeValues'>` and `RuntimeInputDefLike = { id: string; type: string }`.

- [ ] **Step 1: Failing test** — create `scopeInputMapping.test.ts`:

```ts
import { describe, it, expect } from 'bun:test';
import { mergeScopeValues } from '../scopeInputMapping';

const scope = {
  domains: ['example.com', 'app.example.com'],
  repos: ['github.com/example/app'],
  ipRanges: ['10.0.0.0/24'],
  runtimeValues: {},
};

describe('mergeScopeValues', () => {
  it('fills an array domains input with the whole domains bucket', () => {
    const out = mergeScopeValues({}, scope, [{ id: 'domains', type: 'array' }]);
    expect(out.domains).toEqual(['example.com', 'app.example.com']);
  });

  it('fills a singular text domain input with the first domain', () => {
    const out = mergeScopeValues({}, scope, [{ id: 'domain', type: 'text' }]);
    expect(out.domain).toBe('example.com');
  });

  it('maps repos to a repositoryUrl input (first element for text)', () => {
    const out = mergeScopeValues({}, scope, [{ id: 'repositoryUrl', type: 'text' }]);
    expect(out.repositoryUrl).toBe('github.com/example/app');
  });

  it('maps ipRanges to an ipRanges array input', () => {
    const out = mergeScopeValues({}, scope, [{ id: 'ipRanges', type: 'array' }]);
    expect(out.ipRanges).toEqual(['10.0.0.0/24']);
  });

  it('does NOT fill an unrelated input (packageSpecs)', () => {
    const out = mergeScopeValues({ packageSpecs: ['left'] }, scope, [
      { id: 'packageSpecs', type: 'array' },
    ]);
    expect(out.packageSpecs).toEqual(['left']); // unchanged default
  });

  it('preserves defaults for inputs the scope does not cover', () => {
    const out = mergeScopeValues({ authorizationNotes: 'keep' }, scope, [
      { id: 'domains', type: 'array' },
      { id: 'authorizationNotes', type: 'text' },
    ]);
    expect(out.authorizationNotes).toBe('keep');
    expect(out.domains).toEqual(['example.com', 'app.example.com']);
  });

  it('lets explicit runtimeValues override the auto-map by exact id', () => {
    const s = { ...scope, runtimeValues: { domains: ['override.com'] } };
    const out = mergeScopeValues({}, s, [{ id: 'domains', type: 'array' }]);
    expect(out.domains).toEqual(['override.com']);
  });

  it('ignores runtimeValues keys that are not declared runtime inputs', () => {
    const s = { ...scope, runtimeValues: { notAnInput: 'x' } };
    const out = mergeScopeValues({}, s, [{ id: 'domains', type: 'array' }]);
    expect(out.notAnInput).toBeUndefined();
  });

  it('skips empty buckets (no domains → does not set the input)', () => {
    const s = { domains: [], repos: [], ipRanges: [], runtimeValues: {} };
    const out = mergeScopeValues({}, s, [{ id: 'domains', type: 'array' }]);
    expect('domains' in out).toBe(false);
  });

  it("normalizes 'string' type to text (first element)", () => {
    const out = mergeScopeValues({}, scope, [{ id: 'target', type: 'string' }]);
    expect(out.target).toBe('example.com');
  });
});
```

- [ ] **Step 2: Run — fails** (module missing). `cd frontend && bun test src/components/workflow/__tests__/scopeInputMapping.test.ts`

- [ ] **Step 3: Implement** — `scopeInputMapping.ts`:

```ts
export const DOMAIN_INPUT_IDS: ReadonlySet<string> = new Set([
  'domains',
  'domain',
  'targets',
  'target',
  'liveurls',
  'seedurls',
  'hosts',
  'host',
  'authorizedtargets',
]);
export const REPO_INPUT_IDS: ReadonlySet<string> = new Set([
  'repos',
  'repo',
  'repositoryurl',
  'repositoryurls',
  'repositories',
]);
export const IP_INPUT_IDS: ReadonlySet<string> = new Set([
  'ipranges',
  'iprange',
  'ips',
  'ip',
  'cidrs',
]);

interface ScopeLike {
  domains: string[];
  repos: string[];
  ipRanges: string[];
  runtimeValues?: Record<string, unknown> | null;
}
interface RuntimeInputDefLike {
  id: string;
  type: string;
}

function bucketFor(idLower: string, scope: ScopeLike): string[] | undefined {
  if (DOMAIN_INPUT_IDS.has(idLower)) return scope.domains;
  if (REPO_INPUT_IDS.has(idLower)) return scope.repos;
  if (IP_INPUT_IDS.has(idLower)) return scope.ipRanges;
  return undefined;
}

/**
 * Derive a runtime-input prefill map from a saved scope.
 * Precedence: defaults < scope-derived (domains/repos/ipRanges auto-map) < scope.runtimeValues[id].
 * Array inputs receive the whole bucket; text/string inputs receive the first element.
 */
export function mergeScopeValues(
  defaults: Record<string, unknown>,
  scope: ScopeLike,
  runtimeDefs: RuntimeInputDefLike[],
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...defaults };

  for (const def of runtimeDefs) {
    const bucket = bucketFor(def.id.toLowerCase(), scope);
    if (!bucket || bucket.length === 0) continue;
    const isArray = def.type === 'array';
    result[def.id] = isArray ? [...bucket] : bucket[0];
  }

  const explicit = scope.runtimeValues;
  if (explicit) {
    const declared = new Set(runtimeDefs.map((d) => d.id));
    for (const [key, value] of Object.entries(explicit)) {
      if (declared.has(key)) result[key] = value;
    }
  }

  return result;
}
```

- [ ] **Step 4: Run — passes.** `cd frontend && bun test src/components/workflow/__tests__/scopeInputMapping.test.ts` (10 tests).
- [ ] **Step 5: Commit** — `git add frontend/src/components/workflow/scopeInputMapping.ts frontend/src/components/workflow/__tests__/scopeInputMapping.test.ts && git commit -m "feat(run): add mergeScopeValues prefill helper"`

---

### Task 2: "Prefill from target" selector in the Run dialog

**Files:** Modify `frontend/src/components/workflow/RunWorkflowDialog.tsx`. Test: `frontend/src/components/workflow/__tests__/RunWorkflowDialog.scope-prefill.test.tsx` (create).

**Interfaces consumed:** `useScopes()` (`@/hooks/queries/useScopeQueries`), `mergeScopeValues` (Task 1), `Scope` type. shadcn `Select`.

- [ ] **Step 1: Read the dialog** — Read `RunWorkflowDialog.tsx` fully. Confirm: local `inputs` state, `formSeed` state, the re-seed `useEffect` (keyed on `[initialValues, open, runtimeInputs]`), and the field wrapper `key={`${input.id}-${formSeed}`}`. The selector will call `setInputs(merged)` + `setFormSeed((s) => s + 1)` — the same mechanism the effect uses.

- [ ] **Step 2: Add the selector** — Near the top of the dialog body, ABOVE the rendered input fields and only when `runtimeInputs.length > 0`, render a "Prefill from target" section:
  - `const { data: scopes = [] } = useScopes();`
  - Render only if `scopes.length > 0`.
  - A shadcn `Select` whose items are the scope names (value = scope id). Include a small helper caption: "Fill matching inputs (domains, repos, IPs) from a saved target."
  - On value change: find the scope; compute `const merged = mergeScopeValues(inputs, scope, runtimeInputs);` then `setInputs(merged); setFormSeed((s) => s + 1);`. (Merge over the CURRENT `inputs`, so prior manual edits are the base and scope fills the target fields.)
  - Do NOT auto-submit; the user still reviews and clicks Run.

- [ ] **Step 3: Failing test** — `RunWorkflowDialog.scope-prefill.test.tsx`: mock `useScopeQueries.useScopes` to return one scope `{ id:'s1', name:'Example Corp', domains:['example.com','app.example.com'], repos:[], ipRanges:[], runtimeValues:{} }`; render the dialog `open` with `runtimeInputs=[{id:'domains',label:'Domains',type:'array',required:true}]` and empty `initialValues`; select the "Example Corp" option in the "Prefill from target" Select; assert the domains field now contains the scope's domains (assert on the rendered textarea/input value, or that clicking Run calls `onRun` with `{ domains: ['example.com','app.example.com'] }`). Mirror the mocking style of an existing dialog test (`TemplateLibraryPage.test.tsx` for radix-select mock: `@/test/mocks/radix-select`).

- [ ] **Step 4: Run — passes.** `cd frontend && bun test src/components/workflow/__tests__/RunWorkflowDialog.scope-prefill.test.tsx`

- [ ] **Step 5: Typecheck + lint + regression** — `cd frontend && bunx tsc --noEmit`; `bunx eslint src/components/workflow/RunWorkflowDialog.tsx src/components/workflow/scopeInputMapping.ts`; `bun test src/components/workflow/`.

- [ ] **Step 6: Commit** — `git add frontend/src/components/workflow/RunWorkflowDialog.tsx frontend/src/components/workflow/__tests__/RunWorkflowDialog.scope-prefill.test.tsx && git commit -m "feat(run): add Prefill from target selector to Run dialog"`

---

## Browser Verification (gate before Phase 3)

Against the running stack (authenticated session):

1. Create a Target "Acme" with domains `acme.com`, `api.acme.com` (Targets page).
2. Use the "Subdomain Takeover Triage" template (Template Library → Use Template) to create a workflow — it has a `domains` array runtime input. (Or any workflow whose Entry Point has a `domains` input.)
3. Open that workflow in the builder; click **Run**.
4. In the Run dialog, the **"Prefill from target"** selector appears; select "Acme".
5. Confirm the **Domains** input is now populated with `acme.com` and `api.acme.com` (the expected prefill).
6. Confirm inputs NOT covered by the scope (e.g. `authorizationNotes`) are untouched.
7. No console errors.

(We verify the prefill behavior — the workflow need not run to completion, which would require Docker security tooling.)

## Self-Review

- Coverage: merge helper (T1), dialog selector + wiring (T2), browser gate. ✓
- Placeholder scan: the only "read and confirm" step is T2 Step 1 (the dialog's re-seed mechanism) — the reference confirms `initialValues`/`formSeed` exist. No open items.
- Type consistency: `mergeScopeValues` signature identical in T1 (definition) and T2 (consumption); `RuntimeInputDefinition` `{id,type}` subset matches the dialog's `runtimeInputs` prop.
