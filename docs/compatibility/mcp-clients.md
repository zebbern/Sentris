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

## Migration status

The run gateway uses the official v2 request-local facade and supports modern plus
legacy-stateless requests at one URL. It has no inbound transport/session map, cached
server, `Mcp-Session-Id`, affinity cookie, Redis session registration, or sticky route.
Studio remains v1 sessionful and sticky pending its own migration, so Studio sessions in
the administrative session registry are expected.

The gateway's outbound proxy is still an explicit v1 compatibility pool keyed by run
and endpoint. Its replacement belongs to the worker runtime-manager and canonical
outbound-client plan. SDK-independent shared catalog and invocation contracts exist,
but durable grants/snapshots and invocation persistence, resources/prompts runtime,
Workflow Updates, runtime leases, Tasks, and workflow-granular agents remain pending.

## Supported-client acceptance matrix

| Client / retained declaration                              | Owner and purpose                                                                                         | Era/mode                                                   | Required acceptance                                                 | Removal condition                                                                                                                     |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Official `@modelcontextprotocol/client` v2                 | Gateway team; permanent canonical inbound verification client                                             | `versionNegotiation: { mode: 'auto' }`                     | `server/discover`, list, call, no session/cookie                    | Permanent canonical client                                                                                                            |
| Existing `@ai-sdk/mcp`                                     | Agent integration; AI SDK 6 compatibility client used by root, backend, and worker callers                | legacy initialization through SDK v2 `legacy: 'stateless'` | list and call through same URL                                      | Re-evaluate when AI SDK MCP supports modern era                                                                                       |
| Root `@modelcontextprotocol/sdk` declaration               | Platform tooling; root-level MCP scripts and test tooling while package-specific migrations are in flight | v1                                                         | root MCP tooling remains import-compatible                          | Remove after no root script or test imports `@modelcontextprotocol/sdk`, with each remaining caller owned by its workspace dependency |
| Worker outbound `@modelcontextprotocol/sdk` declaration    | Worker runtime; outbound discovery and remote MCP invocation                                              | v1                                                         | discovery/call parity through the worker's explicit adapter         | Remove in the runtime-manager/client-adapter plan after worker outbound calls use the shared v2 adapter                               |
| Backend outbound proxy client                              | Gateway team; backend-owned proxy to external MCP servers                                                 | v1                                                         | discovery/call parity through explicit adapter                      | Remove in the runtime-manager/client-adapter plan after backend outbound calls use the shared v2 adapter                              |
| Docker stdio proxy `@modelcontextprotocol/sdk` declaration | Container integration; bridge hosted stdio MCP servers to the current HTTP compatibility surface          | v1                                                         | existing stdio proxy request, list, and call behavior remains green | Remove when the stdio proxy adopts the shared v2 facade/adapter or is retired by its replacement                                      |
| Studio inbound route                                       | Studio integration; existing sessionful Studio MCP endpoint                                               | v1 sessionful                                              | existing Studio tests remain green                                  | Remove when Studio uses shared facade and durable task projection                                                                     |

The v2 client uses `versionNegotiation: { mode: 'auto' }` to send `server/discover` and fall back to the legacy initialize handshake for a 2025-era server. The canonical inbound facade must be stateless: it emits no MCP session or affinity cookie. The MCP transport specification permits session IDs for servers that need state, but they are not part of the canonical route's acceptance boundary.

A separate legacy-session adapter is forbidden unless the AI SDK compatibility test proves stateless fallback insufficient. If introduced, it must follow the ADR's two-release deletion/renewal rule.

## Local run-gateway acceptance

Live acceptance on 2026-07-31 used instance 0 at
`http://127.0.0.1:3211/api/v1/mcp/gateway` and one disposable, real run record
with a bounded five-minute token. The official v2 client in auto mode negotiated
the modern era and listed/called the registered harmless echo tool. The current
`@ai-sdk/mcp` client listed/called the same tool through legacy-stateless mode.

Two direct POST requests, one `tools/list` and one `tools/call`, each succeeded
without a request cookie or `Mcp-Session-Id`; neither response supplied
`Set-Cookie` or `Mcp-Session-Id`. The administrative sessions endpoint returned
zero run-gateway matches, and the relevant backend log window contained no old
transport-map or session-lookup failure.

Twenty sequential warm authenticated samples per operation produced these local
request-local-route latencies:

| Operation    | Samples | Median   | p95      |
| ------------ | ------- | -------- | -------- |
| `tools/list` | 20      | 20.92 ms | 23.45 ms |
| `tools/call` | 20      | 45.57 ms | 79.10 ms |

No trustworthy comparable pre-change baseline artifact was available, so these
are absolute post-migration measurements only. They do not support a relative
regression claim or justify adding descriptor caching. The optional restart
between list and call was skipped to avoid disrupting the user's active local
instance; focused automated coverage verifies reconstruction after a fresh
facade/controller.
