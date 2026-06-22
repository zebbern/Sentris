# Subdomain Takeover Triage Template Design

## Purpose

Add a reusable bug bounty workflow template that helps researchers triage potential subdomain takeover candidates inside authorized scope. The template should use existing Sentris nodes, avoid secrets, run safely by default, and produce a clear artifact that separates high-confidence Nuclei matches from lower-confidence DNS/HTTP indicators that require manual validation.

## Scope

The template will be named `Subdomain Takeover Triage`. It will be a seed template under `backend/scripts/seed-templates` and appear in the Template Library as a `bug-bounty` template. It will not add a new worker component yet; the first version proves practical value using existing `subfinder`, `dnsx`, `httpx`, `nuclei`, script, and artifact writer nodes.

Runtime inputs:

- `domains`: required array of authorized root domains.
- `knownSubdomains`: optional array of already-known in-scope hostnames. This makes live verification deterministic and lets users triage imported recon.
- `authorizationNotes`: optional text field for scope and rate-limit notes.

## Workflow

The graph discovers candidate hostnames from root domains, merges them with `knownSubdomains`, resolves DNS with CNAME-aware output, probes HTTP services, runs safe Nuclei takeover checks, and ranks candidates into a JSON report.

Candidate ranking should prioritize:

- Confirmed Nuclei takeover findings.
- Dangling-looking CNAME targets such as `github.io`, `herokuapp.com`, `azurewebsites.net`, `cloudfront.net`, `s3.amazonaws.com`, `pages.dev`, and similar managed-service hostnames.
- HTTP responses with takeover-like body/title text such as "no such app", "repository not found", "project not found", "there isn't a GitHub Pages site here", or "bucket not found".

The report should include `summary`, `candidates`, `dnsSignals`, `httpSignals`, `nucleiFindings`, and `nextSteps`. It must explicitly say that manual ownership validation is required before reporting.

## Error Handling

The template should tolerate empty discovery results by still carrying `knownSubdomains` into DNS/HTTP checks. If no signals are found, the artifact should still be written with zero candidates and next steps explaining that no takeover indicators were observed.

## Testing And Verification

Add seed-template tests that require:

- `subdomain-takeover-triage.json` exists and compiles.
- The template is included in `TemplateService.useTemplate` seed coverage.
- The ranking script elevates Nuclei-confirmed findings over weak DNS-only hints and returns priority metadata.

Live verification should run only this new template. Existing known-good templates must not be rerun unless their affiliated template, live input, or audit behavior changes.
