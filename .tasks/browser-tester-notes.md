# Browser Tester Session Notes

## CURRENT STATE

- Bug 9 (race condition) FIXED and CONFIRMED working
- Bug 10 (NEW): `schema.safeParseAsync is not a function` in tool calling

## TERMINAL IDS

- Backend: `768a8d7e-1b05-4211-a72b-364869fbe45a` (PID 35608, bun --watch, auto-reloads)
- Worker: `66bb49d9-52c6-45bf-bf04-41835ee0b760` (PID 20920, needs restart after fix)
- Frontend: `13170681-0b3e-4e19-b558-6f61d5d2930b` (port 5173)

## WORKFLOW

- ID: `2ba11531-f3f8-413a-ac95-3f122cedef96`
- Last run: sentris-run-01a2722f COMPLETED in 17.2s
- Agent found 13 tools, called Everything_Test\_\_echo with empty {} input
- Got error: schema.safeParseAsync is not a function

## BUG 10 ROOT CAUSE

File: `backend/src/mcp/mcp-gateway.service.ts`
Lines ~431-464: `server.registerTool()` passes raw JSON Schema as `inputSchema`.
The MCP SDK `McpServer.registerTool()` expects Zod schemas.

In the SDK code (`mcp.js`):

- Line 170: `validateToolInput()` calls `safeParseAsync(schemaToParse, args)` on inputSchema
- Line 80-92: `ListTools` handler calls `normalizeObjectSchema(tool.inputSchema)` → if not Zod → EMPTY_OBJECT_JSON_SCHEMA

So: AI sees empty schema → sends {} → tool invocation crashes on safeParseAsync

## BUG 10 FIX PLAN

1. In `registerTool()` call, remove `inputSchema` (pass undefined/omit it)
2. Keep the tool callback handler as-is (gets args without validation - fine since external server validates)
3. After tools registered, override `ListTools` via `server.server.setRequestHandler()`
4. Custom ListTools handler returns tools with raw JSON schemas injected

KEY: `server.server.setRequestHandler()` REPLACES handlers (uses Map.set).
BUT `assertCanSetRequestHandler()` THROWS if handler exists.
HOWEVER: `setRequestHandler()` does NOT call `assertCanSetRequestHandler()` - it's only used in `setToolRequestHandlers()`.
So calling `server.server.setRequestHandler(ListToolsRequestSchema, handler)` AFTER registerTool() is safe - it silently replaces.

## IMPORT NEEDS

```typescript
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
```

These are already partially imported (ErrorCode, McpError are from types.js).

## ALTERNATIVE SIMPLER FIX

Since both listing and calling are broken:

1. Register tools WITHOUT inputSchema (avoids crash)
2. Store `Map<proxiedName, jsonSchema>` for external tool schemas
3. Override ListTools on server.server to return real schemas
4. Override CallTools on server.server to skip Zod validation

Actually, even simpler: just override the ListTools handler to merge schemas.
For CallTools: the existing handler catches errors and returns them as `{isError: true}`.
The safeParseAsync error IS the problem - without inputSchema, validation is skipped (line 170: `if (!tool.inputSchema) return undefined;`).

So: Just remove inputSchema from registerTool config and override ListTools.

## EXACT CODE CHANGE NEEDED

### Change 1: Add import for ListToolsRequestSchema

Current line 17: `import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';`
Change to: `import { ErrorCode, McpError, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';`

### Change 2: Add external schema map to class

Add to class properties (around line 60):

```typescript
private readonly externalToolSchemas = new Map<string, Record<string, unknown>>();
```

### Change 3: In registerTools, don't pass inputSchema, save to map instead

Current (lines ~431-438):

```typescript
server.registerTool(
  proxiedName,
  {
    description: t.description,
    inputSchema: t.inputSchema as any,
    _meta: { inputSchema: t.inputSchema },
  },
```

Change to:

```typescript
// Store JSON Schema separately — McpServer.registerTool expects Zod,
// but external tools provide raw JSON Schema. We inject it via
// a custom ListTools handler after registration.
if (t.inputSchema) {
  this.externalToolSchemas.set(proxiedName, t.inputSchema);
}
server.registerTool(
  proxiedName,
  {
    description: t.description,
  },
```

### Change 4: In getServerForRun, after registerTools, patch ListTools

After line ~113 (`this.servers.set(cacheKey, server);`), add:

```typescript
this.patchListToolsWithExternalSchemas(server);
```

### Change 5: Add patchListToolsWithExternalSchemas method

```typescript
/**
 * Override the ListTools handler to inject raw JSON schemas for external tools.
 * McpServer.registerTool() only accepts Zod schemas, but external tools provide
 * raw JSON Schema. This patches the response to include the actual schemas.
 */
private patchListToolsWithExternalSchemas(server: McpServer): void {
  if (this.externalToolSchemas.size === 0) return;

  const schemasSnapshot = new Map(this.externalToolSchemas);
  // Access the low-level Server to override the ListTools handler.
  // setRequestHandler uses Map.set internally, safely replacing the existing handler.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const lowLevelServer = (server as any).server;

  // Get the original handler to delegate to
  // Actually, we need to wrap the response. Let's use a different approach:
  // Read from _registeredTools directly and build our own response.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const registeredTools = (server as any)._registeredTools as Record<string, any>;

  lowLevelServer.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: Object.entries(registeredTools)
      .filter(([, tool]: [string, any]) => tool.enabled)
      .map(([name, tool]: [string, any]) => ({
        name,
        description: tool.description,
        inputSchema: schemasSnapshot.get(name) ?? { type: 'object' as const },
        annotations: tool.annotations,
        _meta: tool._meta,
      })),
  }));
}
```

## ALSO NEED: refreshServersForRun fix

Lines ~120-140: The refresh method also calls registerTools and should also patch.
But since it reuses existing servers, we need to re-patch after refresh too.

## FULL FILE STRUCTURE

- Lines 1-20: imports
- Lines 21-42: DiscoveredTool interface, sanitizeToolNameSegment function
- Lines 43-50: more imports
- Lines 51-65: class properties (servers, registeredToolNames, externalClients maps)
- Lines 66-75: constructor
- Lines 76-115: getServerForRun()
- Lines 116-140: refreshServersForRun()
- Lines 141-155: validateRunAccess()
- Lines ~200-470: registerTools() (component + external tools)
- Lines ~431-464: The registerTool call for external tools (BUG 10 location)
- Lines ~475+: getPreDiscoveredTools, discoverToolsFromEndpoint, proxyCallToExternal, etc.
