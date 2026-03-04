# Triage: Phase 1 — S0 Critical Fixes

## EXECUTION_PLAN

### Phase 1: S0 Critical Fixes (Blocking)

| Step | Agent              | Task                                                                                     | Dependencies |
| ---- | ------------------ | ---------------------------------------------------------------------------------------- | ------------ |
| 1a   | error-fixer        | Fix MCP tool calling (Bug 10): convert raw JSON Schema → Zod in `mcp-gateway.service.ts` | —            |
| 1b   | docker             | Harden Docker: enable TLS on DinD, remove hardcoded `SECRET_STORE_MASTER_KEY` fallback   | —            |
| 1c   | dependency-auditor | Audit vulnerable direct deps (read-only assessment)                                      | —            |
| 1d   | implementer-deps   | Execute dependency upgrades from auditor output                                          | 1c           |
| 1e   | tester             | Verify MCP tool calling fix with integration test                                        | 1a           |

### Known Issues

- **Bug 10**: `mcp-gateway.service.ts` passes raw JSON Schema where McpServer expects Zod schemas → `safeParseAsync` crash
- **DinD**: `docker/docker-compose.full.yml` runs privileged with `DOCKER_TLS_CERTDIR=` (TLS disabled), `tcp://0.0.0.0:2375`
- **Hardcoded secret**: `SECRET_STORE_MASTER_KEY` has hardcoded fallback `abcdefghijklmnopqrstuvwxyz012345`
- **Vulnerable deps**: `@modelcontextprotocol/sdk` ≤1.25.3, `multer` 2.0.2, `fast-xml-parser` 4.5.3 (transitive via minio)
