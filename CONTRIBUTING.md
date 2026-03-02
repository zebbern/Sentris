# Contributing to Sentris Flow

Thank you for improving Sentris Flow. This guide keeps contributions consistent, reviewable, and compliant with our legal and security expectations.

## Quick Start

- Fork or branch from `main`.
- Keep subjects in Conventional Commit style (e.g., `feat:`, `fix:`, `docs:`) and reference the issue/milestone where relevant.
- Run the core gates before opening a PR: `bun run test`, `bun run lint`, and `bun run typecheck`. Call out any intentional gaps in the PR description.
- For backend integrations, prefer targeted checks when needed: `bun --cwd backend run migration:smoke`.
- If you touch workflows or contracts, update fixtures/docs under `docs/` as needed.

## Reference Docs

- `AGENTS.md` — repo layout, commands, testing gates, and PR expectations.
- Component patterns — `docs/development/component-development.mdx` (isolated volume requirement); `worker/src/utils/COMPONENTS_TO_MIGRATE.md` for migration status.

## Developer Certificate of Origin (DCO)

We require a DCO sign-off on every commit. Use `git commit -s` so Git appends a `Signed-off-by: Name <email>` line. If you forgot to sign off, amend and force-push the branch:

```bash
git commit --amend -s
git push --force-with-lease
```

The repository enforces a DCO status check on pull requests; unsignoffed commits will fail CI until corrected.

## Pull Request Checklist

- Tests, lint, and type checks pass (or documented exceptions).
- New or changed behaviour is covered with tests near the code (`__tests__`, `*.spec.ts`/`*.test.ts`).
- Docs/runbooks updated when contracts, workflows, or operational steps change.
- Keep workflow/run identifiers in the `sentris-run-*` shape and reuse shared Zod schemas from `@sentris/shared` instead of ad-hoc types.
- Screenshots or trace snippets included for UI/observability changes when helpful.

## Code Review Expectations

- Keep diffs focused and avoid unrelated formatting churn.
- Explain risk areas and validation performed in the PR description.
- If a check is flaky or blocked, note it explicitly so reviewers know what was attempted.

## Security & Sensitive Changes

- Avoid committing secrets; prefer `.env.example` updates for new settings.
- For vulnerability reports, follow the process in `SECURITY.md` (private disclosure first).
- Components that interact with Docker must follow the isolated volume pattern described in `packages/component-sdk/` and `docs/development/component-development.mdx`.

## Getting Help

- Open a GitHub discussion/issue with module context (frontend/backend/worker/packages).
- Internal team: share blocking details (logs, run IDs, Loki queries) in the PR or chat to speed triage.
