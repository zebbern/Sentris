# Agent: implementer

## Purpose

Create 3-4 new security workflow templates as JSON seed files, following the format of existing templates.

## Skills

Load before starting: component-development

## Subtasks

### Analysis

- [ ] Read 2 existing template files in `backend/scripts/seed-templates/` (e.g., `network-recon-pipeline.json` and `vulnerability-scanning-pipeline.json`) to understand the exact JSON structure: `_metadata`, `manifest`, `graph`, `requiredSecrets` fields
- [ ] Identify what components are available by checking `backend/src/` or existing templates for component references (httpx, nuclei, subfinder, dnsx, trufflehog, notify, etc.)
- [ ] Read the template seed script (look for a seeder in `backend/scripts/`) to understand how templates are loaded

### Template Creation

- [ ] Create `backend/scripts/seed-templates/dast-scanning.json` — DAST scanning template using httpx (target discovery) + nuclei (vulnerability scanning). Include `_metadata` with name, description, category ("Security Scanning"), tags. Define a graph with sequential httpx → nuclei nodes. List `requiredSecrets` for any needed API keys or target configs.
- [ ] Create `backend/scripts/seed-templates/dependency-audit.json` — Dependency/secret audit template using trufflehog for secret detection. Include appropriate `_metadata` (category: "Code Security"). Define a graph with trufflehog scanning node(s). List `requiredSecrets` for repository access tokens.
- [ ] Create `backend/scripts/seed-templates/dns-monitoring.json` — DNS monitoring template using subfinder (subdomain enumeration) + dnsx (DNS resolution) + notify (alerting). Include `_metadata` (category: "Reconnaissance"). Define a graph with sequential subfinder → dnsx → notify nodes. List `requiredSecrets` for notification channels.
- [ ] Create `backend/scripts/seed-templates/api-security-testing.json` — API security testing template using httpx + nuclei with API-focused scan profiles. Include `_metadata` (category: "API Security"). Define a graph targeting API endpoints. List `requiredSecrets` for target API credentials.

### Verification

- [ ] Validate each JSON file is well-formed (`bun -e "console.log(JSON.parse(require('fs').readFileSync('path')))"` or equivalent)
- [ ] Verify each template has all required top-level fields matching existing template structure
- [ ] Verify graph node IDs are unique within each template and edges reference valid node IDs
- [ ] Run `bun run typecheck` to confirm no issues introduced

## Notes

- There are 9 existing templates to use as reference: `incident-response-triage.json`, `container-security-scan.json`, `cloud-security-posture-audit.json`, `vulnerability-scanning-pipeline.json`, `phishing-email-analysis.json`, `network-recon-pipeline.json`, `ioc-enrichment-workflow.json`, `cloud-compliance-audit.json`, `cloud-asset-inventory.json`.
- Follow the EXACT JSON structure of existing templates. Match field names, nesting, and data types precisely.
- Templates must have realistic, useful security workflow configurations — not placeholder data.
- Each template should include a meaningful `description` in `_metadata` explaining the security use case.
- Component names in the graph must reference real components that exist in the system.

## Completion Summary

<!-- Appended by orchestrator after agent completes. Do not fill manually. -->
