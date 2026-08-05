# Canonical Template Findings and Optional TLS Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make dependency-CVE template advisories appear as canonical Sentris findings and make the website quick-win template skip TLS scanning cleanly for HTTP-only targets.

**Architecture:** Reuse `sentris.osv.query`'s analytics-ready `results` and the existing `core.analytics.sink` in canonical no-suffix mode rather than adding a findings path. Model optional TLS work as two mutually exclusive conditional-router branches that rejoin through one `any`-join script before the existing all-input ranking node.

**Tech Stack:** Seed-template JSON graphs, NestJS workflow graph compiler, Bun tests, Temporal workflow scheduler, OpenSearch findings ingestion, React Operator UI.

## Global Constraints

- OpenSearch analytics ingestion remains the one canonical findings write path.
- Finding-producing sinks omit `indexSuffix`; explicit suffixes remain available for non-finding custom analytics such as asset inventories.
- OSV report artifacts remain available and are not replaced by indexed findings.
- HTTPS targets continue through `sentris.testssl.run`; only absence of an HTTPS target yields an empty TLS result.
- Genuine TLS execution failures remain visible.
- No new component implementation, persistence service, scheduler, or output scraper is introduced.
- Existing workflow versions and historical runs remain immutable; only workflows materialized from the updated templates use the corrected graphs.
- Use active local instance `0` for seeding and real-user verification.

## File Structure

- `backend/scripts/seed-templates/npm-dependency-cve-hunt.json` — add one OSV analytics sink and its typed input edge.
- `backend/scripts/seed-templates/github-repo-dependency-cve-triage.json` — add one multi-input OSV analytics sink and five typed input edges.
- `backend/scripts/seed-templates/github-actions-supply-chain-triage.json` — keep finding output on canonical no-suffix storage.
- `backend/scripts/seed-templates/public-repo-full-code-security.json` — keep finding output on canonical no-suffix storage.
- `backend/scripts/seed-templates/web-attack-surface-quick-win-hunt.json` — replace the fake TLS target with route, empty-result, and any-join nodes.
- `backend/src/templates/__tests__/seed-templates.spec.ts` — keep focused graph and embedded-script contract checks for both root-cause fixes.
- `worker/src/components/security/osv.ts` — retain bounded advisory timestamps and reference links in canonical evidence.
- `worker/src/components/security/__tests__/osv.test.ts` — cover the OSV analytics evidence projection.

---

### Task 1: Publish Dependency Advisories Through Canonical Findings

**Files:**

- Modify: `backend/scripts/seed-templates/npm-dependency-cve-hunt.json`
- Modify: `backend/scripts/seed-templates/github-repo-dependency-cve-triage.json`
- Test: `backend/src/templates/__tests__/seed-templates.spec.ts`

**Interfaces:**

- Consumes: `sentris.osv.query.results`, an analytics-ready `list-json` emitted by each OSV node.
- Produces: dynamic `core.analytics.sink` inputs with stable source tags `osv_npm`, `osv_pypi`, `osv_go`, `osv_maven`, and `osv_packagist`.

- [ ] **Step 1: Add the failing canonical-sink contract test**

Add this focused test inside `describe('new seed templates', ...)`:

```ts
it('dependency CVE templates publish OSV results through canonical analytics sinks', () => {
  const cases = [
    {
      fileName: 'npm-dependency-cve-hunt.json',
      inputs: [{ source: 'osv_query', targetHandle: 'osv_npm' }],
    },
    {
      fileName: 'github-repo-dependency-cve-triage.json',
      inputs: [
        { source: 'osv_npm_query', targetHandle: 'osv_npm' },
        { source: 'osv_pypi_query', targetHandle: 'osv_pypi' },
        { source: 'osv_go_query', targetHandle: 'osv_go' },
        { source: 'osv_maven_query', targetHandle: 'osv_maven' },
        { source: 'osv_packagist_query', targetHandle: 'osv_packagist' },
      ],
    },
  ] as const;

  for (const templateCase of cases) {
    const template = readSeed(templateCase.fileName);
    const sink = template.graph.nodes.find((node: { id: string }) => node.id === 'analytics_sink');
    const sinkEdges = template.graph.edges.filter(
      (edge: { target: string }) => edge.target === 'analytics_sink',
    );

    expect(sink?.type).toBe('core.analytics.sink');
    expect(sink.data.config.params).toMatchObject({
      assetKeyField: 'auto',
      failOnError: false,
    });
    expect(sink.data.config.params.indexSuffix).toBeUndefined();
    expect(sink.data.config.params.dataInputs.map((input: { id: string }) => input.id)).toEqual(
      templateCase.inputs.map((input) => input.targetHandle),
    );

    for (const input of templateCase.inputs) {
      expect(sinkEdges).toContainEqual(
        expect.objectContaining({
          source: input.source,
          sourceHandle: 'results',
          target: 'analytics_sink',
          targetHandle: input.targetHandle,
        }),
      );
    }
  }
});
```

- [ ] **Step 2: Run the focused test and confirm the missing sinks fail**

Run:

```powershell
bun --cwd=backend test src/templates/__tests__/seed-templates.spec.ts -t "dependency CVE templates publish OSV results"
```

Expected: FAIL because neither target template has an `analytics_sink` node.

- [ ] **Step 3: Add the NPM template sink**

Update the manifest to `nodeCount: 5` and `edgeCount: 7`. Add this node after `osv_query`:

```json
{
  "id": "analytics_sink",
  "type": "core.analytics.sink",
  "position": { "x": 740, "y": 80 },
  "data": {
    "label": "Index Dependency Findings",
    "config": {
      "params": {
        "dataInputs": [{ "id": "osv_npm", "label": "OSV NPM", "sourceTag": "osv_npm" }],
        "assetKeyField": "auto",
        "failOnError": false
      },
      "inputOverrides": {}
    }
  }
}
```

Add this typed edge without changing the report/artifact edges:

```json
{
  "id": "osv_query-analytics_sink-results",
  "source": "osv_query",
  "target": "analytics_sink",
  "sourceHandle": "results",
  "targetHandle": "osv_npm"
}
```

- [ ] **Step 4: Add the repository template sink**

Update the manifest to `nodeCount: 10` and `edgeCount: 33`. Add one `analytics_sink` node with:

```json
{
  "id": "analytics_sink",
  "type": "core.analytics.sink",
  "position": { "x": 1220, "y": 80 },
  "data": {
    "label": "Index Dependency Findings",
    "config": {
      "params": {
        "dataInputs": [
          { "id": "osv_npm", "label": "OSV NPM", "sourceTag": "osv_npm" },
          { "id": "osv_pypi", "label": "OSV PyPI", "sourceTag": "osv_pypi" },
          { "id": "osv_go", "label": "OSV Go", "sourceTag": "osv_go" },
          { "id": "osv_maven", "label": "OSV Maven", "sourceTag": "osv_maven" },
          {
            "id": "osv_packagist",
            "label": "OSV Packagist",
            "sourceTag": "osv_packagist"
          }
        ],
        "assetKeyField": "auto",
        "failOnError": false
      },
      "inputOverrides": {}
    }
  }
}
```

Add one typed `results` edge per OSV node. Each edge must use the matching target handle from the node's ecosystem; for example:

```json
{
  "id": "osv_npm_query-analytics_sink-results",
  "source": "osv_npm_query",
  "target": "analytics_sink",
  "sourceHandle": "results",
  "targetHandle": "osv_npm"
}
```

The other four exact source/target-handle pairs are `osv_pypi_query`/`osv_pypi`, `osv_go_query`/`osv_go`, `osv_maven_query`/`osv_maven`, and `osv_packagist_query`/`osv_packagist`.

- [ ] **Step 5: Run the focused and complete seed-template checks**

Run:

```powershell
bun --cwd=backend test src/templates/__tests__/seed-templates.spec.ts -t "dependency CVE templates publish OSV results"
bun --cwd=backend test src/templates/__tests__/seed-templates.spec.ts
```

Expected: both commands PASS, including the suite's schema and `compileWorkflowGraph` checks for every seed.

- [ ] **Step 6: Commit the canonical findings slice**

```powershell
git add -- backend/scripts/seed-templates/npm-dependency-cve-hunt.json backend/scripts/seed-templates/github-repo-dependency-cve-triage.json backend/src/templates/__tests__/seed-templates.spec.ts
git commit -s -m "fix: publish dependency template findings"
```

### Task 1A: Align Finding Templates and Preserve OSV Advisory Evidence

**Files:**

- Modify: `backend/scripts/seed-templates/npm-dependency-cve-hunt.json`
- Modify: `backend/scripts/seed-templates/github-repo-dependency-cve-triage.json`
- Modify: `backend/scripts/seed-templates/github-actions-supply-chain-triage.json`
- Modify: `backend/scripts/seed-templates/public-repo-full-code-security.json`
- Modify: `worker/src/components/security/osv.ts`
- Test: `backend/src/templates/__tests__/seed-templates.spec.ts`
- Test: `worker/src/components/security/__tests__/osv.test.ts`

- [ ] **Step 1: Enforce canonical no-suffix mode across finding-producing templates**

Require each maintained finding-producing `core.analytics.sink` to omit `indexSuffix`. Cover the npm dependency, GitHub repository dependency, GitHub Actions supply-chain, public repository full-code-security, and Gemini npm investigator templates. Do not remove explicit suffixes from asset-oriented custom analytics templates.

- [ ] **Step 2: Retain bounded OSV advisory evidence**

Project the OSV finding's existing bounded advisory fields into the analytics result's canonical `evidence` object:

```ts
evidence: {
  published: finding.published,
  modified: finding.modified,
  references: finding.references,
}
```

`getReferences()` already limits the normalized advisory/web references to eight. Keep that bound and use the existing passthrough analytics result plus canonical observation contract; do not add another evidence schema or findings reader.

- [ ] **Step 3: Verify the shared storage and evidence boundaries**

Run:

```powershell
bun --cwd=backend test src/templates/__tests__/seed-templates.spec.ts
bun --cwd=worker test src/components/security/__tests__/osv.test.ts
bun --cwd=worker test src/components/core/__tests__/analytics-sink-result.test.ts
bun --cwd=worker test src/utils/__tests__/opensearch-indexer.test.ts
bun --cwd=worker run typecheck
```

Expected: finding templates select canonical storage, custom analytics suffix behavior remains covered, and hydrated OSV results retain `published`, `modified`, and bounded `references` through canonical evidence.

---

### Task 2: Replace the Fake TLS Target With Conditional Execution

**Files:**

- Modify: `backend/scripts/seed-templates/web-attack-surface-quick-win-hunt.json`
- Test: `backend/src/templates/__tests__/seed-templates.spec.ts`

**Interfaces:**

- Consumes: `extract_live_urls.tlsTargets: string[]` and `testssl_review.findings: object[]`.
- Produces: `merge_tls_findings.tlsFindings: object[]`, which is always present for the ranking node after either the scan or no-target branch completes.

- [ ] **Step 1: Add the failing optional-TLS graph and script test**

Add this test beside the existing website quick-win template tests:

```ts
it('web-attack-surface-quick-win-hunt skips TLS cleanly when no HTTPS target exists', () => {
  const template = readSeed('web-attack-surface-quick-win-hunt.json');
  const routeNode = template.graph.nodes.find(
    (node: { id: string }) => node.id === 'route_tls_targets',
  );
  const selectNode = template.graph.nodes.find(
    (node: { id: string }) => node.id === 'select_tls_target',
  );
  const emptyNode = template.graph.nodes.find(
    (node: { id: string }) => node.id === 'empty_tls_findings',
  );
  const mergeNode = template.graph.nodes.find(
    (node: { id: string }) => node.id === 'merge_tls_findings',
  );
  const edges = template.graph.edges.map(
    (edge: { source: string; target: string; sourceHandle?: string; targetHandle?: string }) =>
      `${edge.source}:${edge.sourceHandle}->${edge.target}:${edge.targetHandle}`,
  );

  expect(routeNode?.type).toBe('sentris.conditional-router.run');
  expect(routeNode.data.config.params).toMatchObject({ conditionType: 'is_not_empty' });
  expect(selectNode.data.config.params.code).not.toContain('no-https-target-provided.invalid:443');
  expect(() => runTemplateScript(selectNode.data.config.params.code, { tlsTargets: [] })).toThrow(
    'TLS target route produced no target',
  );
  expect(runTemplateScript(emptyNode.data.config.params.code, { tlsTargets: [] })).toEqual({
    tlsFindings: [],
  });
  expect(mergeNode.data.config.joinStrategy).toBe('any');
  expect(runTemplateScript(mergeNode.data.config.params.code, { tlsFindingsFromSkip: [] })).toEqual(
    { tlsFindings: [] },
  );
  expect(
    runTemplateScript(mergeNode.data.config.params.code, {
      tlsFindingsFromScan: [{ id: 'tls-1' }],
    }),
  ).toEqual({ tlsFindings: [{ id: 'tls-1' }] });
  expect(edges).toEqual(
    expect.arrayContaining([
      'extract_live_urls:tlsTargets->route_tls_targets:value',
      'route_tls_targets:matched->select_tls_target:tlsTargets',
      'route_tls_targets:unmatched->empty_tls_findings:tlsTargets',
      'testssl_review:findings->merge_tls_findings:tlsFindingsFromScan',
      'empty_tls_findings:tlsFindings->merge_tls_findings:tlsFindingsFromSkip',
      'merge_tls_findings:tlsFindings->rank_quick_wins:tlsFindings',
    ]),
  );
  expect(edges).not.toContain('testssl_review:findings->rank_quick_wins:tlsFindings');
});
```

- [ ] **Step 2: Run the focused test and confirm the missing route fails**

Run:

```powershell
bun --cwd=backend test src/templates/__tests__/seed-templates.spec.ts -t "skips TLS cleanly"
```

Expected: FAIL because `route_tls_targets`, `empty_tls_findings`, and `merge_tls_findings` do not exist and the sentinel is still present.

- [ ] **Step 3: Add route, empty-result, and merge nodes**

Update the manifest to `nodeCount: 13` and `edgeCount: 19`. Add the router at `{ "x": 1060, "y": 500 }`:

```json
{
  "id": "route_tls_targets",
  "type": "sentris.conditional-router.run",
  "position": { "x": 1060, "y": 500 },
  "data": {
    "label": "Route TLS Target Availability",
    "config": {
      "params": { "conditionType": "is_not_empty", "jsonPath": "" },
      "inputOverrides": {}
    }
  }
}
```

Change `select_tls_target` to `{ "x": 1320, "y": 420 }` and use:

```js
export function script(input) {
  const targets = Array.isArray(input.tlsTargets) ? input.tlsTargets : [];
  if (targets.length === 0) throw new Error('TLS target route produced no target');
  return { tlsTarget: targets[0] };
}
```

Add the unmatched-branch script at `{ "x": 1320, "y": 620 }`:

```json
{
  "id": "empty_tls_findings",
  "type": "core.logic.script",
  "position": { "x": 1320, "y": 620 },
  "data": {
    "label": "Skip TLS Review",
    "config": {
      "params": {
        "variables": [{ "name": "tlsTargets", "type": "list-text" }],
        "returns": [{ "name": "tlsFindings", "type": "list-json" }],
        "code": "export function script() { return { tlsFindings: [] }; }"
      },
      "inputOverrides": {}
    }
  }
}
```

Move `testssl_review` to `{ "x": 1580, "y": 420 }`. Add the rejoin node at `{ "x": 1840, "y": 500 }`:

```json
{
  "id": "merge_tls_findings",
  "type": "core.logic.script",
  "position": { "x": 1840, "y": 500 },
  "data": {
    "label": "Finalize TLS Findings",
    "config": {
      "joinStrategy": "any",
      "params": {
        "variables": [
          { "name": "tlsFindingsFromScan", "type": "list-json", "required": false },
          { "name": "tlsFindingsFromSkip", "type": "list-json", "required": false }
        ],
        "returns": [{ "name": "tlsFindings", "type": "list-json" }],
        "code": "export function script(input) { if (Array.isArray(input.tlsFindingsFromScan)) return { tlsFindings: input.tlsFindingsFromScan }; if (Array.isArray(input.tlsFindingsFromSkip)) return { tlsFindings: input.tlsFindingsFromSkip }; throw new Error('No TLS branch produced findings'); }"
      },
      "inputOverrides": {}
    }
  }
}
```

Move `rank_quick_wins` to `{ "x": 2100, "y": 300 }` and `artifact_report` to `{ "x": 2420, "y": 300 }` so the saved workflow graph remains readable in Builder.

- [ ] **Step 4: Replace the direct TLS edges with the conditional branch**

Keep `select_tls_target -> testssl_review`. Replace `extract_live_urls -> select_tls_target` and `testssl_review -> rank_quick_wins` with exactly these edges:

```json
[
  {
    "id": "extract_live_urls-route_tls_targets-tlsTargets",
    "source": "extract_live_urls",
    "target": "route_tls_targets",
    "sourceHandle": "tlsTargets",
    "targetHandle": "value"
  },
  {
    "id": "route_tls_targets-matched-select_tls_target-tlsTargets",
    "source": "route_tls_targets",
    "target": "select_tls_target",
    "sourceHandle": "matched",
    "targetHandle": "tlsTargets"
  },
  {
    "id": "route_tls_targets-unmatched-empty_tls_findings-tlsTargets",
    "source": "route_tls_targets",
    "target": "empty_tls_findings",
    "sourceHandle": "unmatched",
    "targetHandle": "tlsTargets"
  },
  {
    "id": "testssl_review-merge_tls_findings-findings",
    "source": "testssl_review",
    "target": "merge_tls_findings",
    "sourceHandle": "findings",
    "targetHandle": "tlsFindingsFromScan"
  },
  {
    "id": "empty_tls_findings-merge_tls_findings-findings",
    "source": "empty_tls_findings",
    "target": "merge_tls_findings",
    "sourceHandle": "tlsFindings",
    "targetHandle": "tlsFindingsFromSkip"
  },
  {
    "id": "merge_tls_findings-rank_quick_wins-findings",
    "source": "merge_tls_findings",
    "target": "rank_quick_wins",
    "sourceHandle": "tlsFindings",
    "targetHandle": "tlsFindings"
  }
]
```

- [ ] **Step 5: Run the focused and complete seed-template checks**

Run:

```powershell
bun --cwd=backend test src/templates/__tests__/seed-templates.spec.ts -t "skips TLS cleanly"
bun --cwd=backend test src/templates/__tests__/seed-templates.spec.ts
bun --cwd=backend run typecheck
```

Expected: all commands PASS; compilation proves the dynamic branch and `any` join are accepted by the canonical workflow compiler.

- [ ] **Step 6: Commit the optional TLS slice**

```powershell
git add -- backend/scripts/seed-templates/web-attack-surface-quick-win-hunt.json backend/src/templates/__tests__/seed-templates.spec.ts
git commit -s -m "fix: skip tls review without https targets"
```

---

### Task 3: Seed Instance 0 and Verify the Real Operator Journeys

**Files:**

- Verify only: no source files are added by this task.

**Interfaces:**

- Consumes: the changed official finding/TLS seed graphs, instance-0 backend/worker/frontend services, Operator's existing template-run path, and canonical run findings APIs.
- Produces: real user-facing evidence that indexed findings agree across surfaces and HTTP-only TLS absence no longer appears as a failed scan.

- [ ] **Step 1: Confirm instance 0 and local service health**

Run:

```powershell
bun run instance show
bun run dev status
```

Expected: active instance `0`; frontend, backend, and worker are online. If a service was restarted by file watching, wait for readiness rather than starting another instance.

- [ ] **Step 2: Validate the seed target and update the local catalog**

Run:

```powershell
bun --cwd=backend scripts/seed-templates.ts --dry-run
bun --cwd=backend scripts/seed-templates.ts
bun run template-library:verify
```

Expected: the dry run prints the instance-0 database target, the real seed updates the affected template rows, and the changed templates have current live-validation entries. If the broader catalog command remains red because of unrelated missing or stale entries, record those separately instead of treating them as a failure of this slice.

- [ ] **Step 3: Run a real dependency-CVE journey through Operator**

In the browser at `http://localhost:5173/operator`, start a new Operator chat and send:

```text
Run the NPM Dependency CVE Hunt for lodash@4.17.20 and show me the findings.
```

Approve the typed run action if the session is in Ask mode. Wait for the workflow and terminal follow-up to complete. Confirm all three observations refer to the same run ID:

1. The run card reports a non-zero finding count.
2. Operator's typed terminal evidence reports the same finding count and exposes run-scoped finding links.
3. Opening the run-scoped Findings view shows the same OSV advisories, including package/advisory evidence rather than only an artifact count.

If OpenSearch ingestion is still settling, use the visible Refresh control once; do not accept a silent zero as success.

- [ ] **Step 4: Run a real HTTP-only website journey through Operator**

Start another Operator chat and send:

```text
Run Web Attack Surface Quick Win Hunt against http://scanme.nmap.org/ in safe mode.
```

Approve if required and wait for terminal completion. Inspect the run trace and confirm:

1. `route_tls_targets` takes the unmatched branch when `extract_live_urls.tlsTargets` is empty.
2. `testssl_review` is skipped rather than failed.
3. `merge_tls_findings` completes with an empty list.
4. httpx, Katana, Nuclei, ranking, and artifact creation still complete according to their real results.
5. Operator reports the final run outcome without a false TLS error.

- [ ] **Step 5: Check the final repository state and push main**

Run:

```powershell
git status --short --branch
git log --oneline --decorate -4
git push origin main
```

Expected: only the user-owned untracked `Agent Pipeline Live v4.dc.html` remains outside Git; the implementation commits and the earlier design/plan checkpoints are on `origin/main`.
