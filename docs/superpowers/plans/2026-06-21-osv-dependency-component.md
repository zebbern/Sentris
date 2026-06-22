# OSV Dependency Component Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a reusable OSV dependency advisory component and move the npm dependency template off embedded OSV scripts.

**Architecture:** Implement a focused inline worker component at `worker/src/components/security/osv.ts`. It parses package specs, calls OSV `querybatch`, optionally hydrates advisories with `/v1/vulns/{id}`, emits structured findings plus analytics-ready results, and is registered from `worker/src/components/index.ts`. Then update `backend/scripts/seed-templates/npm-dependency-cve-hunt.json` to use the component and keep the existing artifact writer for report persistence.

**Tech Stack:** TypeScript, Bun test, Sentris component SDK, OSV REST API, existing seed-template compiler tests and template live-audit harness.

**Current status:** Complete. The component is implemented and registered, the NPM dependency template uses `sentris.osv.query`, the broader GitHub dependency template routes npm/PyPI/Go/Maven package specs through OSV query nodes, and the live-validation ledger currently proves the relevant templates are fresh without rerunning them.

**Latest verification:**

- `bun --cwd worker test src/components/security/__tests__/osv.test.ts src/components/security/__tests__/manifest-extractor.test.ts` -> 11 pass.
- `bun --cwd backend test src/templates/__tests__/seed-templates.spec.ts` -> 27 pass.
- `bun run template-library:check` -> live-run validation current: 10/10; missing/stale/degraded: 0; duplicate names: 0; low-value/static candidates: 0.
- `bun run typecheck` -> pass.
- `bun run lint:backend` / `bun run lint:frontend` -> 0 errors with existing warning baselines.

---

### Task 1: Add OSV Component Tests

**Files:**

- Create: `worker/src/components/security/__tests__/osv.test.ts`

- [x] **Step 1: Write failing tests**

Create tests that import `../osv`, retrieve `sentris.osv.query`, and verify:

```ts
expect(componentRegistry.get('sentris.osv.query')).toBeDefined();
expect(parsePackageSpec('lodash@4.17.20', 'npm')).toEqual({
  spec: 'lodash@4.17.20',
  name: 'lodash',
  version: '4.17.20',
  ecosystem: 'npm',
});
expect(parsePackageSpec('@scope/pkg@1.2.3', 'npm')).toEqual({
  spec: '@scope/pkg@1.2.3',
  name: '@scope/pkg',
  version: '1.2.3',
  ecosystem: 'npm',
});
expect(inferOsvSeverity({ database_specific: { severity: 'HIGH' } })).toBe('high');
expect(extractFixedVersions(sampleAdvisory)).toEqual(['4.17.21']);
```

Mock `global.fetch` so execute sees one `querybatch` response and one hydrated advisory response:

```ts
const fetchSpy = vi.spyOn(global, 'fetch').mockImplementation(async (url) => {
  const text = String(url);
  if (text.endsWith('/v1/querybatch')) {
    return new Response(
      JSON.stringify({
        results: [{ vulns: [{ id: 'GHSA-test', modified: '2026-01-01T00:00:00Z' }] }],
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  }
  if (text.endsWith('/v1/vulns/GHSA-test')) {
    return new Response(JSON.stringify(sampleAdvisory), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  return new Response('not found', { status: 404 });
});
```

Assert execute returns one finding with `id`, `cves`, `fixedVersions`, `severity`, and one analytics result whose `scanner` is `osv`.

- [x] **Step 2: Verify tests fail**

Run: `bun --cwd worker test src/components/security/__tests__/osv.test.ts`

Expected: FAIL because `worker/src/components/security/osv.ts` does not exist.

### Task 2: Implement OSV Component

**Files:**

- Create: `worker/src/components/security/osv.ts`
- Modify: `worker/src/components/index.ts`

- [x] **Step 1: Add component implementation**

Implement:

```ts
export function parsePackageSpec(spec: string, defaultEcosystem: string): NormalizedPackage | null;
export function inferOsvSeverity(vuln: unknown): 'critical' | 'high' | 'medium' | 'low' | 'unknown';
export function extractFixedVersions(vuln: unknown): string[];
export const definition = defineComponent({ id: 'sentris.osv.query', ... });
```

The component inputs are `packageSpecs`; parameters are `ecosystem`, `severityFloor`, `hydrateAdvisories`, `maxAdvisoriesPerPackage`, and `includeUnknownSeverity`. Execution posts `{ queries }` to `https://api.osv.dev/v1/querybatch`, hydrates advisories when configured, builds `findings`, `summary`, `rawResults`, and `results`, and maps analytics severity to `critical | high | medium | low | info`.

- [x] **Step 2: Register component**

Add `import './security/osv';` near the other security component imports in `worker/src/components/index.ts`.

- [x] **Step 3: Verify component tests pass**

Run: `bun --cwd worker test src/components/security/__tests__/osv.test.ts`

Expected: PASS.

### Task 3: Update NPM Template To Use OSV Component

**Files:**

- Modify: `backend/scripts/seed-templates/npm-dependency-cve-hunt.json`
- Test: `backend/src/templates/__tests__/seed-templates.spec.ts`

- [x] **Step 1: Replace embedded OSV scripts**

Make the graph:

```text
trigger_1 -> osv_query -> assemble_dependency_report -> artifact_report
```

`osv_query` uses `sentris.osv.query`, receives `packageSpecs`, and has params:

```json
{
  "ecosystem": "npm",
  "severityFloor": "medium",
  "hydrateAdvisories": true,
  "maxAdvisoriesPerPackage": 50,
  "includeUnknownSeverity": true
}
```

The assemble script only packages `findings`, `summary`, `packages`, and `researchNotes` into the existing report shape.

- [x] **Step 2: Verify seed graph compiles**

Run: `bun --cwd backend test src/templates/__tests__/seed-templates.spec.ts`

Expected: PASS.

### Task 4: Live Verification And Broad Checks

**Files:**

- Use existing: `scripts/template-library-live-audit.ts`

- [x] **Step 1: Upsert active local template row**

Run: `$env:DATABASE_URL='postgresql://sentris:sentris@localhost:5433/sentris_instance_0'; bun --cwd backend scripts/seed-templates.ts`

Expected: existing templates skipped. If this script only skips existing template rows, update the active DB row for `NPM Dependency CVE Hunt` from the seed file before live audit.

- [x] **Step 2: Run focused live audit**

Run: `$env:TEMPLATE_AUDIT_NAMES='NPM Dependency CVE Hunt'; bun scripts/template-library-live-audit.ts`

Expected: `KEEP COMPLETED` and one JSON artifact with nonzero findings.

- [x] **Step 3: Run verification suite**

Run:

```bash
bun --cwd worker test src/components/security/__tests__/osv.test.ts
bun --cwd backend test src/templates/__tests__/seed-templates.spec.ts
bun --cwd backend test src/templates/__tests__/templates.service.spec.ts
bun run typecheck
bun run lint
git diff --check -- worker/src/components/security/osv.ts worker/src/components/security/__tests__/osv.test.ts worker/src/components/index.ts backend/scripts/seed-templates/npm-dependency-cve-hunt.json backend/src/templates/__tests__/seed-templates.spec.ts backend/src/templates/__tests__/templates.service.spec.ts scripts/template-library-live-audit.ts
docker ps --filter label=sentris.runId --format "{{.ID}} {{.Image}} {{.Status}}"
```

Expected: tests/typecheck exit 0, lint exits 0 with only existing warnings, scoped diff check exits 0, and no leftover Sentris-labeled containers.
