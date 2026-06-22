# Subdomain Takeover Triage Template Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add and verify a reusable `Subdomain Takeover Triage` workflow template for authorized bug bounty takeover candidate review.

**Architecture:** Implement this as a seed-template JSON file using existing Sentris worker nodes. Add backend seed-template and service coverage, plus script-level behavior tests for candidate ranking. Verify compile/use-template behavior and live-run only the new template.

**Tech Stack:** Bun test runner, NestJS backend tests, Sentris workflow graph JSON, existing worker components (`subfinder`, `dnsx`, `httpx`, `nuclei`, `core.logic.script`, `core.artifact.writer`).

---

## File Structure

- Create `backend/scripts/seed-templates/subdomain-takeover-triage.json`: workflow graph and metadata.
- Modify `backend/src/templates/__tests__/seed-templates.spec.ts`: include the new seed and add ranking-script behavior coverage.
- Modify `backend/src/templates/__tests__/templates.service.spec.ts`: include the new seed in use-template coverage.
- Modify `scripts/template-library-live-audit.ts`: add deterministic live inputs for the new template.

## Task 1: Add Failing Seed Coverage

**Files:**

- Modify: `backend/src/templates/__tests__/seed-templates.spec.ts`
- Modify: `backend/src/templates/__tests__/templates.service.spec.ts`

- [ ] **Step 1: Add `subdomain-takeover-triage.json` to seed lists**

Add the filename to `newTemplateFiles` in `seed-templates.spec.ts` and `securityTemplateFiles` in `templates.service.spec.ts`.

- [ ] **Step 2: Add ranking-script behavior test**

Add a test that loads the `rank_takeover_candidates` node, executes its script with:

- one Nuclei finding for `orphan.example.com`;
- one DNS signal for `docs.example.com` pointing at `example.github.io`;
- one unrelated live response.

Expected first candidate: `orphan.example.com`, with `confidence: "confirmed"` and a higher `priorityScore` than `docs.example.com`.

- [ ] **Step 3: Run tests and verify they fail**

Run:

```powershell
bun --cwd backend test src/templates/__tests__/seed-templates.spec.ts src/templates/__tests__/templates.service.spec.ts
```

Expected: FAIL because `subdomain-takeover-triage.json` does not exist.

## Task 2: Create The Seed Template

**Files:**

- Create: `backend/scripts/seed-templates/subdomain-takeover-triage.json`

- [ ] **Step 1: Add metadata and entrypoint**

Use category `bug-bounty`, tags `["bug-bounty", "takeover", "subdomains", "dns", "httpx", "nuclei"]`, `entryPoint: "trigger_1"`, `requiredSecrets: []`, and runtime inputs `domains`, `knownSubdomains`, and `authorizationNotes`.

- [ ] **Step 2: Add graph nodes**

Use these node ids and components:

- `trigger_1`: `core.workflow.entrypoint`
- `subfinder_discovery`: `sentris.subfinder.run`
- `merge_subdomains`: `core.logic.script`
- `dnsx_resolve`: `sentris.dnsx.run`
- `httpx_probe`: `sentris.httpx.scan`
- `nuclei_takeover_checks`: `sentris.nuclei.scan`
- `rank_takeover_candidates`: `core.logic.script`
- `artifact_report`: `core.artifact.writer`

- [ ] **Step 3: Add graph edges**

Connect:

- `trigger_1.domains -> subfinder_discovery.domains`
- `trigger_1.knownSubdomains -> merge_subdomains.knownSubdomains`
- `subfinder_discovery.subdomains -> merge_subdomains.discoveredSubdomains`
- `merge_subdomains.subdomains -> dnsx_resolve.domains`
- `merge_subdomains.subdomains -> httpx_probe.targets`
- `merge_subdomains.subdomains -> nuclei_takeover_checks.targets`
- `dnsx_resolve.results -> rank_takeover_candidates.dnsResults`
- `httpx_probe.responses -> rank_takeover_candidates.httpResponses`
- `nuclei_takeover_checks.findings -> rank_takeover_candidates.nucleiFindings`
- `rank_takeover_candidates.report -> artifact_report.content`

- [ ] **Step 4: Implement scripts**

`merge_subdomains` should normalize/dedupe discovered and known hostnames.

`rank_takeover_candidates` should output `report` with:

- `summary.candidates`
- `summary.confirmed`
- `summary.needsManualReview`
- `candidates[]` with `host`, `confidence`, `priorityScore`, `reasons`, and evidence fields.

## Task 3: Verify Locally

**Files:**

- Test: backend template tests
- Test: root typecheck/lint

- [ ] **Step 1: Run focused backend tests**

Run:

```powershell
bun --cwd backend test src/templates/__tests__/seed-templates.spec.ts src/templates/__tests__/templates.service.spec.ts
```

Expected: PASS.

- [ ] **Step 2: Run broad checks**

Run:

```powershell
bun run typecheck
bun run lint
git diff --check -- . ':(exclude)AGENTS.md'
```

Expected: typecheck passes; lint exits 0 with existing warnings only; scoped diff check passes.

## Task 4: Seed And Live Verify Only The New Template

**Files:**

- Modify: `scripts/template-library-live-audit.ts`

- [ ] **Step 1: Add live inputs**

Add:

```ts
'Subdomain Takeover Triage': {
  domains: ['example.com'],
  knownSubdomains: ['www.example.com'],
  authorizationNotes: 'Live audit fixture: bounded public example domain with imported known subdomain.',
}
```

- [ ] **Step 2: Sync the seed into instance 0**

Use the same explicit Postgres update/seed style already used in this project. Do not rely on inherited `DATABASE_URL`.

- [ ] **Step 3: Run live audit for only the new template**

Run:

```powershell
$env:SENTRIS_INSTANCE='0'
$env:TEMPLATE_AUDIT_NAMES='Subdomain Takeover Triage'
$env:TEMPLATE_AUDIT_FORCE='true'
bun scripts/template-library-live-audit.ts
```

Expected: workflow completes and writes one JSON artifact. Zero takeover candidates is acceptable for the safe fixture if the report includes clear no-signal summary and next steps.
