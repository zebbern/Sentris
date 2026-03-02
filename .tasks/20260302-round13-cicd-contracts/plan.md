# Plan: Round 13 — CI/CD + Contracts & Agent Controller Tests

## Overview

Activate the GitHub Actions CI pipeline for the bun monorepo, and add comprehensive unit tests for two untested modules: the Zod-based contracts package and the NestJS agents controller (SSE streaming + cursor pagination). All three items are independent and execute in parallel Phase 1, followed by code review in Phase 2 and fixes/commit in Phase 3.

## Architecture Decisions

| Decision                                                             | Alternatives                           | Rationale                                                                                                                                     |
| -------------------------------------------------------------------- | -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Single `validate` job in CI (lint → typecheck → test)                | Separate jobs per step                 | Current CI file already has a single-job structure; keeps it simple, avoids artifact passing overhead                                         |
| Bun test runner for contracts tests                                  | Vitest                                 | Project already uses `bun test` everywhere (root `package.json` script); contracts package has no test config — bun test works out of the box |
| Mock `AgentTraceService` and `WorkflowsService` for controller tests | Integration tests with real DB         | Unit tests are the goal; NestJS testing module with mocked providers is standard practice                                                     |
| Test `convertAgentTraceToUiChunk` directly as a pure function        | Test only through controller endpoints | It's a pure function with many branches — direct testing is more thorough and simpler                                                         |

## Affected Files

| Action | File Path                                                | Change Description                                                 |
| ------ | -------------------------------------------------------- | ------------------------------------------------------------------ |
| MODIFY | `.github/workflows/ci.yml`                               | Ensure bun setup, lint/typecheck/test steps are active and correct |
| CREATE | `packages/contracts/src/__tests__/index.test.ts`         | Unit tests for all exported Zod schemas                            |
| CREATE | `backend/src/agents/__tests__/agents.controller.spec.ts` | Unit tests for controller endpoints + convertAgentTraceToUiChunk   |

## Phases

| Phase | Agents                                                  | Purpose                                   | Depends On |
| ----- | ------------------------------------------------------- | ----------------------------------------- | ---------- |
| 1     | devops-cicd, tester-contracts, tester-agents-controller | CI activation + test authoring (parallel) | —          |
| 2     | code-reviewer                                           | Review all Phase 1 changes                | Phase 1    |
| 3     | error-fixer + commit                                    | Address review findings and commit        | Phase 2    |

## Dependencies

- All Phase 1 agents are independent — no cross-dependencies.
- Code reviewer needs all Phase 1 output before starting.
- `tester-contracts` depends on `@sentris/component-sdk` (withPortMeta) and `@sentris/shared` (DestinationConfigSchema) being importable — they are workspace dependencies already declared in contracts `package.json`.
- `tester-agents-controller` depends on `nestjs-zod`, `ai` SDK types, and NestJS testing utilities — all already in backend `package.json`.

## Risk Assessment

- **CI workflow syntax errors**: Low risk — the file is already mostly written, just needs verification. Mitigated by code review.
- **Zod v4 API differences**: The project uses `zod@^4.3.6` which has slightly different APIs from v3. Tests must use v4 patterns (e.g., `z.object` shape access). Mitigated by checking actual usage in source.
- **SSE streaming mocking complexity**: `createUIMessageStream` and `pipeUIMessageStreamToResponse` from the `ai` SDK may be tricky to mock. Mitigated by testing `convertAgentTraceToUiChunk` as a pure function and testing controller methods via NestJS test module with response mocks.
