# Agent: migration-deps

## Purpose

Align dependency versions across workspace packages to eliminate version drift for `bun-types` and `@typescript-eslint/*`.

## Skills

Load before starting: dependency-audit

## Context

### Current Version Mismatches

#### `bun-types`

| Package                               | Version   |
| ------------------------------------- | --------- |
| root `package.json`                   | `^1.3.6`  |
| `backend/package.json`                | `^1.3.6`  |
| `worker/package.json`                 | `^1.3.6`  |
| `packages/contracts/package.json`     | `^1.3.4`  |
| `packages/shared/package.json`        | `^1.2.23` |
| `packages/component-sdk/package.json` | `^1.2.23` |

**Target**: `^1.3.6` (highest current version)

#### `@typescript-eslint/eslint-plugin` + `@typescript-eslint/parser`

| Package                                | Version   |
| -------------------------------------- | --------- |
| `backend/package.json`                 | `^8.53.1` |
| `worker/package.json`                  | `^8.53.1` |
| `packages/shared/package.json`         | `^8.53.0` |
| `packages/contracts/package.json`      | `^8.53.0` |
| `packages/backend-client/package.json` | `^8.53.0` |
| `packages/component-sdk/package.json`  | `^8.53.0` |
| `frontend/package.json`                | `^8.45.0` |

**Target**: `^8.53.1` (highest current version)

#### `@modelcontextprotocol/sdk`

All 4 packages already at `^1.26.0` — **no action needed**.

### Workspace Structure

Root `package.json` declares workspaces: `frontend`, `backend`, `worker`, `packages/backend-client`, `packages/component-sdk`, `packages/contracts`, `packages/shared`

## Subtasks

### bun-types alignment

- [x] Update `packages/contracts/package.json`: change `bun-types` from `^1.3.4` to `^1.3.6`
- [x] Update `packages/shared/package.json`: change `bun-types` from `^1.2.23` to `^1.3.6`
- [x] Update `packages/component-sdk/package.json`: change `bun-types` from `^1.2.23` to `^1.3.6`

### @typescript-eslint alignment

- [x] Update `packages/shared/package.json`: change `@typescript-eslint/eslint-plugin` and `@typescript-eslint/parser` from `^8.53.0` to `^8.53.1`
- [x] Update `packages/contracts/package.json`: change `@typescript-eslint/eslint-plugin` and `@typescript-eslint/parser` from `^8.53.0` to `^8.53.1`
- [x] Update `packages/backend-client/package.json`: change `@typescript-eslint/eslint-plugin` and `@typescript-eslint/parser` from `^8.53.0` to `^8.53.1`
- [x] Update `packages/component-sdk/package.json`: change `@typescript-eslint/eslint-plugin` and `@typescript-eslint/parser` from `^8.53.0` to `^8.53.1`
- [x] Update `frontend/package.json`: change `@typescript-eslint/eslint-plugin` and `@typescript-eslint/parser` from `^8.45.0` to `^8.53.1`

### Verification

- [x] Run `bun install` at workspace root to regenerate `bun.lock`
- [x] Run `bun run typecheck` to verify no type regressions from `bun-types` upgrade
- [x] Run `bun run lint` to verify no lint regressions from `@typescript-eslint` upgrade

## Notes

- `@modelcontextprotocol/sdk` is already aligned at `^1.26.0` across root, worker, component-sdk, and mcp-stdio-proxy — no changes needed.
- The `docker/mcp-stdio-proxy/package.json` also has `@modelcontextprotocol/sdk` but is outside the workspace; leave it as-is.
- These are all semver-range bumps within compatible ranges, so breaking changes are unlikely. The `bun-types` jump from `^1.2.23` to `^1.3.6` is the largest — verify types still compile.
- Use `bun install` (not `npm install`) — this is a Bun workspace.

## Completion Summary

<!-- Appended by orchestrator after agent completes. Do not fill manually. -->
