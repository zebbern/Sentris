# Agent: implementer (Findings Phase 2 — Backend Endpoints)

## Purpose

Add three new endpoints to the findings controller: single finding detail, CSV/JSON export, and severity stats aggregation.

## Skills

Load before starting: none

## Subtasks

### DTO Schemas (`backend/src/analytics/dto/`)

- [x] Create `findings-detail.dto.ts` with a `FindingIdParamSchema` (Zod schema validating `id` as a non-empty string) and a `FindingDetailResponseDto` that extends the existing `FindingItemSchema` but makes `raw` required (the detail view always returns the full document)
- [x] Create `findings-export.dto.ts` with a `FindingsExportQuerySchema` that extends `FindingsQuerySchema` (reuses severity, search, sortOrder filters) and adds a `format` field: `z.enum(['csv', 'json']).default('json')` and a `limit` field: `z.coerce.number().int().min(1).max(10000).default(1000)` — no pagination params since export fetches all matching results up to the limit
- [x] Create `findings-stats.dto.ts` with a `FindingsStatsResponseSchema` containing `severityCounts: z.array(z.object({ severity: z.string(), count: z.number() }))` and `total: z.number()`, plus a corresponding `FindingsStatsResponseDto` class

### `GET /findings/stats` endpoint (`backend/src/analytics/findings.controller.ts`)

- [x] Add a `getStats()` method decorated with `@Get('stats')` — this MUST be registered before the `:id` route so NestJS doesn't match "stats" as an ID parameter
- [x] Query `SecurityAnalyticsService.query()` with `size: 0` and a terms aggregation on the `severity` field (`aggs: { severity_counts: { terms: { field: 'severity', size: 10 } } }`)
- [x] Map the aggregation buckets to the `FindingsStatsResponseDto` shape: `{ severityCounts: [{ severity, count }], total }`
- [x] Apply the same auth checks as `listFindings` (require `auth.isAuthenticated` and `auth.organizationId`)
- [x] Record an `findings.stats` audit log entry
- [x] On OpenSearch errors or client disabled, return `{ severityCounts: [], total: 0 }` (graceful degradation, matching the existing pattern in `listFindings`)

### `GET /findings/export` endpoint (`backend/src/analytics/findings.controller.ts`)

- [x] Add a `exportFindings()` method decorated with `@Get('export')` — register before the `:id` route
- [x] Accept `FindingsExportQuerySchema` via `@Query()` with the `ZodValidationPipe`
- [x] Build the same OpenSearch DSL query as `listFindings` (reuse severity/search filter construction — consider extracting a `buildFindingsQuery()` private helper to avoid duplication with `listFindings`)
- [x] Query `SecurityAnalyticsService.query()` with `size: limit` (from the validated DTO, max 10000) and `from: 0`
- [x] For JSON format: set `Content-Type: application/json`, `Content-Disposition: attachment; filename="findings-export-{ISO timestamp}.json"`, and write the hits array as JSON
- [x] For CSV format: set `Content-Type: text/csv`, `Content-Disposition: attachment; filename="findings-export-{ISO timestamp}.csv"`. Generate CSV with columns: `id, timestamp, severity, name, asset_key, workflow_name, workflow_id, run_id, component_id, node_ref`. Escape values containing commas/quotes/newlines per RFC 4180
- [x] Apply the same auth checks. Record a `findings.export` audit log entry (include format and result count in metadata)
- [x] Apply a stricter rate limit than list: `@Throttle({ default: { limit: 10, ttl: 60000 } })`
- [x] On OpenSearch errors, throw an appropriate HttpException (500) rather than returning empty — exports should fail visibly

### `GET /findings/:id` endpoint (`backend/src/analytics/findings.controller.ts`)

- [x] Add a `getFinding()` method decorated with `@Get(':id')` — register AFTER the `stats` and `export` routes
- [x] Accept `id` via `@Param('id')` and validate it's a non-empty string (use the `FindingIdParamSchema`)
- [x] Query `SecurityAnalyticsService` — use the existing `query()` method with a `term: { _id: id }` filter and `size: 1` to fetch the document by its OpenSearch `_id`
- [x] If no hits returned, throw `NotFoundException` with message `Finding not found`
- [x] Map the single hit to `FindingDetailResponseDto` — include ALL `_source` fields in the `raw` property
- [x] Apply the same auth checks. Record a `findings.detail` audit log entry (include `findingId` in metadata)
- [x] On OpenSearch client disabled, throw `ServiceUnavailableException` with message `Analytics service is not available` (unlike the list endpoint, a detail lookup for a specific ID should not silently return nothing)

### Shared refactor

- [x] Extract the OpenSearch DSL query-building logic (severity filter, search multi_match) from `listFindings` into a `private buildFindingsFilter(query: { severity?: string; search?: string })` method on the controller (or a small utility) so it's reused by `listFindings`, `exportFindings`, and `getStats`

### OpenAPI / Client regeneration

- [x] After all endpoints are added, run `bun --cwd backend run generate:openapi` to update `openapi.json`
- [x] Run `bun --cwd packages/backend-client run generate` to regenerate the typed client

## Notes

- The `SecurityAnalyticsService.query()` method already accepts `aggs` — no changes needed to the service layer for stats.
- Route ordering matters in NestJS: static routes (`/stats`, `/export`) must be declared before parameterized routes (`/:id`). Declare `getStats()`, `exportFindings()`, then `getFinding()` in that order in the controller class.
- The `AuditLogService` is already injected in the controller — use the same `this.auditLogService.record()` pattern.
- CSV generation should be done in-memory (not streaming) since the max export is 10k rows — small enough to buffer. If a streaming approach is preferred later, it can be refactored.
- The index pattern `security-findings-{orgId}-*` is already handled by the service's `query()` method — no need to construct it in the controller.

## Completion Summary

<!-- Appended by orchestrator after agent completes. Do not fill manually. -->
