# Agent: docker

## Purpose

Harden Docker configuration: enable TLS on Docker-in-Docker service, remove hardcoded `SECRET_STORE_MASTER_KEY` fallback value, and audit other secrets with insecure defaults in production compose files.

## Skills

Load before starting: none

## Subtasks

### DinD TLS Hardening

- [x] In `docker/docker-compose.full.yml`, update the `dind` service: change `DOCKER_TLS_CERTDIR=` (empty = disabled) to `DOCKER_TLS_CERTDIR=/certs` to enable automatic TLS certificate generation
- [x] In `docker/docker-compose.full.yml`, update the `dind` service command: change `--host=tcp://0.0.0.0:2375` to `--host=tcp://0.0.0.0:2376` (TLS port)
- [x] Add a shared volume for DinD TLS certs (e.g., `dind_certs:/certs`) to the `dind` service and mount it in the `worker` service as read-only at `/certs/client`
- [x] In `docker/docker-compose.full.yml`, update the `worker` service environment: change `DOCKER_HOST=tcp://dind:2375` to `DOCKER_HOST=tcp://dind:2376` and add `DOCKER_TLS_VERIFY=1` and `DOCKER_CERT_PATH=/certs/client`
- [x] Add `dind_certs` to the `volumes:` section at the bottom of `docker-compose.full.yml`

### Secret Hardening

- [x] In `docker/docker-compose.full.yml`, change `SECRET_STORE_MASTER_KEY=${SECRET_STORE_MASTER_KEY:-abcdefghijklmnopqrstuvwxyz012345}` to `SECRET_STORE_MASTER_KEY=${SECRET_STORE_MASTER_KEY:?SECRET_STORE_MASTER_KEY is required}` so Docker Compose fails fast if the env var is not set
- [x] Verify `SESSION_SECRET` and `INTERNAL_SERVICE_TOKEN` defaults in `docker/docker-compose.full.yml` — currently they use `${VAR:-}` (empty string default). Change to `${VAR:?VAR is required}` for the backend service where `SESSION_SECRET` is used (empty session secret is insecure)
- [x] For `INTERNAL_SERVICE_TOKEN`, apply the same `${VAR:?VAR is required}` treatment in both `backend` and `worker` service definitions since it's used for worker→backend auth
- [x] Update `docker/PRODUCTION.md` with a note about required environment variables: `SECRET_STORE_MASTER_KEY`, `SESSION_SECRET`, `INTERNAL_SERVICE_TOKEN` must all be set before deploying

### Verification

- [x] Validate the modified `docker-compose.full.yml` syntax with `docker compose -f docker/docker-compose.full.yml config` (dry-run parse)
- [x] Confirm `docker/docker-compose.dev-ports.yml` and `docker/docker-compose.infra.yml` do NOT contain the `dind` service or `SECRET_STORE_MASTER_KEY` (they shouldn't — dev infra is separate)

## Notes

- The `dind` service runs as `privileged: true` (required for Docker-in-Docker). TLS mitigates the unauthenticated TCP exposure but does not remove the privileged requirement.
- Port 2375 is Docker's insecure port; 2376 is the TLS-secured port. The DinD image auto-generates certs when `DOCKER_TLS_CERTDIR` is set.
- The worker already uses `DOCKER_HOST=tcp://dind:2375` — this must be updated to `tcp://dind:2376` along with TLS env vars.
- `docker-compose.infra.yml` is the dev infrastructure stack and does NOT include `dind`, `backend`, `worker`, or `frontend` — those are only in `docker-compose.full.yml` (production). No changes needed in infra compose.
- `SESSION_SECRET=${SESSION_SECRET:-}` defaults to empty string, which means the session middleware may use an insecure default. Making it required is the correct fix.

## Completion Summary

<!-- Appended by orchestrator after agent completes. Do not fill manually. -->
