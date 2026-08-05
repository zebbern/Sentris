# Canonical Template Findings and Optional TLS Design

## Outcome

Maintained finding-producing templates publish scanner results through Sentris's canonical findings pipeline, so the run card, Operator evidence, and Findings dashboard report the same results. OSV observations retain bounded advisory timestamps and reference links. The website quick-win template skips TLS scanning cleanly when an HTTP-only target yields no HTTPS endpoint, while preserving `testssl` for real TLS targets.

## Canonical Findings

The npm dependency CVE hunt and GitHub repository dependency CVE triage templates connect each OSV node's analytics-ready `results` to the existing `core.analytics.sink`. Finding-producing sinks omit `indexSuffix`, selecting the organization-scoped canonical observation index, deterministic finding IDs, and immutable observation writes. The same no-suffix rule applies to the GitHub Actions supply-chain and public repository full-code-security templates; the Gemini npm investigator was already canonical.

Explicit suffixes still select generic custom analytics and remain valid for non-finding data such as the attack-surface asset inventory. They are not an alternate findings index.

OSV analytics results place the advisory's `published`, `modified`, and normalized `references` in canonical `evidence`. Reference normalization keeps at most eight links. Artifact/report generation remains unchanged.

This reuses the same OpenSearch-backed ingestion and run-scoped findings query used by scanner-backed templates. It does not introduce another normalizer, persistence service, or post-run output scraper.

## Optional TLS Branch

Replace the website quick-win template's fake `no-https-target-provided.invalid:443` target with explicit conditional execution:

1. Route the extracted HTTPS target list with `sentris.conditional-router.run` using the existing non-empty condition.
2. On the matched branch, select a real TLS target and run `sentris.testssl.run` as today.
3. On the unmatched branch, return an explicit empty TLS-findings result.
4. Rejoin the mutually exclusive branches through one `any`-join normalization node.
5. Feed that guaranteed normalized TLS result into the existing ranking node, which keeps its `all` dependency semantics for the other scanners.

The conditional branch remains template-local because the optionality comes from this workflow's input derivation, not from global `testssl` behavior. A genuine TLS scan failure still fails visibly; only the absence of an HTTPS target is treated as a valid empty result.

## Invariants

- OpenSearch analytics ingestion remains the one canonical findings write path.
- Run findings remain scoped by organization and run through existing APIs.
- Finding-producing sinks omit `indexSuffix`; non-finding custom analytics may use an explicit suffix.
- OSV canonical evidence retains `published`, `modified`, and at most eight normalized references.
- OSV report artifacts remain available and are not replaced by the findings index.
- HTTPS targets continue to receive TLS scanning; HTTP-only targets do not generate fake network work or false trace failures.
- Ranking waits for the real scanner branches and exactly one TLS outcome.
- No new component implementation or second scheduler is introduced.
- Existing saved workflow versions and historical runs are not migrated. Newly materialized workflows use the updated templates.

## Verification

- Validate and compile all changed maintained-template graphs.
- Run focused template/component checks covering canonical no-suffix wiring, OSV evidence projection, custom analytics behavior, and both TLS branches.
- Reseed the templates in local instance 0.
- Through Operator, run one dependency-CVE workflow that produces a known OSV advisory and confirm the run card, Operator result, and Findings view agree.
- Through Operator, run the website quick-win workflow against an HTTP-only target and confirm TLS is skipped without a trace failure while the other scanners and ranking complete.
