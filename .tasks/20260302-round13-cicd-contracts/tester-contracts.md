# Agent: tester-contracts

## Purpose

Write comprehensive unit tests for all exported Zod schemas in `packages/contracts/src/index.ts`.

## Skills

Load before starting: testing-patterns

## Subtasks

- [x] Read `packages/contracts/src/index.ts` to catalog all exported schemas and types
- [x] Read `packages/component-sdk/src/__tests__/port-meta.test.ts` to understand how `withPortMeta` schemas are tested in this codebase
- [x] Create `packages/contracts/src/__tests__/index.test.ts`
- [x] Test `awsCredentialSchema`: valid parse with all fields, valid parse with optional fields omitted, reject missing required fields (`accessKeyId`, `secretAccessKey`)
- [x] Test `LLMProviderSchema` discriminated union: valid parse for each provider variant (`openai`, `gemini`, `openrouter`, `zai-coding-plan`, `anthropic`), reject unknown provider, reject missing `provider` field, reject missing `modelId` field
- [x] Test `LLMProviderSchema` provider-specific fields: `openai` has optional `headers`/`baseUrl`, `gemini` has optional `projectId`, `anthropic` lacks `headers`
- [x] Test `McpToolArgumentSchema`: valid parse with defaults applied (`type` defaults to `"string"`, `required` defaults to `true`), reject empty `name`, test optional `enum` array (must be nonempty when provided)
- [x] Test `McpToolDefinitionSchema`: valid parse with required fields (`id`, `title`, `endpoint`), optional `headers`/`metadata`/`arguments`, reject empty `id`/`title`/`endpoint`
- [x] Test `secretMetadataSchema`: valid parse, reject missing `secretId`/`version`/`format`, reject invalid `format` value (only `"raw"` | `"json"`)
- [x] Test `fileContractSchema`: valid parse with all fields (`id`, `name`, `mimeType`, `size`, `content`), reject missing required fields
- [x] Test `destinationWriterSchema`: valid parse with `adapterId` + optional `config`/`metadata`, verify it uses `DestinationConfigSchema.shape` from `@sentris/shared`
- [x] Test `manualApprovalPendingSchema`: valid parse with all required fields (`approved`, `rejected`, `respondedBy`, `respondedAt`, `requestId`), optional `responseNote`
- [x] Test `manualFormPendingSchema`: valid parse (record of string→any), accepts arbitrary key-value pairs
- [x] Test `manualSelectionPendingSchema`: valid parse with all required fields, optional `responseNote`, `selection` accepts any type
- [x] Verify all schema factory functions return schemas with `withPortMeta` metadata (check that the schema has the expected `schemaName` in its metadata)
- [x] Verify exported contract name constants match the `schemaName` passed to `withPortMeta` (e.g., `awsCredentialContractName === 'core.credential.aws'`)

## Notes

- The project uses `bun test` (not Vitest/Jest). Use `describe`/`test`/`expect` from bun's test runner.
- Schemas are factory functions (e.g., `awsCredentialSchema()` returns a schema). Call them before parsing.
- `withPortMeta` attaches metadata to schemas. Check `packages/component-sdk/src/__tests__/port-meta.test.ts` for the API to read metadata back.
- `DestinationConfigSchema` is imported from `@sentris/shared` — it's a plain `z.object` (see `packages/shared/src/destinations.ts`).
- The project uses Zod v4 (`^4.3.6`). Discriminated unions and `.shape` access may differ from v3.
- `McpToolArgumentSchema` is a plain schema (not a factory function), unlike the others.
- Each test should cover: valid input passes, invalid input is rejected with appropriate error, optional fields can be omitted, default values are applied where specified.

## Completion Summary

<!-- Appended by orchestrator after agent completes. Do not fill manually. -->
