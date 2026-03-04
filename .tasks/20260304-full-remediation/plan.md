# Plan: Phase 1 — S0 Critical Fixes

## Overview

Phase 1 addresses the highest-severity issues blocking production readiness: a crashing MCP tool-calling bug, Docker-in-Docker running without TLS, a hardcoded encryption master key fallback in the production compose file, and three vulnerable direct/transitive dependencies. Steps 1a, 1b, and 1c are independent and can run in parallel. Step 1d depends on 1c's audit output. Step 1e depends on 1a's fix.

## Architecture Decisions

| Decision                                                                                  | Alternatives                                                               | Rationale                                                                                                                                                                                                                                                                                                                                   |
| ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fix Bug 10 by removing `inputSchema` from `registerTool()` and patching ListTools handler | Convert JSON Schema to Zod at registration time using `json-schema-to-zod` | The existing fix in `mcp-gateway.service.ts` already implements the patch approach — it stores raw schemas in `externalToolSchemas` map and uses `patchListToolsWithExternalSchemas()`. The issue is the `z.object({}).passthrough()` placeholder still triggers `safeParseAsync`. Fix is to omit schema entirely from registerTool config. |
| Remove `SECRET_STORE_MASTER_KEY` default entirely (fail-fast on missing)                  | Generate a random key at startup                                           | Fail-fast is safer — a random key would lose access to previously encrypted data on restart. Operators must provide the key explicitly.                                                                                                                                                                                                     |
| Enable TLS on DinD via `DOCKER_TLS_CERTDIR=/certs`                                        | Use Unix socket mount instead of TCP                                       | TLS is the standard Docker recommendation for TCP-based DinD. Unix sockets would require container co-location.                                                                                                                                                                                                                             |

## Affected Files

| Action | File Path                                                          | Change Description                                                                                          |
| ------ | ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| MODIFY | `backend/src/mcp/mcp-gateway.service.ts`                           | Remove `inputSchema` from external tool `registerTool()` call; fix `z.object({}).passthrough()` placeholder |
| MODIFY | `docker/docker-compose.full.yml`                                   | Enable DinD TLS, remove hardcoded `SECRET_STORE_MASTER_KEY` default, update worker `DOCKER_HOST` to TLS     |
| MODIFY | `package.json` (root)                                              | Update `@modelcontextprotocol/sdk` version                                                                  |
| MODIFY | `worker/package.json`                                              | Update `@modelcontextprotocol/sdk` version                                                                  |
| MODIFY | `packages/component-sdk/package.json`                              | Update `@modelcontextprotocol/sdk` version                                                                  |
| MODIFY | `docker/mcp-stdio-proxy/package.json`                              | Update `@modelcontextprotocol/sdk` version                                                                  |
| MODIFY | `backend/package.json`                                             | Update `multer` version                                                                                     |
| CREATE | `backend/src/mcp/__tests__/mcp-external-tools.integration.spec.ts` | Integration test for external tool registration + calling                                                   |

## Phases

| Phase | Agents             | Purpose                           | Depends On |
| ----- | ------------------ | --------------------------------- | ---------- |
| 1a    | error-fixer        | Fix MCP tool calling (Bug 10)     | —          |
| 1b    | docker             | Docker security hardening         | —          |
| 1c    | dependency-auditor | Audit vulnerable deps (read-only) | —          |
| 1d    | implementer-deps   | Execute dependency upgrades       | 1c         |
| 1e    | tester             | Verify MCP tool calling fix       | 1a         |

## Dependencies

- **1d → 1c**: The implementer needs the auditor's safe target versions and breaking change analysis before upgrading.
- **1e → 1a**: The tester needs the Bug 10 fix landed before verifying it works.
- **1a, 1b, 1c** are independent and can run in parallel.

## Risk Assessment

| Risk                                                                                   | Severity | Mitigation                                                                                                      |
| -------------------------------------------------------------------------------------- | -------- | --------------------------------------------------------------------------------------------------------------- |
| `@modelcontextprotocol/sdk` upgrade may have breaking API changes                      | Medium   | Auditor checks changelog/migration guide before implementer upgrades                                            |
| Removing `SECRET_STORE_MASTER_KEY` default breaks existing deployments without env set | Low      | Only affects `docker-compose.full.yml` (production); dev compose files are separate. Document in PRODUCTION.md. |
| DinD TLS enablement may break worker Docker communication                              | Medium   | Update worker `DOCKER_HOST` to `tcp://dind:2376` and mount TLS certs volume                                     |
| `fast-xml-parser` is transitive (via `minio` package) — can't directly pin             | Low      | Use `overrides`/`resolutions` in root `package.json` or update `minio` package                                  |
