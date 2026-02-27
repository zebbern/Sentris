# Security Policy

We take security and user trust seriously. Please use the private channels below to report vulnerabilities so we can assess and remediate before public disclosure.

## Reporting a Vulnerability
- Preferred: Open a private advisory via GitHub’s “Report a vulnerability” link for this repository.
- Alternative: Email `security@shipsec.ai` with a clear subject (e.g., `Vulnerability report: <area>`).

Please include:
- Affected area (frontend, backend, worker, shared package) and commit/branch if known.
- Reproduction steps or proof-of-concept.
- Impact assessment (confidentiality/integrity/availability) and any prerequisites.
- Suggested fixes or mitigations if you have them.

We aim to acknowledge new reports within 3 business days and provide an initial remediation plan or timeline within 10 business days.

## Scope & Expectations
- Do not test against production data you do not own. Avoid actions that degrade availability.
- Respect privacy and data integrity; use test tenants/accounts where possible.
- No bounties are currently offered; coordinated disclosure credit is provided in release notes when applicable.

## Handling Secrets
- Never include real secrets or tokens in issues, PRs, or logs. Use `.env.example` for new configuration keys and follow existing patterns for secret management.
