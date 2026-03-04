# Agent: dependency-auditor

## Purpose

Read-only assessment of three known vulnerable dependencies. Identify safe target versions, check for breaking changes, and document an upgrade plan for the implementer.

## Skills

Load before starting: dependency-audit

## Subtasks

### @modelcontextprotocol/sdk (GHSA-345p-7cg4-v4c7: cross-client data leak)

- [x] Verify current versions across all workspace packages: root `package.json` (`^1.25.3`), `worker/package.json` (`^1.25.1`), `packages/component-sdk/package.json` (`^1.25.2`), `docker/mcp-stdio-proxy/package.json` (`^1.25.3`)
- [x] Identify the minimum safe version that patches GHSA-345p-7cg4-v4c7 (expected: ≥1.26.0)
- [x] Review the changelog/release notes for breaking changes between 1.25.x → target version — pay attention to `McpServer.registerTool()` API, `Client`, `StreamableHTTPClientTransport`, and `ListToolsRequestSchema` imports used in `backend/src/mcp/mcp-gateway.service.ts`
- [x] Check if the fix for Bug 10 (removing `inputSchema` from `registerTool()`) is compatible with the target SDK version

### multer (GHSA-xf7r-hgr6-v32p, GHSA-v52c-386h-88mc: dual DoS)

- [x] Verify current version in `backend/package.json` (`^2.0.2`)
- [x] Identify the minimum safe version that patches both GHSA-xf7r-hgr6-v32p and GHSA-v52c-386h-88mc (expected: ≥2.1.0)
- [x] Review changelog for breaking changes between 2.0.x → target version — check if multer's Express middleware API changed

### fast-xml-parser (GHSA-m7jm-9gc2-mpf2: entity encoding bypass)

- [x] Confirm `fast-xml-parser` is NOT a direct dependency — it's transitive via `minio@8.0.6` (resolved as `fast-xml-parser@4.5.3` in `bun.lock`) and via `@aws-sdk/xml-builder` (resolved as `fast-xml-parser@5.2.5`)
- [x] Identify which version(s) are affected by GHSA-m7jm-9gc2-mpf2 and whether 4.5.3 or 5.2.5 are vulnerable
- [x] Determine the remediation strategy: update `minio` package to a version that pulls a patched `fast-xml-parser`, OR use `overrides`/`resolutions` in root `package.json` to force a patched version
- [x] Check if a newer `minio` package version exists that depends on a patched `fast-xml-parser`

### Upgrade Plan Document

- [x] Write a summary in this file's Notes section (or append below) with: target versions, breaking changes found (if any), recommended upgrade order, and any caveats for the implementer

## Notes

- This is a READ-ONLY agent. Do not modify any source code, `package.json`, or lock files.
- The `bun.lock` shows two `fast-xml-parser` versions: `4.5.3` (via `minio`) and `5.2.5` (via `@aws-sdk/xml-builder`). The auditor must determine which version(s) are affected.
- `@modelcontextprotocol/sdk` is used across 4 workspace packages — all must be upgraded together to avoid version mismatches.

---

## Upgrade Plan

### Dependency Audit Summary

**Status**: ACTION REQUIRED

### Vulnerabilities

| Package                     | Current                          | CVE            | Severity | Fix Version      | CVSS |
| --------------------------- | -------------------------------- | -------------- | -------- | ---------------- | ---- |
| `@modelcontextprotocol/sdk` | 1.25.3                           | CVE-2026-25536 | HIGH     | ≥1.26.0          | 7.1  |
| `multer`                    | 2.0.2                            | CVE-2026-3304  | HIGH     | ≥2.1.0           | 8.7  |
| `multer`                    | 2.0.2                            | CVE-2026-2359  | HIGH     | ≥2.1.0           | 8.7  |
| `fast-xml-parser`           | 4.5.3 (via minio)                | CVE-2026-25896 | CRITICAL | ≥4.5.4 or ≥5.3.5 | 9.3  |
| `fast-xml-parser`           | 5.2.5 (via @aws-sdk/xml-builder) | CVE-2026-25896 | CRITICAL | ≥5.3.5           | 9.3  |

### Detailed Findings

#### 1. `@modelcontextprotocol/sdk` → Target: `^1.26.0`

**Advisory**: GHSA-345p-7cg4-v4c7 — Cross-client data leak via shared server/transport instance reuse.

**Current versions in workspace**:
| Location | Spec | Resolved |
|----------|------|----------|
| Root `package.json` (devDeps) | `^1.25.3` | 1.25.3 |
| `worker/package.json` (deps) | `^1.25.1` | 1.25.3 |
| `packages/component-sdk/package.json` (devDeps) | `^1.25.2` | 1.25.3 |
| `docker/mcp-stdio-proxy/package.json` (deps) | `^1.25.3` | 1.25.3 |

**Breaking changes**: No public API shape changes. However, **v1.26.0 adds runtime guards that WILL break the current gateway code**:

1. `Protocol.connect()` throws if the protocol is already connected to a transport.
2. **Stateless `StreamableHTTPServerTransport.handleRequest()` throws if called more than once** — this directly affects `backend/src/mcp/mcp-gateway.controller.ts`.

**⚠️ CRITICAL compatibility issue in `mcp-gateway.controller.ts`**:
The controller creates a transport with `sessionIdGenerator: undefined` (stateless mode) at line ~100-103 but stores it in `this.transports` map and calls `handleRequest()` multiple times for subsequent GET/POST requests (lines ~148-151). In v1.26.0, the second call to `handleRequest()` will throw.

**Required code change**: Change `sessionIdGenerator: undefined` to `sessionIdGenerator: () => randomUUID()` in `mcp-gateway.controller.ts` line 101. This switches to stateful mode, which matches the existing caching pattern (one transport per session, reused for multiple requests). Import `randomUUID` from `crypto`.

**Other imports unaffected**: `McpServer`, `Client`, `StreamableHTTPClientTransport`, `ListToolsRequestSchema`, `ErrorCode`, `McpError`, `CallToolResult`, `isInitializeRequest`, `AuthInfo`, `Tool`, `AnySchema`, `ZodRawShapeCompat`, `StdioClientTransport` — all unchanged in v1.26.0.

**Bug 10 fix compatibility**: The planned fix (removing `inputSchema` from `registerTool()` config and overriding `ListTools` handler) is **fully compatible** with v1.26.0. The `registerTool()` API signature is unchanged.

#### 2. `multer` → Target: `^2.1.0`

**Advisories**:

- GHSA-xf7r-hgr6-v32p (CVE-2026-3304) — DoS via incomplete cleanup
- GHSA-v52c-386h-88mc (CVE-2026-2359) — DoS via resource exhaustion (dropped connection)

**Current version**: 2.0.2 (resolved in `bun.lock`)

**Locations**:

- `backend/package.json` direct dependency: `^2.0.2`
- `@nestjs/platform-express@10.4.22` transitive dependency: pinned `multer@2.0.2`

**Breaking changes**: **None**. v2.1.0 is a minor release. Changes:

- Dropped internal deps: `mkdirp`, `object-assign`, `xtend` (no public API impact)
- Added UTF-8 header support
- Security fixes for both CVEs
- Express middleware API is unchanged

**Complication**: `@nestjs/platform-express@10.4.22` pins `multer@2.0.2`. No newer v10.x release exists (v10.4.22 is the latest in the v10 line; NestJS v11 exists but is a major migration out of scope).

**Remediation**:

1. Update direct dep in `backend/package.json`: `"multer": "^2.1.0"`
2. Add `overrides` in root `package.json` to force the transitive dep:
   ```json
   "overrides": {
     "multer": ">=2.1.0"
   }
   ```
3. Multer is NOT directly imported in backend source code (no `import multer` found). It is used exclusively through NestJS decorators (`@UseInterceptors(FileInterceptor(...))` etc.), so the public API compatibility is all that matters — and it's unchanged.

#### 3. `fast-xml-parser` → Transitive only (via `minio` and `@aws-sdk/xml-builder`)

**Advisory**: GHSA-m7jm-9gc2-mpf2 (CVE-2026-25896) — Entity encoding bypass via regex injection in DOCTYPE entity names. **CRITICAL 9.3 CVSS**.

**Affected ranges**: `>=4.1.3, <4.5.4` AND `>=5.0.0, <5.3.5`

**Current versions (BOTH vulnerable)**:
| Version | Consumer | Via |
|---------|----------|-----|
| 4.5.3 | `minio@8.0.6` | `backend/package.json` and `worker/package.json` |
| 5.2.5 | `@aws-sdk/xml-builder@3.972.2` | `@aws-sdk/client-s3@^3.975.0` in `worker/package.json` |

**Remediation strategy** (two-step):

**Step 1 — Update `minio`**: Upgrade from `^8.0.6` to `^8.0.7` in both `backend/package.json` and `worker/package.json`.

- `minio@8.0.7` (released 4 days ago) bumped `fast-xml-parser` from `4.4.1` to `5.3.6` (patched).
- This is a bug-fix release. The `minio` public API is unchanged. No breaking changes.
- Also removes `@types/minio` need (built-in types since `minio>7.1.0`), but the project still has `@types/minio` in backend devDeps. Can be removed separately.

**Step 2 — Override for `@aws-sdk/xml-builder`**: After minio update, both consumers use fast-xml-parser v5. Add override in root `package.json`:

```json
"overrides": {
  "fast-xml-parser": ">=5.3.5"
}
```

This forces `@aws-sdk/xml-builder@3.972.2` (which pins `fast-xml-parser@5.2.5`) to use `>=5.3.5`. Since fast-xml-parser 5.3.5 is a patch release (no breaking changes), this is safe.

Alternatively, updating `@aws-sdk/client-s3` to the latest version may pull in a newer `@aws-sdk/xml-builder` that already includes a patched `fast-xml-parser`. AWS SDK v3 releases frequently.

### Recommended Upgrade Order

1. **`multer` first** (lowest risk) — Minor version bump, no API changes, no code changes needed.
2. **`minio` second** (low risk) — Patch version bump, no API changes, resolves CRITICAL fast-xml-parser vuln.
3. **`fast-xml-parser` override third** — Add `overrides` in root `package.json` for remaining transitive instance.
4. **`@modelcontextprotocol/sdk` last** (requires code change) — Needs `sessionIdGenerator` fix in `mcp-gateway.controller.ts` before or simultaneous with the version bump.

### Combined `overrides` for root `package.json`

```json
{
  "overrides": {
    "multer": ">=2.1.0",
    "fast-xml-parser": ">=5.3.5"
  }
}
```

### Post-Upgrade Verification

- Run `bun install` to regenerate `bun.lock`
- Run `bun test` to verify no regressions
- Verify resolved versions: `grep -E "multer@|fast-xml-parser@|@modelcontextprotocol/sdk@" bun.lock`
- Run backend tests: `bun test --cwd backend`
- Run e2e MCP tests if available to validate the `sessionIdGenerator` change

## Completion Summary

<!-- Appended by orchestrator after agent completes. Do not fill manually. -->
