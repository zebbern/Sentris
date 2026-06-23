# Bug Bounty Evidence Router Design

## Purpose

Add a reusable workflow template that turns messy bug bounty research notes into a structured public-data triage report. Researchers often start with a paste of target URLs, package names, CVE IDs, and observations rather than a clean single-purpose input. Existing templates are strong once the user already knows whether they are doing repository dependency triage, CVE impact research, or web exposure mapping; this template routes mixed evidence into the right next steps.

## Selected Approach

Use existing nodes only:

- `core.workflow.entrypoint` accepts mixed evidence notes, optional authorized targets, default package ecosystem, and authorization notes.
- `core.logic.script` extracts and normalizes CVE IDs, HTTP targets, npm-style package specs, domains, and freeform observations.
- `sentris.httpx.scan` safely probes extracted URLs/domains for live HTTP metadata.
- `sentris.osv.query` checks extracted package specs against OSV.
- `sentris.nvd.cve.query` enriches CVE IDs, or falls back to a keyword only when no CVE ID is present.
- `core.http.request` fetches the CISA KEV catalog as public exploitability context.
- `core.logic.script` assembles routed findings, follow-up recommendations, warnings, and evidence buckets.
- `core.artifact.writer` stores the JSON report.

This should not replace deeper scanners. It is a front-door triage workflow that recommends which specialized workflow to run next.

## Runtime Inputs

- `evidenceNotes` required text: pasted notes from recon, reports, program scope, chat, terminal output, or dependency research.
- `authorizedTargets` optional array: known in-scope hosts or URLs that may be probed.
- `packageEcosystem` optional text: defaults to `npm` for package specs.
- `authorizationNotes` optional text: copied into the final report.

Optional inputs must define type-appropriate defaults so blank fields do not become `undefined` at runtime.

## Data Flow

1. Parse notes and targets into bounded, deduplicated buckets:
   - CVE IDs such as `CVE-2024-3094`.
   - URL/domain targets for live HTTP probing.
   - npm-style package specs such as `lodash@4.17.20` or `express`.
   - Plain observations that should stay in the artifact but not drive network calls.
2. Run public enrichment:
   - HTTPX on at most 20 URL/domain targets.
   - OSV on at most 40 package specs.
   - NVD on explicit CVE IDs when present, otherwise on one conservative keyword.
   - CISA KEV catalog fetch with non-fatal errors.
3. Assemble a report with:
   - `runNow`: high-confidence follow-up workflows or checks.
   - `manualReview`: items needing human validation.
   - `notEnoughEvidence`: extracted observations that are not actionable yet.
   - `recommendedFollowUpWorkflows`: template names matching each evidence type.

## Report Requirements

The artifact must include:

- Input summary and authorization notes.
- Extracted indicators with caps/truncation metadata.
- HTTP response evidence and top live targets.
- OSV package findings sorted by severity.
- NVD/KEV CVE context when available.
- Clear next steps that point to existing specialized templates instead of duplicating them.

## Validation

Focused tests should prove:

- The seed template exists and has the expected node wiring.
- Optional runtime inputs have defaults.
- The parser extracts CVEs, URLs, authorized targets, and package specs without duplicating values.
- The report assembler prioritizes KEV CVEs, OSV package findings, and live HTTP targets.

Live verification should force-run only this template with public safe inputs and inspect node I/O to confirm the run completes, writes an artifact, and provides useful routing output.
