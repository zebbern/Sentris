# Bug Bounty Evidence Router Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add and live-verify a reusable public-data workflow template that turns mixed bug bounty notes into routed evidence, enrichment, and follow-up recommendations.

**Architecture:** The template uses existing workflow nodes only. A parser script normalizes mixed notes into CVE IDs, package specs, HTTP targets, and observations; public enrichment nodes run OSV, NVD, HTTPX, and CISA KEV; an assembler script writes one artifact with routed next steps.

**Tech Stack:** Sentris seed-template JSON, core workflow components, security components (`sentris.httpx.scan`, `sentris.osv.query`, `sentris.nvd.cve.query`), Bun tests, template live-audit script.

---

### Task 1: Add Focused Seed Template Coverage

**Files:**
- Modify: `backend/src/templates/__tests__/seed-templates.spec.ts`

- [ ] **Step 1: Add a graph wiring test**

Add a test that loads `bug-bounty-evidence-router.json`, asserts node types include entrypoint, parser, HTTPX, OSV, NVD, KEV fetch, assembler, and artifact writer, and asserts key edges:

```ts
expect(edges).toEqual(
  expect.arrayContaining([
    'trigger_1:evidenceNotes->parse_evidence:evidenceNotes',
    'parse_evidence:httpTargets->httpx_probe:targets',
    'parse_evidence:packageSpecs->query_osv:packageSpecs',
    'parse_evidence:cveIds->query_nvd:cveIds',
    'assemble_router_report:report->artifact_report:content',
  ]),
);
```

- [ ] **Step 2: Add parser behavior test**

Use `runTemplateScript` against the `parse_evidence` node with mixed notes containing a CVE, URL, package spec, and authorized target. Assert deduped outputs:

```ts
expect(result.cveIds).toContain('CVE-2024-3094');
expect(result.httpTargets).toEqual(expect.arrayContaining(['https://scanme.nmap.org']));
expect(result.packageSpecs).toEqual(expect.arrayContaining(['lodash@4.17.20']));
```

- [ ] **Step 3: Add report assembly behavior test**

Use `runTemplateScript` against the `assemble_router_report` node with fixture HTTPX, OSV, NVD, and KEV data. Assert `runNow` includes KEV/CVE and package follow-ups, and `recommendedFollowUpWorkflows` points to existing template names.

- [ ] **Step 4: Run focused test and confirm failure before implementation**

Run:

```bash
bun test backend/src/templates/__tests__/seed-templates.spec.ts --test-name-pattern "bug-bounty-evidence-router"
```

Expected before implementation: fails because the seed file does not exist.

### Task 2: Add the Workflow Template

**Files:**
- Create: `backend/scripts/seed-templates/bug-bounty-evidence-router.json`

- [ ] **Step 1: Add template metadata and runtime inputs**

Create metadata/category `bug-bounty`, tags for `bug-bounty`, `triage`, `cve`, `osv`, `nvd`, `httpx`, `router`. Runtime inputs:

```json
[
  { "id": "evidenceNotes", "label": "Evidence notes", "type": "text", "required": true },
  { "id": "authorizedTargets", "label": "Authorized targets", "type": "array", "required": false, "defaultValue": [] },
  { "id": "packageEcosystem", "label": "Package ecosystem", "type": "text", "required": false, "defaultValue": "npm" },
  { "id": "authorizationNotes", "label": "Authorization notes", "type": "text", "required": false, "defaultValue": "" }
]
```

- [ ] **Step 2: Add parser node**

Parser returns:

```json
[
  { "name": "httpTargets", "type": "list-text" },
  { "name": "packageSpecs", "type": "list-text" },
  { "name": "cveIds", "type": "string" },
  { "name": "keywordSearch", "type": "string" },
  { "name": "normalizedEvidence", "type": "json" }
]
```

The script must bound output to 20 HTTP targets, 40 package specs, and 25 CVE IDs.

- [ ] **Step 3: Add enrichment nodes**

Wire parser output to:

```text
sentris.httpx.scan targets
sentris.osv.query packageSpecs
sentris.nvd.cve.query cveIds and keywordSearch
core.http.request CISA KEV URL
```

Use safe parameters: HTTPX `threads: 25`, `followRedirects: true`, `tlsProbe: true`, `preferHttps: true`; OSV `ecosystem: npm`, `severityFloor: medium`, `hydrateAdvisories: true`; NVD `failOnUnavailable: false`, `timeoutMs: 90000`.

- [ ] **Step 4: Add report assembler and artifact writer**

Assembler output `report` must contain summary, extracted evidence, source status, `runNow`, `manualReview`, `notEnoughEvidence`, and `recommendedFollowUpWorkflows`. Artifact writer saves `bug-bounty-evidence-router-{{date}}.json`.

### Task 3: Add Live Audit Fixture

**Files:**
- Modify: `scripts/template-library-live-audit.ts`

- [ ] **Step 1: Add `LIVE_INPUTS['Bug Bounty Evidence Router']`**

Use safe public data:

```ts
LIVE_INPUTS['Bug Bounty Evidence Router'] = {
  evidenceNotes:
    'Authorized notes: https://scanme.nmap.org shows Apache. Check lodash@4.17.20 and CVE-2024-3094. Also review https://example.com/docs.',
  authorizedTargets: ['https://scanme.nmap.org', 'https://example.com'],
  packageEcosystem: 'npm',
  authorizationNotes: 'Live audit fixture uses safe public targets and public vulnerability metadata.',
};
```

### Task 4: Verify and Live-Test

**Files:**
- Generated ledger/cache output only.

- [ ] **Step 1: Run focused seed-template tests**

Run:

```bash
bun test backend/src/templates/__tests__/seed-templates.spec.ts --test-name-pattern "bug-bounty-evidence-router"
```

Expected: all matching tests pass.

- [ ] **Step 2: Seed the catalog**

Run:

```bash
bun --cwd backend run seed:templates
```

Expected: `Bug Bounty Evidence Router` is inserted or updated in the active instance database.

- [ ] **Step 3: Run only the new template live audit**

Run:

```bash
bun run template-library:audit -- --name "Bug Bounty Evidence Router" --force
```

Expected: run completes, produces at least one artifact, recommendation is `KEEP COMPLETED`.

- [ ] **Step 4: Run catalog quality gate**

Run:

```bash
bun run template-library:check
```

Expected: live-run validation is current for the full catalog, duplicate functionality count is `0`, low-value/static count is `0`, runtime input default issues are `0`.

## Self-Review

Spec coverage: covered runtime inputs, public-data routing, non-duplicate purpose, report shape, and live verification.

Placeholder scan: no deferred placeholders; all file paths and commands are concrete.

Type consistency: output names in tests, template edges, and report assembly are aligned.
