# Agent: tester

## Purpose

Verify the Bug 10 fix (MCP external tool calling) works correctly by writing integration tests that cover external tool registration with JSON Schema and the tool calling path.

## Skills

Load before starting: testing-patterns

## Subtasks

### Understand existing test patterns

- [x] Read `backend/src/mcp/__tests__/mcp-gateway.spec.ts` to understand the current unit test setup (mock structure, test patterns)
- [x] Read `backend/src/mcp/__tests__/mcp-internal.integration.spec.ts` to understand the integration test setup (NestJS test module, Redis mock, HTTP testing)
- [x] Read `backend/src/mcp/__tests__/tool-registry.service.spec.ts` to understand tool registry test patterns

### Write integration test for external tool registration with JSON Schema

- [x] Create or extend a test file (e.g., `backend/src/mcp/__tests__/mcp-external-tools.integration.spec.ts`) that tests the full external tool registration flow
- [x] Test case: Register an external MCP tool with a raw JSON Schema `inputSchema` (not Zod) — verify it registers without error
- [x] Test case: Call `ListTools` on the server after registration — verify the response includes the raw JSON Schema (not an empty `{type: "object"}`)
- [x] Test case: Verify the tool description is preserved in the ListTools response

### Write integration test for external tool calling path

- [x] Test case: Call an external tool via `server.server.handleRequest()` (or equivalent) with arguments matching the JSON Schema — verify it does NOT throw `safeParseAsync is not a function`
- [x] Test case: Call an external tool with empty `{}` arguments — verify it invokes the tool callback without validation crash
- [x] Test case: Verify the tool callback receives the correct arguments and returns a proper `CallToolResult`

### Verify existing tests still pass

- [x] Run `bun test backend/src/mcp/__tests__/mcp-gateway.spec.ts` — all existing tests pass
- [x] Run `bun test backend/src/mcp/__tests__/mcp-internal.integration.spec.ts` — all existing tests pass
- [x] Run `bun test backend/src/mcp/__tests__/tool-registry.service.spec.ts` — all existing tests pass
- [x] Run full backend test suite: `bun test --cwd backend` — no regressions

## Notes

- This agent depends on error-fixer (step 1a) completing first. The fix should already be landed before tests are written.
- The key thing to test: external tools registered with raw JSON Schema (not Zod) should be callable without crashing on `safeParseAsync`.
- The `McpServer` class can be instantiated directly in tests without NestJS — see existing `mcp-gateway.spec.ts` for the pattern.
- The `patchListToolsWithExternalSchemas()` method is private — test it indirectly through the public `getServerForRun()` + list/call flow, or by instantiating `McpServer` directly and verifying the ListTools handler output.
- Use `bun:test` for the test framework (consistent with existing tests).
- Internal (component) tools use Zod schemas from `getToolInputShape()` and should NOT be affected — verify with existing tests.

## Completion Summary

<!-- Appended by orchestrator after agent completes. Do not fill manually. -->
