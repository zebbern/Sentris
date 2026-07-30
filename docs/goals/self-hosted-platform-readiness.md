## /goal: Ship Sentris Flow as a Trustworthy, Capable Self-Hosted Platform

**Category**: BUILD
**Scope**: Complete the validated tenant-boundary, production-runtime, migration,
findings-integrity, lifecycle-durability, target-operator-loop, and release-gate
work. Include implementation, tests, documentation, performance evidence, and
local/self-hosted verification. Exclude unrelated feature expansion, new
connector/scanner breadth, a managed SaaS control plane, theoretical maximal
hardening with no realistic asset impact, and external deployment or Git
publishing unless separately authorized.

### Objective

Sentris Flow is release-ready as a capable open-source, locally self-hostable
alternative to expensive security orchestration platforms: existing workflow,
scanner, Docker, MCP, HTTP, and integration capabilities remain usable;
realistic high-impact tenant and credential boundaries are enforced; production
execution and schema upgrades are deterministic; findings and lifecycle side
effects are trustworthy; and the Target → scoped run → asset/coverage delta →
finding → triage → rescan journey works end to end without a material
performance regression.

### Priority Order

1. Preserve useful security-automation capability and correct behavior.
2. Preserve or improve workflow throughput, latency, and operator responsiveness.
3. Keep trusted single-admin local operation straightforward.
4. Mitigate realistic attacks according to prerequisites, exploitability,
   reachable assets, and blast radius, with stricter controls available for
   multi-user/hardened self-hosting.
5. Improve maintainability and operations without speculative abstraction.

Security is risk-based, not maximal. A control that removes meaningful
capability or exceeds the performance budget is not acceptable merely because
it reduces attack surface.

### Success Criteria (verify ALL before returning)

- Architecture decisions define trusted-local versus multi-user/hardened trust
  assumptions, the backend/worker organization and run boundary, findings
  ownership and projection, and the supported Docker/DIND topology. Alternatives
  and capability/performance tradeoffs are recorded.
- Hosted-mode MCP discovery cannot execute arbitrary worker-host commands.
  Secret, file, OAuth connection, MCP group/server, API-key, and worker
  credential access is bound to authenticated organization, user, run, and
  resource ownership. Two-tenant tests prove foreign names and UUIDs fail closed.
- Existing legitimate execution modes remain available through explicit
  capability and policy controls rather than blanket bans. Public-network
  scanners, raw HTTP workflows, Docker components, MCP servers, and trusted-local
  administration each have a documented, tested path.
- Representative pre-change baselines exist. After implementation, median and
  p95 API latency, workflow duration/throughput, component startup overhead, and
  frontend critical-journey responsiveness remain within
  `[PERFORMANCE_BUDGET]` (default 10%) outside normal benchmark variance. Any
  exception has evidence, alternatives, and explicit user approval.
- Production verification starts a correctly configured worker, checks real
  readiness dependencies, completes a backend callback, round-trips one Docker
  component through the supported DIND topology, and cleans up run-scoped
  resources after cancellation or worker failure.
- An empty database and an upgrade from the previous supported release reach the
  same current schema using checked migrations only. Ambiguous ordering,
  uncontrolled production schema push, and backend/worker schema drift are
  removed or rejected automatically.
- Worker and backend share one versioned findings contract. Combined filters,
  pagination, totals, charts, exports, scope counts, and datasets above 10,000
  triaged findings agree. Dependency failure is unavailable/degraded, never a
  false zero. The active Phase 5 work has no silent hard cap.
- Terminal notifications, ticket synchronization, security-relevant audit
  events, and required telemetry are durable, idempotent, retryable, and
  reconcilable. Completion does not depend on client polling and does not
  duplicate after restart.
- Target rows and detail can launch scoped runs, including zero-input workflows.
  Run history is paginated and navigable; asset type and source-run views work;
  findings are scope-filtered and deep-linkable; rescan is reachable; and
  comparable-run observations distinguish not-scanned from not-observed.
- Frontend auth does not persist raw passwords or long-lived bearer tokens in
  localStorage. The active Clerk organization and role drive headers and query
  keys and fail closed on unknown roles. CSV export neutralizes formulas without
  corrupting ordinary values.
- The release gate builds frontend, backend, worker, and required images and
  runs lint, typecheck, unit tests, fresh/upgrade migrations, two-tenant tests,
  production-compose smoke, one Temporal workflow, one Docker round-trip, one
  telemetry-ingest assertion, and the target-to-triage critical journey on an
  explicitly selected `[SENTRIS_INSTANCE]`.
- Self-hosting documentation covers trust profiles, configuration, capability
  and egress controls, upgrades and rollback, backup and restore, health checks,
  performance expectations, and accepted residual risks. Architecture
  documentation matches implementation.
- Relevant existing tests pass; time-dependent tests use controlled clocks; the
  final worktree contains no accidental unrelated changes and preserves
  user-owned work.

### Constraints

- MUST NOT: remove, globally disable, or materially cripple scanners, Docker
  networking, MCP, HTTP flexibility, integrations, or local administration
  merely to simplify a security fix.
- MUST NOT: accept a change that breaks a supported workflow or exceeds the
  performance budget without evidence, lower-impact alternatives, and explicit
  user approval.
- MUST NOT: conflate trusted single-admin local use with an untrusted
  multi-tenant deployment.
- MUST NOT: report analytics failure, missing coverage, dropped telemetry, or
  truncation as a successful empty result.
- MUST NOT: fabricate benchmarks, test results, sources, credentials,
  exploitability, or verification evidence.
- MUST NOT: overwrite unrelated user changes, commit, push, rebase, reset,
  delete branches, deploy externally, or rotate credentials without explicit
  authorization.
- MUST: rank security work using demonstrated code reachability, attacker
  prerequisites, asset value, and blast radius. A theoretical issue may be
  documented and accepted when its mitigation costs more capability or
  performance than its realistic risk warrants.
- MUST: prefer narrowly scoped capabilities, tenant/run-bound credentials,
  explicit egress declarations, and observable policy decisions over universal
  prohibitions.
- MUST: reproduce or statically prove each root cause before patching, add
  regression tests in the existing style, and regenerate API contracts after
  backend route changes.
- MUST: check and explicitly select `[SENTRIS_INSTANCE]` before instance-dependent
  dev, E2E, database, or Temporal commands.
- LIMIT: add production dependencies only when the existing stack cannot meet a
  success criterion and the dependency's runtime, maintenance, performance, and
  self-hosting costs are justified.
- LIMIT: stop only when every criterion has independently reviewable evidence.
  If completion requires new authority or an unavoidable capability/performance
  tradeoff, stop at that decision and request direction instead of silently
  weakening the product.

### Output Specification

Deliver:

1. Scoped code, configuration, migrations, and tests implementing the criteria.
2. Repository-conventional architecture decisions for trust profiles, worker
   capability/credential flow, findings ownership/projection, and Docker
   production topology.
3. Updated self-hosting, migration, recovery, and architecture documentation.
4. A final report with: Outcome; Capability Preserved; Performance Baseline and
   Delta; Security Risks Fixed or Accepted; Data and Migration Evidence;
   Production Smoke Evidence; Critical-Journey Evidence; Commands and Results;
   Residual Risks; User-Owned Changes Preserved.
5. A criterion-by-criterion evidence matrix linking every success criterion to
   tests, commands, files, logs, or benchmark results.

### Verification Method

An independent reviewer can confirm completion by:

1. Reviewing the architecture decisions and evidence matrix.
2. Running the recorded lint, typecheck, unit, build, migration, two-tenant,
   compose, Temporal, Docker, telemetry, and critical-journey commands.
3. Comparing before/after benchmark artifacts against the performance budget.
4. Testing both trusted-local and multi-user/hardened self-hosted configurations.
5. Migrating both an empty database and the previous supported release.
6. Simulating dependency failure, restart, cancellation, duplicate delivery,
   foreign tenant identifiers, redirect/egress edge cases, and large datasets.
7. Following the self-hosting guide from a clean environment and completing the
   target-to-triage journey.

### Failure Modes to Prevent

- **Security destroys capability**: require explicit capabilities, both trust
  profiles, functional regression tests, and approval for removals.
- **Hardening silently degrades performance**: baseline first and enforce the
  performance budget in the evidence matrix.
- **Single-user assumptions leak into hosting**: require tenant context in
  interfaces and two-tenant negative tests.
- **Local self-hosting becomes impractical**: verify a documented trusted-local
  path with simple startup and explicit opt-ins.
- **Findings say zero when data failed**: model and test degraded states.
- **Production works only in unit tests**: require actual compose, DIND,
  Temporal, telemetry, storage, and critical-journey smoke tests.
- **Schema drift returns**: use one migration authority and CI parity checks.
- **Notifications or cleanup depend on polling**: use durable finalization,
  reconciliation, and restart/cancellation tests.
- **Scope expands indefinitely**: defer unrelated features and theoretical
  hardening; stop at the enumerated end state.

### Context

Sentris Flow should remain a powerful open-source alternative to costly security
orchestration products and practical for local/self-hosted operation. Security
controls matter when they protect realistically reachable credentials, tenant
data, execution authority, or durable integrity. They are not a goal in
isolation and must be balanced against scanner capability, workflow flexibility,
performance, and operational simplicity.

### Examples

**Good:** Keep stdio MCP as an explicit trusted-local capability with a minimal
environment while multi-user hosting uses authenticated, allowlisted,
digest-pinned container discovery. Preserve scanner egress through per-component
declarations and regression tests.

**Bad:** Disable all container networking or all MCP execution to eliminate
SSRF/command risk, breaking legitimate security workflows without measuring the
actual threat, asset value, alternatives, or performance impact.
