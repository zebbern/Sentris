# Public Repo Secret Exposure Triage Template Design

## Purpose

Add a reusable bug bounty workflow template that scans an authorized public Git repository for verified credential leaks and writes a redacted triage report. This fills a practical template-library gap: repository exposure checks are common in bug bounty programs, and the platform already has a TruffleHog component that can run this safely without new infrastructure.

## Scope

The template will be named `Public Repo Secret Exposure Triage`. It will be a seed template under `backend/scripts/seed-templates` and appear in the Template Library as a `bug-bounty` template. It will use existing nodes only:

- `core.workflow.entrypoint`
- `sentris.trufflehog.scan`
- `core.logic.script`
- `core.artifact.writer`

Runtime inputs:

- `repositoryUrl`: required public Git repository URL that the researcher is authorized to test.
- `authorizationNotes`: optional text for program scope, exclusions, and reporting context.

The first version will scan Git history with TruffleHog's verified-results mode. It will not scan GitHub issue or pull request comments because that often requires API tokens and can materially increase runtime/noise.

## Workflow

The graph receives an authorized repository URL, runs TruffleHog in `git` mode with JSON output and verified-only filtering, assembles a redacted JSON report, and saves the report as a run artifact.

The report should include:

- `summary.repositoryUrl`
- `summary.secretCount`
- `summary.verifiedCount`
- `summary.hasVerifiedSecrets`
- `findings[]` with detector name/type, verification state, file, commit, timestamp, and redacted value only
- `analyticsResults[]` from TruffleHog for downstream sink compatibility
- `authorizationNotes`
- `nextSteps`

The script must not copy raw secret values into the artifact. If TruffleHog returns `Raw` or `RawV2`, the report should prefer `Redacted` and otherwise use a fixed `[redacted]` placeholder.

## Error Handling

If TruffleHog returns no secrets, the workflow should still write an artifact with zero counts and next steps stating that no verified secrets were detected. If the public repository cannot be cloned or scanned, the TruffleHog node should fail the workflow, which is appropriate because the report would not be trustworthy.

## Testing And Verification

Add seed-template tests that require:

- `public-repo-secret-exposure-triage.json` exists and compiles.
- The template is included in `TemplateService.useTemplate` seed coverage.
- The report script redacts raw secret values and prioritizes verified findings in its summary.

Live verification should run only this new template with a small public repository fixture such as `https://github.com/octocat/Hello-World`. Existing known-good templates must not be rerun unless their affiliated template, live input, or audit behavior changes.
