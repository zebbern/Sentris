# ADR: Worker Capability and Credential Boundaries

## Status

**Accepted** — 2026-07-26

## Context

The backend authorizes users and starts Temporal workflows. The worker executes
user-selected components that can read secrets and files, make network
requests, start containers, publish events, and call internal backend APIs.
Passing raw adapters or long-lived application credentials into component code
turns a component bug or malicious package into deployment-wide authority.

Per-call remote authorization would reduce that authority, but it adds latency
and a new availability dependency to every resource lookup. The boundary must
instead be established once and remain immutable throughout a run.

## Decision

The backend is the authority for user, organization, workflow, and run
ownership. At workflow start it creates an immutable execution context
containing at least:

- `organizationId`
- public Sentris `runId`
- Temporal workflow/run identifiers
- workflow version
- authenticated trigger identity when the initiating user is known

Temporal carries this context to the worker. The worker does not accept an
organization supplied by component parameters or event payloads when an
authorized run context already exists.

At an activity or event ingress, the worker binds shared database, MinIO, Kafka,
and secret clients once:

```text
raw adapter + authorized organization/run
                |
                v
immutable scoped capability -> component
```

Raw adapters reject resource operations until bound. A scoped capability cannot
be rebound to a different organization, including from an organization to the
null/trusted-local scope. Secret lookup constrains both the secret identity and
selected version. File lookup and overwrite constrain database ownership before
object-store I/O, and object keys are namespaced by organization. Errors and
completion events preserve the same organization and run context.

Components receive only the capabilities declared by their definition and
allowed by runtime policy. Network access is not universally denied:
public-network scanners and raw HTTP components retain egress, while components
that do not declare network access default to no network. Docker and MCP
capabilities follow their dedicated policies.

Application database credentials, master encryption keys, shared internal
tokens, cloud credentials, and the worker's full environment are never copied
into a child process. Explicit component secrets are passed only through the
narrowest supported mechanism and are redacted from telemetry.

`INTERNAL_SERVICE_TOKEN` is a deployment credential held only by the trusted
worker process. It authenticates worker-to-backend health and internal API
calls; it is never copied into a component container, host-stdio child, user
script, MCP server, or component input. Each internal resource request also
carries the authorized organization and, where applicable, the public run ID.
The backend resolves the run or resource with those exact ownership predicates
before returning data or accepting a callback.

This deliberately treats the worker as part of the trusted computing base. A
fully compromised worker already holds database connectivity and the secret
store master key, so replacing its service token with short-lived per-run
tokens would not contain that attacker. Per-run callback tokens may still be
added as defense in depth, but they are not used as a substitute for component
process isolation or exact resource ownership in this release.

Scope binding reuses existing clients and adds database predicates rather than
constructing clients or making policy network calls per resource operation.

## Consequences

### Positive

- A component cannot mint another tenant's file or secret capability.
- Authorization remains consistent across success, failure, Kafka spill, and
  callback paths.
- Legitimate scanners and integrations retain the connectivity and credentials
  they explicitly need.
- Client reuse keeps resource-access overhead small and measurable.

### Negative

- All worker ingress paths and component test fixtures must carry organization
  and run context.
- Legacy null-owned resources require an explicit trusted-local migration path.
- The long-lived worker service token has deployment-wide blast radius inside
  the already trusted worker process and must be rotated as a deployment secret.

### Neutral

- Temporal remains the durability mechanism; it is not the source of user
  authorization.

## Failure Modes and Required Verification

- Calling `forOrganization()` on an already scoped service cannot change scope.
- Foreign names and UUIDs, null-to-tenant, and tenant-to-null access fail
  closed.
- File overwrite races cannot replace another organization's database row or
  object.
- Failed activities and spilled Kafka messages retain organization and run
  ownership.
- Child-process environment tests enumerate allowed variables on Linux and
  Windows.
- Component containers, host-stdio children, user scripts, and MCP servers never
  receive `INTERNAL_SERVICE_TOKEN`.
- Internal run callbacks and reads reject an organization/run mismatch even
  after service-token authentication.
- Removing an ownership predicate or scope binding causes a regression test to
  fail.

## Alternatives Considered

**Expose raw adapters and ask components to pass organization IDs**

- Rejected because organization selection would remain attacker-controlled at
  the point of use.

**Call the backend authorization API for every file and secret access**

- Rejected as the default because it adds latency, load, and availability
  coupling without improving an already immutable run capability.

**Give every component the worker service token**

- Rejected because compromise of one component would grant deployment-wide
  backend authority.

**Issue a short-lived signed token for every run and operation**

- Deferred as defense in depth. It adds issuance, propagation, expiry,
  long-running-workflow renewal, and operator clock-skew failure modes. It does
  not contain a compromised worker because that process already has database
  and encryption authority. The selected boundary keeps the token out of every
  user-controlled child process and enforces organization/run ownership at the
  backend without adding a per-operation policy round trip.

**Disable secrets, files, networking, or Docker in shared deployments**

- Rejected because it would remove core orchestration capability. Narrow
  capabilities provide containment at lower product cost.

## References

- `docs/architecture/adr-self-hosted-trust-profiles.md`
- `docs/architecture/adr-supported-docker-dind-topology.md`
- `packages/component-sdk/src/interfaces.ts`
