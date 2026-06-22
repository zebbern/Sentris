# API Surface Exposure Triage Design

## Goal

Create a reusable bug bounty workflow template that finds exposed API documentation, GraphQL consoles, debug/admin paths, and API-related misconfiguration signals from authorized seed URLs.

## Context

The current template library already covers broad recon, web quick wins, takeovers, secret exposure, public repository code/IaC checks, dependency CVEs, service CVE mapping, and CVE research briefs. It does not have a focused API surface workflow that turns a small set of in-scope URLs into a ranked list of API documentation and console exposures.

## Approach

Use existing workflow components:

- `core.workflow.entrypoint` accepts authorized seed URLs, optional known API paths, scan intensity, and authorization notes.
- `sentris.katana.run` performs bounded crawling with strict scope.
- `core.logic.script` generates a deduplicated candidate URL list from seed URLs, Katana endpoints, and common API/documentation paths.
- `sentris.httpx.scan` probes candidates and records status, titles, redirects, technologies, and response metadata.
- `sentris.nuclei.scan` runs focused exposure, misconfiguration, GraphQL, panel, and token templates against the same candidates.
- `core.logic.script` ranks HTTP responses and Nuclei findings into a report.
- `core.artifact.writer` stores the report as a run artifact.

## Runtime Inputs

- `seedUrls`: list of authorized HTTP/HTTPS URLs.
- `knownApiPaths`: optional list of program-known paths such as `/api`, `/graphql`, or `/swagger`.
- `scanIntensity`: `safe` or `thorough`; defaults to `safe`.
- `authorizationNotes`: optional text copied into the report.

## Signal Strategy

The workflow should favor high-signal API findings:

- GraphQL consoles and introspection endpoints.
- Swagger/OpenAPI/Redoc documentation.
- API docs with authentication or environment clues.
- Debug, actuator, metrics, admin, and API explorer paths.
- Nuclei findings from focused exposure/configuration templates.

The workflow should not perform destructive actions, fuzzing, auth bypass attempts, or high-volume scanning. Candidate generation must be bounded and deduplicated.

## Report Shape

The final artifact contains:

- summary counts by source, severity, selected candidate count, and top risk.
- candidate evidence from HTTPX.
- Nuclei findings.
- prioritized findings sorted by severity and confidence.
- authorization notes and recommended manual validation steps.

## Validation

Automated seed-template tests should prove:

- the graph compiles and wires Katana, HTTPX, Nuclei, candidate generation, ranking, and artifact output.
- the ranking script prioritizes GraphQL, Swagger/OpenAPI, and Nuclei exposure findings correctly.

Live validation should run only the new template against a safe public target and confirm a completed run plus an artifact. After that, the full template audit should skip unchanged validated templates and report no delete/review candidates.
