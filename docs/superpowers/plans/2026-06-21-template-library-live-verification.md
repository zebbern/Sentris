# Template Library Live Verification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Live-verify every Template Library seed template against the local Sentris instance, then remove or consolidate templates that are broken, unusable, or too low-value to keep.

**Architecture:** Add a repeatable audit harness that reads seed templates, compares them with the running API, creates workflows through the same template-use endpoint as the UI, runs templates where live inputs and credentials are available, and writes JSON/Markdown evidence. Use the audit output to make scoped edits to seed template JSON files and active DB template rows.

**Tech Stack:** Bun/Node, NestJS API at `http://localhost:3211/api/v1`, Temporal-backed workflow runs, seed templates in `backend/scripts/seed-templates/*.json`.

**Current status:** Complete for the current seed catalog. The harness exists at `scripts/template-library-live-audit.ts`, package aliases exist at `bun run template-library:check` and `bun run template-library:audit`, stale static/demo templates were removed or consolidated into the 10 current high-value security templates, and `.cache/template-live-audit-ledger.json` records `COMPLETED` / `keep` evidence for all 10 active live-run templates. Use `bun run template-library:check` before starting any new live run; rerun only templates reported as missing, stale, degraded, duplicated, or low-value/static.

**Latest verification:**

- `bun run template-library:verify` -> fast preflight plus focused template tests pass.
- `bun run template-library:check` -> live-run validation current: 10/10; missing/stale/degraded: 0; duplicate names: 0; low-value/static candidates: 0.
- `bun run template-library:audit` -> 10 keep; 0 fix/consolidate/delete/review; unchanged templates skipped from rerun.
- `bun --cwd backend test src/templates/__tests__/seed-templates.spec.ts` -> 27 pass.
- `bun test scripts/__tests__/template-library-live-audit-utils.test.ts` -> 15 pass.
- `bun run typecheck` -> pass.
- `bun run lint:backend` / `bun run lint:frontend` -> 0 errors with existing warning baselines.

---

### Task 1: Build The Live Audit Harness

**Files:**

- Create: `scripts/template-library-live-audit.ts`

- [x] **Step 1: Add API helpers**

Create helpers for `GET /templates`, `POST /templates/:id/use`, `POST /workflows/:id/run`, `GET /workflows/runs/:runId/status`, `GET /workflows/runs/:runId/artifacts`, `GET /workflows/runs/:runId/node-io`, and workflow cleanup.

- [x] **Step 2: Add template classification**

Classify templates as:

- `live-run`: no external secrets and enough runtime inputs to execute safely.
- `structure-only`: no runtime inputs or cannot accept target/user data.
- `credential-gated`: requires real third-party credentials or Slack delivery.

- [x] **Step 3: Add controlled fixtures**

Use safe public/controlled targets:

- `CVE-2024-3094` for CVE research.
- `https://host.docker.internal:18443/api/health` for web/API flows.
- `example.com` for DNS/recon flows.
- `scanme.nmap.org` for bounded port/service checks.

- [x] **Step 4: Write audit output**

Write output under a timestamped temp directory:

- `template-live-audit.json`
- `template-live-audit.md`
- per-run traces and node I/O summaries

### Task 2: Run The Audit

**Files:**

- Execute: `scripts/template-library-live-audit.ts`

- [x] **Step 1: Confirm services**

Run:

```powershell
Invoke-RestMethod http://localhost:3211/api/v1/health
Invoke-RestMethod http://localhost:3211/api/v1/health/ready
```

Expected: both return `status: "ok"`.

- [x] **Step 2: Run harness**

Run:

```powershell
bun run template-library:audit
```

Expected: harness audits all active templates, skips unchanged templates with current ledger entries, and completes with a report path.

- [x] **Step 3: Inspect failures**

For each failed live-run template, read trace/node I/O, identify root cause, and decide whether to fix or prune.

### Task 3: Clean Up Low-Value Templates

**Files:**

- Modify/delete: `backend/scripts/seed-templates/*.json`
- Possibly add: `backend/scripts/seed-templates/_retired.json` only if the existing seeding system needs retirement metadata.

- [x] **Step 1: Remove templates that are static demos**

Delete templates that cannot be used without hard-coded assumptions and do not expose runtime inputs, unless they represent a high-value credential-backed workflow.

- [x] **Step 2: Consolidate duplicates**

Prefer one useful version when multiple templates cover the same flow with only superficial differences, for example generic web scan vs bug bounty web quick-win scan.

- [x] **Step 3: Update active DB rows**

Because the local seed service skips existing rows, apply equivalent changes to the active instance database so `/templates` matches the edited seed files.

### Task 4: Verify

**Files:**

- Test: `backend/src/templates/__tests__/seed-templates.spec.ts`
- Test: affected worker/component tests if runner behavior changes

- [x] **Step 1: Validate seed templates**

Run the scoped verification command:

```powershell
bun run template-library:verify
```

Or run the seed-template test directly:

```powershell
bun --cwd backend test src/templates/__tests__/seed-templates.spec.ts
```

Expected: all template validation tests pass.

- [x] **Step 2: Typecheck**

Run:

```powershell
bun run typecheck
```

Expected: exit code 0.

- [x] **Step 3: Lint**

Run:

```powershell
bun run lint
```

Expected: exit code 0. Existing warnings may remain; no new errors.

- [x] **Step 4: Re-run live audit**

Run:

```powershell
bun run template-library:audit
```

Expected: remaining live-run templates complete, credential-gated templates are explicitly classified, and no active template is left in a broken/static-demo state.
