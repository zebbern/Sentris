# ADR: Supported Production Docker-in-Docker Topology

## Status

**Accepted; production smoke evidence pending** — 2026-07-26

## Context

Security components depend on Docker for mature scanners and need public
network access, file inputs, and output collection. Mounting the host Docker
socket gives the worker host-root-equivalent authority. The previous
production compose also mounted the DIND certificate volume at incompatible
paths: DIND generated client material under `/certs/client`, while the worker
mounted the named-volume root at that path.

The generic component runner created its input and output under the worker's
operating-system temp directory and passed that path to `docker run -v`. A
remote DIND daemon resolves bind sources in the daemon container's filesystem,
not the worker container's filesystem, so the path did not exist there. This
was the root cause of generic component file exchange failing under DIND.

A blanket Docker or network ban would remove core platform capability. The
supported topology must isolate daemon authority and run data while remaining
compatible with scanners and avoiding a global lock or per-execution helper
containers.

## Decision

The supported containerized production topology is:

```text
backend -> Temporal -> unprivileged worker
                         |
                         | Docker API over mTLS
                         v
          egress-capable Docker control network
                         |
                         v
                 dedicated privileged DIND
                         |
                         v
              run-scoped scanner containers
```

The DIND daemon is the only privileged application container. Its API is not
published on a host port. Only DIND and the worker join the named
`docker-control` bridge. That bridge is deliberately not `internal`: DIND and
the inner bridge networks it creates must retain outbound connectivity for
public-network scanners. Other application services remain off the control
network.

DIND generates its CA and client certificates in separate named volumes
mounted at `/certs/ca` and `/certs/client`. The worker receives only the client
volume, read-only, at `/certs/client` and uses `DOCKER_HOST`,
`DOCKER_TLS_VERIFY`, and `DOCKER_CERT_PATH`. The worker never receives the host
Docker socket or DIND daemon storage.

Generic component file exchange uses the outer `dind_io` named volume mounted
at the same absolute path, `/sentris-docker-io`, in the worker and DIND. Each
execution creates an independent directory under `runs/` and a managed
metadata record under `metadata/`. Metadata is written before the directory so
a worker exit cannot leave an untracked directory. Only that run-scoped
directory is bind-mounted into the inner component container. Opaque resource
IDs keep nested workflow identifiers out of filesystem paths, while metadata
retains the owning run ID. The runner still starts one scanner container and
uses no global serialization point or helper container, preserving the
previous launch shape.

Scanner-specific `IsolatedContainerVolume` instances remain inner named
volumes labeled with `studio.managed=true` and `studio.run=<run-id>`.
Components retain their declared network mode: scanners and HTTP components
may use bridge networking, while components that need no network continue to
use `none`. No inbound port is published unless a component contract asks for
one.

## Health and Reconciliation

`GET /health` is process-only liveness. `GET /health/ready` is dependency-aware
readiness and returns HTTP 503 when the worker is not accepting Temporal work,
maintenance reconciliation has failed, or a required configured dependency is
unavailable.

Production readiness covers:

- Temporal system service;
- Docker API through the configured `DOCKER_HOST` and TLS environment;
- PostgreSQL;
- the configured MinIO bucket;
- Kafka;
- Redis when configured;
- backend health and the callback token when backend callbacks are configured.

Checks execute independently in parallel, have a three-second per-check
timeout, and share a five-second cache/in-flight request. A health-port bind
failure is fatal rather than being treated as a successful no-op.

The worker performs orphan reconciliation before accepting tasks and every 15
minutes afterward. A pass inventories at most 500 managed resources, ignores
resources younger than one hour, and removes at most 100 old inactive
resources in container-before-volume-before-exchange-directory order. These
bounds are operator-configurable.

Before deleting anything, the reconciler resolves every eligible run against
Temporal with a three-second lookup timeout. Running workflows are preserved.
Unknown, missing, or timed-out status responses fail closed, so no resource is
deleted when run state is uncertain. A Temporal `NOT_FOUND` response and known
terminal statuses are eligible for cleanup. Startup failures prevent worker
startup; periodic failures remain visible through readiness until a later pass
succeeds. Individual removal failures are aggregated and reported rather than
being returned as false success.

## Consequences

### Positive

- Compromising another application service does not expose the Docker API.
- The worker does not control the host Docker daemon.
- Generic file I/O resolves correctly in both the worker and DIND filesystems.
- Public-network scanners and `network: none` components retain their existing
  capability modes.
- Cleanup is bounded, active-run aware, fail-closed, and health-visible.
- Shared exchange setup adds only directory and metadata operations; it does
  not add an extra container launch.

### Negative

- DIND remains privileged and is a high-value internal service.
- The worker holds a client credential with full authority over the dedicated
  DIND daemon.
- TLS bootstrapping, daemon storage, shared exchange metadata, and
  reconciliation add operational complexity.
- The shared exchange directory is writable by the worker account to support
  nonroot scanner images; isolation relies on mounting only the selected
  run-scoped directory into each inner container.

### Evidence Boundary

Static topology and unit tests cover certificate mounts, network membership,
readiness semantics, callback URL normalization, DIND-visible I/O workspace
creation, resource ordering/bounds, active-run preservation, and failure
visibility. No live production-compose DIND round-trip or before/after startup
benchmark has run yet, so production functionality and the 10% performance
budget remain unproved.

## Failure Modes and Required Live Verification

- The Docker API is not host-published and rejects clients without the
  generated certificate.
- Production worker readiness fails when DIND or another required dependency
  is unavailable and recovers after the dependency returns.
- A generic Docker component round-trips input/output through DIND.
- Cancellation, component failure, and worker restart leave no unreconciled
  run-scoped containers, inner volumes, or exchange directories.
- An active workflow with an old resource is not cleaned.
- Representative component startup median and p95 stay within 10% of the
  accepted baseline, or an exception receives explicit user approval.
- Tests exercise both an egress-enabled scanner and a no-network component.

## Alternatives Considered

**Mount `/var/run/docker.sock` into the worker**

Rejected because it grants control over the host daemon and breaks a meaningful
containment boundary.

**Make the Docker control network internal**

Rejected because DIND and the inner bridge networks it creates would lose
required scanner egress.

**Disable Docker or force `network: none` for every component**

Rejected because it would eliminate many of the platform's scanners and HTTP
workflows.

**Use worker temp bind mounts**

Rejected because bind sources are resolved by DIND and worker-only paths do not
exist in the daemon filesystem.

**Use a helper container or global named exchange volume per call**

Rejected because it would add launch overhead or a serialization bottleneck.
The selected outer named volume contains independently scoped run directories.

**Rootless DIND**

Deferred. It reduces daemon privilege but still needs representative scanner,
filesystem, and performance compatibility evidence.

**Kubernetes jobs or a remote executor**

Deferred as an additional executor. Requiring it would make local self-hosting
substantially heavier.

## References

- `Dockerfile`
- `docker/docker-compose.full.yml`
- `packages/component-sdk/src/docker-io-workspace.ts`
- `packages/component-sdk/src/runner.ts`
- `worker/src/health/health-server.ts`
- `worker/src/health/readiness-checks.ts`
- `worker/src/utils/orphan-reconciler.ts`
- `worker/src/temporal/workers/dev.worker.ts`
- `docs/development/isolated-volumes.mdx`
- `docs/architecture/adr-self-hosted-trust-profiles.md`
