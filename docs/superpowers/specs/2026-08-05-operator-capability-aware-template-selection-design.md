# Operator Capability-Aware Template Selection Design

## Outcome

When a user explicitly asks Operator to find website vulnerabilities or security flaws, the maintained-template search can require an actual vulnerability-scanning component. Reconnaissance requests continue to match reconnaissance-only templates.

## Architecture

`list_workflow_templates` remains the single catalog boundary. Its typed input gains an optional bounded `requiredComponentIds` array, and each returned template summary includes the unique component IDs derived from the validated graph. `TemplateService.listTemplateCatalog` filters materializable templates by those exact graph contents before applying the result limit.

Operator guidance uses this contract for the concrete web-vulnerability case: require `sentris.nuclei.scan` when the request asks to detect vulnerabilities, flaws, exposures, or misconfigurations. It must not apply that requirement to discovery-only requests. The model still chooses among the matching maintained templates and must use the exact returned template ID and runtime-input contract.

## Invariants

- Template names and tags are descriptive metadata, not proof of executable capability.
- The validated template graph is the source of truth for `componentIds` and filtering.
- Filtering happens before `limit`, so a popular recon-only template cannot crowd out a matching scanner template.
- No new template, intent-classification service, capability ontology, authoring path, or scanner implementation is introduced.
- Existing template materialization, compilation, approval, saving, and running remain canonical and unchanged.
- Unknown but syntactically valid component IDs return an empty catalog; malformed or oversized input is rejected by the shared schema.

## Verification

- Shared contract checks accept bounded component requirements and expose component IDs.
- Template service checks prove graph-derived deduplication, pre-limit filtering, and exclusion of recon-only templates.
- Operator command checks prove the filter reaches the canonical catalog service unchanged.
- A real Gemini Operator request for website security flaws proposes a Nuclei-backed maintained template and shows its provenance in the UI.
