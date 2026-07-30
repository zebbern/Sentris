import { describe, expect, it } from 'bun:test';

import {
  FINDINGS_CONTRACT_CLASSIFICATION_FIELD,
  FINDINGS_CONTRACT_CLASSIFICATION_VERSION,
  FINDINGS_CONTRACT_VALIDATION_VERSION_FIELD,
  FINDINGS_FINAL_INGEST_PIPELINE_ID,
  FINDINGS_INDEX_TEMPLATE_VERSION,
  buildFindingsFinalIngestPipeline,
  buildFindingsIndexTemplate,
  buildFindingsReindexPlan,
  buildOrganizationFindingsIndexTemplate,
  hashFindingsMappingInvariant,
} from '../findings-index-template';
import {
  buildFindingObservationIndexName,
  buildFindingOrganizationIndexKey,
} from '@sentris/shared/finding-observation-id';

describe('findings index template', () => {
  it('pins every queryable triage field to an exact OpenSearch mapping', () => {
    const template = buildFindingsIndexTemplate(['security-findings-*']);
    const properties = template.template.mappings.properties;
    const triage = properties.sentris.properties.triage;

    expect(template.version).toBe(FINDINGS_INDEX_TEMPLATE_VERSION);
    expect(template._meta.sentris_contract_classification_version).toBe(
      FINDINGS_CONTRACT_CLASSIFICATION_VERSION,
    );
    expect(template.template.settings['index.final_pipeline']).toBe(
      FINDINGS_FINAL_INGEST_PIPELINE_ID,
    );
    expect(properties.run_id).toEqual({ type: 'keyword' });
    expect(properties.workflow_id).toEqual({ type: 'keyword' });
    expect(properties.component_id).toEqual({ type: 'keyword' });
    expect(properties.workflow_name).toEqual({ type: 'text' });
    expect(properties[FINDINGS_CONTRACT_CLASSIFICATION_FIELD]).toEqual({ type: 'keyword' });
    expect(properties[FINDINGS_CONTRACT_VALIDATION_VERSION_FIELD]).toEqual({
      type: 'integer',
    });
    expect(properties.sentris.properties.contract_validated).toEqual({ type: 'boolean' });
    expect(properties.sentris.properties.contract_source_validated).toEqual({ type: 'boolean' });
    expect(properties.sentris.properties.contract_document_id).toEqual({ type: 'keyword' });
    expect(triage).toEqual({
      type: 'object',
      dynamic: 'strict',
      properties: {
        status: { type: 'keyword' },
        assignee_user_id: { type: 'keyword' },
        severity_override: { type: 'keyword' },
        notes: { type: 'text', index: false },
        updated_at: { type: 'date' },
        version: { type: 'long' },
      },
    });
  });

  it('preserves arbitrary JSON in source and evidence without dynamic field mappings', () => {
    const template = buildFindingsIndexTemplate(['security-findings-observations']);
    const mappings = template.template.mappings;
    const properties = mappings.properties as Record<string, any>;

    expect(mappings.dynamic).toBe(false);
    expect(properties.evidence).toEqual({ type: 'object', enabled: false });
    expect(properties.source).toEqual({ type: 'object', enabled: false });
    expect(properties.sentris.dynamic).toBe(false);
  });

  it('treats OpenSearch-omitted default object types as the same mapping contract', () => {
    const expected = buildFindingsIndexTemplate(['security-findings-observations']).template
      .mappings;
    const installed = structuredClone(expected) as {
      properties: {
        sentris: {
          type?: string;
          properties: {
            triage: {
              type?: string;
            };
          };
        };
      };
    };
    delete installed.properties.sentris.type;
    delete installed.properties.sentris.properties.triage.type;

    expect(hashFindingsMappingInvariant(installed)).toBe(hashFindingsMappingInvariant(expected));
  });

  it('indexes one normalized severity field for canonical and case-variant legacy rows', () => {
    const template = buildFindingsIndexTemplate(['security-findings-observations']);
    const properties = template.template.mappings.properties as Record<string, unknown>;
    const script = buildFindingsFinalIngestPipeline().processors[0].script.source;

    expect(properties.sentris_normalized_severity).toEqual({ type: 'keyword' });
    expect(script).toContain("ctx.sentris_normalized_severity = 'high'");
    expect(script).toContain('ctx.severity.toLowerCase()');
    expect(script).toContain("ctx.sentris_normalized_severity = 'none'");
  });

  it('emits Painless-compatible numeric character comparisons for canonical dates and IDs', () => {
    const script = buildFindingsFinalIngestPipeline().processors[0].script.source;

    expect(script).toContain('value.charAt(length - 1) != 90');
    expect(script).toContain('value.charAt(4) != 45');
    expect(script).toContain('value.charAt(10) != 84');
    expect(script).toContain('digit < 48 || digit > 57');
    expect(script).toContain('(digit >= 97 && digit <= 102)');
    expect(script).not.toContain("digit < '0'");
    expect(script).not.toContain("digit >= 'a'");
  });

  it('applies the final pipeline template only to the exact observation index', () => {
    const organizationId = 'Org-Case-Sensitive';
    const template = buildOrganizationFindingsIndexTemplate(organizationId);

    expect(template.index_patterns).toEqual([buildFindingObservationIndexName(organizationId)]);
    expect(template.index_patterns[0]).not.toContain('*');
  });

  it('overwrites caller attestations, classifies the complete source, and rejects ID drift', () => {
    const pipeline = buildFindingsFinalIngestPipeline();
    const script = pipeline.processors[0].script.source;

    expect(pipeline.version).toBe(FINDINGS_INDEX_TEMPLATE_VERSION);
    expect(script).toContain(
      `ctx.${FINDINGS_CONTRACT_VALIDATION_VERSION_FIELD} = ${FINDINGS_CONTRACT_CLASSIFICATION_VERSION}`,
    );
    expect(script).toContain(`ctx.${FINDINGS_CONTRACT_CLASSIFICATION_FIELD} = 'invalid'`);
    expect(script).toContain(`ctx.${FINDINGS_CONTRACT_CLASSIFICATION_FIELD} = 'legacy'`);
    expect(script).toContain(`ctx.${FINDINGS_CONTRACT_CLASSIFICATION_FIELD} = 'canonical'`);
    expect(script).toContain("ctx.containsKey('contract')");
    expect(script).toContain("ctx.containsKey('schema_version')");
    expect(script).toContain("source.containsKey('evidence')");
    expect(script).toContain("source.containsKey('source')");
    expect(script).toContain('boolean isCanonicalDateTime(def value)');
    expect(script).toContain('boolean isCanonicalFindingId(def value)');
    expect(script).toContain('digit >= 97 && digit <= 102');
    expect(script).toContain('value.charAt(length - 1) != 90');
    expect(script).not.toContain('source.source instanceof Map');
    expect(script).toContain("source.severity == 'critical'");
    expect(script).toContain("source.severity == 'none'");
    expect(script).toContain('source.title.length() > 0');
    expect(script).toContain('sentris.scope_id == null');
    expect(script).toContain('sentris.contract_document_id == source.finding_id');
    expect(script).toContain('ctx._id != ctx.finding_id');
    expect(script).toContain('ctx._id != sentris.contract_document_id');
    expect(script).toContain('throw new IllegalArgumentException');
    expect(
      script.indexOf(`ctx.${FINDINGS_CONTRACT_CLASSIFICATION_FIELD} = 'invalid'`),
    ).toBeLessThan(script.indexOf('boolean hasContractMarker'));
    expect(script.indexOf('throw new IllegalArgumentException')).toBeLessThan(
      script.indexOf(`ctx.${FINDINGS_CONTRACT_CLASSIFICATION_FIELD} = 'canonical'`),
    );
  });

  it('builds a deterministic non-destructive legacy-to-stable reindex plan', () => {
    const plan = buildFindingsReindexPlan('org-1', [
      'security-findings-org-1-2026.07.25',
      'security-findings-org-1-observations-v1',
      'security-findings-org-1-2026.07.24',
      'security-findings-org-1-seed',
      'security-findings-org-2-2026.07.25',
    ]);

    expect(plan.targetIndex).toBe(buildFindingObservationIndexName('org-1'));
    expect(plan.sourceIndices).toEqual([
      'security-findings-org-1-2026.07.24',
      'security-findings-org-1-2026.07.25',
      'security-findings-org-1-observations-v1',
    ]);
    expect(plan.targetIndex).toContain(buildFindingOrganizationIndexKey('org-1'));
    expect(plan.deleteSources).toBe(false);
  });
});
