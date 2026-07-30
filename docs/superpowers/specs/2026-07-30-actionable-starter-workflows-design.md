# Actionable Starter Workflows

## Goal

Make the first useful Sentris Flow experience broader and easier to understand without adding setup-heavy tools, credentials, AI calls, or a new result schema.

Success means:

- two common security-review jobs are available as official no-secret templates;
- each template completes with a useful JSON artifact even when a public data source returns an error;
- terminal runs surface report metrics and next actions without requiring the user to inspect raw JSON;
- reviewed official no-setup templates remain Recommended on a fresh open-source install where no local live-audit ledger exists.

## Scope decision

The repository already contains 35 official templates, including at least eight that the product classifies as no-setup. Adding five more would duplicate existing CVE, repository, web, API, and reconnaissance coverage.

This batch adds only two missing verticals:

1. **Domain Email Authentication Posture** — inspect public SPF, DMARC, and MX records through DNS-over-HTTPS and produce prioritized remediation guidance. DKIM is explicitly excluded because selectors cannot be inferred reliably.
2. **OIDC Discovery Configuration Review** — inspect public OpenID Connect discovery metadata and identify evidence-backed configuration review items without invoking authorization or token endpoints.

## Considered approaches

### Add five new templates

This maximizes catalog count but overlaps existing templates and creates more validation and maintenance work. Rejected because catalog breadth is not the current constraint.

### Curate only existing templates

This is fastest and avoids seed work, but leaves meaningful email-authentication and identity-configuration gaps. Rejected because two small additions materially broaden the starter catalog.

### Add two gap-filling templates and improve all report results

This is the selected approach. It adds distinct user value while making the entire existing report-producing catalog easier to consume.

## Template architecture

Both templates use existing workflow contracts:

```text
Entrypoint → request builder → public HTTP request(s) → report assembler → artifact writer
```

Allowed components:

- `core.workflow.entrypoint`
- `core.logic.script`
- `core.http.request`
- `core.artifact.writer`

They require no stored secrets or separately installed scanner tools after Sentris is running. `core.logic.script` uses the platform-managed Bun container, so the base Sentris Docker runtime remains required.

### Domain Email Authentication Posture

Input:

- `domain` — required domain name
- `authorizationNotes` — optional context

The request builder normalizes the domain and creates Google DNS-over-HTTPS URLs for root TXT, `_dmarc` TXT, and MX records. The assembler:

- extracts SPF and DMARC records;
- reports missing or multiple SPF policies;
- reports missing DMARC, monitoring-only policy, or partial enforcement coverage;
- reports whether MX records exist;
- preserves raw observed records as evidence;
- produces `summary`, `findings`, `warnings`, and `nextSteps`.

Network and parse failures become report warnings rather than failing the workflow.

### OIDC Discovery Configuration Review

Input:

- `issuerUrl` — required HTTPS issuer URL
- `authorizationNotes` — optional context

The request builder normalizes the issuer and appends `/.well-known/openid-configuration`. The assembler reviews advertised metadata for:

- issuer mismatch;
- non-HTTPS authorization, token, JWKS, or user-info endpoints;
- missing PKCE `S256` advertisement;
- `none` in advertised ID-token signing algorithms;
- implicit or hybrid response types that merit review.

The report distinguishes advertised capability from enforced behavior and does not label public-client authentication method `none` as a vulnerability by itself.

## Actionable run summaries

`RunResultsSummary` will replace its current placeholder with a small deterministic renderer.

Data flow:

1. Reuse the existing run-artifact list query.
2. Select the most report-like small JSON artifact produced by `core.artifact.writer`.
3. Reuse the existing cached artifact-preview query.
4. Parse the artifact root, `report`, or `brief` envelope defensively.
5. Render up to four primitive summary metrics, the first warning or recommendation, and the first two next actions.
6. Provide a **View full report** action that opens the existing Artifacts tab.

Malformed, unsupported, oversized, missing, or failed-download artifacts never affect run status. The existing node counts, duration, and artifact count remain visible, with a neutral full-report fallback where possible. All artifact content is rendered as React text; HTML and Markdown are not interpreted.

## Recommendation fallback

The backend always returns a validation object, while the live-audit ledger is local and gitignored. On a fresh install that makes every official template's validation status `unknown`, preventing the Recommended state even though local seeds are reviewed and marked verified.

Recommendation eligibility will therefore use:

- current live-verified evidence when present;
- reviewed `isVerified` status only when validation is absent or explicitly `unknown`;
- no fallback for stale, failed, or review-required live evidence.

The UI will not display a Live verified badge unless current live evidence exists.

## File boundaries

Template stream:

- two new files under `backend/scripts/seed-templates/`;
- focused seed assertions in the existing template seed tests;
- deterministic live inputs in `packages/shared/src/template-validation-fingerprint.ts`;
- corresponding live-input utility assertions.

Result-summary stream:

- new pure parser/selection helper;
- new small report-summary component and tests;
- one import and placeholder replacement in `RunResultsSummary.tsx`.

Recommendation stream:

- `frontend/src/pages/template-library/setupLevel.ts`;
- its focused tests only.

One owner edits each file during parallel implementation. Existing design edits outside these files are left untouched.

## Verification

- compile and validate every seed graph;
- unit-test both report assemblers with healthy and unavailable-source inputs;
- unit-test report selection, parsing, zero/false preservation, caps, and malformed JSON;
- component-test loading, fallback, actionable output, and View full report behavior;
- unit-test the recommendation fallback and stale-evidence precedence;
- dry-run and apply template seeding against active instance 0;
- live-audit only the two new templates and require completed runs with artifacts;
- run the focused frontend/backend/shared tests and typechecks;
- manually verify one template-to-summary browser path.

The known unrelated stale entries in the broader template-validation ledger do not block this batch.
