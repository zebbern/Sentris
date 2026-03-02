# Triage: Round 13 — CI/CD + Contracts & Agent Controller Tests

## EXECUTION_PLAN

### Items

1. **CI/CD activation**: Convert `.github/workflows/ci.yml` from yarn→bun, uncomment and configure typecheck/test/build jobs. The file has all jobs commented out with `# TODO`.
2. **Contracts tests**: Write unit tests for `packages/contracts/src/index.ts` (~181 lines, 10+ Zod schemas). Place in `packages/contracts/src/__tests__/`.
3. **Agent controller tests**: Write unit tests for `backend/src/agents/agents.controller.ts` (~261 lines, SSE streaming + cursor). Place in `backend/src/agents/__tests__/`.

### Phases

- Phase 1 (parallel, 3): devops(ci-cd) + tester(contracts) + tester(agents-controller)
- Phase 2: code-reviewer
- Phase 3: error-fixer + commit

### Task Files

- `devops-cicd.md`
- `tester-contracts.md`
- `tester-agents-controller.md`
- `code-reviewer.md`

### Context

- CI file: `.github/workflows/ci.yml`. Project uses `bun`, monorepo at `workproject/`. Backend/frontend/worker each have `package.json`.
- Contracts: `packages/contracts/src/index.ts` — awsCredentialSchema, LLMProviderSchema (5 providers), McpToolDefinitionSchema, secretMetadataSchema, fileContractSchema, destinationWriterSchema, manualApprovalPendingSchema, etc. Uses `withPortMeta` from `@sentris/component-sdk`.
- Agent controller: `backend/src/agents/agents.controller.ts` — GET /:agentRunId/parts (cursor), POST /:agentRunId/chat (SSE). DTOs in dto/ subdirectory.
- Project root: `workproject/`
