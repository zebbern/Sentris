# Agent: error-fixer

## Purpose

Fix Bug 10: MCP external tool calling crashes with `schema.safeParseAsync is not a function` because raw JSON Schema is passed where McpServer expects Zod schemas.

## Skills

Load before starting: none

## Subtasks

- [x] Read `backend/src/mcp/mcp-gateway.service.ts` lines 380–470 (external tool registration loop) and `backend/src/mcp/__tests__/mcp-gateway.spec.ts` to understand the current flow
- [x] Read `.tasks/browser-tester-notes.md` "BUG 10 FIX PLAN" section for the existing diagnosis and fix plan
- [x] In the external tools registration loop (~line 430), change the `server.registerTool()` call: remove the `inputSchema: z.object({}).passthrough()` from the config object so McpServer skips Zod validation entirely (passing `undefined` or omitting the field)
- [x] Verify the `externalToolSchemas` map population and `patchListToolsWithExternalSchemas()` call are both in place — these already exist in the current code; confirm they correctly inject raw JSON schemas into the ListTools response
- [x] Verify `refreshServersForRun()` also calls `patchListToolsWithExternalSchemas(server)` after `registerTools()` — this is already present; confirm it works correctly with the schema removal change
- [x] Run existing MCP gateway unit tests: `bun test backend/src/mcp/__tests__/mcp-gateway.spec.ts`
- [x] Run existing MCP integration tests: `bun test backend/src/mcp/__tests__/mcp-internal.integration.spec.ts`
- [x] Run full backend test suite to check for regressions: `bun test --cwd backend`

## Notes

- The fix is partially implemented already: `externalToolSchemas` map and `patchListToolsWithExternalSchemas()` method exist in the current code. The remaining issue is that `z.object({}).passthrough()` is still passed as `inputSchema` in the `registerTool()` call (~line 432), which causes `safeParseAsync` to be called on it during tool invocation.
- The `patchListToolsWithExternalSchemas()` method correctly overrides the ListTools handler to return raw JSON schemas from the map. The fix is purely about removing the Zod placeholder from `registerTool()`.
- Internal (component) tools use Zod schemas from `getToolInputShape()` and are NOT affected by this bug.
- The key insight from browser-tester-notes: when `inputSchema` is undefined/omitted in `registerTool()`, the SDK's `validateToolInput()` skips validation entirely (line 170 in SDK: `if (!tool.inputSchema) return undefined;`).

## Completion Summary

<!-- Appended by orchestrator after agent completes. Do not fill manually. -->
