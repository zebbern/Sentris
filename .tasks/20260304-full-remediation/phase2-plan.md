# Plan: Phase 2 — Security Hardening

## Overview

Phase 2 addresses three security hardening items: SSRF protection for the HTTP Request component (user-controlled outbound requests), completing the exec()→spawn() migration in Docker-related activities (command injection surface reduction), and evaluating/replacing the abandoned kafkajs dependency. Phases 2a and 2b are independent and can run in parallel. Phase 2c (researcher) can also run in parallel. Phase 2d depends on 2c. Phase 2e reviews 2a and 2b after they complete.

## Architecture Decisions

| Decision                                                                                | Alternatives                                            | Rationale                                                                                                                                                                                                                                                                         |
| --------------------------------------------------------------------------------------- | ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Add SSRF protection at the component-sdk `instrumentedFetch` layer                      | Add validation only in the HTTP Request component       | Protecting at the SDK level covers all components that use `context.http.fetch()`, not just `http-request.ts`. Any component making outbound HTTP calls gets protection automatically.                                                                                            |
| Use DNS-resolved IP check (post-resolve, pre-connect) in addition to hostname blocklist | Hostname-only blocklist                                 | Hostname-only is vulnerable to DNS rebinding attacks where a domain resolves to 127.0.0.1 or 169.254.x.x. Post-resolution check catches this.                                                                                                                                     |
| Replace `exec()`/`execAsync()` with `execFile()` using array arguments                  | Use `spawn()` with streaming                            | `execFile()` is the right choice here: the current code uses `exec()` with `promisify` to capture stdout as a string. `execFile()` has the same callback/promise pattern but takes args as an array, preventing shell injection. `spawn()` would require streaming logic changes. |
| Evaluate kafkajs replacement before executing migration                                 | Replace immediately with @confluentinc/kafka-javascript | kafkajs has been abandoned since 2023 but is functional. The replacement needs careful evaluation for Redpanda compatibility and API surface differences before committing.                                                                                                       |

## Affected Files

| Action | File Path                                                  | Change Description                                                                  |
| ------ | ---------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| CREATE | `packages/component-sdk/src/http/ssrf-guard.ts`            | URL validation module: IP range blocklist, DNS resolution check, hostname blocklist |
| MODIFY | `packages/component-sdk/src/http/instrumented-fetch.ts`    | Integrate SSRF guard before `globalThis.fetch()` call                               |
| MODIFY | `packages/component-sdk/src/http/types.ts`                 | Add SSRF guard options type (allowlist overrides, enable/disable)                   |
| CREATE | `packages/component-sdk/src/__tests__/ssrf-guard.test.ts`  | Unit tests for the SSRF blocklist                                                   |
| MODIFY | `worker/src/temporal/activities/mcp.activity.ts`           | Replace 4 `execAsync()` calls with `execFile()` using array args                    |
| MODIFY | `worker/src/temporal/activities/mcp-discovery.activity.ts` | Replace 1 `execAsync()` call with `execFile()` using array args                     |
| MODIFY | `worker/package.json`                                      | Replace kafkajs dependency (if migration proceeds)                                  |
| MODIFY | `backend/package.json`                                     | Replace kafkajs dependency (if migration proceeds)                                  |
| MODIFY | `worker/src/adapters/kafka-*.adapter.ts`                   | Update imports/API calls (if migration proceeds)                                    |
| MODIFY | `backend/src/*/ingest.service.ts`                          | Update imports/API calls (if migration proceeds)                                    |

## Phases

| Phase | Agents                  | Purpose                                                     | Depends On |
| ----- | ----------------------- | ----------------------------------------------------------- | ---------- |
| 2a    | implementer             | SSRF protection in component-sdk and HTTP Request component | —          |
| 2b    | error-fixer             | Complete exec()→spawn() migration in mcp activities         | —          |
| 2c    | researcher              | Evaluate kafkajs replacement options                        | —          |
| 2d    | migration (implementer) | Execute kafkajs replacement                                 | 2c         |
| 2e    | code-reviewer           | Review SSRF blocklist and exec→spawn changes                | 2a, 2b     |

## Dependencies

- **2a, 2b, 2c** are independent and can run in parallel.
- **2d → 2c**: Migration can only proceed after researcher recommends a replacement and confirms Redpanda compatibility.
- **2e → 2a, 2b**: Code reviewer needs both security changes landed before reviewing.

## Risk Assessment

| Risk                                                  | Severity | Mitigation                                                                                                                                                   |
| ----------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| SSRF guard blocks legitimate internal service calls   | Medium   | Add configurable allowlist; internal service calls (e.g., `callInternalApi` in mcp.activity.ts) use raw `fetch`, not `context.http.fetch`, so are unaffected |
| DNS resolution check adds latency to HTTP requests    | Low      | Cache DNS resolution results; the check is one extra `dns.resolve()` call per unique hostname                                                                |
| exec→execFile migration breaks Docker command parsing | Medium   | Docker CLI uses simple argument patterns; validate with existing e2e tests                                                                                   |
| kafkajs replacement has incompatible API              | Medium   | Researcher evaluates API surface before migration; adapters use a thin wrapper pattern that isolates changes                                                 |
