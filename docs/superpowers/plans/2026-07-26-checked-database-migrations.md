# Checked Database Migrations Implementation Plan

> **Execution note:** This plan is being implemented in the current shared worktree without commits, per the task constraints. No database, Docker, PM2, or other instance-dependent command will run until the user selects `SENTRIS_INSTANCE`.

**Goal:** Replace schema-push startup behavior with deterministic, immutable SQL migrations that detect changed history, serialize concurrent starters, and safely adopt only an exact v1.0.0 database.

**Architecture:** `backend/migrations` is the only authoritative migration directory. A filesystem loader validates Drizzle's journal and SQL file set and hashes every migration. A database-independent orchestrator validates a checksum ledger and applies each pending migration in its own transaction through a small adapter. The PostgreSQL adapter owns advisory locking, ledger queries, schema introspection, and transaction primitives. Startup, maintenance, and smoke commands share this runner.

**Tech Stack:** Bun, TypeScript, `pg`, Drizzle-generated SQL/snapshots, Bun test.

---

## Task 1: Lock down the migration manifest

**Files:**

- Create: `backend/src/database/migrations/checked-migrations.ts`
- Test: `backend/scripts/migrations/__tests__/checked-migrations.test.ts`
- Promote: `backend/migrations/**`

1. Write failing unit tests covering contiguous journal indexes, unique tags, missing referenced files, unreferenced SQL files, stable SHA-256 checksums, and SQL statement splitting.
2. Run the focused tests and confirm they fail because the loader does not exist.
3. Implement the minimum journal parser/validator and filesystem loader.
4. Mechanically copy the generated `0000_v1_0_0` baseline, `0001_current_schema` delta, snapshots, and journal into `backend/migrations`.
5. Re-run the focused tests and run the manifest checker against the promoted directory.

## Task 2: Implement checked ledger and adoption behavior

**Files:**

- Modify: `backend/src/database/migrations/checked-migrations.ts`
- Test: `backend/scripts/migrations/__tests__/checked-migrations.test.ts`

1. Write failing tests for exact-prefix history, unknown/gapped/drifted ledger rows, empty-database application, explicit v1 adoption, refusal of implicit adoption, refusal of empty/current/arbitrary schemas, per-migration commits, and rollback after a statement failure.
2. Add snapshot-to-schema fingerprint derivation and exact schema comparison.
3. Add the database-independent migration orchestrator with a mandatory advisory lock, one transaction per migration, ledger inserts in the same transaction, and rollback/release behavior.
4. Re-run the focused tests.

## Task 3: Add the PostgreSQL adapter and CLI

**Files:**

- Create: `backend/src/database/migrations/postgres-migration-database.ts`
- Create: `backend/scripts/run-migrations.ts`
- Test: `backend/scripts/migrations/__tests__/postgres-migration-database.test.ts`

1. Write failing adapter tests for parameterized advisory lock/unlock, ledger existence/history, transaction commands, migration recording, and public-schema introspection.
2. Implement the `pg` adapter and a strict CLI accepting only optional `--adopt v1.0.0`.
3. Resolve the target through the shared local-script runtime and print its formatted/redacted target before acquiring the lock or mutating the database.
4. Run the focused adapter and CLI-unit tests without connecting to a database.

## Task 4: Switch every authoritative runtime path

**Files:**

- Modify: `backend/package.json`
- Modify: `package.json`
- Modify: `Dockerfile`
- Modify: `backend/drizzle.config.ts`
- Modify: `scripts/db-reset-instance.sh`
- Create: `backend/drizzle/README.md`
- Create: `backend/scripts/check-migrations.ts`
- Test: `backend/scripts/migrations/__tests__/migration-policy.test.ts`

1. Write a failing repository-policy test that rejects an authoritative config/runtime script pointing at legacy `backend/drizzle` or invoking schema push.
2. Point Drizzle generation output at `backend/migrations`; retain push only as an explicitly named developer-only command.
3. Route backend development/startup, root migration, production container startup, and database reset through `migration:run`.
4. Mark `backend/drizzle` as historical and non-authoritative.
5. Add `migration:check` and make the policy test pass against the real repository.

## Task 5: Upgrade the startup guard and live smoke hooks

**Files:**

- Modify: `backend/src/database/migration.guard.ts`
- Create: `backend/src/database/__tests__/migration.guard.spec.ts`
- Modify: `backend/scripts/migration-smoke.ts`
- Test: `backend/scripts/migrations/__tests__/migration-smoke.test.ts`

1. Write failing guard tests for missing, incomplete, and checksum-drifted ledgers plus a fully current ledger.
2. Change the startup guard to require the complete authoritative checksum ledger and direct operators to `bun run migrate`.
3. Add `fresh`, `upgrade`, and read-only `parity` smoke modes. Require an explicitly supplied `SENTRIS_INSTANCE` or `MIGRATION_SMOKE_DATABASE_URL`, print the redacted target first, and make `upgrade` seed only the generated v1 baseline before invoking explicit adoption.
4. Unit-test smoke target/mode/precondition behavior with fakes only. Do not execute live smoke modes during this task.

## Task 6: Documentation and verification

**Files:**

- Modify: `AGENTS.md`
- Modify: `docs/MULTI-INSTANCE-DEV.mdx`

1. Replace current operational guidance for schema push with checked migration commands and document the developer-only push escape hatch.
2. Run focused migration tests, the repository migration check, backend typecheck, backend lint on touched files (or the project lint if practical), and inspect the scoped diff.
3. Report exact commands/results, call out any unrelated pre-existing failures, and leave live fresh/upgrade/parity smoke tests deferred until the user selects an instance.
