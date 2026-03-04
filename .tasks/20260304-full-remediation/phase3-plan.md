# Plan: Phase 3 — Architecture & Observability

## Overview

Phase 3 addresses three scaling and observability gaps: (1) in-memory Maps in 3 backend services that prevent horizontal scaling, (2) no structured health checks or correlation IDs in the backend, and (3) the worker has no HTTP health endpoint for infrastructure monitoring. The architect designs the state migration strategy while two implementer tracks work in parallel on health/observability.

## Architecture Decisions

| Decision                                                | Alternatives                                      | Rationale                                                                                                                                            |
| ------------------------------------------------------- | ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Use @nestjs/terminus for backend health                 | Custom health controller, raw HTTP checks         | Terminus is the NestJS standard, provides structured health indicators and Kubernetes-compatible responses                                           |
| Plain `http.createServer` for worker health             | Express, Fastify, Hono                            | Worker should stay dependency-light; `node:http` adds zero deps for a single endpoint                                                                |
| Correlation ID via middleware + header propagation      | OpenTelemetry full tracing, custom logger context | Middleware is simpler than full OTEL (OTEL can be added later); X-Request-Id is industry standard                                                    |
| Architect designs state migration before implementation | Implement Redis immediately                       | In-memory Maps hold live protocol connections (MCP clients, SSE transports) that cannot be trivially serialized — design must precede implementation |

## Affected Files

| Action | File Path                                                    | Change Description                                          |
| ------ | ------------------------------------------------------------ | ----------------------------------------------------------- |
| CREATE | `backend/src/health/health.module.ts`                        | New NestJS health module with Terminus                      |
| CREATE | `backend/src/health/health.controller.ts`                    | /health and /health/ready endpoints                         |
| MODIFY | `backend/src/app.module.ts`                                  | Register HealthModule, remove old health from AppController |
| MODIFY | `backend/src/app.controller.ts`                              | Remove /health endpoint (moved to HealthController)         |
| MODIFY | `backend/src/app.service.ts`                                 | Remove getHealth() method                                   |
| CREATE | `backend/src/common/middleware/correlation-id.middleware.ts` | X-Request-Id middleware                                     |
| MODIFY | `backend/src/common/interceptors/logging.interceptor.ts`     | Include correlation ID in logs                              |
| CREATE | `worker/src/health/health-server.ts`                         | Lightweight HTTP health server                              |
| MODIFY | `worker/src/temporal/workers/dev.worker.ts`                  | Start health server, pass connection refs                   |
| MODIFY | `worker/src/config/env.schema.ts`                            | Add WORKER_HEALTH_PORT                                      |
| MODIFY | `pm2.config.cjs`                                             | Add WORKER_HEALTH_PORT to worker env                        |

## Phases

| Phase | Agents                    | Purpose                                                  | Depends On             |
| ----- | ------------------------- | -------------------------------------------------------- | ---------------------- |
| 3a    | architect                 | Design state externalization strategy for in-memory Maps | —                      |
| 3b    | implementer-health        | Backend health checks + correlation IDs                  | —                      |
| 3b    | implementer-worker-health | Worker HTTP health endpoint                              | —                      |
| 3c    | tester                    | Test health endpoints and correlation IDs                | 3b (both implementers) |

## Dependencies

- **3a (architect)** is independent — produces a design document only, no code changes.
- **3b (both implementers)** are independent of each other and of the architect — they can run in parallel.
- **3c (tester)** depends on both implementers completing before writing tests against their code.
- The architect's state migration design will be implemented in a future Phase 4 — not in this phase.

## Risk Assessment

- **Low risk**: Health endpoints are additive — they don't modify existing behavior, only add new endpoints.
- **Medium risk**: Removing the existing `/health` from `AppController` could break existing health checks (PM2, Docker HEALTHCHECK, nginx). Implementer must ensure the new `/health` endpoint is at the same path and returns a compatible response.
- **Low risk**: Correlation ID middleware is additive — it adds a header but doesn't change request processing logic.
- **Medium risk**: Worker health server adds a new port listener — must handle port conflicts in multi-instance dev (use instance-based port offsets).
