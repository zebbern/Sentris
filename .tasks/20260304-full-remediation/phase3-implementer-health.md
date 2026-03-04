# Agent: implementer-health

## Purpose

Add structured health checks to the NestJS backend using @nestjs/terminus, and add correlation ID middleware for request tracing across services.

## Skills

Load before starting: none

## Subtasks

### Install @nestjs/terminus

- [x] Add `@nestjs/terminus` to `backend/package.json` dependencies
- [x] Run `bun install` from workspace root to update lockfile
- [x] Verify the package resolves correctly by checking `bun.lock`

### Create HealthModule with infrastructure checks

- [x] Create `backend/src/health/health.module.ts` — import TerminusModule, HttpModule, and register health indicators
- [x] Create `backend/src/health/health.controller.ts` with two endpoints:
  - `GET /health` — liveness probe (always returns 200 if process is up)
  - `GET /health/ready` — readiness probe checking all downstream dependencies
- [x] Implement a Postgres health indicator — use Drizzle/pg pool to run a simple query (`SELECT 1`)
- [x] Implement a Redis health indicator — ping the Redis connection used by ThrottlerStorageRedisService (read `redis.url` from ConfigService)
- [x] Implement a Temporal health indicator — check Temporal connection via the TemporalService (call `describeNamespace` or equivalent lightweight RPC)
- [x] Register the HealthModule in `backend/src/app.module.ts` — add to the `coreModules` array
- [x] Migrate the existing `/health` endpoint from `AppController` to the new `HealthController` — remove `getHealth()` from `AppService` and the `@Get('/health')` handler from `AppController`
- [x] Mark the health endpoints as `@Public()` and `@SkipThrottle()` to match the existing `/health` behavior

### Add correlation ID middleware

- [x] Create `backend/src/common/middleware/correlation-id.middleware.ts` — a NestJS middleware that:
  - Reads `X-Request-Id` from the incoming request header
  - If absent, generates a new UUID v4
  - Sets `X-Request-Id` on the response header
  - Attaches the correlation ID to `req` (e.g., `req['correlationId']`) for downstream use
- [x] Register the middleware globally in `AppModule` by implementing `NestModule.configure()` and applying it to all routes
- [x] Update `LoggingInterceptor` in `backend/src/common/interceptors/logging.interceptor.ts` to include the correlation ID in log output (read from `req['correlationId']`)

### Propagate correlation IDs to Kafka

- [x] Identify where Kafka messages are published in the backend (search for KafkaProducer/publish calls)
  - **Finding**: The backend only _consumes_ Kafka messages (via `kafkajs` Consumer in `log-ingest`, `node-io-ingest`, `event-ingest`, `agent-trace-ingest`). There are no Kafka producer calls in the backend. No changes needed.
- [ ] ~~Add `X-Request-Id` as a Kafka message header when publishing events~~ — N/A: no producer exists
- [ ] ~~Document the header convention in a code comment~~ — N/A: no producer exists

### Propagate correlation IDs to Temporal

- [x] When starting Temporal workflows from the backend, pass the correlation ID as workflow search attribute or memo field
  - Added `correlationId` to `StartWorkflowOptions` interface; propagated via `memo['correlationId']`
- [x] Document how the worker can read the correlation ID from workflow metadata
  - Code comment in `temporal.service.ts` documents the convention: worker reads via `workflowInfo().memo`

### Verification

- [x] Run backend tests: `bun test --cwd backend` — 761 pass, 0 fail, 16 skip
- [x] Run typecheck: `bun run typecheck` — no new type errors (pre-existing worker build error unrelated to changes)
- [ ] Manually verify (if dev environment available): `curl http://localhost:3211/api/health` returns liveness, `curl http://localhost:3211/api/health/ready` returns dependency statuses

## Notes

- The existing `/health` endpoint in `AppController` returns `{ status: 'ok', service: 'sentris-backend', timestamp }` from `AppService.getHealth()`. This should be replaced, not duplicated.
- The backend already has a `LoggingInterceptor` at `backend/src/common/interceptors/logging.interceptor.ts` that logs `METHOD URL STATUS — DURATIONms`. The correlation ID should be added to this format.
- The backend already uses `correlationId` in its trace/logging system (see `backend/src/trace/types.ts` and `backend/src/logging/log-ingest.service.ts`). The new middleware should integrate with this existing concept, not create a parallel one.
- Redis is already used for throttler storage (`ThrottlerStorageRedisService` with `ioredis`). The health check can reuse or create a separate lightweight connection.
- The Temporal connection is managed through `backend/src/temporal/temporal.service.ts`.
- Health endpoints are commonly used by Docker HEALTHCHECK, Kubernetes probes, and PM2's `listen_timeout`/`ready` signals. Keep the response format standard (Terminus provides this).

## Completion Summary

<!-- Appended by orchestrator after agent completes. Do not fill manually. -->
