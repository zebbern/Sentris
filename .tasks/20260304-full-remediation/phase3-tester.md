# Agent: tester

## Purpose

Test the health endpoints for both backend and worker, and verify correlation ID propagation.

## Skills

Load before starting: testing-patterns

## Subtasks

### Backend health endpoint tests

- [ ] Write unit tests for `HealthController` — verify `/health` returns 200 with `{ status: "ok" }` shape
- [ ] Write unit tests for `/health/ready` — mock the health indicators (Postgres, Redis, Temporal) and verify:
  - All healthy → 200 with each check marked "up"
  - Postgres down → 503 with Postgres check marked "down", others still checked
  - Redis down → 503 with Redis check marked "down"
  - Temporal down → 503 with Temporal check marked "down"
- [ ] Verify health endpoints are public (no auth required) and skip rate limiting

### Backend correlation ID tests

- [ ] Write unit tests for the correlation ID middleware:
  - Request with `X-Request-Id` header → same value passed through to response
  - Request without `X-Request-Id` → UUID v4 generated and set on response
  - Correlation ID is attached to `req['correlationId']` for downstream use
- [ ] Write a test verifying the `LoggingInterceptor` includes the correlation ID in log output
- [ ] Write a test verifying Kafka message headers include `X-Request-Id` when a correlation ID is present on the request

### Worker health endpoint tests

- [ ] Write unit tests for the worker health server:
  - When all checks pass (Temporal alive, Docker socket accessible, Redis pingable) → 200 with all checks "up"
  - When Temporal connection is dead → 503 with Temporal check "down"
  - When Docker socket is missing → 503 with Docker check "down" (or skipped on Windows)
  - When Redis is not configured → 200 with Redis check "not_configured"
- [ ] Verify the health server handles unknown routes (e.g., `GET /foo`) with 404
- [ ] Verify the health server shuts down cleanly when `close()` is called

### Integration tests (if dev environment available)

- [ ] Add an E2E test that hits `GET /api/health` on a running backend instance and asserts the response shape
- [ ] Add an E2E test that hits `GET /api/health/ready` and asserts all infrastructure checks pass
- [ ] Add an E2E test that sends a request with `X-Request-Id: test-123` and verifies the response header echoes it back

## Notes

- Existing integration test at `backend/src/__tests__/backend-integration.test.ts` already has a `Health Check` describe block — new tests should complement or replace those tests.
- Backend tests use Vitest (`bun test --cwd backend`). Worker tests also use Vitest (`bun test --cwd worker`).
- For unit tests, mock the health indicators rather than requiring live Postgres/Redis/Temporal connections.
- The tester agent depends on the implementer-health and implementer-worker-health agents completing first. If those agents have not finished, write tests based on the expected interface contracts defined in the subtask descriptions above.
- Place backend health tests in `backend/src/health/__tests__/health.controller.spec.ts`.
- Place worker health tests in `worker/src/health/__tests__/health-server.spec.ts`.
- Place correlation ID middleware tests in `backend/src/common/middleware/__tests__/correlation-id.middleware.spec.ts`.

## Completion Summary

<!-- Appended by orchestrator after agent completes. Do not fill manually. -->
