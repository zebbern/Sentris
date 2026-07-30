# ADR: Explicit Self-Hosted Trust Profiles

## Status

**Accepted** — 2026-07-26

## Context

Sentris Flow serves two materially different self-hosting cases:

1. A single trusted operator runs the stack on a workstation or private server
   and expects broad scanner, Docker, HTTP, MCP, and local-administration
   capability.
2. Multiple authenticated users or organizations share a deployment and must
   not be able to exercise another tenant's credentials, data, or execution
   authority.

Treating the first case as hostile by default makes the open-source product
needlessly difficult to use. Treating the second case as a larger version of a
local install leaves implicit host and null-tenant capabilities reachable by
untrusted users. A security control is acceptable only when its reduction in
realistic risk justifies its capability, latency, and operational cost.

## Decision

Sentris Flow has two explicit runtime trust profiles:

| Property                                           | `trusted-local`                              | `hardened`                                             |
| -------------------------------------------------- | -------------------------------------------- | ------------------------------------------------------ |
| Intended operators                                 | One trusted administrator                    | Untrusted users and/or multiple organizations          |
| Authentication                                     | Local or external authentication             | External authentication with an active organization    |
| Null-owned legacy resources                        | Available only to the trusted local operator | Never used as an organization fallback                 |
| Worker-host stdio MCP                              | Explicit per-capability opt-in               | Disabled                                               |
| HTTP and scanner egress                            | Available, with observable component policy  | Available, with observable component policy            |
| Docker components                                  | Available                                    | Available through the supported isolated DIND topology |
| Tenant checks                                      | Enforced                                     | Enforced, with two-tenant negative tests               |
| Ambient application credentials in child processes | Forbidden                                    | Forbidden                                              |

The resolved profile is visible at startup and in diagnostics. Development
tooling and the single-admin all-in-one container example explicitly select
`trusted-local`; hardened deployment examples select `hardened` together with
external organization authentication. An explicit setting takes precedence. A
missing setting resolves to `trusted-local` in development and `hardened` in
production, while the local all-in-one example remains straightforward through
its explicit trusted-local setting.

The profile supplies defaults, not a second authorization system. Public API
ownership still comes from authenticated context, and worker resource access
still uses exact organization and run scope in both profiles. Narrow capability
flags may further restrict a profile. They may not silently broaden
`hardened`, and insecure combinations fail during configuration validation.

`MCP_DISCOVERY_TRUSTED_LOCAL_STDIO=true` is one such capability. It permits
local stdio discovery only in the `trusted-local` profile, uses a minimal child
environment, and exposes its temporary proxy on loopback only. HTTP MCP,
container MCP, raw HTTP workflows, public-network scanners, and Docker
components remain supported rather than being globally disabled.

Authorization is checked at ingress and represented as an immutable scoped
service or capability downstream. This avoids a remote policy lookup on each
component operation and keeps the expected steady-state performance cost below
the platform's 10% regression budget.

## Consequences

### Positive

- Local self-hosting retains the features that make a security orchestration
  platform useful.
- Multi-user deployments have a documented fail-closed boundary instead of
  relying on local-install assumptions.
- Operators can understand and audit why a capability was allowed.
- Exact tenant checks apply consistently without adding a per-operation network
  round trip.

### Negative

- Documentation and release tests must exercise both profiles.
- Some existing environment defaults and null-tenant compatibility paths need
  migration.
- A trusted-local installation intentionally accepts more host authority; it
  must not be advertised as an isolation boundary between mutually untrusted
  users.

### Neutral

- The profiles do not decide which external targets an operator is authorized
  to scan. They only define platform trust and capability boundaries.

## Failure Modes and Required Verification

- Startup rejects host-stdio enablement under `hardened`.
- Foreign organization names and UUIDs fail identically to missing resources.
- Null organization matches only null-owned resources.
- Profile tests prove legitimate HTTP, scanner, Docker, MCP, integration, and
  local-admin paths still work.
- Before/after API, workflow, component-startup, and frontend measurements stay
  inside the 10% performance budget.

## Alternatives Considered

**One maximally restrictive profile**

- Rejected because blanket host, Docker, or network restrictions remove useful
  local capabilities without a corresponding asset boundary in a
  single-operator install.

**One permissive profile with documentation warnings**

- Rejected because warnings do not contain credential or tenant compromise in
  a shared deployment.

**Infer all policy from the authentication provider**

- Rejected because authentication choice is not a complete threat model and
  implicit inference is difficult for operators to audit.

## References

- `docs/goals/self-hosted-platform-readiness.md`
- `docs/architecture/adr-worker-capability-and-credential-boundaries.md`
- `docs/architecture/adr-supported-docker-dind-topology.md`
