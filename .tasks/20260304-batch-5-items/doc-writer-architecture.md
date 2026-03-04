# Agent: doc-writer

## Purpose

Update architecture documentation to reflect recently added features: health checks, sticky sessions, Redis session registry, Findings Dashboard v2, SSRF guard, and correlation IDs.

## Skills

Load before starting: none

## Subtasks

### AGENTS.md Updates

- [x] Read current `AGENTS.md` Architecture section (lines ~185-229) to understand existing content
- [x] Add health check endpoints to Architecture section: backend `/health` and `/health/ready`, worker `:9100/health`
- [x] Add sticky sessions documentation: Nginx consistent hash by `mcp_affinity` cookie
- [x] Add Redis session registry and admin endpoint documentation
- [x] Add Findings Dashboard v2 mention: detail view, export, chart, advanced filters (ToolFilter, severity, status)
- [x] Add SSRF guard documentation: `component-sdk` validates URLs before HTTP requests
- [x] Add correlation ID documentation: `X-Request-Id` middleware propagates request IDs through the stack

### docs/architecture.mdx Updates

- [x] Read current `docs/architecture.mdx` to identify stale or missing sections
- [x] Add health check endpoints section (backend and worker) if not present
- [x] Add sticky sessions + Redis session registry to the architecture overview if not already documented
- [x] Add SSRF guard under the Security Architecture section
- [x] Add correlation IDs / observability section

### User Guide Updates

- [x] Read `docs/user-guide.mdx` to understand current structure
- [x] Add Findings Dashboard section covering: navigating findings, detail view, exporting findings, chart visualization, filtering by tool/severity/status

## Notes

- This is a documentation-only task — do not modify source code.
- Keep documentation concise and consistent with existing style in the docs.
- The architecture docs use MDX format (`.mdx` extension) — follow existing formatting patterns.
- Component categories are documented in `docs/architecture.mdx` under "Component Categories" — do not modify this section.
- Reference existing architecture diagram in `docs/architecture.mdx` for placement guidance.

## Completion Summary

<!-- Appended by orchestrator after agent completes. Do not fill manually. -->
