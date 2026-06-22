# Public Repo Secret Exposure Triage Template Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add and verify a reusable `Public Repo Secret Exposure Triage` workflow template for authorized bug bounty repository secret checks.

**Architecture:** Implement this as a seed-template JSON file using the existing TruffleHog, logic script, entrypoint, and artifact writer nodes. Add backend seed-template/service coverage and a script behavior test that proves raw secret values are redacted. Live-run only the new template with a small public repository fixture.

**Tech Stack:** Bun test runner, NestJS backend tests, Sentris workflow graph JSON, existing worker components (`sentris.trufflehog.scan`, `core.logic.script`, `core.artifact.writer`).

---

## File Structure

- Create `backend/scripts/seed-templates/public-repo-secret-exposure-triage.json`: workflow graph and metadata.
- Modify `backend/src/templates/__tests__/seed-templates.spec.ts`: include the new seed and add report-script behavior coverage.
- Modify `backend/src/templates/__tests__/templates.service.spec.ts`: include the new seed in use-template coverage.
- Modify `scripts/template-library-live-audit.ts`: add deterministic live inputs for the new template.

## Task 1: Add Failing Seed Coverage

**Files:**

- Modify: `backend/src/templates/__tests__/seed-templates.spec.ts`
- Modify: `backend/src/templates/__tests__/templates.service.spec.ts`

- [ ] **Step 1: Add `public-repo-secret-exposure-triage.json` to seed lists**

Add the filename to `newTemplateFiles` in `seed-templates.spec.ts` and `securityTemplateFiles` in `templates.service.spec.ts`.

- [ ] **Step 2: Add report-script behavior test**

Add a test that loads the `assemble_secret_report` node, executes its script with:

- one verified secret containing `Raw: "super-secret-value"` and `Redacted: "super-..."`;
- one unverified secret containing `Raw: "do-not-copy-me"` and no `Redacted`;
- TruffleHog counts showing two total secrets and one verified secret.

Expected: `summary.secretCount` is `2`, `summary.verifiedCount` is `1`, `summary.hasVerifiedSecrets` is `true`, the first finding is verified, and `JSON.stringify(report)` contains neither raw secret value.

- [ ] **Step 3: Run tests and verify they fail**

Run:

```powershell
bun --cwd backend test src/templates/__tests__/seed-templates.spec.ts src/templates/__tests__/templates.service.spec.ts
```

Expected: FAIL because `public-repo-secret-exposure-triage.json` does not exist.

## Task 2: Create The Seed Template

**Files:**

- Create: `backend/scripts/seed-templates/public-repo-secret-exposure-triage.json`

- [ ] **Step 1: Add metadata and entrypoint**

Use category `bug-bounty`, tags `["bug-bounty", "secrets", "trufflehog", "git", "repository"]`, `entryPoint: "trigger_1"`, `requiredSecrets: []`, and runtime inputs `repositoryUrl` and `authorizationNotes`.

- [ ] **Step 2: Add graph nodes**

Use these node ids and components:

- `trigger_1`: `core.workflow.entrypoint`
- `trufflehog_secret_scan`: `sentris.trufflehog.scan`
- `assemble_secret_report`: `core.logic.script`
- `artifact_report`: `core.artifact.writer`

- [ ] **Step 3: Add graph edges**

Connect:

- `trigger_1.repositoryUrl -> trufflehog_secret_scan.scanTarget`
- `trigger_1.repositoryUrl -> assemble_secret_report.repositoryUrl`
- `trigger_1.authorizationNotes -> assemble_secret_report.authorizationNotes`
- `trufflehog_secret_scan.secrets -> assemble_secret_report.secrets`
- `trufflehog_secret_scan.results -> assemble_secret_report.analyticsResults`
- `trufflehog_secret_scan.secretCount -> assemble_secret_report.secretCount`
- `trufflehog_secret_scan.verifiedCount -> assemble_secret_report.verifiedCount`
- `trufflehog_secret_scan.hasVerifiedSecrets -> assemble_secret_report.hasVerifiedSecrets`
- `assemble_secret_report.report -> artifact_report.content`

- [ ] **Step 4: Implement script**

`assemble_secret_report` should output `report` with:

- `summary.repositoryUrl`
- `summary.secretCount`
- `summary.verifiedCount`
- `summary.hasVerifiedSecrets`
- `findings[]` sorted with verified secrets first
- `analyticsResults`
- `authorizationNotes`
- `nextSteps`

The script must never include `Raw` or `RawV2` values in the report.

## Task 3: Verify Locally

**Files:**

- Test: backend template tests

- [ ] **Step 1: Run focused backend tests**

Run:

```powershell
bun --cwd backend test src/templates/__tests__/seed-templates.spec.ts src/templates/__tests__/templates.service.spec.ts
```

Expected: PASS.

## Task 4: Seed And Live Verify Only The New Template

**Files:**

- Modify: `scripts/template-library-live-audit.ts`

- [ ] **Step 1: Add live inputs**

Add:

```ts
'Public Repo Secret Exposure Triage': {
  repositoryUrl: 'https://github.com/octocat/Hello-World',
  authorizationNotes: 'Live audit fixture: small public GitHub repository for non-destructive verified-secret scan.',
}
```

- [ ] **Step 2: Sync the seed into instance 0**

Use an explicit `DATABASE_URL=postgresql://sentris:sentris@localhost:5433/sentris_instance_0` when seeding or updating the template row.

- [ ] **Step 3: Run live audit for only the new template**

Run:

```powershell
$env:DATABASE_URL='postgresql://sentris:sentris@localhost:5433/sentris_instance_0'
$env:TEMPLATE_AUDIT_NAMES='Public Repo Secret Exposure Triage'
$env:TEMPLATE_AUDIT_FORCE='true'
bun scripts/template-library-live-audit.ts
```

Expected: workflow completes and writes one JSON artifact. Zero verified secrets is acceptable for the safe fixture if the report includes zero counts and next steps.
