# MCP v2 Runtime SDK 2.0.0 Compatibility Boundary

This note is the tracked implementation boundary for the canonical outbound MCP
runtime. It records the repository state and official API behavior verified on
2026-08-01. Recheck the installed declarations and current official documentation
before changing the dependency pin or implementing against a later release.

## Version and lockfile pin

- The compatibility target is exactly `@modelcontextprotocol/client@2.0.0`.
- `bun.lock:703` resolves that package to `2.0.0` with integrity
  `sha512-8f1OghQ2rjzIOfqgUCP+8GiUWqRs89njoWLNqAe8kWmDePv3s1fZXseej+QXemssEuuOvLLmLO/kqM3IQHtISw==`.
- The backend currently declares the v2 client as a development dependency and the
  v2 server/node packages as server dependencies. The worker currently declares only
  `@modelcontextprotocol/sdk` v1 and must add its own exact client v2 production
  dependency.
- `@modelcontextprotocol/node@2.0.0` is the Node server adapter. It exports
  `NodeStreamableHTTPServerTransport`, `toNodeHandler`, and related server helpers; it
  is not an outbound worker dependency. Stdio client support is exported by
  `@modelcontextprotocol/client/stdio`.

## Installed declaration evidence

Paths below are relative to the repository root and refer to the installed `2.0.0`
declarations available during this review.

| Concern              | Installed declaration                                                                                  | Decision                                                                                                                                                                                                                                                 |
| -------------------- | ------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Client construction  | `backend/node_modules/@modelcontextprotocol/client/dist/index.d.mts:1945`                              | Construct `Client(clientInfo, options)` with explicit `versionNegotiation: { mode: 'auto' }`; the default is legacy.                                                                                                                                     |
| Connect signature    | `backend/node_modules/@modelcontextprotocol/client/dist/index.d.mts:2041`                              | Call `client.connect(transport, { prior, signal, timeout })`; the transport is the first argument.                                                                                                                                                       |
| Negotiation evidence | `backend/node_modules/@modelcontextprotocol/client/dist/index.d.mts:2099-2129`                         | Record `getNegotiatedProtocolVersion()`, `getProtocolEra()`, and `getDiscoverResult()`. A `prior` verdict is host-scoped, auth-partitioned, and TTL-bounded.                                                                                             |
| Pagination           | `backend/node_modules/@modelcontextprotocol/client/dist/index.d.mts:1718-1728`                         | Set `listMaxPages: 64`; no-argument list calls aggregate up to that hard cap.                                                                                                                                                                            |
| Response caching     | `backend/node_modules/@modelcontextprotocol/client/dist/index.d.mts:1730-1804`                         | `cacheMode` applies only to list tools/prompts/resources/templates and `readResource`, not `getPrompt` or `callTool`. `cachePartition` does not isolate public entries, so each complete authorization partition owns a distinct client and cache store. |
| Input required       | `backend/node_modules/@modelcontextprotocol/client/dist/index-D4xIIEF6.d.mts:1290-1311,1500-1511,1843` | Configure `inputRequired: { autoFulfill: false }`, pass `allowInputRequired: true`, detect `isInputRequiredResult`, and map it to Sentris's non-retryable `input-required-unsupported` result.                                                           |
| Call options         | `backend/node_modules/@modelcontextprotocol/client/dist/index-D4xIIEF6.d.mts:1799-1844`                | Pass operation `signal`, idle `timeout`, `resetTimeoutOnProgress: true`, and bounded `maxTotalTimeout`. Sentris owns monotonic progress validation, rate limiting, and Temporal heartbeat policy.                                                        |
| Tool definition      | `backend/node_modules/@modelcontextprotocol/client/dist/index.d.mts:1813-1821`                         | Supply the immutable snapshotted `toolDefinition` to `callTool`.                                                                                                                                                                                         |
| Server information   | `backend/node_modules/@modelcontextprotocol/client/dist/index.d.mts:1737-1747,2078-2085`               | Treat `getServerVersion()`/result metadata as self-reported display and cache context only, never as an authentication, authorization, or runtime-identity key.                                                                                          |
| Public results       | `backend/node_modules/@modelcontextprotocol/client/dist/index-D4xIIEF6.d.mts:385`                      | Normalize the SDK's stripped public results; do not depend on a visible wire `resultType: 'complete'`.                                                                                                                                                   |
| HTTP transport       | `backend/node_modules/@modelcontextprotocol/client/dist/index-D4xIIEF6.d.mts:3020-3245`                | The v2 Streamable HTTP transport supports modern request-local HTTP and initialize-era legacy behavior. Do not expose modern session/resume state.                                                                                                       |
| Very-old SSE         | `backend/node_modules/@modelcontextprotocol/client/dist/index-D4xIIEF6.d.mts:2828-2896`                | A recognized very-old HTTP+SSE fallback uses a fresh v2 `Client` and the deprecated v2 `SSEClientTransport`; it is not a reason to create a v1 adapter.                                                                                                  |
| Node adapter         | `backend/node_modules/@modelcontextprotocol/node/dist/index.d.mts:64-273`                              | Keep this backend/server-side unless the worker itself becomes an MCP server.                                                                                                                                                                            |
| Stdio client         | `backend/node_modules/@modelcontextprotocol/client/dist/stdio.d.mts:6-80`                              | Use `StdioClientTransport` for host and bounded Docker stdio; it owns the spawned child.                                                                                                                                                                 |
| Request-local server | `backend/node_modules/@modelcontextprotocol/server/dist/createMcpHandler-CLhGwQTn.d.mts:3766-3926`     | Preserve the backend's `createMcpHandler` per-request facade. Do not replace it with a persistent transport session.                                                                                                                                     |
| Resource templates   | `backend/node_modules/@modelcontextprotocol/server/dist/createMcpHandler-CLhGwQTn.d.mts:3404-3434`     | Construct a non-listable template with `new ResourceTemplate(uriTemplate, { list: undefined })`.                                                                                                                                                         |

## Protocol and product decisions

- Modern MCP `2026-07-28` has no initialize exchange, transport session, GET event
  stream, resumption, or protocol ping. Modern readiness is local fenced lifecycle
  state plus an allowed idempotent operation when remote validation is needed. An
  era-specific legacy ping may remain private to the legacy path.
- The canonical v2 client handles modern and initialize-era Streamable HTTP. Very-old
  SSE fallback is attempted only after HTTP `400`, `404`, or `405` with a body that is
  empty or is not a recognized modern JSON-RPC error, never for authentication
  failures, timeouts, or arbitrary server errors. Do not add a v1 outbound adapter
  unless a conformance test proves an incompatibility and the user explicitly approves
  the new seam.
- Public client result types are normalized SDK values; do not depend on a visible wire
  `resultType: 'complete'`. Final server information is metadata/accessor state and is
  never an authentication, authorization, cache-partition, or runtime-identity key.
- The SDK owns negotiation, validation, framing, transport cancellation, and response
  caching. Sentris owns authorization partitioning, lifecycle leases/fencing, bounded
  retries, monotonic/rate-limited progress, durable attempts, and unknown-outcome
  classification.
- MCP Tasks remain deferred until maintained official TypeScript support exists.

## Official primary sources

- [Client v2.0.0 release](https://github.com/modelcontextprotocol/typescript-sdk/releases/tag/%40modelcontextprotocol%2Fclient%402.0.0)
- [Server v2.0.0 release](https://github.com/modelcontextprotocol/typescript-sdk/releases/tag/%40modelcontextprotocol%2Fserver%402.0.0)
- [Upgrade to MCP TypeScript SDK v2](https://ts.sdk.modelcontextprotocol.io/v2/migration/upgrade-to-v2)
- [Support MCP protocol version 2026-07-28](https://ts.sdk.modelcontextprotocol.io/v2/migration/support-2026-07-28)
- [Protocol-version negotiation](https://ts.sdk.modelcontextprotocol.io/v2/protocol-versions)
- [Gateway and prior-discovery guidance](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/advanced/gateway.md)
- [MCP client API](https://ts.sdk.modelcontextprotocol.io/v2/api/%40modelcontextprotocol/client/client/client.html)
- [Streamable HTTP transport](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http)
- [MCP 2026-07-28 changelog](https://modelcontextprotocol.io/specification/2026-07-28/changelog)
