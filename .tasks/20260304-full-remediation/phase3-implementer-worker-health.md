# Agent: implementer-worker-health

## Purpose

Add a minimal HTTP health server to the Temporal worker process so PM2, Docker, and load balancers can check worker liveness.

## Skills

Load before starting: none

## Subtasks

### Add WORKER_HEALTH_PORT to env config

- [x] Add `WORKER_HEALTH_PORT` to `worker/src/config/env.schema.ts` as an optional number with a sensible default (e.g., `9100`)
- [x] Document the new env var in `worker/.env.example` (or create one if it doesn't exist)

### Create a lightweight HTTP health server

- [x] Create `worker/src/health/health-server.ts` — a plain `http.createServer` (no Express/Fastify, keep deps minimal) that serves:
  - `GET /health` — returns 200 with JSON `{ status: "ok", service: "sentris-worker", timestamp, checks: {...} }` if all checks pass, or 503 with failed check details
- [x] Implement a Temporal connection check: verify the `NativeConnection` is alive (pass the connection reference from `dev.worker.ts` main function)
- [x] Implement a Docker socket check: verify `/var/run/docker.sock` is accessible (the worker runs Docker containers for component execution). On Windows dev, skip this check gracefully if the socket doesn't exist.
- [x] Implement a Redis check (if `TERMINAL_REDIS_URL` is configured): ping the terminal Redis connection. If Redis is not configured, skip the check and report as "not_configured"
- [x] The health server must handle errors gracefully — if any check throws, report it as unhealthy but don't crash the health server
- [x] The health server must support graceful shutdown — close the HTTP server when the worker receives SIGTERM/SIGINT

### Wire health server into the worker lifecycle

- [x] In `worker/src/temporal/workers/dev.worker.ts`, start the health server after Temporal connection is established and services are initialized
- [x] Pass the Temporal `NativeConnection` reference and the terminal Redis instance (from `kafka.terminalRedis`) to the health server
- [x] Register the health server for cleanup in the `finally` block alongside the other resources
- [x] Log the health server port on startup: `✅ Health server listening on port ${port}`

### Wire into PM2 health check config

- [x] In `pm2.config.cjs`, add the `WORKER_HEALTH_PORT` env var to the worker app config (derive port from instance number to avoid collisions: e.g., `9100 + instanceNum`)
- [x] If PM2 supports `listen_timeout` or `ready` signals, configure them to use the health endpoint

### Verification

- [x] Run worker tests: `bun test --cwd worker` — ensure no regressions
- [x] Run typecheck: `bun run typecheck` — ensure no type errors
- [ ] Manually verify (if dev environment available): start the worker, then `curl http://localhost:9100/health` returns health status JSON

## Notes

- The worker currently has NO HTTP server — it is a pure Temporal worker that connects to Temporal and processes tasks. The health server is additive.
- The worker already has a file-based heartbeat (`logHeartbeat` in `utils/debug-logger.ts`) on a 15-second interval — the HTTP health server is a more standard alternative for infrastructure monitoring.
- Use `node:http` only — no framework dependencies. The worker's `package.json` should not grow for a health endpoint.
- The worker's `main()` function in `dev.worker.ts` creates `connection` (NativeConnection), `pool` (Postgres), and `kafka.terminalRedis` (optional Redis). These can be checked by the health server.
- PM2 instance numbering: worker apps are named `sentris-worker-${instanceNum}`. Health port should be per-instance to avoid port conflicts: `WORKER_HEALTH_PORT = 9100 + instanceNum * 100` (matching the existing port offset pattern: frontend=5173+N*100, backend=3211+N*100).
- Docker socket path: Linux/macOS = `/var/run/docker.sock`, Windows = `//./pipe/docker_engine`. Check platform.

## Completion Summary

<!-- Appended by orchestrator after agent completes. Do not fill manually. -->
