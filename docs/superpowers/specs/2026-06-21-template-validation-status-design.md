# Template Validation Status Design

## Goal

Show the latest live-validation state for each Template Library item so broken, stale, or low-value templates are visible in the app without reading audit files.

## Scope

This is a local maintenance feature for the existing Template Library. It does not add a database migration or retest templates. It exposes the current audit ledger when available and degrades to an unknown validation state when the ledger is missing.

## Backend Design

Add a small template-validation ledger reader under `backend/src/templates/`. It reads `template-live-audit-ledger.json` from:

- `TEMPLATE_AUDIT_LEDGER_PATH`, when set
- `<backend cwd>/.cache/template-live-audit-ledger.json`
- `<backend cwd>/../.cache/template-live-audit-ledger.json`

The service parses version `1` ledger entries and exposes a `getValidationForTemplate(template)` method. A template with a matching ledger entry receives:

- `status`: `live-verified`, `needs-fix`, `needs-review`, or `unknown`
- `recommendation`
- `terminalStatus`
- `artifactsCount`
- `verifiedAt`
- `rationale`
- `isCurrent`, false when `template.updatedAt` is newer than `verifiedAt`

`TemplateService.listTemplates()` and `getTemplateById()` enrich returned rows with this `validation` object. If the ledger is missing or malformed, templates still load with `status: unknown`.

## Frontend Design

Extend `Template` with optional `validation` metadata. `TemplateCard` renders a compact validation badge in the metadata line:

- Live verified: green shield/check, includes artifact count and verified age
- Needs fix/review: amber warning
- Unknown: muted badge
- Stale: amber text indicating validation predates the template update

The badge uses a tooltip for rationale and exact terminal/recommendation context. It stays small so the library remains scan-friendly.

## Testing

Backend:

- Unit-test that `TemplateService.listTemplates()` enriches templates with ledger-backed validation metadata.
- Unit-test the ledger reader fallback for missing entries.

Frontend:

- Page/card test that a template with validation renders `Live verified`.
- Page/card test that stale validation renders a stale indicator.

Verification:

- Focused backend template service tests.
- Focused frontend Template Library page tests.
- Typecheck and lint if code paths changed in both backend and frontend.
