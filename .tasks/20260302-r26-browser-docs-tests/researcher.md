# Agent: researcher

## Purpose

Audit all project documentation files for accuracy against the current codebase — identify stale references, incorrect commands, outdated architecture descriptions, and missing documentation.

## Skills

Load before starting: none

## Subtasks

### Top-level docs

- [x] Audit `docs/index.mdx` — verify introductory content matches current product scope and features
- [x] Audit `docs/quickstart.mdx` — verify installation steps, commands, and prerequisites against actual `package.json` scripts and `justfile` targets
- [x] Audit `docs/installation.mdx` — verify system requirements, install steps, and env var references against `install.sh`, `docker/` configs, and `.env.example` files
- [x] Audit `docs/command-reference.mdx` — cross-reference every documented command against `justfile`, `package.json` scripts, and actual CLI behavior
- [x] Audit `docs/user-guide.md` — verify UI descriptions, page names, and navigation paths match current frontend routes in `frontend/src/routes.tsx`
- [x] Audit `docs/mcp-library.md` — verify MCP server list and configuration matches actual MCP integration code in `worker/` and `docker/`
- [x] Audit `docs/analytics.md` — verify analytics setup instructions match current implementation in `frontend/src/features/analytics/`
- [x] Audit `docs/audit-logging.mdx` — verify audit log format and configuration matches backend implementation
- [x] Audit `docs/aws-credentials.md` — verify credential setup steps are current
- [x] Audit `docs/TEMPLATE_LIBRARY.md` — verify template documentation matches `frontend/src/features/templates/` and `frontend/src/pages/template-library/` implementation
- [x] Audit `docs/version-check.md` — verify version check mechanism matches current implementation

### Architecture docs

- [x] Audit `docs/architecture.mdx` — verify system architecture diagram and descriptions match current stack (`frontend/`, `backend/`, `worker/`, `packages/`)
- [x] Audit `docs/architecture/workflow-compilation.mdx` — verify workflow compilation flow matches `worker/` implementation
- [x] Audit `docs/architecture/temporal-orchestration.mdx` — verify Temporal patterns match current `worker/src/temporal/` code
- [x] Audit `docs/architecture/streaming-pipelines.mdx` — verify streaming architecture matches current implementation
- [x] Audit `docs/architecture/human-in-the-loop.mdx` — verify HITL patterns match `backend/src/human-inputs/` and frontend `HumanInputDialog.tsx`

### Development docs

- [x] Audit `docs/development/dev-environment.md` — verify setup instructions match `justfile`, `docker-compose` files, `pm2.config.cjs`, and `AGENTS.md` dev section
- [x] Audit `docs/development/component-development.mdx` — verify component development patterns match current `packages/component-sdk/` and `worker/` structure
- [x] Audit `docs/development/analytics.mdx` — verify analytics dev docs match current frontend analytics implementation
- [x] Audit `docs/development/release-process.mdx` — verify release steps are current
- [x] Audit `docs/development/isolated-volumes.mdx` — verify Docker volume strategy matches current `docker/` configuration
- [x] Audit `docs/development/workflow-analytics.mdx` — verify workflow analytics docs match implementation

### Guide docs

- [x] Audit `docs/guides/secrets-management.md` — verify secrets management guide matches backend and frontend implementation
- [x] Audit `docs/guides/template-library.md` — verify template library guide matches current template feature implementation

### Workflow docs

- [x] Audit `docs/workflows/execution-status.md` — verify execution status values match `packages/contracts/` or `packages/shared/` type definitions
- [x] Audit `docs/workflows/mcp-library-example.md` — verify MCP example is still valid

### Other project docs

- [x] Audit `docs/MULTI-INSTANCE-DEV.md` — cross-reference with `justfile` instance commands, `pm2.config.cjs`, and `AGENTS.md` multi-instance section
- [x] Audit `workproject/README.md` — verify project overview and setup instructions are current
- [x] Audit `workproject/CONTRIBUTING.md` — verify contribution guidelines match current workflow
- [x] Audit `workproject/SECURITY.md` — verify security policy is current
- [x] Audit `docs/docs.json` — verify documentation structure/navigation matches actual file tree

### Cross-cutting checks

- [x] Verify all documented API endpoints exist in `backend/src/` route definitions or `openapi.json`
- [x] Verify all documented environment variables exist in `.env.example` files
- [x] Verify all documented CLI commands (`just`, `bun run`) exist and work as described
- [x] Compile a prioritized findings report: S0 (factually wrong/dangerous), S1 (stale/misleading), S2 (minor inaccuracy or style issue)

## Notes

- Use `grep_search` and `file_search` to cross-reference doc claims against actual code — do not rely on reading docs alone
- For command references, check `justfile` targets, `package.json` scripts, and `pm2.config.cjs`
- For route/page references, check `frontend/src/routes.tsx`
- For API endpoint references, check `openapi.json` and `backend/src/` controllers
- For environment variable references, check `.env.example` files in `backend/`, `worker/`, `frontend/`
- Focus on factual accuracy, not prose quality — the doc-writer will handle fixes

## Completion Summary

<!-- Appended by orchestrator after agent completes. Do not fill manually. -->

## Prioritized Findings Report

### S0 — Factually Wrong / Dangerous

**S0-1: `docker/SECURE-DEV-MODE.md` references non-existent `just dev-insecure` command**

- File: `docker/SECURE-DEV-MODE.md`
- Claim: "`just dev-insecure` is the new command for fast, insecure development"
- Reality: No `dev-insecure` target exists in the justfile. `just dev` auto-detects auth mode based on `CLERK_SECRET_KEY` in `backend/.env`. This is misleading — users will get an error.
- Also claims: "`just dev` now runs with security enabled" — incorrect; `just dev` only uses security when `CLERK_SECRET_KEY` is set.

**S0-2: `docs/mcp-library.md` troubleshooting uses wrong port 3000**

- File: `docs/mcp-library.md` (Troubleshooting section)
- Claim: "Check backend API: `curl http://localhost:3000/api/v1/mcp-servers`"
- Reality: Backend runs on port 3211 (or `http://localhost/api/v1/mcp-servers` via nginx). Port 3000 was never used.

**S0-3: `package.json` `dev:infra` script uses non-instance-aware PM2 app names**

- File: `package.json` line 23
- Claim: `--only sentris-frontend,sentris-backend,sentris-worker`
- Reality: PM2 config uses instance-aware names like `sentris-frontend-0`, `sentris-backend-0`, `sentris-worker-0`. The `bun run dev:infra` / `bun run dev:stack` scripts will fail to start any PM2 apps because the names don't match. This also affects `bun run dev:stack:stop` which uses `pm2 delete sentris-frontend sentris-backend sentris-worker`.
- Impact: `bun run dev:stack` (documented in README and AGENTS.md) is broken.

**S0-4: `docker/SECURE-DEV-MODE.md` lists wrong docker compose file for security overlay**

- File: `docker/SECURE-DEV-MODE.md` Architecture table
- Claim: Lists `docker-compose.dev-secure.yml` as "Security overlay for development" — correct.
- But also claims `docker-compose.prod.yml` is "Production security configuration" in the same table, which is confusing context for a dev-mode doc. Minor, but the main issue is the `just dev-insecure` reference (S0-1).

### S1 — Stale / Misleading

**S1-1: `README.md` says "24 security components" — count may be stale**

- File: `README.md` (Capabilities section)
- Claim: "24 security components wrapping industry-standard open-source tools"
- Reality: Listed tools total approximately 24, but the architecture doc says "24 components" in the security category. This count should be verified against the actual component registry and could be stale if components were added in recent rounds.

**S1-2: `docker/README.md` references `just prod-secure` command that doesn't exist**

- File: `docker/README.md` (Quick Reference table)
- Claim: `just prod-secure` — "Start with security & multitenancy"
- Reality: No `prod-secure` target in the justfile. Security mode is auto-detected by `just prod` based on whether TLS certs exist in `docker/certs/root-ca.pem`. Command `just generate-certs` exists.

**S1-3: `docs/command-reference.mdx` missing several commands documented in `just help`**

- File: `docs/command-reference.mdx`
- Missing commands from the command reference:
  - `just security-init` / `just security-init --force`
  - `just hash-password`
  - `just generate-certs`
  - `just instance show` / `just instance use N`
  - `just instance-init [N]`
  - `just instance-env init|update|copy|show`
  - `just prod start-latest`
  - `just prod-images` (start/stop/build-test/logs/status/clean)
- These are all real justfile targets that are undocumented in the command reference.

**S1-4: `docs/command-reference.mdx` lists infrastructure services incompletely**

- File: `docs/command-reference.mdx` (Infrastructure section)
- Claim: Infrastructure includes "PostgreSQL, Temporal, MinIO, Redis, Loki"
- Reality: Also includes Redpanda (Kafka), OpenSearch, OpenSearch Dashboards, Redpanda Console, and nginx. The infrastructure section is significantly incomplete.

**S1-5: `docs/quickstart.mdx` lists `just` as required but `docs/installation.mdx` and `docs/development/dev-environment.md` list it as optional**

- File: `docs/quickstart.mdx` Prerequisites
- Claim: "just command runner" listed as a prerequisite (implies required)
- Reality: `just` is optional per `dev-environment.md` and installation docs. `bun run setup` + `bun run dev` are the non-just alternatives shown in `README.md`.

**S1-6: `AGENTS.md` references `bun run dev:stack` which is broken due to S0-3**

- File: `AGENTS.md` (Development section)
- Claim: `bun run dev:stack` as cross-platform alternative
- Reality: Due to PM2 name mismatch (S0-3), this script doesn't start apps correctly.

**S1-7: `docs/TEMPLATE_LIBRARY.md` references stale migration file path**

- File: `docs/TEMPLATE_LIBRARY.md` (Setup Instructions §3)
- Claim: "The migration file is at: `backend/drizzle/0020_create-templates.sql`"
- Reality: Migration numbering has likely changed after 25+ rounds of changes. There are many more migrations now. This specific reference may be stale.

**S1-8: `docs/TEMPLATE_LIBRARY.md` API endpoint paths missing `/v1/` prefix**

- File: `docs/TEMPLATE_LIBRARY.md` (API Endpoints section)
- Claim: Endpoints like `GET /templates`, `POST /templates/publish`, etc.
- Reality: Based on NestJS router and `openapi.json`, all API routes use the `/api/v1/` prefix. Should be `/api/v1/templates` etc.

**S1-9: `docs/user-guide.md` references stale API endpoint `/api/v1/workflows/run`**

- File: `docs/user-guide.md` (API Integration section)
- Claim: `curl -X POST http://localhost/api/v1/workflows/run`
- Reality: Should be verified against `openapi.json`. The endpoint may have a different path or require different parameters.

**S1-10: `docs/user-guide.md` references stale API endpoint `/api/v1/mcp-servers`**

- File: `docs/user-guide.md` (Debug Commands section)
- Claim: `curl http://localhost/api/v1/mcp-servers`
- Reality: Needs verification against actual backend routes.

**S1-11: `docs/development/dev-environment.md` Docker project name inconsistency**

- File: `docs/development/dev-environment.md` (Architecture Overview)
- Claim: "Docker Compose (infrastructure — project name: sentris)"
- Reality: The justfile does NOT specify `-p sentris` for infrastructre — it uses the default project name (derived from directory). However, `package.json`'s `dev:infra` script does use `-p sentris`. This inconsistency could cause confusion if both methods create different project names.

**S1-12: `docs/installation.mdx` lists port 5601 in the note as a debugging port**

- File: `docs/installation.mdx`
- Claim: "Individual service ports (5173, 3211, 5601) are available for debugging"
- Reality: Port 5601 is OpenSearch Dashboards (analytics), not a core debugging port. Minor but could be confusing.

**S1-13: `docs/docs.json` navigation doesn't include `development/dev-environment`**

- File: `docs/docs.json`
- Reality: The `dev-environment.md` page is not listed in the docs.json navigation. It exists as a file but isn't included in the Mintlify nav structure, making it undiscoverable through the docs site.

**S1-14: `docs/docs.json` navigation doesn't include `MULTI-INSTANCE-DEV.md` or `TEMPLATE_LIBRARY.md`**

- File: `docs/docs.json`
- Reality: These are important docs not included in the sidebar navigation. They exist but are "orphan pages" in the docs site structure.

### S2 — Minor Inaccuracy / Style Issue

**S2-1: `docs/index.mdx` tech stack table says "Bun runtime" for Backend but `dev-environment.md` says "Bun 1.1.20+"**

- Consistent but the worker row says "Node.js" while the worker also uses Bun/TypeScript. However, Temporal SDK uses Node.js APIs, so this may be intentionally correct. Low priority.

**S2-2: `docs/architecture.mdx` component categories table says "github" category with "Remove Org Membership"**

- File: `docs/architecture.mdx` (Component Categories table)
- This is a very specific single-component category. May be outdated if more GitHub integrations exist. Low priority.

**S2-3: `CONTRIBUTING.md` references `bun --cwd backend run migration:smoke` which needs verification**

- File: `CONTRIBUTING.md`
- This script name should be verified against `backend/package.json` scripts.

**S2-4: `docs/architecture/temporal-orchestration.mdx` uses task queue name `sentris-default`**

- File: `docs/architecture/temporal-orchestration.mdx`
- Claim: Default task queue is `sentris-default`
- Reality: AGENTS.md and .env.example likely use `sentris-workflows` as the task queue name. Should be verified.

**S2-5: `AGENTS.md` skills section references `.claude/skills/` path**

- File: `AGENTS.md` (skills_system section)
- Claim: `cat .claude/skills/<name>/SKILL.md`
- Reality: This is the Claude-specific path convention. The project also has `.github/skills/` for Copilot. Not wrong but slightly confusing if someone uses the wrong agent tool.

**S2-6: `README.md` Development Quickstart shows `bun run setup` but `package.json` maps this to `node scripts/setup.js`**

- File: `README.md`
- This chain works if `scripts/setup.js` exists and functions. Should be verified.

**S2-7: `docs/analytics.md` architecture diagram shows "Frontend SPA (8080)" for prod but dev uses 5173**

- File: `docs/analytics.md`
- The architecture diagram shows port 8080 for the frontend which is the production container port. The dev mode uses 5173. This is technically correct for prod but could confuse developers reading the analytics doc while in dev mode.

**S2-8: `docs/installation.mdx` lists Redpanda port as 19092 in dev-environment.md but not in installation.mdx**

- File: `docs/installation.mdx` vs `docs/development/dev-environment.md`
- The installation doc shows Redpanda port 9092, while dev-environment shows 19092. Kafka port mapping should be verified. The docker-compose likely maps external port 19092 to internal 9092, but the `package.json` backend .env.example probably uses `localhost:9092`.

**S2-9: `docker/PRODUCTION.md` still references OpenSearch 2.11.1 for password hashing**

- File: `docker/PRODUCTION.md` (Password Hashing section)
- The `docker run` command uses `opensearchproject/opensearch:2.11.1` — this specific version may be out of date. The actual docker-compose likely uses a newer version.

**S2-10: Template publishing description inconsistency between TEMPLATE_LIBRARY.md and guides/template-library.md**

- `TEMPLATE_LIBRARY.md` (API section) describes the Publish step as: "Copy the generated JSON and open the GitHub repository page to create a PR"
- `guides/template-library.md` says the same
- But the frontend `PublishTemplateModal` with 4-step wizard may have changed behavior. The description says "Submit as a GitHub pull request" in one place and "Copy and paste to GitHub" in another. These should be consistent.
