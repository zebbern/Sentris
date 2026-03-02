# Agent: devops-cicd

## Purpose

Activate and verify the GitHub Actions CI workflow at `.github/workflows/ci.yml` so it runs lint, typecheck, and tests using bun on every push/PR.

## Skills

Load before starting: devops-cicd

## Subtasks

- [x] Read the current `.github/workflows/ci.yml` file and assess what needs changing
- [x] Ensure the workflow triggers are correct: `push` to `main` and all `pull_request` events
- [x] Ensure `oven-sh/setup-bun@v1` is used with `bun-version: latest` (not yarn/node for package install)
- [x] Ensure `bun install` is the dependency installation step (not `yarn install` or `npm install`)
- [x] Ensure the lint step runs `bun run lint` (matches root `package.json` script)
- [x] Ensure the typecheck step runs `bun run typecheck` (matches root `package.json` script: `tsc --build`)
- [x] Ensure the test step runs `bun run test` (matches root `package.json` script)
- [x] Verify the job timeout is reasonable (current: 25 minutes — keep it)
- [x] Verify the workflow YAML is valid (proper indentation, no syntax issues)
- [x] Run `get_errors` on the workflow file to confirm no lint/syntax issues

## Notes

- The root `package.json` already defines: `"lint"` (runs frontend+backend+worker lint), `"typecheck"` (`tsc --build`), `"test"` (`rm -rf worker/dist && bun test`).
- The CI file already looks mostly correct with bun setup. Verify nothing is commented out or using wrong tool names.
- Do NOT add build/deploy steps — this is CI validation only (lint + typecheck + test).
- The monorepo uses `bun` workspaces. `bun install` at root installs all workspace deps.

## Completion Summary

<!-- Appended by orchestrator after agent completes. Do not fill manually. -->
