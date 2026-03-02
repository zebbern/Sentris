# Agent: tester-backend-common

## Purpose

Create unit tests for all untested modules in `backend/src/common/`: AllExceptionsFilter, LoggingInterceptor, KafkaTopicResolver, postgres-error utilities, and crypto-utils.

## Skills

Load before starting: testing-patterns

## Subtasks

### AllExceptionsFilter (`backend/src/common/__tests__/all-exceptions.filter.spec.ts`)

- [x] Create test file with bun:test imports and mock setup for ConfigService, Request, Response
- [x] Test that HttpException is passed through with original status code and response body preserved
- [x] Test that HttpException with string response body produces correct JSON structure (statusCode, message, error, timestamp, path)
- [x] Test that HttpException with object response body merges timestamp and path into the response
- [x] Test that unknown errors return 500 with generic "Internal server error" message when `isProduction=true`
- [x] Test that unknown errors include `message` and `stack` in response body when `isProduction=false`
- [x] Test the SSE/streaming path: when `response.headersSent=true`, call `response.end()` instead of sending JSON
- [x] Test that 5xx errors are logged via `logger.error` and 4xx via `logger.warn`

### LoggingInterceptor (`backend/src/common/__tests__/logging.interceptor.spec.ts`)

- [x] Create test file with mock ExecutionContext, CallHandler, Request, Response
- [x] Test that successful requests log `{method} {url} {statusCode} — {duration}ms` via `logger.log`
- [x] Test that failed requests (HttpException) log the exception status via `logger.warn`
- [x] Test that failed requests (non-HttpException) log status 500 via `logger.warn`
- [x] Test that non-HTTP context types pass through without logging (returns `next.handle()` directly)

### KafkaTopicResolver (`backend/src/common/__tests__/kafka-topic-resolver.spec.ts`)

- [x] Test default topic names when no config is provided (`telemetry.logs`, `telemetry.events`, `telemetry.agent-trace`, `telemetry.node-io`)
- [x] Test that `resolveTopic` returns the base topic name when `enableInstanceSuffix=false` or `instanceId` is not set
- [x] Test that `resolveTopic` appends `.instance-{id}` when both `enableInstanceSuffix=true` and `instanceId` are set
- [x] Test each getter method (`getLogsTopic`, `getEventsTopic`, `getAgentTraceTopic`, `getNodeIOTopic`) with and without instance suffix
- [x] Test `isInstanceIsolated()` returns correct boolean
- [x] Test custom topic names via config override
- [x] Test singleton pattern: `getTopicResolver()` returns the same instance on repeated calls
- [x] Test `resetTopicResolver()` clears the singleton so a new instance is created on next call

### postgres-error (`backend/src/common/__tests__/postgres-error.spec.ts`)

- [x] Test `getPostgresErrorCode` extracts `.code` from a direct error object
- [x] Test `getPostgresErrorCode` extracts `.cause.code` from a DrizzleQueryError-style wrapper
- [x] Test `getPostgresErrorCode` returns `undefined` for null, undefined, non-object, and objects without `.code`
- [x] Test `PG_ERROR` constants have correct SQLSTATE values (`UNIQUE_VIOLATION=23505`, `FOREIGN_KEY_VIOLATION=23503`)

### crypto-utils (`backend/src/common/__tests__/crypto-utils.spec.ts`)

- [x] Test `timingSafeCompare` returns `true` for identical strings
- [x] Test `timingSafeCompare` returns `false` for different strings of same length
- [x] Test `timingSafeCompare` returns `false` for strings of different lengths
- [x] Test `timingSafeCompare` with empty strings (both empty = true)

## Notes

- Convention: `bun:test` with `vi.fn()`, `describe/it/expect`.
- AllExceptionsFilter requires mocking `ConfigService.get('app')` to control `isProduction`.
- For the filter and interceptor, mock Express `Request`/`Response` objects (plain objects with the properties accessed by the SUT).
- `resetTopicResolver()` must be called in `beforeEach` to ensure test isolation for singleton tests.

## Completion Summary

<!-- Appended by orchestrator after agent completes. Do not fill manually. -->
