# ADR: Versioned Findings Ownership and Query Projection

## Status

**Proposed** — 2026-07-26

## Context

Workers emit immutable security observations to OpenSearch while PostgreSQL
stores mutable triage state. The split is useful for full-text search and
aggregations, but ad hoc joins produce inconsistent filters, totals, charts,
exports, and scope counts. In particular, materializing a bounded list of
triaged IDs cannot represent organizations with more than 10,000 triaged
findings, and returning an empty summary when OpenSearch fails misrepresents
unknown data as zero.

Worker component schemas also vary. Without one versioned ingestion contract,
backend query behavior can drift from what scanners actually write.

## Decision

`packages/shared` owns a versioned findings observation contract. The worker
validates and emits that contract; the backend validates versioned documents
again at its read boundary and uses an explicit adapter for pre-contract
documents.
Every observation includes:

- schema version and deterministic finding identity
- exact `sentris.organization_id`
- source workflow and run IDs
- scope and asset identity when known
- component/tool identity
- observed timestamp
- canonical lower-case severity, title, description, evidence, and source metadata

Organization, run, scope, and source identity come from authorized execution
context, not arbitrary finding payload fields. Re-ingesting the same identity is
idempotent. The trusted worker stamps two validation attestations and binds the
canonical `finding_id` to an indexed `sentris.contract_document_id`. Canonical
writes use OpenSearch `create`, so replay keeps the original observation
content, observation timestamps, and any newer projected triage rather than
overwriting them.
Worker bulk acknowledgements are accepted only when OpenSearch returns exactly
one well-formed result for each requested operation. A canonical `create` 409
with `version_conflict_engine_exception` is an idempotent replay; valid 2xx
results are successes, valid operation failures are degraded, and missing,
extra, malformed, or contradictory item results fail the batch.

PostgreSQL remains the source of truth for mutable triage and its audit history.
OpenSearch remains the read-optimized finding store. A durable transactional
outbox projects triage state and a monotonic triage version into the
organization's finding document. Projection is idempotent and rejects older
versions. A synchronous best-effort write may reduce read-after-write latency,
but the outbox is the durability mechanism.
Assignee updates use a non-empty organization member ID or explicit `null` to
clear assignment in both single and bulk requests. Bulk membership is resolved
once per request. Duplicate or empty finding IDs are rejected, and semantic
no-ops do not create state, history, audit, or projection churn.

All finding lists, combined filters, totals, charts, scope summaries, and
exports use one normalized query model and the same OpenSearch projection.
Exact totals accept OpenSearch's legacy safe nonnegative integer form or
`{ value, relation: "eq" }`; missing, malformed, unsafe, negative, or
lower-bound (`gte`) totals are unavailable. Severity aggregations require
unique canonical severity keys, safe nonnegative counts, and a sum equal to the
exact total. This prevents lists, detail/existence checks, statistics, and
scope summaries from converting an unknown or partial answer into a false
zero.
Exports paginate with a point-in-time/search-after cursor rather than a fixed
result cap. Detail responses may overlay the authoritative PostgreSQL triage
row while reporting the projection watermark.

Canonical observations use a stable organization index and deterministic
document ID. A checked, non-destructive migration reindexes legacy daily
indexes with an exact `sentris.organization_id` ownership filter and
create-only writes; it never imports legacy mappings, overwrites an existing
observation, or deletes a source index. New index, template, role, tenant,
Dashboards, and control resources use
`o{sha256(exact UTF-8 organization ID)}`. This fixed-width key preserves case
and whitespace distinctions; it is an identity encoding, not a secrecy
boundary.

Template v6 pins canonical and supported legacy query fields, sets root and
`sentris` mappings to `dynamic: false`, and stores arbitrary scanner fields in
`_source` without letting them create mappings. `evidence` and `source` retain
their required contract keys and arbitrary JSON values, including scalars,
arrays, objects, and null, with parsing/indexing disabled. Custom analytics
suffixes remain generic: neither the observation template nor final pipeline
matches them.

The template configures a content-addressed final ingest pipeline on every
observation index.
Unlike a request-selected pipeline, an OpenSearch final pipeline cannot be
bypassed by a writer. The pipeline allows documents with both contract markers
absent to remain readable through the legacy adapter, but rejects a versioned
observation when either source identity differs from the actual document
`_id`. It overwrites caller-supplied storage attestations with an indexed
classification (`canonical`, `legacy`, or `invalid`) and classification version
derived from the stored source. It also writes one indexed
`sentris_normalized_severity` value: known case variants become their lower-case
bucket and missing/unknown values become `none`. Filters, statistics, charts,
and scope summaries use that field, while the original `severity` remains in
`_source`. Canonical validation includes the deterministic ID format, severity
enum, required and nullable fields, UTC timestamp grammar, and trusted-writer
markers. Its validation is idempotent and does not depend on update or upsert
requests rerunning an ingest pipeline.

Final ingest pipelines do not police arbitrary scripted `_update` mutations.
The supported triage projector only changes `sentris.triage` and must preserve
both identity fields and the storage attestation; OpenSearch write credentials
and allowed API usage are therefore part of the trusted computing base. An
administrator or unsupported writer can invalidate previously reconciled
exactness until the next full reconciliation detects and repairs the
classification. This residual risk is preferable to rescanning every document
on each read.

Exact-match queries prefer `sentris.*` and use disjoint root-field fallbacks
only when the corresponding canonical field is absent. Caller-selected
analytics suffixes cannot alias the canonical
`observations-v1` suffix or legacy `YYYY.MM.DD` findings suffixes after
normalization. Scope summaries resolve all organization-owned run IDs with
keyset pagination and query both canonical `sentris.run_id` and legacy root
`run_id` fields in bounded batches; there is no 10,000-run correctness
boundary.

Per-tenant reconciliation persists its cursor and cycle cutoff in PostgreSQL
and processes bounded pages until the tenant is complete. Its OpenSearch
completion watermark is bound to the observation-index UUID, so a rebuilt
projection cannot inherit stale health. Schema coverage is aggregated across
the full query with indexed classification and classification-version filters;
hot reads do not execute Painless or load `_source` for coverage. Both
`evidence` and `source` keys are required, but their values may be any JSON
value. Observed timestamps accept the shared contract's UTC `Z` form and reject
numeric offsets. A document is legacy only when both version marker keys are
absent; null or malformed markers and incomplete versioned documents are
invalid. Invalid coverage is derived from the exact query total minus the
disjoint canonical and legacy buckets.

OpenSearch does not expose metadata `_id` to ordinary aggregation scripts, so
the write path and reconciliation bind classification to the actual hit ID.
Returned versioned documents are also parsed against the shared schema and
bound directly to the hit `_id`. A point-in-time, search-after reconciliation
checks every existing hit in bounded pages and backfills or repairs indexed
classifications with sequence-number/primary-term optimistic concurrency.
Version conflicts retry the complete pass. Classification changes are refreshed
before the organization watermark is written to the control index.

Before any invariant verification or PIT scan, reconciliation durably
overwrites the prior control document with `verification_state: checking`. A
failed checking-state write aborts reconciliation. Before scanning and again
before publishing, reconciliation reads and hashes the installed final pipeline
body, exact organization template, current index mapping, final-pipeline
setting, and index UUID. Only a completed pass writes
`verification_state: verified`; the watermark binds their content hashes and
aggregate invariant fingerprint in addition to template, schema, and
classification versions. Before hashing, OpenSearch response representations
are normalized for semantically equivalent nested or dotted settings, numeric
and boolean strings, and harmless response defaults. All other material fields
remain hash inputs, so drift fails before verified watermark publication.
Missing, unverified, mismatched, or stale watermarks degrade nonzero aggregate
responses rather than claiming exactness. Healthy reads only check the bounded
verified watermark and current index settings; they do not rescan the corpus,
so a successfully reconciled index returns to available rather than remaining
permanently degraded.

List navigation uses one ten-minute point-in-time snapshot. Every cursor-mode
response includes a signed current cursor with a freshly issued ten-minute
expiry; the first page cursor encodes an empty search-after position on the same
PIT and original organization/query digest. Empty search-after values are not
sent to OpenSearch. Each search refreshes the PIT keepalive, so a user can move
backward after more than two minutes, including from a terminal page to page
one, and then forward on the same snapshot.

Scheduled triage reconciliation does not rely only on organizations already
present in PostgreSQL. Under the existing global PostgreSQL advisory lock, each
invocation advances one bounded composite-aggregation page across observation
indexes using `_index` plus exact `sentris.organization_id`. It validates that
each organization hashes back to its bucket index and enqueues organizations
with observation findings but no triage projection rows. The composite cursor
is persisted in the existing reconciliation control table only after its page
is processed, so restart retries an incomplete page, successful cycles resume
fairly, and the final page wraps discovery to the beginning. Batches are
bounded, and case-distinct IDs remain separate.

Exports scan the requested snapshot, enrich every returned item from
authoritative PostgreSQL triage in bounded 5,000-item batches, and expose
availability, projection health, and schema coverage through response headers.
If enrichment is unavailable, observation data may still be exported, but the
export is explicitly degraded. A full export page without continuation sort
values fails as unavailable instead of returning a truncated success. Durable
export audit succeeds before any response header or body is released.

Responses distinguish:

- **available** — query completed and the projection watermark satisfies the
  requested consistency policy;
- **degraded** — data is available but a dependency or projection is stale;
- **unavailable** — the query cannot establish a trustworthy answer.

Dependency failure, truncation, or missing coverage never returns a successful
zero. “Not scanned” and “scanned but not observed” are separate comparable-run
states derived from run coverage, not from absence of a finding alone.

## Consequences

### Positive

- Lists, filters, totals, charts, exports, and scope counts share one data grain
  and query definition.
- Query cost does not grow by loading every triaged ID into backend memory.
- Triage remains strongly durable and auditable in PostgreSQL.
- Versioned ingestion makes backend/worker drift testable.

### Negative

- Triage projection is eventually consistent and needs an observable watermark.
- A durable outbox, projector, reconciliation command, and upgrade migration
  are required.
- Existing component-specific finding outputs need adapters to the shared
  contract.
- The final pipeline adds a small validation cost to versioned observation
  ingestion. Existing-document classification reconciliation is O(N) in index
  reads and may write stale/missing attestations, although PIT pagination bounds
  memory and per-request work.

### Neutral

- OpenSearch is a projection and may be rebuilt; PostgreSQL triage history is
  not reconstructed from OpenSearch.

## Failure Modes and Required Verification

- Contract compatibility tests run against both backend and worker packages.
- Combined filters and exports agree on datasets above 10,000 triaged findings.
- Projection duplicates and out-of-order retries do not regress triage state.
- Observation replay preserves original content and timestamps while retaining
  newer triage.
- OpenSearch failure returns `degraded` or `unavailable`, never an empty success.
- Scope counts use canonical and legacy run ID fields with exact organization
  ownership.
- Full-query schema buckets partition the exact query total.
- Offset and cursor reads reject malformed or lower-bound totals, and severity
  buckets reject unknown keys, duplicates, unsafe counts, or a non-exact sum.
- A live OpenSearch compatibility corpus proves that the final-pipeline Painless
  validator compiles, overwrites forged attestations, and classifies missing
  optional evidence, scalar/array/object evidence, nested source JSON, UTC
  timestamps, offset timestamps, malformed/null markers, and legacy documents
  exactly like the shared schema. It also proves disabled objects retain their
  exact `_source` JSON without mapping conflicts.
- A live final-pipeline test rejects versioned source/metadata ID mismatches,
  permits marker-absent legacy documents, and verifies that request-selected
  pipelines cannot bypass the invariant.
- Migration verification proves pipeline installation precedes the template
  and target-index settings, reconciliation scans beyond 10,000 hits, and the
  persisted watermark becomes stale after an index rebuild or invariant
  version change. A live migration also proves case-colliding legacy index names
  only copy documents whose exact ownership field matches.
- Installed-pipeline, template, mapping, and index-setting drift must fail
  before PIT scanning or watermark publication. Live OpenSearch responses must
  be normalized only after confirming their returned shape.
- Reconciliation tests prove optimistic version conflicts retry, non-conflict
  write failures do not publish a watermark, and repaired classifications are
  refreshed before watermark publication.
- Reconciliation invalidates a prior healthy control document before checking
  same-index invariants; checking-state write failure aborts before scanning,
  and later invariant failure leaves hot reads unverified.
- Bulk response tests reject missing, extra, wrong-operation, malformed, and
  contradictory OpenSearch item results while preserving canonical replay
  idempotency.
- Scale tests record indexed schema-coverage latency, CPU, and heap behavior;
  coverage must not require `search.allow_expensive_queries`.
- Query profiling proves severity filters, statistics, charts, and scope
  summaries use the indexed normalized field without runtime fields or
  per-document scripts.
- A custom-suffix live write proves generic analytics does not invoke the
  finding final pipeline or inherit the canonical observation mapping.
- Export audit failure releases no headers or body, and authoritative triage
  enrichment is not truncated at 5,000 findings.
- Cursor navigation can return to page one from a terminal page and move forward
  again after more than two minutes while the ten-minute PIT remains valid.
- Composite discovery is tested live with `_index` aggregation and more than one
  page; a forged index/organization pairing is rejected.
- Reconciliation detects and repairs missing or stale projections, including an
  organization that has observations but no PostgreSQL triage rows.

## Alternatives Considered

**Keep the hybrid stores and join bounded ID arrays in application memory**

- Rejected because correctness changes at the cap and memory/latency scale with
  tenant history.

**Move every finding and search query to PostgreSQL immediately**

- Rejected for this release because it discards the existing search and
  aggregation investment and creates a larger migration with uncertain
  performance.

**Make OpenSearch the mutable triage source of truth**

- Rejected because lifecycle updates and audit history need transactional,
  relational durability.

**Return zero when analytics is unavailable**

- Rejected because a false zero is operationally more dangerous than an
  explicit degraded state.

## References

- `docs/architecture.mdx`
- `packages/shared/src/finding-triage.ts`
- `backend/src/findings/finding-triage.repository.ts`
- `docs/goals/self-hosted-platform-readiness.md`
