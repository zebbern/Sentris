# API Surface Exposure Triage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add and live-verify a non-duplicate API surface exposure workflow template for bug bounty triage.

**Architecture:** Reuse Katana, HTTPX, Nuclei, logic scripts, and artifact writer. Keep candidate generation and report ranking inside template logic nodes so no new worker component is needed unless validation exposes a gap.

**Tech Stack:** Sentris workflow JSON seed templates, Bun tests, existing worker security components, local template live-audit harness.

---

### Task 1: Seed Template Tests

**Files:**

- Modify: `backend/src/templates/__tests__/seed-templates.spec.ts`
- Create later: `backend/scripts/seed-templates/api-surface-exposure-triage.json`

- [x] Add `api-surface-exposure-triage.json` to `newTemplateFiles`.
- [x] Add a test proving the graph contains `sentris.katana.run`, `sentris.httpx.scan`, `sentris.nuclei.scan`, candidate generation, report assembly, and artifact output.
- [x] Add a test executing the report assembly script with mock GraphQL, Swagger, and Nuclei data; assert the highest ranked finding is critical/high and the summary counts are correct.
- [x] Run `bun --cwd backend test src/templates/__tests__/seed-templates.spec.ts` and confirm the new tests fail because the template does not exist yet.

### Task 2: Template File

**Files:**

- Create: `backend/scripts/seed-templates/api-surface-exposure-triage.json`

- [x] Create a 7-node graph:
  - `trigger_1`
  - `crawl_seed_urls`
  - `build_api_candidates`
  - `probe_api_candidates`
  - `nuclei_api_exposure_scan`
  - `assemble_api_surface_report`
  - `artifact_report`
- [x] Wire seed URLs into Katana and candidate generation.
- [x] Wire Katana endpoints into candidate generation.
- [x] Wire generated candidates into HTTPX and Nuclei.
- [x] Wire HTTPX responses and Nuclei findings into report assembly.
- [x] Save the report as `api-surface-exposure-triage-{{date}}.json`.

### Task 3: Test and Local Seed

**Files:**

- Modify if needed: `backend/src/templates/__tests__/seed-templates.spec.ts`

- [x] Run `bun --cwd backend test src/templates/__tests__/seed-templates.spec.ts`.
- [x] Fix graph/schema/report script issues until focused tests pass.
- [x] Upsert the new template into the local instance-0 `templates` table with `repository='sentris/templates'` and `path='templates/api-surface-exposure-triage.json'`.

### Task 4: Live Audit

**Files:**

- Modify: `scripts/template-library-live-audit.ts`

- [x] Add a live fixture for `API Surface Exposure Triage`.
- [x] Use a safe public target, `https://petstore.swagger.io/`, with known API documentation paths including `/v2/swagger.json`, `/swagger.json`, and `/`.
- [x] Run forced audit only for this template:
      `TEMPLATE_AUDIT_NAMES='API Surface Exposure Triage' TEMPLATE_AUDIT_FORCE='true' bun scripts/template-library-live-audit.ts`
- [x] Inspect the artifact and node I/O evidence.
- [x] If the artifact is empty or low-signal, tune candidate generation or the fixture and rerun forced audit.

### Task 5: Final Verification

**Files:**

- All touched files.

- [x] Run focused backend seed-template tests.
- [x] Run live-audit utility tests if the audit harness changed.
- [x] Run `bun run typecheck`.
- [x] Run `bun run lint`.
- [x] Run `git diff --check -- . ':(exclude)AGENTS.md'`.
- [x] Run the normal full template audit without force and confirm unchanged templates are skipped with `keep` recommendations.
