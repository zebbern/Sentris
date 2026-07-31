# MCP client compatibility boundary

Verified 2026-07-31 against the npm registry and official MCP documentation.

## Runtime and package boundary

| Package                        | Declared range | Resolved version | Runtime requirement | Supported era / role                                    |
| ------------------------------ | -------------- | ---------------- | ------------------- | ------------------------------------------------------- |
| `@modelcontextprotocol/server` | `^2.0.0`       | `2.0.0`          | Node `>=20`         | Canonical inbound server, modern 2026-07-28 era         |
| `@modelcontextprotocol/node`   | `^2.0.0`       | `2.0.0`          | Node `>=20`         | Node transports for the canonical inbound server        |
| `@modelcontextprotocol/client` | `^2.0.0`       | `2.0.0`          | Node `>=20`         | Backend test client, modern auto-negotiating client     |
| `@modelcontextprotocol/sdk`    | `^1.30.0`      | `1.30.0`         | Node `>=18`         | Transitional outbound proxy and Studio v1 surface       |
| `@ai-sdk/mcp`                  | `^1.0.66`      | `1.0.66`         | Node `>=18`         | AI SDK 6 compatibility client; remain on the `1.x` line |

The repository runtime is Node `22.16.0` and Bun `1.3.10`; Node satisfies every selected package's engine requirement, and Bun is the repository package manager. The v2 packages are intentionally added alongside `@modelcontextprotocol/sdk` v1: the official v2 migration guide prescribes this incremental order. Do not install `@ai-sdk/mcp` `2.x` in this migration slice because it targets the AI SDK 7 line, while Sentris uses AI SDK 6.

Official sources:

- npm registry metadata: [server](https://www.npmjs.com/package/@modelcontextprotocol/server), [node](https://www.npmjs.com/package/@modelcontextprotocol/node), [client](https://www.npmjs.com/package/@modelcontextprotocol/client), [SDK v1](https://www.npmjs.com/package/@modelcontextprotocol/sdk), and [AI SDK MCP](https://www.npmjs.com/package/@ai-sdk/mcp).
- MCP TypeScript SDK: [upgrade from v1 to v2](https://ts.sdk.modelcontextprotocol.io/v2/migration/upgrade-to-v2) and [support protocol revision 2026-07-28](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/migration/support-2026-07-28.md).
- MCP specification: [transports and backwards compatibility](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports) and [protocol changelog](https://modelcontextprotocol.io/specification/2025-11-25/changelog).

## Supported-client acceptance matrix

| Client                                     | Era/mode                                                   | Required acceptance                              | Removal condition                                                 |
| ------------------------------------------ | ---------------------------------------------------------- | ------------------------------------------------ | ----------------------------------------------------------------- |
| Official `@modelcontextprotocol/client` v2 | `versionNegotiation: { mode: 'auto' }`                     | `server/discover`, list, call, no session/cookie | Permanent canonical client                                        |
| Existing `@ai-sdk/mcp`                     | legacy initialization through SDK v2 `legacy: 'stateless'` | list and call through same URL                   | Re-evaluate when AI SDK MCP supports modern era                   |
| Backend outbound proxy client              | v1                                                         | discovery/call parity through explicit adapter   | Remove in runtime-manager/client-adapter plan                     |
| Studio inbound route                       | v1 sessionful                                              | existing Studio tests remain green               | Remove when Studio uses shared facade and durable task projection |

The v2 client uses `versionNegotiation: { mode: 'auto' }` to send `server/discover` and fall back to the legacy initialize handshake for a 2025-era server. The canonical inbound facade must be stateless: it emits no MCP session or affinity cookie. The MCP transport specification permits session IDs for servers that need state, but they are not part of the canonical route's acceptance boundary.

A separate legacy-session adapter is forbidden unless the AI SDK compatibility test proves stateless fallback insufficient. If introduced, it must follow the ADR's two-release deletion/renewal rule.
