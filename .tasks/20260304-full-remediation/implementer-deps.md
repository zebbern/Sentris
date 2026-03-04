# Agent: implementer-deps

## Purpose

Execute dependency upgrades based on the dependency-auditor's findings to remediate known vulnerabilities in `@modelcontextprotocol/sdk`, `multer`, and `fast-xml-parser`.

## Skills

Load before starting: none

## Subtasks

### @modelcontextprotocol/sdk upgrade

- [x] Read the dependency-auditor's output in `.tasks/20260304-full-remediation/dependency-auditor.md` for target version and breaking change notes
- [x] Update `@modelcontextprotocol/sdk` version in root `package.json` (currently `^1.25.3`)
- [x] Update `@modelcontextprotocol/sdk` version in `worker/package.json` (currently `^1.25.1`)
- [x] Update `@modelcontextprotocol/sdk` version in `packages/component-sdk/package.json` (currently `^1.25.2`)
- [x] Update `@modelcontextprotocol/sdk` version in `docker/mcp-stdio-proxy/package.json` (currently `^1.25.3`)
- [x] Run `bun install` from the workspace root to update `bun.lock`
- [x] Run backend tests: `bun test --cwd backend` — verify no regressions from SDK upgrade
- [x] Run worker tests: `bun test --cwd worker` — verify no regressions

### multer upgrade

- [x] Update `multer` version in `backend/package.json` (currently `^2.0.2`) to the auditor's recommended version
- [x] Update `@types/multer` in `backend/package.json` if needed (currently `^2.0.0`)
- [x] Run `bun install` to update lockfile
- [x] Run backend tests: `bun test --cwd backend` — verify no regressions from multer upgrade

### fast-xml-parser remediation

- [x] Apply the auditor's recommended remediation strategy (likely one of: update `minio` package, add `overrides` in root `package.json`, or confirm versions are not affected)
- [x] If using `overrides`/`resolutions`, add them to root `package.json` and run `bun install`
- [x] Verify the resolved `fast-xml-parser` version in `bun.lock` is patched
- [x] Run any tests that exercise MinIO functionality (if they exist)

### Final verification

- [x] Run full test suite: `bun run test` from workspace root
- [x] Run typecheck: `bun run typecheck` from workspace root

## Notes

- This agent depends on the dependency-auditor (step 1c) completing first. The auditor's output will contain specific target versions and any breaking change warnings.
- All four `@modelcontextprotocol/sdk` instances must be updated together to the same version to avoid workspace resolution conflicts.
- `fast-xml-parser` is transitive — the remediation approach depends on the auditor's findings (direct override vs upstream package update).
- The `bun.lock` file is the workspace lockfile at the monorepo root level.

## Completion Summary

<!-- Appended by orchestrator after agent completes. Do not fill manually. -->
